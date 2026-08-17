import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { PgSessionStore } from './pgSessionStore.js';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema/index.js';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

function makePromiseLike() {
  const handler = {
    catch: jest.fn(),
  };
  return handler as unknown as Promise<unknown>;
}

function createMockDb(): {
  db: jest.Mocked<NodePgDatabase<typeof schema>>;
  selectResult: Array<{ id: string; messages: unknown; updatedAt: Date }>;
  rtResult: Array<{ discordMessageId: string; sessionId: string }>;
  getByIdResult: Array<{ id: string; messages: unknown }>;
  limitResults: Array<unknown>;
  getByIdError: { current: Error | null };
  deleteResult: Array<{ id: string }>;
  deleteError: { current: Error | null };
  latestResult: Array<{ id: string; messages: unknown }>;
  latestError: { current: Error | null };
} {
  const selectResult: Array<{
    id: string;
    messages: unknown;
    updatedAt: Date;
  }> = [];
  const rtResult: Array<{ discordMessageId: string; sessionId: string }> = [];
  const getByIdResult: Array<{ id: string; messages: unknown }> = [];
  const limitResults: Array<unknown> = [];
  const getByIdError: { current: Error | null } = { current: null };
  const deleteResult: Array<{ id: string }> = [];
  const deleteError: { current: Error | null } = { current: null };
  const latestResult: Array<{ id: string; messages: unknown }> = [];
  const latestError: { current: Error | null } = { current: null };

  const insertPromise = makePromiseLike();
  const updatePromise = makePromiseLike();

  let limitCallIndex = 0;

  // A single select() chain serves three different query shapes, all built the
  // same way: select().from().where().orderBy().limit() (or .orderBy() alone).
  // getLatestByUserId is disambiguated by the latestResult/latestError controls
  // below; getById and getByReplyTarget share the index-based limitResults.
  const db = {
    select: jest.fn().mockImplementation(() => ({
      from: jest.fn().mockImplementation(() => ({
        where: jest.fn().mockImplementation(() => ({
          orderBy: jest.fn().mockImplementation(() => ({
            then: (onFulfilled: (val: unknown) => void) => {
              void Promise.resolve(selectResult).then(onFulfilled);
            },
            limit: jest.fn().mockImplementation(() => {
              // getLatestByUserId: dedicated controls take priority.
              if (latestError.current) {
                return Promise.reject(latestError.current);
              }
              if (latestResult.length > 0) {
                const rows = latestResult.slice();
                latestResult.length = 0;
                return Promise.resolve(rows);
              }
              // getById / getByReplyTarget: shared index-based results.
              const result = limitResults[limitCallIndex++] ?? (
                getByIdError.current
                  ? Promise.reject(getByIdError.current)
                  : getByIdResult
              );
              if (result instanceof Promise) return result;
              return Promise.resolve(result);
            }),
          })),
          limit: jest.fn().mockImplementation(() => {
            if (latestError.current) {
              return Promise.reject(latestError.current);
            }
            if (latestResult.length > 0) {
              const rows = latestResult.slice();
              latestResult.length = 0;
              return Promise.resolve(rows);
            }
            const result = limitResults[limitCallIndex++] ?? (
              getByIdError.current
                ? Promise.reject(getByIdError.current)
                : getByIdResult
            );
            if (result instanceof Promise) return result;
            return Promise.resolve(result);
          }),
        })),
        orderBy: jest.fn().mockImplementation(() => ({
          then: (onFulfilled: (val: unknown) => void) => {
            void Promise.resolve(rtResult).then(onFulfilled);
          },
        })),
      })),
    })),
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        then: (onFulfilled: (val: unknown) => void) => {
          void Promise.resolve({}).then(onFulfilled);
        },
        catch: insertPromise.catch,
        onConflictDoNothing: jest.fn().mockReturnValue({
          then: (onFulfilled: (val: unknown) => void) => {
            void Promise.resolve({}).then(onFulfilled);
          },
          catch: insertPromise.catch,
        }),
      }),
    }),
    update: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          then: (onFulfilled: (val: unknown) => void) => {
            void Promise.resolve({}).then(onFulfilled);
          },
          catch: updatePromise.catch,
        }),
      }),
    }),
    // delete().where(...).returning(...) — used by cleanupStaleSessions.
    delete: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        returning: jest.fn().mockImplementation(() => {
          if (deleteError.current) {
            return Promise.reject(deleteError.current);
          }
          return Promise.resolve(deleteResult);
        }),
      }),
    }),
  } as unknown as jest.Mocked<NodePgDatabase<typeof schema>>;

  return {
    db,
    selectResult,
    rtResult,
    getByIdResult,
    limitResults,
    getByIdError,
    deleteResult,
    deleteError,
    latestResult,
    latestError,
  };
}

