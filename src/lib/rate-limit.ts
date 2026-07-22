/**
 * rate-limit.ts
 *
 * Minimal in-memory fixed-window rate limiter, keyed by an arbitrary string
 * (call sites key by `${scope}:${operator_id}`).
 *
 * LIMITATION — read before relying on this for anything security-critical:
 * state lives in a module-level Map, so on Vercel the limit is enforced PER
 * SERVERLESS INSTANCE, not globally. A burst spread across N warm instances can
 * reach up to N× the configured limit. This is an intentional, proportionate
 * defence against a single client hammering one instance (runaway loops, cost
 * abuse); a global limit would need a shared store (Redis/Upstash) and a new
 * dependency, which is out of scope (audit 9.1b).
 *
 * Upgrade path: replace the body of `rateLimit()` with a Redis INCR + EXPIRE
 * (or Upstash `@upstash/ratelimit`) keyed by the same string.
 */

interface Window {
  count: number;
  /** Epoch ms at which this window resets. */
  resetAt: number;
}

const buckets = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until the current window resets (0 when allowed). */
  retryAfterMs: number;
}

/**
 * Records one hit against `key`. Returns `allowed: false` once `limit` hits have
 * occurred within the rolling `windowMs`. The window is fixed (not sliding):
 * it starts on the first hit and resets `windowMs` later.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    // New (or expired) window — start counting fresh. Overwriting an expired
    // entry also bounds the Map size to the number of active keys (operators).
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}
