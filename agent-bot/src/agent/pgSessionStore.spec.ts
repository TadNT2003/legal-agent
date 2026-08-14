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

  const insertPromise = makePromiseLike();
  const updatePromise = makePromiseLike();

  let limitCallIndex = 0;

  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            then: (onFulfilled: (val: unknown) => void) => {
              void Promise.resolve(selectResult).then(onFulfilled);
            },
          }),
          limit: jest.fn().mockImplementation(() => {
            const result = limitResults[limitCallIndex++] ?? (
              getByIdError.current
                ? Promise.reject(getByIdError.current)
                : getByIdResult
            );
            if (result instanceof Promise) return result;
            return Promise.resolve(result);
          }),
        }),
        orderBy: jest.fn().mockReturnValue({
          then: (onFulfilled: (val: unknown) => void) => {
            void Promise.resolve(rtResult).then(onFulfilled);
          },
        }),
      }),
    }),
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
  } as unknown as jest.Mocked<NodePgDatabase<typeof schema>>;

  return { db, selectResult, rtResult, getByIdResult, limitResults, getByIdError };
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
});