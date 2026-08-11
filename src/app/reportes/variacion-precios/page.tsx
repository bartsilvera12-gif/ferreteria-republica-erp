"use client";

/**
 * /reportes/variacion-precios — productos que cambiaron de costo y/o precio de
 * venta al recibir compras. Muestra anterior vs actual, variación % y monto, y
 * quién recibió la compra. Filtros: rango de fechas, proveedor y (client) producto.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { TrendingUp, Loader2, Search } from "lucide-react";

interface Row {
  producto_id: string; producto_nombre: string; fecha: string; numero_control: string;
  proveedor_nombre: string; usuario_nombre: string | null;
  costo_ant: number; costo_act: number; costo_var_monto: number; costo_var_pct: number | null;
  precio_ant: number; precio_act: number; precio_var_monto: number; precio_var_pct: number | null;
}

function gs(v: number) { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }
function fh(iso: string) { try { return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso)); } catch { return iso; } }
function hoyAsuncion() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date()); }
const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

function Pct({ v }: { v: number | null }) {
  if (v == null) return <span className="text-slate-300">—</span>;
  const cls = v > 0 ? "text-red-600" : v < 0 ? "text-emerald-600" : "text-slate-500";
  return <span className={`font-semibold tabular-nums ${cls}`}>{v > 0 ? "+" : ""}{v.toFixed(1)}%</span>;
}

export default function ReporteVariacionPreciosPage() {
  const hoy = hoyAsuncion();
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [proveedor, setProveedor] = useState("");
  const [prodFiltro, setProdFiltro] = useState("");
  const [items, setItems] = useState<Row[]>([]);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams({ desde, hasta });
      if (proveedor.trim()) p.set("proveedor", proveedor.trim());
      const r = await fetch(`/api/reportes/variacion-precios?${p.toString()}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (j?.success) setItems(j.data.items as Row[]);
    } finally { setCargando(false); }
  }, [desde, hasta, proveedor]);

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const q = prodFiltro.trim().toLowerCase();
  const filtrados = useMemo(() => q === "" ? items : items.filter((r) => r.producto_nombre.toLowerCase().includes(q)), [items, q]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zentra · Reportes" title="Variación de precios" description="Productos que cambiaron de costo y/o precio de venta al recibir compras: anterior vs actual, variación y quién recibió." backHref="/reportes" backLabel="Reportes" />

      <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Proveedor</span>
            <input type="text" value={proveedor} onChange={(e) => setProveedor(e.target.value)} placeholder="Nombre del proveedor" className={inputCls} /></label>
          <div className="flex items-end">
            <button type="button" onClick={cargar} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#4FAEB2] px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 hover:bg-[#3F8E91]">
              <Search className="h-4 w-4" /> Generar
            </button>
          </div>
        </div>
        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="text" value={prodFiltro} onChange={(e) => setProdFiltro(e.target.value)} placeholder="Filtrar por producto…" className={`${inputCls} pl-9`} />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
          <TrendingUp className="h-4 w-4 text-[#4FAEB2]" />
          <h2 className="text-[15px] font-bold text-slate-800">Variaciones en recepción de compras</h2>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />}
          {!cargando && <span className="text-xs text-slate-400">{filtrados.length} filas</span>}
        </div>
        {cargando ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Sin variaciones de precio para los filtros seleccionados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Producto</th>
                  <th className="px-3 py-3 font-semibold">Fecha</th>
                  <th className="px-3 py-3 text-right font-semibold">Costo ant.</th>
                  <th className="px-3 py-3 text-right font-semibold">Costo act.</th>
                  <th className="px-3 py-3 text-right font-semibold">Δ Costo</th>
                  <th className="px-3 py-3 text-right font-semibold">P. venta ant.</th>
                  <th className="px-3 py-3 text-right font-semibold">P. venta act.</th>
                  <th className="px-3 py-3 text-right font-semibold">Δ Venta</th>
                  <th className="px-4 py-3 font-semibold">Recibió</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map((r, i) => (
                  <tr key={i} className="hover:bg-[#4FAEB2]/[0.03]">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-slate-800">{r.producto_nombre}</span>
                      <div className="text-[11px] text-slate-400">{r.proveedor_nombre} · {r.numero_control}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{fh(r.fecha)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{gs(r.costo_ant)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{gs(r.costo_act)}</td>
                    <td className="px-3 py-2.5 text-right"><Pct v={r.costo_var_pct} /></td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{gs(r.precio_ant)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{gs(r.precio_act)}</td>
                    <td className="px-3 py-2.5 text-right"><Pct v={r.precio_var_pct} /></td>
                    <td className="px-4 py-2.5 text-slate-600">{r.usuario_nombre ? r.usuario_nombre.split("@")[0] : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
