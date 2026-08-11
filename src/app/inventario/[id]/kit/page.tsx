"use client";

/**
 * /inventario/[id]/kit — Editor de componentes de un producto KIT (#14).
 * Un KIT descuenta el stock de sus componentes al venderse (reutiliza el motor
 * de recetas). Conserva su propio precio y sale como una sola línea en el ticket.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PageHeader from "@/components/ui/PageHeader";
import { Boxes, Loader2, Search, Trash2, Plus, Info } from "lucide-react";

interface Componente { producto_id: string; nombre: string; sku: string | null; unidad_medida: string | null; stock_actual: number; cantidad: number; }
interface Resultado { id: string; nombre: string; sku: string | null; unidad_medida: string; stock_actual: number; }

const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function KitEditorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const productoId = params.id;

  const [prodNombre, setProdNombre] = useState("");
  const [componentes, setComponentes] = useState<Componente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Buscador de componentes
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [buscando, setBuscando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [pr, kr] = await Promise.all([
        fetch(`/api/productos/${productoId}`, { credentials: "include", cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch(`/api/productos/${productoId}/kit`, { credentials: "include", cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);
      const p = pr?.data ?? pr;
      setProdNombre(p?.nombre ?? p?.producto?.nombre ?? "Producto");
      if (kr?.success) setComponentes((kr.data.componentes as Componente[]) ?? []);
    } finally { setCargando(false); }
  }, [productoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const buscar = useCallback(async (texto: string) => {
    if (texto.trim().length < 2) { setResultados([]); return; }
    setBuscando(true);
    try {
      const r = await fetch(`/api/productos/search-compras?q=${encodeURIComponent(texto.trim())}&limit=20`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      const items = (j?.data?.items ?? []) as Resultado[];
      setResultados(items.filter((it) => it.id !== productoId && !componentes.some((c) => c.producto_id === it.id)));
    } finally { setBuscando(false); }
  }, [productoId, componentes]);

  useEffect(() => {
    const t = setTimeout(() => buscar(q), 250);
    return () => clearTimeout(t);
  }, [q, buscar]);

  function agregar(r: Resultado) {
    setComponentes((prev) => [...prev, { producto_id: r.id, nombre: r.nombre, sku: r.sku, unidad_medida: r.unidad_medida, stock_actual: r.stock_actual, cantidad: 1 }]);
    setQ(""); setResultados([]);
  }
  function setCantidad(id: string, cant: number) {
    setComponentes((prev) => prev.map((c) => (c.producto_id === id ? { ...c, cantidad: cant } : c)));
  }
  function quitar(id: string) {
    setComponentes((prev) => prev.filter((c) => c.producto_id !== id));
  }

  async function guardar() {
    setGuardando(true); setMsg(null);
    try {
      const body = { componentes: componentes.filter((c) => c.cantidad > 0).map((c) => ({ producto_id: c.producto_id, cantidad: c.cantidad, unidad_medida: c.unidad_medida })) };
      const r = await fetch(`/api/productos/${productoId}/kit`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!j?.success) { setMsg(j?.error || "No se pudo guardar."); return; }
      setComponentes((j.data.componentes as Componente[]) ?? []);
      setMsg(componentes.length === 0 ? "El producto ya no es un KIT." : "KIT guardado. Al venderlo descuenta el stock de sus componentes.");
    } catch { setMsg("Error de red al guardar."); }
    finally { setGuardando(false); }
  }

  const esKit = componentes.length > 0;
  const validos = useMemo(() => componentes.filter((c) => c.cantidad > 0).length, [componentes]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zentra · Inventario" title="Componentes del KIT" description={prodNombre} backHref={`/inventario/${productoId}/editar`} backLabel="Editar producto" />

      <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <p>Un <b>KIT</b> se vende como un solo producto (con su propio precio) y al concretarse la venta descuenta el stock de cada componente. El kit no maneja stock propio. Dejá la lista vacía y guardá para que deje de ser kit.</p>
      </div>

      {cargando ? (
        <p className="px-5 py-10 text-center text-sm text-slate-400"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Cargando…</p>
      ) : (
        <>
          {/* Buscador */}
          <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Agregar componente</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto por nombre, SKU o código…" className={`${inputCls} pl-9`} />
              {buscando && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[#4FAEB2]" />}
            </div>
            {resultados.length > 0 && (
              <ul className="mt-2 max-h-64 divide-y divide-slate-100 overflow-auto rounded-xl border border-slate-100">
                {resultados.map((r) => (
                  <li key={r.id}>
                    <button type="button" onClick={() => agregar(r)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-[#4FAEB2]/5">
                      <span><span className="text-sm font-medium text-slate-800">{r.nombre}</span><span className="ml-2 font-mono text-[11px] text-slate-400">{r.sku}</span></span>
                      <span className="flex items-center gap-2 text-[11px] text-slate-400"><span>Stock {r.stock_actual}</span><Plus className="h-4 w-4 text-[#4FAEB2]" /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Lista de componentes */}
          <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
            <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
              <Boxes className="h-4 w-4 text-[#4FAEB2]" />
              <h2 className="text-[15px] font-bold text-slate-800">Componentes {esKit && <span className="text-xs font-normal text-slate-400">({validos})</span>}</h2>
            </div>
            {componentes.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-slate-400">Sin componentes. Buscá y agregá productos para convertirlo en KIT.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3 font-semibold">Producto</th>
                    <th className="px-3 py-3 text-right font-semibold">Stock</th>
                    <th className="px-3 py-3 text-right font-semibold">Cant. por kit</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {componentes.map((c) => (
                    <tr key={c.producto_id} className="hover:bg-[#4FAEB2]/[0.03]">
                      <td className="px-5 py-2.5">
                        <span className="font-medium text-slate-800">{c.nombre}</span>
                        <div className="font-mono text-[11px] text-slate-400">{c.sku}{c.unidad_medida ? ` · ${c.unidad_medida}` : ""}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{c.stock_actual}</td>
                      <td className="px-3 py-2.5 text-right">
                        <input type="number" min={0} step="any" value={c.cantidad || ""} onChange={(e) => setCantidad(c.producto_id, Number(e.target.value) || 0)}
                          className="w-24 rounded-md border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20" />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button type="button" onClick={() => quitar(c.producto_id)} className="rounded-md p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {msg && <p className="rounded-lg bg-slate-50 px-4 py-2.5 text-sm text-slate-700">{msg}</p>}

          <div className="flex gap-3">
            <button type="button" onClick={guardar} disabled={guardando} className="rounded-xl bg-[#4FAEB2] px-6 py-3 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-40">
              {guardando ? "Guardando…" : componentes.length === 0 ? "Guardar (no es KIT)" : "Guardar KIT"}
            </button>
            <button type="button" onClick={() => router.push(`/inventario/${productoId}/editar`)} className="rounded-xl border border-slate-200 px-6 py-3 text-sm hover:bg-slate-50">Volver</button>
          </div>
        </>
      )}
    </div>
  );
}
