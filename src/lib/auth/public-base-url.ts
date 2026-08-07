/**
 * URL pública base del deployment (para armar redirects de emails de Supabase).
 * Prioriza NEXT_PUBLIC_SITE_URL; si no, la deriva de los headers de proxy.
 */
export function publicBaseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (env) return env.replace(/\/+$/, "");

  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  if (host) return `${proto}://${host}`;

  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}
