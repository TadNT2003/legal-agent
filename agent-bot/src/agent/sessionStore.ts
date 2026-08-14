import { randomUUID } from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const MAX_SESSIONS = 500;
// Generous multiple of MAX_SESSIONS — several bot messages (multi-chunk
// replies) can link to the same session.
const MAX_REPLY_LINKS = MAX_SESSIONS * 4;

export interface Session {
  id: string;
  messages: ChatCompletionMessageParam[];
}

/**
 * In-memory only — sessions and reply links are lost on process restart,
 * which is fine for a PoC (a reply to an old bot message after a restart
 * just falls back to starting a fresh session — see events/messageCreate.ts).
 *
 * A session starts on a mention/keyword/DM trigger; it continues only via a
 * reply to one of the bot's own messages belonging to that session. Both
 * maps are bounded so a long-running process doesn't grow without limit —
 * oldest entries (by last write) are evicted once the cap is hit.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly sessionIdByReplyTarget = new Map<string, string>();

  constructor(
    private readonly maxSessions = MAX_SESSIONS,
    private readonly maxReplyLinks = MAX_REPLY_LINKS,
  ) {}

  createSession(): Session {
    const session: Session = { id: randomUUID(), messages: [] };
    this.sessions.set(session.id, session);
    evictOldest(this.sessions, this.maxSessions);
    return session;
  }

  getByReplyTarget(discordMessageId: string): Session | undefined {
    const sessionId = this.sessionIdByReplyTarget.get(discordMessageId);
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  /** Records the outcome of a turn. Re-inserts to mark the session as recently used. */
  update(session: Session, messages: ChatCompletionMessageParam[]): void {
    session.messages = messages;
    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
  }

  /** Makes `discordMessageId` a valid reply target that continues `session`. */
  linkReplyTarget(discordMessageId: string, session: Session): void {
    this.sessionIdByReplyTarget.set(discordMessageId, session.id);
    evictOldest(this.sessionIdByReplyTarget, this.maxReplyLinks);
  }
}

function evictOldest<K, V>(map: Map<K, V>, maxSize: number): void {
  while (map.size > maxSize) {
    const oldestKey = map.keys().next().value;
    if (oldestKey === undefined) break;
    map.delete(oldestKey);
  }
}
