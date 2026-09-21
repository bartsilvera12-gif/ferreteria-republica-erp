/*
 * Service Worker — Ferretería República (offline v2).
 *
 * A diferencia del intento anterior, este SÍ cachea las PÁGINAS (documentos de
 * navegación), no solo los datos. Combinado con el precache que precarga las
 * rutas clave, permite ABRIR y CONSULTAR esas pantallas sin conexión.
 *
 * Seguridad: online la navegación es network-first (nunca versión vieja). Los
 * chunks de Next (/_next/static) llevan hash → cache-first seguro.
 */

const VERSION = "v2";
const PRECACHE = `fr-precache-${VERSION}`;
const RUNTIME = `fr-runtime-${VERSION}`;
const STATIC = `fr-static-${VERSION}`;
const PRECACHE_URLS = ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((c) => c.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([PRECACHE, RUNTIME, STATIC]);
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("fr-") && !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k === RUNTIME || k === STATIC).map((k) => caches.delete(k)))));
  }
});

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

// Navegación (abrir/recargar una página): network-first, cachea el documento,
// y offline sirve el documento cacheado; si no hay, /offline.html.
async function networkFirstDoc(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    // Match EXACTO (sin ignoreSearch): una navegación a "/inventario" NO debe
    // matchear "/inventario?_rsc=..." (eso es RSC crudo, no el documento HTML).
    const cached = await cache.match(req, { ignoreVary: true });
    if (cached) return cached;
    return (await caches.match("/offline.html")) || new Response("Sin conexión", { status: 503 });
  }
}

// API: network-first (online = igual que hoy, seguro para GET con efecto
// secundario), offline sirve lo último cacheado.
async function networkFirstApi(req) {
  const cache = await caches.open(RUNTIME);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    return cached || new Response(JSON.stringify({ offline: true }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
}

// RSC / documentos precargados por fetch / imágenes: stale-while-revalidate.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(req, { ignoreVary: true });
  const net = fetch(req).then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  if (cached) { net; return cached; }
  return (await net) || new Response("", { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin && url.pathname.startsWith("/_next/static/")) { event.respondWith(cacheFirst(req, STATIC)); return; }
  if (sameOrigin && url.pathname.startsWith("/icons/")) { event.respondWith(cacheFirst(req, PRECACHE)); return; }
  if (req.mode === "navigate") { event.respondWith(networkFirstDoc(req)); return; }
  if (sameOrigin && url.pathname.startsWith("/api/")) { event.respondWith(networkFirstApi(req)); return; }
  if (sameOrigin) { event.respondWith(staleWhileRevalidate(req)); return; }
});
