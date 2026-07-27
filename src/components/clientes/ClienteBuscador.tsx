"use client";

/**
 * Selector de cliente con búsqueda (combobox). Reemplaza al `<select>` plano:
 * filtra por razón social, nombre de contacto, RUC o documento a medida que se
 * escribe, con navegación por teclado.
 *
 * Controlado: recibe la lista de clientes ya cargada y el id seleccionado.
 * Pensado para catálogos de clientes chicos/medianos (filtra en el cliente).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, X, Check, User } from "lucide-react";

export interface ClienteOption {
  id: string;
  empresa?: string | null;
  nombre_contacto?: string | null;
  ruc?: string | null;
  documento?: string | null;
}

interface Props {
  clientes: ClienteOption[];
  value: string; // id, "" = sin cliente
  onChange: (id: string) => void;
  placeholder?: string;
  /** Texto de la opción vacía. "" la oculta (cliente obligatorio). */
  sinClienteLabel?: string | null;
  className?: string;
}

function labelCliente(c: ClienteOption): string {
  return (c.empresa || c.nombre_contacto || "Cliente").trim();
}

function norm(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Cada palabra debe aparecer en algún campo (orden libre). */
function matches(c: ClienteOption, q: string): boolean {
  const campos = norm([c.empresa, c.nombre_contacto, c.ruc, c.documento].filter(Boolean).join(" "));
  return norm(q).split(/\s+/).filter(Boolean).every((tok) => campos.includes(tok));
}

export default function ClienteBuscador({
  clientes,
  value,
  onChange,
  placeholder = "Buscar por nombre, RUC o documento…",
  sinClienteLabel = "— Sin cliente —",
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hl, setHl] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const seleccionado = useMemo(() => clientes.find((c) => c.id === value) ?? null, [clientes, value]);

  const resultados = useMemo(() => {
    const q = query.trim();
    const base = q ? clientes.filter((c) => matches(c, q)) : clientes;
    return base.slice(0, 50);
  }, [clientes, query]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) { setOpen(false); setQuery(""); }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (open && hl >= 0) listRef.current?.querySelector(`[data-idx="${hl}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, hl]);

  function elegir(id: string) {
    onChange(id);
    setOpen(false);
    setQuery("");
    setHl(-1);
  }

  // Opciones navegables: "sin cliente" (si aplica) + resultados.
  const conSinCliente = sinClienteLabel != null;
  const totalNav = (conSinCliente ? 1 : 0) + resultados.length;

  function seleccionarIndice(idx: number) {
    if (conSinCliente && idx === 0) return elegir("");
    const r = resultados[idx - (conSinCliente ? 1 : 0)];
    if (r) elegir(r.id);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      {/* Campo: si hay cliente y no está abierto, muestra el elegido; si no, el input de búsqueda. */}
      <div className="relative">
        <User className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-[#4FAEB2]" />
        {seleccionado && !open ? (
          <button
            type="button"
            onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="flex h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-left text-sm outline-none transition hover:border-[#4FAEB2]/60"
          >
            <span className="truncate font-medium text-slate-800">
              {labelCliente(seleccionado)}
              {seleccionado.ruc && <span className="ml-2 text-xs font-normal text-slate-400">RUC {seleccionado.ruc}</span>}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" />
          </button>
        ) : (
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); setHl(-1); }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHl((h) => Math.min(h + 1, totalNav - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
              else if (e.key === "Enter") { e.preventDefault(); if (open && hl >= 0) seleccionarIndice(hl); }
              else if (e.key === "Escape") { e.preventDefault(); setOpen(false); setQuery(""); }
            }}
            placeholder={placeholder}
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-sm outline-none transition placeholder:text-slate-400 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
          />
        )}
        {seleccionado && !open && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); elegir(""); }}
            className="absolute right-9 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
            aria-label="Quitar cliente"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <ul
          ref={listRef}
          className="absolute z-40 mt-1.5 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl ring-1 ring-[#4FAEB2]/15"
        >
          {conSinCliente && (
            <li>
              <button
                type="button"
                data-idx={0}
                onMouseEnter={() => setHl(0)}
                onClick={() => elegir("")}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                  hl === 0 ? "bg-[#4FAEB2]/10 text-[#2F6E71]" : "text-slate-500 hover:bg-slate-50"
                }`}
              >
                {sinClienteLabel}
                {value === "" && <Check className="h-4 w-4 text-[#4FAEB2]" />}
              </button>
            </li>
          )}
          {resultados.length === 0 ? (
            <li className="px-3 py-3 text-center text-xs text-slate-400">Sin clientes que coincidan.</li>
          ) : (
            resultados.map((c, i) => {
              const idx = i + (conSinCliente ? 1 : 0);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setHl(idx)}
                    onClick={() => elegir(c.id)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                      idx === hl ? "bg-[#4FAEB2]/10 text-[#2F6E71]" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{labelCliente(c)}</span>
                      {c.ruc && <span className="ml-2 text-xs text-slate-400">RUC {c.ruc}</span>}
                      {!c.ruc && c.documento && <span className="ml-2 text-xs text-slate-400">CI {c.documento}</span>}
                    </span>
                    {value === c.id && <Check className="h-4 w-4 shrink-0 text-[#4FAEB2]" />}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      )}
    </div>
  );
}
