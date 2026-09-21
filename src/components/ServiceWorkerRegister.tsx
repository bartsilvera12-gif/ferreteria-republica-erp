"use client";

import { useEffect } from "react";

/**
 * Registra el service worker (/sw.js). Por ahora registra también en desarrollo
 * para poder PROBAR el offline localmente. Antes de deployar a producción se
 * puede volver a limitar a `process.env.NODE_ENV === "production"`.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("[sw] registro falló:", err);
      });
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
