import { randomUUID } from 'node:crypto';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { desc, eq, sql } from 'drizzle-orm';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import type * as schema from '../schema/index.js';
import { replyTargets, sessions } from '../schema/session.schema.js';
import { createLogger } from '../tools/logging.js';

const logger = createLogger('pg-session-store');

// In-memory cache max entries. Oldest (by last write order) are evicted.
const MAX_CACHE = 500;
// How long (ms) since last update before a session is considered stale
// and no longer reloaded from DB on startup.
const SESSION_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface Session {
  id: string;
  messages: ChatCompletionMessageParam[];
}

/**
 * Database-backed session store with an in-memory LRU cache.
 *
 * - createSession() inserts a row into agent_sessions.
 * - update() writes the messages JSONB + updated_at to Postgres and refreshes
 *   the in-memory cache entry.
 * - linkReplyTarget() inserts into agent_reply_targets; a unique index on
 *   discord_message_id prevents duplicates.
 * - getByReplyTarget() looks up the session via the reply_targets table.
 * - On startup, loadActiveSessions() pre-warms the cache from the DB
 *   (sessions updated within SESSION_STALE_MS).
 */
export class PgSessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly sessionIdByReplyTarget = new Map<string, string>();

  constructor(
    private readonly db: NodePgDatabase<typeof schema>,
  ) {}

  /**
   * Pre-load recently active sessions from the DB into the in-memory cache.
   * Call once at startup to restore conversation continuity across restarts.
   */
  async loadActiveSessions(): Promise<number> {
    const staleCutoff = new Date(Date.now() - SESSION_STALE_MS);

    const rows = await this.db
      .select({
        id: sessions.id,
        messages: sessions.messages,
        updatedAt: sessions.updatedAt,
      })
      .from(sessions)
      .where(
        sql`${sessions.updatedAt} >= ${staleCutoff}`,
      )
      .orderBy(desc(sessions.updatedAt));

    let loaded = 0;
    for (const row of rows) {
      const msgs = (row.messages as ChatCompletionMessageParam[]) ?? [];
      this.sessions.set(row.id, { id: row.id, messages: msgs });
      loaded++;
    }

    // Also load reply targets so in-memory lookups work
    const rtRows = await this.db
      .select({
        discordMessageId: replyTargets.discordMessageId,
        sessionId: replyTargets.sessionId,
      })
      .from(replyTargets)
      .orderBy(desc(replyTargets.createdAt));

    const cachedIds = new Set(this.sessions.keys());
    for (const rt of rtRows) {
      if (cachedIds.has(rt.sessionId)) {
        this.sessionIdByReplyTarget.set(rt.discordMessageId, rt.sessionId);
      }
    }

    logger.log(
      `Loaded ${loaded} active sessions, ${this.sessionIdByReplyTarget.size} reply targets`,
    );
    return loaded;
  }

  createSession(
    discordUserId?: string,
    discordChannelId?: string,
  ): Session {
    const id = randomUUID();
    const session: Session = { id, messages: [] };

    this.db
      .insert(sessions)
      .values({
        id,
        discordUserId,
        discordChannelId,
        messages: [],
      })
      .catch((err) => {
        logger.error(`Failed to persist new session ${id}`, err);
      });

    this.sessions.set(id, session);
    evictOldest(this.sessions, MAX_CACHE);
    return session;
  }

  /**
   * Cache hit returns synchronously in spirit but this is async throughout
   * since a miss falls through to Postgres — a session created by another
   * process, or evicted/not yet loaded by this one, must still resolve
   * instead of silently behaving as "not found".
   */
  async getById(id: string): Promise<Session | undefined> {
    const cached = this.sessions.get(id);
    if (cached) return cached;

    let rows: { id: string; messages: unknown }[];
    try {
      rows = await this.db
        .select({ id: sessions.id, messages: sessions.messages })
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1);
    } catch (err) {
      // Covers a malformed (non-UUID) id, which Postgres rejects outright,
      // the same way a genuine miss does: not found, not a 500.
      logger.error(`Failed to look up session ${id}`, err);
      return undefined;
    }

    const row = rows[0];
    if (!row) return undefined;

    const session: Session = {
      id: row.id,
      messages: (row.messages as ChatCompletionMessageParam[]) ?? [],
    };
    this.sessions.set(session.id, session);
    evictOldest(this.sessions, MAX_CACHE);
    return session;
  }

  async getByReplyTarget(discordMessageId: string): Promise<Session | undefined> {
    const cachedSessionId = this.sessionIdByReplyTarget.get(discordMessageId);
    if (cachedSessionId) {
      const cached = this.sessions.get(cachedSessionId);
      if (cached) return cached;
    }

    // Cache miss — look up in Postgres via reply_targets join
    try {
      const rows = await this.db
        .select({
          sessionId: replyTargets.sessionId,
        })
        .from(replyTargets)
        .where(eq(replyTargets.discordMessageId, discordMessageId))
        .limit(1);

      if (rows.length === 0) return undefined;

      const sessionId = rows[0].sessionId;
      this.sessionIdByReplyTarget.set(discordMessageId, sessionId);

      const session = await this.getById(sessionId);
      if (session) {
        evictOldest(this.sessionIdByReplyTarget, MAX_CACHE * 4);
      }
      return session;
    } catch (err) {
      logger.error(`Failed to look up reply target ${discordMessageId}`, err);
      return undefined;
    }
  }

  /** Records the outcome of a turn. Persists to DB and refreshes cache recency. */
  async update(session: Session, messages: ChatCompletionMessageParam[]): Promise<void> {
    session.messages = messages;

    await this.db
      .update(sessions)
      .set({
        messages,
        updatedAt: new Date(),
      })
      .where(eq(sessions.id, session.id))
      .catch((err) => {
        logger.error(`Failed to persist session update ${session.id}`, err);
      });

    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
  }

  /** Makes `discordMessageId` a valid reply target that continues `session`. */
  linkReplyTarget(discordMessageId: string, session: Session): void {
    this.sessionIdByReplyTarget.set(discordMessageId, session.id);

    this.db
      .insert(replyTargets)
      .values({
        sessionId: session.id,
        discordMessageId,
      })
      .onConflictDoNothing({ target: replyTargets.discordMessageId })
      .catch((err) => {
        logger.error(
          `Failed to persist reply target ${discordMessageId}`,
          err,
        );
      });

    evictOldest(this.sessionIdByReplyTarget, MAX_CACHE * 4);
  }
}

function evictOldest<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}