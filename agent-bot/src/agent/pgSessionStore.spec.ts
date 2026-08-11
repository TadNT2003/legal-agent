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
} {
  const selectResult: Array<{
    id: string;
    messages: unknown;
    updatedAt: Date;
  }> = [];
  const rtResult: Array<{ discordMessageId: string; sessionId: string }> = [];

  const insertPromise = makePromiseLike();
  const updatePromise = makePromiseLike();

  const db = {
    select: jest.fn().mockReturnValue({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            then: (onFulfilled: (val: unknown) => void) => {
              void Promise.resolve(selectResult).then(onFulfilled);
            },
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

  return { db, selectResult, rtResult };
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

  it('a message not linked to any session resolves to undefined', () => {
    expect(store.getByReplyTarget('unknown-message-id')).toBeUndefined();
  });

  it('linking a reply target makes the session resolvable by that message id', () => {
    const session = store.createSession();
    store.linkReplyTarget('bot-msg-1', session);
    expect(store.getByReplyTarget('bot-msg-1')).toBe(session);
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

    const resolved = store.getByReplyTarget('bot-msg-1');
    expect(resolved?.messages).toEqual(msgs);
  });

  it('multiple reply targets can resolve to the same session', () => {
    const session = store.createSession();
    store.linkReplyTarget('bot-msg-chunk-1', session);
    store.linkReplyTarget('bot-msg-chunk-2', session);

    expect(store.getByReplyTarget('bot-msg-chunk-1')).toBe(session);
    expect(store.getByReplyTarget('bot-msg-chunk-2')).toBe(session);
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

    expect(store.getByReplyTarget('older1-msg')).toBe(older1);
    expect(store.getByReplyTarget('newer-msg')).toBe(newer);
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

    const resolved = store.getByReplyTarget('bot-msg-1');
    expect(resolved).toBeDefined();
  });

  it('linkReplyTarget calls db.insert for persistence', () => {
    const session = store.createSession('user-a', 'chan-a');
    store.linkReplyTarget('msg-99', session);

    expect(session.id).toBeDefined();
    expect(store.getByReplyTarget('msg-99')).toBe(session);
  });
});