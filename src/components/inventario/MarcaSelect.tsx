"use client";

/**
 * Desplegable de marca: elegir una marca ya registrada, buscarla al tipear o
 * crear una nueva directamente desde el campo ("Crear «texto»").
 * El valor es el nombre de la marca (productos.marca es texto).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Check, Plus } from "lucide-react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}

export default function MarcaSelect({ value, onChange, className = "" }: Props) {
  const [marcas, setMarcas] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/productos/marcas", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancel || !j?.success) return;
        setMarcas((j.data?.marcas ?? []) as string[]);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // La marca actual siempre figura en la lista (aunque sea nueva y aún no guardada).
  const todas = useMemo(() => {
    const v = value.trim();
    if (v && !marcas.some((m) => m.toLowerCase() === v.toLowerCase())) {
      return [...marcas, v].sort((a, b) => a.localeCompare(b, "es"));
    }
    return marcas;
  }, [marcas, value]);

  const q = query.trim();
  const filtradas = q ? todas.filter((m) => m.toLowerCase().includes(q.toLowerCase())) : todas;
  const existeExacta = !!q && todas.some((m) => m.toLowerCase() === q.toLowerCase());

  function pick(m: string) {
    onChange(m);
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (q && !existeExacta && filtradas.length !== 1) pick(q);
      else if (filtradas.length >= 1) pick(filtradas[0]);
      else if (q) pick(q);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm outline-none transition-all hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
      >
        <span className="min-w-0 truncate">
          {value.trim() ? value : <span className="text-slate-400">Elegí o creá una marca</span>}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/5">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Buscar o escribir una marca nueva..."
                className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            <button
              type="button"
              onClick={() => pick("")}
              className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm italic text-slate-500 hover:bg-slate-50"
            >
              Sin marca
              {!value.trim() && <Check className="h-3.5 w-3.5 text-[#4FAEB2]" />}
            </button>
            {q && !existeExacta && (
              <button
                type="button"
                onClick={() => pick(q)}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm font-medium text-[#3F8E91] hover:bg-[#4FAEB2]/10"
              >
                <Plus className="h-3.5 w-3.5" />
                Crear marca «{q}»
              </button>
            )}
            {filtradas.map((m) => {
              const sel = m.toLowerCase() === value.trim().toLowerCase();
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => pick(m)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <span className={`min-w-0 truncate ${sel ? "font-semibold" : ""}`}>{m}</span>
                  {sel && <Check className="h-3.5 w-3.5 shrink-0 text-[#4FAEB2]" />}
                </button>
              );
            })}
            {filtradas.length === 0 && !q && (
              <p className="px-3 py-4 text-center text-xs text-slate-400">Todavía no hay marcas. Escribí una para crearla.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
