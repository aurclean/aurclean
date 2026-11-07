import "server-only";

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-process token bucket. Good enough for a single instance and for protecting
 * login and scan endpoints from runaway clients. For multi-instance production
 * deployments point RATE_LIMIT_DRIVER at Redis/Upstash and swap the store.
 */
const buckets = new Map<string, Bucket>();

const MAX_BUCKETS = 10_000;

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();

  if (buckets.size > MAX_BUCKETS) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(bucketKey);
    }
  }

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { success: true, remaining: limit - 1, resetAt };
  }

  if (existing.count >= limit) {
    return { success: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    success: true,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
  };
}

export const RATE_LIMITS = {
  LOGIN: { limit: 8, windowMs: 5 * 60 * 1000 },
  SCAN: { limit: 240, windowMs: 60 * 1000 },
  MUTATION: { limit: 120, windowMs: 60 * 1000 },
  UPLOAD: { limit: 40, windowMs: 60 * 1000 },
  REPORT: { limit: 60, windowMs: 60 * 1000 },
} as const;
