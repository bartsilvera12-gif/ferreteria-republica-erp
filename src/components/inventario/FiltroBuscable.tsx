"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export interface OpcionFiltro {
  value: string;
  label: string;
}

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Desplegable con buscador: se escribe para filtrar las opciones
 * (sin distinguir mayúsculas ni acentos) y se elige una.
 */
export default function FiltroBuscable({
  value,
  onChange,
  opciones,
  ariaLabel,
  placeholderBusqueda,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  opciones: OpcionFiltro[];
  ariaLabel: string;
  placeholderBusqueda: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [abierto]);

  const filtradas = useMemo(() => {
    const n = normalizar(q.trim());
    if (!n) return opciones;
    return opciones.filter((o) => o.value === "" || normalizar(o.label).includes(n));
  }, [opciones, q]);

  const actual = opciones.find((o) => o.value === value)?.label ?? opciones[0]?.label ?? "";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={abierto}
        onClick={() => { setAbierto((a) => !a); setQ(""); }}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition-all focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
      >
        <span className="truncate">{actual}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {abierto && (
        <div className="absolute left-0 z-30 mt-1 w-64 max-w-[90vw] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-slate-100 px-2 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholderBusqueda}
              className="w-full text-sm outline-none"
            />
          </div>
          <ul className="max-h-60 overflow-y-auto py-1">
            {filtradas.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setAbierto(false); setQ(""); }}
                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 ${o.value === value ? "bg-slate-50 font-semibold" : ""}`}
                >
                  {o.label}
                </button>
              </li>
            ))}
            {filtradas.length === 0 && (
              <li className="px-3 py-2 text-sm text-slate-400">Sin coincidencias</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
