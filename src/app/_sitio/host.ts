/**
 * Helpers de host para el SITIO PÚBLICO (ferreteriarepublica.com.py).
 *
 * Espeja la misma lógica de `src/middleware.ts` (misma env var SITIO_HOST_REGEX)
 * para que los Route Handlers públicos hagan gating por hostname: si se los
 * invoca desde un host del ERP deben responder 404 y nunca exponer contenido
 * público dentro del ERP.
 *
 * La carpeta `_sitio` tiene prefijo "_": App Router la trata como carpeta
 * privada (no genera rutas). Es solo código compartido del sitio público.
 */
const SITIO_HOST_REGEX = new RegExp(
  `^${process.env.SITIO_HOST_REGEX ?? "(www\\.)?ferreteriarepublica\\.com\\.py"}$`
);

export function isSitioHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0];
  return SITIO_HOST_REGEX.test(hostname);
}

/**
 * Origin canónico del sitio público (siempre apex, sin www), para construir
 * URLs absolutas en canonical / Open Graph / JSON-LD / sitemaps.
 */
export const SITIO_ORIGIN = (
  process.env.SITIO_PUBLIC_ORIGIN?.trim() || "https://ferreteriarepublica.com.py"
).replace(/\/+$/, "");
