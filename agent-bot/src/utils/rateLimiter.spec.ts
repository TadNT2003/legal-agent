import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  jest.useFakeTimers();

  beforeEach(() => {
    jest.clearAllTimers();
  });

  it('allows requests within the limit', () => {
    const limiter = new RateLimiter({ maxRequests: 3, windowMs: 60_000 });

    const r1 = limiter.check('user1');
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = limiter.check('user1');
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = limiter.check('user1');
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it('rejects requests over the limit', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });

    limiter.check('user1');
    limiter.check('user1');
    const r3 = limiter.check('user1');

    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it('allows requests again after the window passes', () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });

    limiter.check('user1');
    limiter.check('user1');

    jest.advanceTimersByTime(60_001);

    const r3 = limiter.check('user1');
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(1);
  });

  it('tracks rate limits independently per user', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    const r1 = limiter.check('user1');
    expect(r1.allowed).toBe(true);

    const r2 = limiter.check('user2');
    expect(r2.allowed).toBe(true);

    const r3 = limiter.check('user1');
    expect(r3.allowed).toBe(false);

    const r4 = limiter.check('user2');
    expect(r4.allowed).toBe(false);
  });

  it('returns correct resetAt for rejected requests', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    const t1 = Date.now();
    limiter.check('user1');

    const rejected = limiter.check('user1');
    expect(rejected.allowed).toBe(false);
    expect(rejected.resetAt).toBeGreaterThanOrEqual(t1 + 60_000);
  });

  it('cleans up user data manually', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    limiter.check('user1');
    const rejected = limiter.check('user1');
    expect(rejected.allowed).toBe(false);

    limiter.cleanup('user1');
    const allowed = limiter.check('user1');
    expect(allowed.allowed).toBe(true);
  });

  it('cleans up all users', () => {
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 60_000 });

    limiter.check('user1');
    limiter.check('user2');

    limiter.cleanupAll();

    const r1 = limiter.check('user1');
    const r2 = limiter.check('user2');
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
  });
});