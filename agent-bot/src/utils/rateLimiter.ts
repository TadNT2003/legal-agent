export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, number[]>();
  private resetTimers = new Map<string, NodeJS.Timeout>();

  constructor(private config: RateLimitConfig) {}

  check(key: string): RateLimitResult {
    const now = Date.now();
    const timestamps = this.buckets.get(key) ?? [];
    const validTimestamps = timestamps.filter(
      (ts) => ts > now - this.config.windowMs,
    );

    if (validTimestamps.length >= this.config.maxRequests) {
      const oldest = validTimestamps[0];
      const resetAt = oldest + this.config.windowMs;
      this.buckets.set(key, validTimestamps);
      this.scheduleCleanup(key);
      return { allowed: false, remaining: 0, resetAt };
    }

    validTimestamps.push(now);
    this.buckets.set(key, validTimestamps);
    this.scheduleCleanup(key);

    const remaining = this.config.maxRequests - validTimestamps.length;
    const resetAt = now + this.config.windowMs;
    return { allowed: true, remaining, resetAt };
  }

  cleanup(key: string): void {
    this.buckets.delete(key);
    const timer = this.resetTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.resetTimers.delete(key);
    }
  }

  cleanupAll(): void {
    for (const key of this.buckets.keys()) {
      this.cleanup(key);
    }
  }

  scheduleCleanup(key: string): void {
    const existing = this.resetTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.cleanup(key);
    }, this.config.windowMs);

    timer.unref?.();
    this.resetTimers.set(key, timer);
  }
}

export function createRateLimiter(config: RateLimitConfig) {
  return new RateLimiter(config);
}