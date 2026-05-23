"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Context para sincronizar el loader inicial del ERP con el estado del Sidebar.
 *
 * Flujo típico:
 *  1. AuthGuard envuelve la app con <BootProvider>.
 *  2. Mientras (authLoading || !sidebarReady), muestra <ZentraLoader overlay />.
 *  3. Renderiza los children desde el primer momento (montar el Sidebar abajo)
 *     para que el Sidebar pueda hacer su fetch de módulos/permisos.
 *  4. El Sidebar llama setSidebarReady(true) cuando termina su carga inicial.
 *
 * Resultado: el loader se mantiene visible hasta que el Sidebar tenga sus
 * datos, y vuelve a aparecer cuando el Sidebar recarga (cambio de pestaña,
 * token refresh, etc.).
 */
type BootContextValue = {
  sidebarReady: boolean;
  setSidebarReady: (v: boolean) => void;
};

const BootContext = createContext<BootContextValue>({
  sidebarReady: false,
  setSidebarReady: () => {},
});

export function BootProvider({ children }: { children: ReactNode }) {
  const [sidebarReady, setSidebarReady] = useState(false);
  return (
    <BootContext.Provider value={{ sidebarReady, setSidebarReady }}>
      {children}
    </BootContext.Provider>
  );
}

export function useBoot() {
  return useContext(BootContext);
}
