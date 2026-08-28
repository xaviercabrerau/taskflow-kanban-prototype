import { createHash } from "crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Default budget for the MCP JSON-RPC endpoint: 30 requests per rolling
// minute, per caller (see `deriveRateLimitKey` below for how "caller" is
// determined). Adjust here if a different limit is needed.
const REQUESTS_PER_WINDOW = 30;
const WINDOW = "1 m";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

let warnedMissingConfig = false;
let ratelimit: Ratelimit | null | undefined; // undefined = not yet initialized, null = not configured

function getRatelimit(): Ratelimit | null {
  if (ratelimit !== undefined) return ratelimit;

  // The Vercel Marketplace "Upstash for Redis" integration (installed
  // 2026-08-28) provisions KV_REST_API_URL/KV_REST_API_TOKEN, not
  // UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN — it keeps the legacy
  // Vercel KV env var names for backward compatibility with code written
  // against the old @vercel/kv product. Accept either naming.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    if (!warnedMissingConfig) {
      console.warn(
        "[rate-limit] No Upstash Redis credentials found (checked UPSTASH_REDIS_REST_URL/TOKEN " +
          "and KV_REST_API_URL/TOKEN) — falling back to the in-memory limiter. See OBSERVABILITY.md."
      );
      warnedMissingConfig = true;
    }
    ratelimit = null;
    return ratelimit;
  }

  const redis = new Redis({ url, token });
  ratelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(REQUESTS_PER_WINDOW, WINDOW),
    prefix: "taskflow-mcp",
  });
  return ratelimit;
}

/**
 * Derives a stable, non-reversible rate-limit key for a request. Prefers the
 * caller's bearer token (hashed — the raw token is never stored or logged).
 *
 * There is no trustworthy per-client IP available here: this Next.js version
 * (15+) no longer exposes `request.ip`/`geo`, and `X-Forwarded-For` is
 * client-suppliable and trivially spoofed to mint unlimited buckets. Rather
 * than use a spoofable identifier as a security boundary, every request made
 * before a token is known (e.g. `initialize` / `tools/list`) shares a single
 * global bucket.
 */
export function deriveRateLimitKey(token: string | null): string {
  if (token) {
    const hash = createHash("sha256").update(token).digest("hex");
    return `token:${hash}`;
  }
  return "anon:global";
}

// Conservative fallback used whenever Upstash can't be reached (unconfigured,
// or the call itself errors/times out). This is a fixed-window counter kept
// in a module-level Map: it resets on redeploy/cold-start and isn't shared
// across serverless instances, but that degraded protection is still better
// than failing open to unlimited requests against endpoints that front
// SECURITY DEFINER writes.
const FALLBACK_LIMIT = 10;
const FALLBACK_WINDOW_MS = 60_000;
const fallbackWindows = new Map<string, { count: number; windowStart: number }>();

function checkFallbackRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const entry = fallbackWindows.get(key);
  if (!entry || now - entry.windowStart >= FALLBACK_WINDOW_MS) {
    fallbackWindows.set(key, { count: 1, windowStart: now });
    return { success: true, remaining: FALLBACK_LIMIT - 1, resetAt: now + FALLBACK_WINDOW_MS };
  }
  entry.count += 1;
  return {
    success: entry.count <= FALLBACK_LIMIT,
    remaining: Math.max(0, FALLBACK_LIMIT - entry.count),
    resetAt: entry.windowStart + FALLBACK_WINDOW_MS,
  };
}

/**
 * Checks and consumes one unit of the rate-limit budget for `key`.
 *
 * Falls back to a conservative in-memory limit (rather than failing open)
 * both when Upstash Redis is not configured AND when a configured Upstash
 * call itself throws (network blip, outage, DNS failure). See
 * OBSERVABILITY.md for how to activate full Upstash enforcement.
 */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  const limiter = getRatelimit();
  if (!limiter) {
    return checkFallbackRateLimit(key);
  }

  try {
    const { success, remaining, reset } = await limiter.limit(key);
    return { success, remaining, resetAt: reset };
  } catch (err) {
    console.error("[rate-limit] Upstash call failed, failing back to in-memory limit:", err);
    return checkFallbackRateLimit(key);
  }
}
