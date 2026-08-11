"use client";

/**
 * /reportes/productos-vendidos — cuánto se vendió de cada producto.
 * Resumido: unidades y total por producto. Detallado: cada venta (fecha, factura,
 * cajero, vendedor, cantidad, precio). Filtros: rango de fechas, categoría y
 * (client-side) nombre de producto.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { Boxes, Loader2, Search } from "lucide-react";

interface Resumen { producto_id: string; producto_nombre: string; categoria_nombre: string | null; unidades: number; total: number; ventas: number; }
interface Detalle { fecha: string; numero_control: string; numero_factura: string | null; cajero: string | null; vendedor: string | null; producto_id: string; producto_nombre: string; categoria_nombre: string | null; cantidad: number; precio_venta: number; total_linea: number; }
type Cat = { id: string; nombre: string };

function gs(v: number) { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }
function fh(iso: string) {
  try { return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch { return iso; }
}
function hoyAsuncion() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date()); }
const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function ReporteProductosVendidosPage() {
  const hoy = hoyAsuncion();
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [modo, setModo] = useState<"resumido" | "detallado">("resumido");
  const [categoriaId, setCategoriaId] = useState("");
  const [categorias, setCategorias] = useState<Cat[]>([]);
  const [prodFiltro, setProdFiltro] = useState("");
  const [resumen, setResumen] = useState<Resumen[]>([]);
  const [detalle, setDetalle] = useState<Detalle[]>([]);
  const [totales, setTotales] = useState<{ total: number; unidades: number }>({ total: 0, unidades: 0 });
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    fetch("/api/inventario/categorias", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setCategorias(((j?.data?.categorias ?? []) as Cat[]).map((c) => ({ id: c.id, nombre: c.nombre }))))
      .catch(() => setCategorias([]));
  }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams({ desde, hasta, modo });
      if (categoriaId) p.set("categoria_id", categoriaId);
      const r = await fetch(`/api/reportes/productos-vendidos?${p.toString()}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (j?.success) {
        if (modo === "detallado") { setDetalle(j.data.items as Detalle[]); setResumen([]); }
        else {
          setResumen(j.data.items as Resumen[]); setDetalle([]);
          setTotales({ total: j.data.totalGeneral ?? 0, unidades: j.data.unidadesGeneral ?? 0 });
        }
      }
    } finally { setCargando(false); }
  }, [desde, hasta, modo, categoriaId]);

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const q = prodFiltro.trim().toLowerCase();
  const resumenF = useMemo(() => q === "" ? resumen : resumen.filter((r) => r.producto_nombre.toLowerCase().includes(q)), [resumen, q]);
  const detalleF = useMemo(() => q === "" ? detalle : detalle.filter((d) => d.producto_nombre.toLowerCase().includes(q)), [detalle, q]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zentra · Reportes" title="Productos vendidos" description="Cuánto se vendió de cada producto. Resumido (unidades y total) o detallado (cada venta con factura, cajero y vendedor)." backHref="/reportes" backLabel="Reportes" />

      <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Categoría</span>
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className={inputCls}>
              <option value="">Todas</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Detalle</span>
            <select value={modo} onChange={(e) => setModo(e.target.value as "resumido" | "detallado")} className={inputCls}>
              <option value="resumido">Resumido (por producto)</option>
              <option value="detallado">Detallado (cada venta)</option>
            </select></label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input type="text" value={prodFiltro} onChange={(e) => setProdFiltro(e.target.value)} placeholder="Filtrar por producto…" className={`${inputCls} pl-9`} />
          </div>
          <button type="button" onClick={cargar} className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 hover:bg-[#3F8E91]">
            <Search className="h-4 w-4" /> Generar
          </button>
        </div>
      </div>

      {modo === "resumido" && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total vendido</p><p className="mt-0.5 text-sm font-bold tabular-nums text-[#3F8E91]">{gs(totales.total)}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Unidades</p><p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{totales.unidades.toLocaleString("es-PY")}</p></div>
          <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Productos distintos</p><p className="mt-0.5 text-sm font-bold tabular-nums text-slate-900">{resumenF.length}</p></div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
          <Boxes className="h-4 w-4 text-[#4FAEB2]" />
          <h2 className="text-[15px] font-bold text-slate-800">{modo === "resumido" ? "Resumen por producto" : "Detalle de ventas"}</h2>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />}
          {!cargando && <span className="text-xs text-slate-400">{(modo === "resumido" ? resumenF : detalleF).length} filas</span>}
        </div>

        {cargando ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : modo === "resumido" ? (
          resumenF.length === 0 ? <p className="px-5 py-12 text-center text-sm text-slate-400">Sin ventas para los filtros seleccionados.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Producto</th><th className="px-3 py-3 font-semibold">Categoría</th>
                  <th className="px-3 py-3 text-right font-semibold">Unidades</th><th className="px-3 py-3 text-right font-semibold">Ventas</th><th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {resumenF.map((r) => (
                    <tr key={r.producto_id} className="hover:bg-[#4FAEB2]/[0.03]">
                      <td className="px-5 py-2.5 font-medium text-slate-800">{r.producto_nombre}</td>
                      <td className="px-3 py-2.5 text-slate-600">{r.categoria_nombre || "—"}</td>
                      <td className="px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">{r.unidades.toLocaleString("es-PY")}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{r.ventas}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#3F8E91]">{gs(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          detalleF.length === 0 ? <p className="px-5 py-12 text-center text-sm text-slate-400">Sin ventas para los filtros seleccionados.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Fecha</th><th className="px-3 py-3 font-semibold">Factura</th><th className="px-3 py-3 font-semibold">Producto</th>
                  <th className="px-3 py-3 font-semibold">Vendedor</th><th className="px-3 py-3 text-right font-semibold">Cant.</th><th className="px-3 py-3 text-right font-semibold">P. unit.</th><th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {detalleF.map((d, i) => (
                    <tr key={i} className="hover:bg-[#4FAEB2]/[0.03]">
                      <td className="px-5 py-2.5 whitespace-nowrap text-slate-600">{fh(d.fecha)}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-500">{d.numero_factura || d.numero_control}</td>
                      <td className="px-3 py-2.5 text-slate-800">{d.producto_nombre}</td>
                      <td className="px-3 py-2.5 text-slate-600">{d.vendedor || d.cajero || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">{d.cantidad.toLocaleString("es-PY")}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{gs(d.precio_venta)}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#3F8E91]">{gs(d.total_linea)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
