/**
 * Rate limiting best-effort en memoria (sin dependencias externas). Pensado para
 * proteger login y recuperación de contraseña contra fuerza bruta / abuso.
 *
 * Limitación conocida: en entornos serverless / multi-instancia el estado no se
 * comparte entre instancias, así que es una defensa razonable pero no global.
 * Supabase Auth aplica además su propio rate limiting del lado del proveedor.
 */

type Hit = { count: number; resetAt: number };

const buckets = new Map<string, Hit>();

// Limpieza perezosa para no crecer sin límite.
let lastSweep = 0;
function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) buckets.delete(k);
  }
}

export type RateLimitResult = { allowed: boolean; retryAfterSec: number };

/**
 * Consume un intento para `key`. Permite `limit` intentos por ventana `windowMs`.
 * @param nowMs reloj inyectable (los scripts del repo prohíben Date.now en algunos
 *              contextos; en runtime normal se usa el default).
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now()
): RateLimitResult {
  sweep(nowMs);
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (cur.count >= limit) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - nowMs) / 1000)) };
  }
  cur.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

/** IP del cliente a partir de headers de proxy comunes (best-effort). */
export function clientIpFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}
