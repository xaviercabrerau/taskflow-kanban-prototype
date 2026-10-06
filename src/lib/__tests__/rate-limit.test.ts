import { describe, it, expect, beforeAll } from '@jest/globals';
import {
  MAX_FALLBACK_ENTRIES,
  checkIpRateLimit,
  checkRateLimit,
  deriveIpRateLimitKey,
  deriveRateLimitKey,
  getClientIp,
  getFallbackSize,
} from '@/lib/rate-limit';

// Hallazgo D de la revisión del 2026-10-05. Tres problemas del limitador:
//  1. La clave de las peticiones sin token era UN cubo global compartido por
//     todos: cualquiera podía agotarlo y dejar fuera a los clientes legítimos.
//  2. Las rutas públicas (y las que limitan antes de validar el token) usaban
//     como clave un texto que manda el cliente, así que variarlo daba cubos
//     ilimitados. Se añade un límite por IP.
//  3. El fallback en memoria (Map) crecía sin tope al variar la clave.

function req(headers: Record<string, string>) {
  return new Request('http://localhost/x', { headers });
}

describe('getClientIp', () => {
  it('usa x-vercel-forwarded-for, que la plataforma pone y el cliente no puede falsificar', () => {
    expect(getClientIp(req({ 'x-vercel-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('toma la primera IP si la cabecera trae una lista', () => {
    expect(getClientIp(req({ 'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
  });

  it('ignora x-forwarded-for, que un cliente puede falsificar', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.99' }))).toBeNull();
  });

  it('cae a x-real-ip si no hay x-vercel-forwarded-for', () => {
    expect(getClientIp(req({ 'x-real-ip': '203.0.113.8' }))).toBe('203.0.113.8');
  });

  it('devuelve null si no hay ninguna cabecera de confianza', () => {
    expect(getClientIp(req({}))).toBeNull();
  });
});

describe('claves de límite', () => {
  it('la clave por IP es estable, distinta por IP y no contiene la IP en claro', () => {
    const a = deriveIpRateLimitKey('203.0.113.7');
    expect(a).toBe(deriveIpRateLimitKey('203.0.113.7'));
    expect(a).not.toBe(deriveIpRateLimitKey('203.0.113.8'));
    expect(a).not.toContain('203.0.113.7');
    expect(deriveIpRateLimitKey(null)).toBe('ip:unknown');
  });

  it('las peticiones sin token ya no comparten un único cubo global cuando se conoce la IP', () => {
    expect(deriveRateLimitKey(null)).toBe('anon:global'); // compatibilidad
    const a = deriveRateLimitKey(null, '203.0.113.7');
    const b = deriveRateLimitKey(null, '203.0.113.8');
    expect(a).not.toBe('anon:global');
    expect(a).not.toBe(b);
  });

  it('con token, la clave sigue siendo el hash del token (sin cambios)', () => {
    const k = deriveRateLimitKey('tfmcp_abc', '203.0.113.7');
    expect(k).toMatch(/^token:[0-9a-f]{64}$/);
    expect(k).toBe(deriveRateLimitKey('tfmcp_abc', '203.0.113.99'));
  });
});

describe('límites (sin Upstash: fallback en memoria)', () => {
  beforeAll(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  it('el fallback por token sigue limitando (regresión)', async () => {
    const key = 'token:regresion';
    const results = [];
    for (let i = 0; i < 12; i += 1) results.push((await checkRateLimit(key)).success);
    expect(results.slice(0, 10).every(Boolean)).toBe(true);
    expect(results[11]).toBe(false);
  });

  it('el límite por IP es independiente del de token y más holgado', async () => {
    const key = 'ip:prueba-holgado';
    let lastOk = 0;
    for (let i = 1; i <= 60; i += 1) {
      if ((await checkIpRateLimit(key)).success) lastOk = i;
    }
    // Más que los 10 del token, pero con tope.
    expect(lastOk).toBeGreaterThan(10);
    expect(lastOk).toBeLessThan(60);
  });

  it('el fallback en memoria tiene tope aunque se varíe la clave sin parar', async () => {
    for (let i = 0; i < MAX_FALLBACK_ENTRIES + 200; i += 1) {
      await checkRateLimit(`token:unico-${i}`);
    }
    expect(getFallbackSize()).toBeLessThanOrEqual(MAX_FALLBACK_ENTRIES);
  });
});
