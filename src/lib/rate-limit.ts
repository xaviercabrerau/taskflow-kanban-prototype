import { createHash } from "crypto";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Dos presupuestos independientes, ambos por ventana deslizante de 1 minuto:
//  - "token": 30 peticiones por clave (token del llamador, usuario, etc.).
//    Es el límite de siempre; ver `deriveRateLimitKey` para cómo se forma la clave.
//  - "ip": 120 peticiones por IP del cliente. Frena a quien varía la clave
//    (tokens inventados, tokens de share links inventados) para saltarse el
//    límite anterior: cada variante sería un cubo nuevo y las rutas públicas
//    harían una consulta a la base por cada una.
const WINDOW = "1 m";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

type LimiterKind = "token" | "ip";

const LIMITS: Record<LimiterKind, { requests: number; prefix: string; fallback: number }> = {
  token: { requests: 30, prefix: "taskflow-mcp", fallback: 10 },
  ip: { requests: 120, prefix: "taskflow-ip", fallback: 40 },
};

let warnedMissingConfig = false;
// undefined = aún sin inicializar, null = sin configurar
const limiters: Partial<Record<LimiterKind, Ratelimit | null>> = {};

function getRatelimit(kind: LimiterKind): Ratelimit | null {
  if (limiters[kind] !== undefined) return limiters[kind] as Ratelimit | null;

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
    limiters[kind] = null;
    return null;
  }

  const redis = new Redis({ url, token });
  limiters[kind] = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(LIMITS[kind].requests, WINDOW),
    prefix: LIMITS[kind].prefix,
  });
  return limiters[kind] as Ratelimit;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * IP del cliente, SOLO desde cabeceras que no puede falsificar.
 *
 * En Vercel, `x-vercel-forwarded-for` la fija la plataforma y sobrescribe lo
 * que mande el cliente. `x-real-ip` es el respaldo habitual de otros proxies.
 * `x-forwarded-for` NO se usa a propósito: un cliente puede mandarla con el
 * valor que quiera y acuñar cubos ilimitados. Si no hay ninguna cabecera de
 * confianza (p. ej. en desarrollo local) devuelve null.
 */
export function getClientIp(request: Request): string | null {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  return real || null;
}

/** Clave no reversible para el límite por IP (la IP en claro no se guarda ni se registra). */
export function deriveIpRateLimitKey(ip: string | null): string {
  return ip ? `ip:${hash(ip)}` : "ip:unknown";
}

/**
 * Derives a stable, non-reversible rate-limit key for a request. Prefers the
 * caller's bearer token (hashed — the raw token is never stored or logged).
 *
 * Peticiones sin token (p. ej. `initialize` / `tools/list`): antes todas
 * compartían UN cubo global, así que cualquiera podía agotarlo y dejar sin
 * servicio a los clientes legítimos. Si se conoce una IP de confianza
 * (`getClientIp`), cada IP tiene su propio cubo; si no, se mantiene el cubo
 * global como último recurso.
 */
export function deriveRateLimitKey(token: string | null, ip?: string | null): string {
  if (token) return `token:${hash(token)}`;
  if (ip) return `anon:${hash(ip)}`;
  return "anon:global";
}

// Conservative fallback used whenever Upstash can't be reached (unconfigured,
// or the call itself errors/times out). This is a fixed-window counter kept
// in a module-level Map: it resets on redeploy/cold-start and isn't shared
// across serverless instances, but that degraded protection is still better
// than failing open to unlimited requests against endpoints that front
// SECURITY DEFINER writes.
//
// El Map tiene tope: quien varía la clave en cada petición no puede hacerlo
// crecer sin límite. Al llenarse se descartan primero las ventanas vencidas y,
// si hace falta, las más antiguas (el Map conserva el orden de inserción).
const FALLBACK_WINDOW_MS = 60_000;
export const MAX_FALLBACK_ENTRIES = 5_000;
const fallbackWindows = new Map<string, { count: number; windowStart: number }>();

export function getFallbackSize(): number {
  return fallbackWindows.size;
}

function pruneFallback(now: number): void {
  if (fallbackWindows.size < MAX_FALLBACK_ENTRIES) return;
  for (const [key, entry] of fallbackWindows) {
    if (now - entry.windowStart >= FALLBACK_WINDOW_MS) fallbackWindows.delete(key);
  }
  for (const key of fallbackWindows.keys()) {
    if (fallbackWindows.size < MAX_FALLBACK_ENTRIES) break;
    fallbackWindows.delete(key);
  }
}

function checkFallbackRateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  const entry = fallbackWindows.get(key);
  if (!entry || now - entry.windowStart >= FALLBACK_WINDOW_MS) {
    pruneFallback(now);
    fallbackWindows.set(key, { count: 1, windowStart: now });
    return { success: true, remaining: limit - 1, resetAt: now + FALLBACK_WINDOW_MS };
  }
  entry.count += 1;
  return {
    success: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.windowStart + FALLBACK_WINDOW_MS,
  };
}

async function check(kind: LimiterKind, key: string): Promise<RateLimitResult> {
  const limiter = getRatelimit(kind);
  if (!limiter) {
    return checkFallbackRateLimit(`${kind}:${key}`, LIMITS[kind].fallback);
  }

  try {
    const { success, remaining, reset } = await limiter.limit(key);
    return { success, remaining, resetAt: reset };
  } catch (err) {
    console.error("[rate-limit] Upstash call failed, failing back to in-memory limit:", err);
    return checkFallbackRateLimit(`${kind}:${key}`, LIMITS[kind].fallback);
  }
}

/**
 * Checks and consumes one unit of the per-key budget (30/min).
 *
 * Falls back to a conservative in-memory limit (rather than failing open)
 * both when Upstash Redis is not configured AND when a configured Upstash
 * call itself throws (network blip, outage, DNS failure). See
 * OBSERVABILITY.md for how to activate full Upstash enforcement.
 */
export async function checkRateLimit(key: string): Promise<RateLimitResult> {
  return check("token", key);
}

/**
 * Checks and consumes one unit of the per-IP budget (120/min). Úsalo ANTES de
 * hacer trabajo por petición (consultas a la base, validación de tokens) en
 * rutas públicas o que limitan por una clave que manda el cliente.
 */
export async function checkIpRateLimit(key: string): Promise<RateLimitResult> {
  return check("ip", key);
}
