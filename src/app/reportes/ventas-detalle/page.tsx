"use client";

/**
 * /reportes/ventas-detalle — Reporte de ventas con filtros (estilo el "Reporte
 * de Venta" del sistema previo): rango de fechas, cliente, cajero, código, tipo
 * (contado/crédito), facturada/no, cobradas/pendientes, solo anuladas, y export PDF.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import ClienteBuscador from "@/components/clientes/ClienteBuscador";
import { getClientes } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";
import { ShoppingCart, Download, Search, Loader2, ChevronRight } from "lucide-react";

interface VentaRow {
  id: string; numero_control: string; fecha: string; tipo_venta: string; estado: string;
  metodo_pago: string | null; cliente_nombre: string | null; cajero: string | null; vendedor: string | null;
  subtotal: number; monto_iva: number; total: number; facturada: boolean;
  numero_factura: string | null; saldo_credito: number | null; estado_cobro: string | null;
}
interface ItemRow { producto_nombre: string; cantidad: number; precio_venta: number; total_linea: number; }
interface Rep {
  ventas: VentaRow[];
  totales: { cantidad: number; subtotal: number; monto_iva: number; total: number; total_contado: number; total_credito: number; facturadas: number; saldo_pendiente: number };
}

function gs(v: number) { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }
function fh(iso: string) {
  try { return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)); }
  catch { return iso; }
}
function hoyAsuncion() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date()); }

const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

export default function ReporteVentasDetallePage() {
  const hoy = hoyAsuncion();
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [horaDesde, setHoraDesde] = useState("");
  const [horaHasta, setHoraHasta] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cajero, setCajero] = useState("");
  const [codigo, setCodigo] = useState("");
  const [tipo, setTipo] = useState("");
  const [facturada, setFacturada] = useState("");
  const [cobro, setCobro] = useState("");
  const [soloAnuladas, setSoloAnuladas] = useState(false);
  const [resumido, setResumido] = useState(false);
  const [pdfProductos, setPdfProductos] = useState(false);
  const [data, setData] = useState<Rep | null>(null);
  const [cargando, setCargando] = useState(true);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [itemsCache, setItemsCache] = useState<Record<string, ItemRow[]>>({});
  const [itemsCargando, setItemsCargando] = useState<string | null>(null);

  useEffect(() => { getClientes().then(setClientes).catch(() => setClientes([])); }, []);

  const params = useCallback((extra?: Record<string, string>) => {
    const p = new URLSearchParams({ desde, hasta });
    if (horaDesde.trim()) p.set("hora_desde", horaDesde.trim());
    if (horaHasta.trim()) p.set("hora_hasta", horaHasta.trim());
    if (clienteId) p.set("cliente_id", clienteId);
    if (cajero.trim()) p.set("cajero", cajero.trim());
    if (codigo.trim()) p.set("codigo", codigo.trim());
    if (tipo) p.set("tipo", tipo);
    if (facturada) p.set("facturada", facturada);
    if (cobro) p.set("cobro", cobro);
    if (soloAnuladas) p.set("solo_anuladas", "1");
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    return p;
  }, [desde, hasta, horaDesde, horaHasta, clienteId, cajero, codigo, tipo, facturada, cobro, soloAnuladas]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setExpandida(null);
    try {
      const r = await fetch(`/api/reportes/ventas-detalle?${params().toString()}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      setData(j?.success ? (j.data as Rep) : null);
    } catch { setData(null); }
    finally { setCargando(false); }
  }, [params]);

  const toggleFila = useCallback(async (ventaId: string) => {
    if (expandida === ventaId) { setExpandida(null); return; }
    setExpandida(ventaId);
    if (itemsCache[ventaId]) return;
    setItemsCargando(ventaId);
    try {
      const r = await fetch(`/api/reportes/ventas-detalle/items?venta_id=${ventaId}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      setItemsCache((c) => ({ ...c, [ventaId]: j?.success ? (j.data.items as ItemRow[]) : [] }));
    } catch { setItemsCache((c) => ({ ...c, [ventaId]: [] })); }
    finally { setItemsCargando(null); }
  }, [expandida, itemsCache]);

  useEffect(() => { cargar(); /* carga inicial */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pdfHref = useMemo(() => `/api/reportes/ventas-detalle/pdf?${params({ auto: "1", resumido: resumido ? "1" : "0", productos: pdfProductos && !resumido ? "1" : "0" }).toString()}`, [params, resumido, pdfProductos]);
  const tot = data?.totales;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zentra · Reportes" title="Reporte de ventas" description="Ventas por rango de fechas con filtros por cliente, cajero, tipo, facturación y cobro. Exportable a PDF." backHref="/reportes" backLabel="Reportes" />

      {/* Filtros */}
      <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hora desde</span>
            <input type="time" value={horaDesde} onChange={(e) => setHoraDesde(e.target.value)} className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hora hasta</span>
            <input type="time" value={horaHasta} onChange={(e) => setHoraHasta(e.target.value)} className={inputCls} /></label>
          <div className="text-sm sm:col-span-2"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cliente</span>
            <ClienteBuscador clientes={clientes} value={clienteId} onChange={setClienteId} sinClienteLabel="— Todos —" placeholder="Todos — nombre o RUC…" /></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cajero</span>
            <input type="text" value={cajero} onChange={(e) => setCajero(e.target.value)} placeholder="Nombre del cajero" className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Código de venta</span>
            <input type="text" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="VTA-000123" className={inputCls} /></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tipo</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={inputCls}>
              <option value="">Todas</option><option value="CONTADO">Contado</option><option value="CREDITO">Crédito</option>
            </select></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Facturada</span>
            <select value={facturada} onChange={(e) => setFacturada(e.target.value)} className={inputCls}>
              <option value="">Todas</option><option value="si">Facturadas</option><option value="no">No facturadas</option>
            </select></label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cobro</span>
            <select value={cobro} onChange={(e) => setCobro(e.target.value)} className={inputCls}>
              <option value="">Todas</option><option value="cobrado">Cobradas</option><option value="pendiente">Pendientes (crédito)</option>
            </select></label>
          <label className="flex items-center gap-2 text-sm text-slate-600 sm:mt-6">
            <input type="checkbox" checked={soloAnuladas} onChange={(e) => setSoloAnuladas(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]" />
            Solo anuladas
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 sm:mt-6">
            <input type="checkbox" checked={resumido} onChange={(e) => setResumido(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2]" />
            PDF resumido (solo totales)
          </label>
          <label className={`flex items-center gap-2 text-sm sm:mt-6 ${resumido ? "text-slate-300" : "text-slate-600"}`}>
            <input type="checkbox" checked={pdfProductos} disabled={resumido} onChange={(e) => setPdfProductos(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-[#4FAEB2] focus:ring-[#4FAEB2] disabled:opacity-40" />
            PDF con productos por venta
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-[#4FAEB2]/30 bg-white px-4 py-2.5 text-sm font-bold text-[#3F8E91] hover:bg-[#4FAEB2]/10">
            <Download className="h-4 w-4" /> PDF
          </a>
          <button type="button" onClick={cargar} className="inline-flex items-center gap-2 rounded-xl bg-[#4FAEB2] px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 hover:bg-[#3F8E91]">
            <Search className="h-4 w-4" /> Generar reporte
          </button>
        </div>
      </div>

      {/* Totales */}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { l: "Total vendido", v: gs(tot?.total ?? 0), hi: true },
          { l: "Contado", v: gs(tot?.total_contado ?? 0) },
          { l: "Crédito", v: gs(tot?.total_credito ?? 0) },
          { l: "IVA", v: gs(tot?.monto_iva ?? 0) },
          { l: "Facturadas", v: String(tot?.facturadas ?? 0) },
          { l: "Saldo pendiente", v: gs(tot?.saldo_pendiente ?? 0) },
        ].map((c) => (
          <div key={c.l} className={`rounded-xl border p-3 ${c.hi ? "border-[#4FAEB2]/30 bg-[#4FAEB2]/10" : "border-slate-200 bg-white"}`}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{c.l}</p>
            <p className={`mt-0.5 text-sm font-bold tabular-nums ${c.hi ? "text-[#3F8E91]" : "text-slate-900"}`}>{c.v}</p>
          </div>
        ))}
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
          <ShoppingCart className="h-4 w-4 text-[#4FAEB2]" />
          <h2 className="text-[15px] font-bold text-slate-800">Detalle de ventas</h2>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />}
          {!cargando && data && <span className="text-xs text-slate-400">{data.ventas.length} filas</span>}
        </div>
        {cargando ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : !data || data.ventas.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Sin ventas para los filtros seleccionados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="w-8 px-2 py-3"></th>
                  <th className="px-3 py-3 font-semibold">N° Venta</th>
                  <th className="px-3 py-3 font-semibold">Fecha y hora</th>
                  <th className="px-3 py-3 font-semibold">Cliente</th>
                  <th className="px-3 py-3 font-semibold">Vendedor</th>
                  <th className="px-3 py-3 font-semibold">Cajero</th>
                  <th className="px-3 py-3 font-semibold">Tipo</th>
                  <th className="px-3 py-3 text-center font-semibold">Facturada</th>
                  <th className="px-3 py-3 text-center font-semibold">Cobro</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.ventas.map((v) => {
                  const anulada = v.estado === "anulada";
                  const abierta = expandida === v.id;
                  const items = itemsCache[v.id];
                  return (
                    <Fragment key={v.id}>
                      <tr onClick={() => toggleFila(v.id)} className={`cursor-pointer transition-colors hover:bg-[#4FAEB2]/[0.05] ${abierta ? "bg-[#4FAEB2]/[0.06]" : ""} ${anulada ? "text-red-600 line-through" : ""}`}>
                        <td className="px-2 py-2.5 text-slate-400"><ChevronRight className={`h-4 w-4 transition-transform ${abierta ? "rotate-90 text-[#4FAEB2]" : ""}`} /></td>
                        <td className="px-3 py-2.5 font-mono font-semibold">{v.numero_control}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{fh(v.fecha)}</td>
                        <td className="px-3 py-2.5 text-slate-700">{v.cliente_nombre || <span className="text-slate-400">Consumidor Final</span>}</td>
                        <td className="px-3 py-2.5 capitalize text-slate-600">{v.vendedor || <span className="text-slate-400">—</span>}</td>
                        <td className="px-3 py-2.5 text-slate-600">{v.cajero || "—"}</td>
                        <td className="px-3 py-2.5 capitalize text-slate-600">{v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}</td>
                        <td className="px-3 py-2.5 text-center">
                          {v.facturada ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">Sí</span> : <span className="text-slate-400">No</span>}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs">
                          {anulada ? "Anulada" : v.tipo_venta === "CREDITO" ? (v.estado_cobro === "pagado" ? <span className="text-emerald-700">Cobrada</span> : <span className="text-amber-600">Pendiente</span>) : <span className="text-emerald-700">Cobrada</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-bold tabular-nums text-[#3F8E91]">{gs(v.total)}</td>
                      </tr>
                      {abierta && (
                        <tr className="bg-slate-50/60">
                          <td colSpan={10} className="px-5 py-3">
                            {itemsCargando === v.id ? (
                              <p className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando productos…</p>
                            ) : !items || items.length === 0 ? (
                              <p className="text-xs text-slate-400">Sin productos registrados en esta venta.</p>
                            ) : (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-[10px] uppercase tracking-wide text-slate-400">
                                    <th className="py-1 pr-3 text-left font-semibold">Producto</th>
                                    <th className="py-1 px-3 text-right font-semibold">Cantidad</th>
                                    <th className="py-1 px-3 text-right font-semibold">Precio unit.</th>
                                    <th className="py-1 pl-3 text-right font-semibold">Total</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {items.map((it, i) => (
                                    <tr key={i} className="border-t border-slate-200/70">
                                      <td className="py-1 pr-3 text-slate-700">{it.producto_nombre}</td>
                                      <td className="py-1 px-3 text-right tabular-nums text-slate-600">{it.cantidad.toLocaleString("es-PY")}</td>
                                      <td className="py-1 px-3 text-right tabular-nums text-slate-600">{gs(it.precio_venta)}</td>
                                      <td className="py-1 pl-3 text-right font-semibold tabular-nums text-slate-800">{gs(it.total_linea)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
