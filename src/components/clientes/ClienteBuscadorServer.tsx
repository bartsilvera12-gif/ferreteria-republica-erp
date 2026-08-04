"use client";

/**
 * Buscador de cliente con búsqueda SERVER-SIDE (para catálogos grandes: 8.900+
 * clientes). Escribís y consulta /api/clientes paginado por nombre/RUC/etc.,
 * sin traer toda la base. Al elegir, devuelve el cliente completo.
 */
import { useEffect, useRef, useState } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { getClientesPaginado, clienteNombre } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";

export default function ClienteBuscadorServer({
  selectedId,
  selectedLabel,
  onSelect,
  placeholder = "Buscar cliente por nombre o RUC…",
  className = "",
}: {
  selectedId: string;
  /** Etiqueta a mostrar cuando hay uno elegido (nombre). */
  selectedLabel?: string;
  onSelect: (cliente: Cliente | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [hl, setHl] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResultados([]); setBuscando(false); return; }
    setBuscando(true);
    const t = setTimeout(async () => {
      const r = await getClientesPaginado({ page: 1, pageSize: 20, q });
      setResultados(r.clientes);
      setBuscando(false);
      setHl(-1);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  function elegir(c: Cliente) {
    onSelect(c);
    setOpen(false);
    setQuery("");
    setResultados([]);
    setHl(-1);
  }

  if (selectedId) {
    return (
      <div className={`flex h-11 items-center justify-between gap-2 rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.06] px-3 ${className}`}>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{selectedLabel || "Cliente seleccionado"}</span>
        <button type="button" onClick={() => onSelect(null)} className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Quitar cliente">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHl((h) => Math.min(h + 1, resultados.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); if (hl >= 0 && resultados[hl]) elegir(resultados[hl]); }
          else if (e.key === "Escape") { setOpen(false); }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
      />
      {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#4FAEB2]" />}
      {open && query.trim().length >= 2 && (
        <ul className="absolute left-0 right-0 z-50 mt-1.5 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-[#4FAEB2]/15">
          {buscando && resultados.length === 0 ? (
            <li className="px-3 py-3 text-center text-xs text-slate-400">Buscando…</li>
          ) : resultados.length === 0 ? (
            <li className="px-3 py-3 text-center text-xs text-slate-400">Sin clientes que coincidan.</li>
          ) : (
            resultados.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setHl(i)}
                  onClick={() => elegir(c)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === hl ? "bg-[#4FAEB2]/10 text-[#2F6E71]" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{clienteNombre(c)}</span>
                  {c.ruc && <span className="shrink-0 text-xs text-slate-400">RUC {c.ruc}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
