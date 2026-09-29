"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "@/lib/auth";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { warmProductosOffline } from "@/lib/inventario/storage";
import { warmClientesOffline } from "@/lib/clientes/storage";

/**
 * Precarga PANTALLAS + DATOS para uso offline, apenas hay internet y sesión.
 * Robusto: la descarga del catálogo reintenta y solo se "marca listo" cuando
 * quedó COMPLETO (si no, reintenta pronto). Además precachea un "shell" de las
 * fichas (detalle de producto/cliente) para poder abrirlas offline.
 */

const ROUTES = ["/", "/inventario", "/clientes"];
const DATA = ["/api/inventario/categorias", "/api/inventario/ubicaciones", "/api/caja/estado"];
const THROTTLE_KEY = "neura.offlinePrecache.v3";
const OK_MS = 30 * 60 * 1000; // completo → no repetir por 30 min
const RETRY_MS = 90 * 1000; // incompleto → reintentar a los 90s

function lastRun(): { ts: number; complete: boolean } | null {
  try {
    const raw = window.localStorage.getItem(THROTTLE_KEY);
    return raw ? (JSON.parse(raw) as { ts: number; complete: boolean }) : null;
  } catch {
    return null;
  }
}
function saveRun(complete: boolean) {
  try {
    window.localStorage.setItem(THROTTLE_KEY, JSON.stringify({ ts: Date.now(), complete }));
  } catch {
    /* nop */
  }
}
function shouldSkip(): boolean {
  const r = lastRun();
  if (!r) return false;
  const age = Date.now() - r.ts;
  return r.complete ? age < OK_MS : age < RETRY_MS;
}

export default function OfflinePrecache() {
  const router = useRouter();
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    let cancelled = false;

    async function run() {
      if (!navigator.onLine || shouldSkip()) return;
      const session = await getSession().catch(() => null);
      if (cancelled || !session) return;

      // 1) prefetch rutas de lista (RSC + chunks).
      for (const r of ROUTES) { try { router.prefetch(r); } catch { /* nop */ } }
      // 2) documentos de lista (recarga completa offline).
      for (const r of ROUTES) {
        if (cancelled || !navigator.onLine) break;
        try { await fetch(r, { credentials: "include" }); } catch { /* nop */ }
      }
      // 3) datos de referencia livianos.
      for (const url of DATA) {
        if (cancelled || !navigator.onLine) break;
        try { await fetchWithSupabaseSession(url, { cache: "no-store" }); } catch { /* nop */ }
      }
      // 4) catálogo completo y clientes → IndexedDB (robusto).
      let prodComplete = false;
      let cliComplete = false;
      if (!cancelled && navigator.onLine) {
        try { prodComplete = (await warmProductosOffline()).complete; } catch { /* nop */ }
      }
      if (!cancelled && navigator.onLine) {
        try { cliComplete = (await warmClientesOffline()).complete; } catch { /* nop */ }
      }
      // Marcar según completitud (si quedó a medias, se reintenta pronto).
      saveRun(prodComplete && cliComplete);
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
