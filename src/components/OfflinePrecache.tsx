"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { warmProductosOffline } from "@/lib/inventario/storage";
import { warmClientesOffline } from "@/lib/clientes/storage";

/**
 * Precarga las PANTALLAS clave y sus DATOS para uso offline, apenas hay internet
 * y sesión. Combina:
 *  - router.prefetch(ruta)  → cachea el RSC y los chunks JS de esa ruta.
 *  - fetch(ruta)            → cachea el documento HTML (para recarga completa).
 *  - fetch(/api/...)        → cachea los datos de consulta.
 * Todo pasa por el service worker, que lo guarda en Cache Storage (en la PC del
 * cliente, no en el servidor). Best-effort, no bloquea, throttle 30 min.
 */

const ROUTES = ["/", "/inventario", "/clientes"];
// Datos de referencia livianos (URL estable). El catálogo completo y los
// clientes se bajan aparte a IndexedDB (warm*Offline), porque son grandes y
// PostgREST capa en 1000 filas.
const DATA = [
  "/api/inventario/categorias",
  "/api/inventario/ubicaciones",
  "/api/caja/estado",
];

const THROTTLE_KEY = "neura.offlinePrecache.v2";
const THROTTLE_MS = 30 * 60 * 1000;

function ranRecently() {
  try {
    const raw = window.localStorage.getItem(THROTTLE_KEY);
    return !!raw && Date.now() - Number(raw) < THROTTLE_MS;
  } catch { return false; }
}
function markRun() {
  try { window.localStorage.setItem(THROTTLE_KEY, String(Date.now())); } catch { /* nop */ }
}

export default function OfflinePrecache() {
  const router = useRouter();
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    let cancelled = false;

    async function run() {
      if (!navigator.onLine || ranRecently()) return;
      const session = await getSession().catch(() => null);
      if (cancelled || !session) return;
      markRun();

      // 1) RSC + chunks de cada ruta.
      for (const r of ROUTES) { try { router.prefetch(r); } catch { /* nop */ } }

      // 2) Documento HTML de cada ruta (para recarga completa offline).
      for (const r of ROUTES) {
        if (cancelled || !navigator.onLine) break;
        try { await fetch(r, { credentials: "include" }); } catch { /* nop */ }
      }

      // 3) Datos de referencia livianos.
      for (const url of DATA) {
        if (cancelled || !navigator.onLine) break;
        try { await fetchWithSupabaseSession(url, { cache: "no-store" }); } catch { /* nop */ }
      }

      // 4) Catálogo completo y clientes → IndexedDB (paginado, offline real).
      if (!cancelled && navigator.onLine) { try { await warmProductosOffline(); } catch { /* nop */ } }
      if (!cancelled && navigator.onLine) { try { await warmClientesOffline(); } catch { /* nop */ } }
    }

    const start = () => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (typeof ric === "function") ric(() => run(), { timeout: 8000 });
      else setTimeout(run, 3000);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => { cancelled = true; window.removeEventListener("load", start); };
  }, [router]);

  return null;
}