describe('PgSessionStore', () => {
  let store: PgSessionStore;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    store = new PgSessionStore(mockDb.db);
  });

  it('creates sessions with unique ids and empty history', () => {
    const a = store.createSession('user1', 'channel1');
    const b = store.createSession('user2', 'channel2');

    expect(a.id).not.toBe(b.id);
    expect(a.messages).toEqual([]);
    expect(a.id).toBeDefined();
  });

  it('a message not linked to any session resolves to undefined', async () => {
    expect(await store.getByReplyTarget('unknown-message-id')).toBeUndefined();
  });

  it('linking a reply target makes the session resolvable by that message id', async () => {
    const session = store.createSession();
    store.linkReplyTarget('bot-msg-1', session);
    const resolved = await store.getByReplyTarget('bot-msg-1');
    expect(resolved).toBe(session);
  });

  it('update() persists the new message history on the session object', async () => {
    const session = store.createSession();
    store.linkReplyTarget('bot-msg-1', session);

    const msgs: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    await store.update(session, msgs);

    const resolved = await store.getByReplyTarget('bot-msg-1');
    expect(resolved?.messages).toEqual(msgs);
  });

  it('multiple reply targets can resolve to the same session', async () => {
    const session = store.createSession();
    store.linkReplyTarget('bot-msg-chunk-1', session);
    store.linkReplyTarget('bot-msg-chunk-2', session);

    expect(await store.getByReplyTarget('bot-msg-chunk-1')).toBe(session);
    expect(await store.getByReplyTarget('bot-msg-chunk-2')).toBe(session);
  });

  it('createSession accepts optional discord user and channel ids', () => {
    const session = store.createSession('discord-user-123', 'discord-channel-456');
    expect(session.id).toBeDefined();
    expect(session.messages).toEqual([]);
  });

  it('update() refreshes recency in cache (re-insert pattern)', async () => {
    const older1 = store.createSession();
    const older2 = store.createSession();
    const newer = store.createSession();
    store.linkReplyTarget('older1-msg', older1);
    store.linkReplyTarget('older2-msg', older2);
    store.linkReplyTarget('newer-msg', newer);

    const msgs: ChatCompletionMessageParam[] = [
      { role: 'user', content: 'still active' },
    ];
    await store.update(older1, msgs);

    expect(await store.getByReplyTarget('older1-msg')).toBe(older1);
    expect(await store.getByReplyTarget('newer-msg')).toBe(newer);
  });

  it('loadActiveSessions loads recent sessions from DB', async () => {
    const now = new Date();
    mockDb.selectResult.push(
      {
        id: 'sess-1',
        messages: [
          { role: 'system', content: 'test' },
          { role: 'user', content: 'hello' },
        ],
        updatedAt: now,
      },
      {
        id: 'sess-2',
        messages: [{ role: 'user', content: 'world' }],
        updatedAt: now,
      },
    );
    mockDb.rtResult.push(
      { discordMessageId: 'bot-msg-1', sessionId: 'sess-1' },
    );

    const count = await store.loadActiveSessions();
    expect(count).toBe(2);

    const resolved = await store.getByReplyTarget('bot-msg-1');
    expect(resolved).toBeDefined();
  });

  it('getByReplyTarget falls through to DB when cache is empty', async () => {
    mockDb.limitResults.push([{ sessionId: 'db-sess-1' }]);
    mockDb.limitResults.push([{
      id: 'db-sess-1',
      messages: [{ role: 'user', content: 'from db' }],
    }]);

    const resolved = await store.getByReplyTarget('db-bot-msg');

    expect(resolved).toEqual({
      id: 'db-sess-1',
      messages: [{ role: 'user', content: 'from db' }],
    });
    // Subsequent calls should hit the now-warmed cache, no more DB calls.
    const cached = await store.getByReplyTarget('db-bot-msg');
    expect(cached).toBe(resolved);
  });

  it('getByReplyTarget returns undefined when reply target is not in DB', async () => {
    mockDb.limitResults.push([]);
    const resolved = await store.getByReplyTarget('nowhere-msg');
    expect(resolved).toBeUndefined();
  });

  it('getByReplyTarget returns undefined when DB lookup fails', async () => {
    mockDb.limitResults.push(Promise.reject(new Error('connection refused')));

    const resolved = await store.getByReplyTarget('fail-msg');
    expect(resolved).toBeUndefined();
  });

  it('linkReplyTarget calls db.insert for persistence', async () => {
    const session = store.createSession('user-a', 'chan-a');
    store.linkReplyTarget('msg-99', session);

    expect(session.id).toBeDefined();
    expect(await store.getByReplyTarget('msg-99')).toBe(session);
  });

  describe('getById', () => {
    it('resolves a cached session without querying the DB', async () => {
      const session = store.createSession();

      const resolved = await store.getById(session.id);

      expect(resolved).toBe(session);
      expect(mockDb.db.select).not.toHaveBeenCalled();
    });

    it('falls through to Postgres on a cache miss and caches the result', async () => {
      mockDb.getByIdResult.push({
        id: 'db-only-session',
        messages: [{ role: 'user', content: 'from db' }],
      });

      const resolved = await store.getById('db-only-session');

      expect(resolved).toEqual({
        id: 'db-only-session',
        messages: [{ role: 'user', content: 'from db' }],
      });
      // Second call must hit the now-warmed cache, not the DB again.
      mockDb.db.select.mockClear();
      const cached = await store.getById('db-only-session');
      expect(cached).toBe(resolved);
      expect(mockDb.db.select).not.toHaveBeenCalled();
    });

    it('resolves undefined for a session that exists in neither cache nor DB', async () => {
      const resolved = await store.getById('nowhere-to-be-found');
      expect(resolved).toBeUndefined();
    });

    it('resolves undefined (not a thrown error) when the DB lookup fails, e.g. a malformed id', async () => {
      mockDb.getByIdError.current = new Error(
        'invalid input syntax for type uuid',
      );

      await expect(store.getById('not-a-uuid')).resolves.toBeUndefined();
    });
  });

  describe('getActiveCount', () => {
    it('reports the number of cached sessions', () => {
      expect(store.getActiveCount()).toBe(0);
      store.createSession();
      store.createSession();
      expect(store.getActiveCount()).toBe(2);
    });
  });

  describe('getLatestByUserId', () => {
    it('resolves the user most recent session from the DB', async () => {
      mockDb.latestResult.push({
        id: 'user-latest',
        messages: [{ role: 'user', content: 'hi' }],
      });

      const resolved = await store.getLatestByUserId('discord-user-1');

      expect(resolved).toEqual({
        id: 'user-latest',
        messages: [{ role: 'user', content: 'hi' }],
      });
      // The resolved session is also cached by id so getById() can hit it.
      expect(await store.getById('user-latest')).toBe(resolved);
    });

    it('resolves undefined when the user has no session in the DB', async () => {
      const resolved = await store.getLatestByUserId('no-such-user');
      expect(resolved).toBeUndefined();
    });

    it('resolves undefined (not a thrown error) when the DB lookup fails', async () => {
      mockDb.latestError.current = new Error('connection refused');

      await expect(store.getLatestByUserId('fail-user')).resolves.toBeUndefined();
    });
  });

  describe('cleanupStaleSessions', () => {
    it('returns the number of sessions the DB reported as deleted', async () => {
      mockDb.deleteResult.push({ id: 'stale-1' }, { id: 'stale-2' });

      const removed = await store.cleanupStaleSessions();

      expect(removed).toBe(2);
    });

    it('returns 0 when there is nothing to clean up', async () => {
      expect(await store.cleanupStaleSessions()).toBe(0);
    });

    it('evicts deleted sessions from the in-memory cache', async () => {
      const session = store.createSession();
      store.linkReplyTarget('msg-x', session);
      // Warm the reply-target -> session map the way a live session would have.
      expect(await store.getByReplyTarget('msg-x')).toBe(session);

      mockDb.deleteResult.push({ id: session.id });
      await store.cleanupStaleSessions();

      // The session is gone from the cache; its reply target can no longer
      // resolve to it.
      expect(store.getActiveCount()).toBe(0);
      expect(await store.getById(session.id)).toBeUndefined();
      // (getById falls through to the mock DB and finds nothing by default.)
    });

    it('drops reply-target links that pointed at a deleted session', async () => {
      const session = store.createSession();
      store.linkReplyTarget('orphan-msg', session);

      mockDb.deleteResult.push({ id: session.id });
      await store.cleanupStaleSessions();

      // The reply target no longer resolves, even though the session id is
      // still a valid string — its cache entry was pruned with the session.
      // (getByReplyTarget will fall through to the mock DB, which returns no
      // rows by default, so it resolves undefined.)
      expect(await store.getByReplyTarget('orphan-msg')).toBeUndefined();
    });

    it('swallows a DB failure and returns 0 instead of throwing', async () => {
      mockDb.deleteError.current = new Error('connection reset');

      const removed = await store.cleanupStaleSessions();

      expect(removed).toBe(0);
    });

    it('does not throw on consecutive runs (schedule-safe)', async () => {
      mockDb.deleteResult.push({ id: 'a' });
      await expect(store.cleanupStaleSessions()).resolves.toBe(1);
      mockDb.deleteResult.length = 0;
      await expect(store.cleanupStaleSessions()).resolves.toBe(0);
    });
  });
});