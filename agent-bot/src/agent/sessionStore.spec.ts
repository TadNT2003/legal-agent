import { describe, expect, it } from '@jest/globals';
import { SessionStore } from './sessionStore.js';

describe('SessionStore', () => {
  it('creates sessions with unique ids and empty history', () => {
    const store = new SessionStore();

    const a = store.createSession();
    const b = store.createSession();

    expect(a.id).not.toBe(b.id);
    expect(a.messages).toEqual([]);
  });

  it('a message not linked to any session resolves to undefined', () => {
    const store = new SessionStore();

    expect(store.getByReplyTarget('unknown-message-id')).toBeUndefined();
  });

  it('linking a reply target makes the session resolvable by that message id', () => {
    const store = new SessionStore();
    const session = store.createSession();

    store.linkReplyTarget('bot-msg-1', session);

    expect(store.getByReplyTarget('bot-msg-1')).toBe(session);
  });

  it('update() persists the new message history on the session object', () => {
    const store = new SessionStore();
    const session = store.createSession();
    store.linkReplyTarget('bot-msg-1', session);

    store.update(session, [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);

    const resolved = store.getByReplyTarget('bot-msg-1');
    expect(resolved?.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('multiple reply targets (multi-chunk replies) can resolve to the same session', () => {
    const store = new SessionStore();
    const session = store.createSession();

    store.linkReplyTarget('bot-msg-chunk-1', session);
    store.linkReplyTarget('bot-msg-chunk-2', session);

    expect(store.getByReplyTarget('bot-msg-chunk-1')).toBe(session);
    expect(store.getByReplyTarget('bot-msg-chunk-2')).toBe(session);
  });

  it('evicts the oldest session once the cap is exceeded', () => {
    const store = new SessionStore(3);
    const first = store.createSession();
    store.linkReplyTarget('first-msg', first);

    store.createSession();
    store.createSession();
    store.createSession(); // 4th session, over the cap of 3

    expect(store.getByReplyTarget('first-msg')).toBeUndefined();
  });

  it('sessions under the cap are not evicted', () => {
    const store = new SessionStore(3);
    const first = store.createSession();
    store.linkReplyTarget('first-msg', first);

    store.createSession();
    store.createSession(); // 3 total, at the cap, not over it

    expect(store.getByReplyTarget('first-msg')).toBe(first);
  });

  it('update() refreshes recency so a just-updated session survives eviction pressure', () => {
    const store = new SessionStore(3);
    const older1 = store.createSession();
    const older2 = store.createSession();
    const session = store.createSession();
    store.linkReplyTarget('kept-msg', session);
    store.linkReplyTarget('older1-msg', older1);
    store.linkReplyTarget('older2-msg', older2);

    // Touch `older1` so it's no longer the least-recently-used entry.
    store.update(older1, [{ role: 'user', content: 'still active' }]);

    // Push past the cap — without the update() above, `older1` would be the
    // next eviction victim (oldest by insertion order); `older2` is now the
    // genuinely oldest untouched entry and should be evicted instead.
    store.createSession();

    expect(store.getByReplyTarget('older2-msg')).toBeUndefined();
    expect(store.getByReplyTarget('older1-msg')).toBe(older1);
    expect(store.getByReplyTarget('kept-msg')).toBe(session);
  });
});
