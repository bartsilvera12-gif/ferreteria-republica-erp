"use client";

/**
 * /reportes/facturas — Reporte de facturas emitidas (autoimpresor).
 * Filtros: rango de fechas (desde/hasta) + cliente. Muestra el detalle fiscal
 * de cada factura, totales, link a ver cada factura y exportación a PDF.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import ClienteBuscador from "@/components/clientes/ClienteBuscador";
import { getClientes } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";
import { FileText, Download, ExternalLink, Loader2, Search } from "lucide-react";

interface FacturaRow {
  venta_id: string;
  numero_completo: string;
  numero_control: string;
  condicion: string;
  emitida_at: string;
  timbrado_numero: string;
  cliente_nombre: string | null;
  cliente_ruc: string | null;
  exentas: number;
  gravado_5: number;
  iva_5: number;
  gravado_10: number;
  iva_10: number;
  total: number;
}
interface Reporte {
  facturas: FacturaRow[];
  totales: { cantidad: number; exentas: number; gravado_5: number; iva_5: number; gravado_10: number; iva_10: number; total: number };
}

function gs(v: number) { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }
function fechaHora(iso: string) {
  try {
    return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}
function hoyAsuncion() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date()); }

export default function ReporteFacturasPage() {
  const hoy = hoyAsuncion();
  const [desde, setDesde] = useState(`${hoy.slice(0, 7)}-01`);
  const [hasta, setHasta] = useState(hoy);
  const [clienteId, setClienteId] = useState("");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [data, setData] = useState<Reporte | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => { getClientes().then(setClientes).catch(() => setClientes([])); }, []);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams({ desde, hasta });
      if (clienteId) p.set("cliente_id", clienteId);
      const r = await fetch(`/api/reportes/facturas?${p.toString()}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      setData(j?.success ? (j.data as Reporte) : { facturas: [], totales: { cantidad: 0, exentas: 0, gravado_5: 0, iva_5: 0, gravado_10: 0, iva_10: 0, total: 0 } });
    } catch {
      setData({ facturas: [], totales: { cantidad: 0, exentas: 0, gravado_5: 0, iva_5: 0, gravado_10: 0, iva_10: 0, total: 0 } });
    } finally { setCargando(false); }
  }, [desde, hasta, clienteId]);

  useEffect(() => { cargar(); }, [cargar]);

  const pdfHref = useMemo(() => {
    const p = new URLSearchParams({ desde, hasta, auto: "1" });
    if (clienteId) p.set("cliente_id", clienteId);
    return `/api/reportes/facturas/pdf?${p.toString()}`;
  }, [desde, hasta, clienteId]);

  const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";
  const tot = data?.totales;

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zentra · Reportes" title="Facturas emitidas" description="Todas las facturas emitidas por el autoimpresor. Filtrá por fecha y cliente, mirá el detalle y exportá a PDF." backHref="/reportes" backLabel="Reportes" />

      {/* Filtros */}
      <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.5fr_auto] lg:items-end">
          <label className="text-sm">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Desde</span>
            <input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
          </label>
          <label className="text-sm">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Hasta</span>
            <input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
          </label>
          <div className="text-sm">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Cliente</span>
            <ClienteBuscador clientes={clientes} value={clienteId} onChange={setClienteId} sinClienteLabel="— Todos los clientes —" placeholder="Todos — buscar por nombre o RUC…" />
          </div>
          <button
            type="button"
            onClick={() => cargar()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#4FAEB2] px-5 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 transition-colors hover:bg-[#3F8E91]"
          >
            <Search className="h-4 w-4" /> Buscar
          </button>
        </div>
      </div>

      {/* Resumen + PDF */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Facturas: <span className="tabular-nums text-slate-900">{tot?.cantidad ?? 0}</span></span>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">IVA total: <span className="tabular-nums text-slate-900">{gs((tot?.iva_5 ?? 0) + (tot?.iva_10 ?? 0))}</span></span>
          <span className="rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/10 px-3 py-2 font-semibold text-[#3F8E91]">Total facturado: <span className="tabular-nums">{gs(tot?.total ?? 0)}</span></span>
        </div>
        <a
          href={pdfHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-[#4FAEB2]/30 bg-white px-4 py-2.5 text-sm font-bold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/10"
        >
          <Download className="h-4 w-4" /> Descargar PDF
        </a>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
          <FileText className="h-4 w-4 text-[#4FAEB2]" />
          <h2 className="text-[15px] font-bold text-slate-800">Detalle de facturas</h2>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />}
        </div>

        {cargando ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : !data || data.facturas.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">No hay facturas emitidas en el rango seleccionado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">N° Factura</th>
                  <th className="px-3 py-3 font-semibold">Fecha</th>
                  <th className="px-3 py-3 font-semibold">Cliente</th>
                  <th className="px-3 py-3 font-semibold">Cond.</th>
                  <th className="px-3 py-3 text-right font-semibold">Exentas</th>
                  <th className="px-3 py-3 text-right font-semibold">Grav. 5%</th>
                  <th className="px-3 py-3 text-right font-semibold">Grav. 10%</th>
                  <th className="px-3 py-3 text-right font-semibold">IVA</th>
                  <th className="px-3 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 text-center font-semibold">Ver</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.facturas.map((f) => (
                  <tr key={f.venta_id} className="transition-colors hover:bg-[#4FAEB2]/[0.03]">
                    <td className="px-5 py-3 font-mono font-semibold text-slate-800">{f.numero_completo}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-slate-600">{fechaHora(f.emitida_at)}</td>
                    <td className="px-3 py-3 text-slate-700">
                      {f.cliente_nombre?.trim() || <span className="text-slate-500">Consumidor Final</span>}
                      {f.cliente_ruc && <span className="ml-1.5 text-[11px] text-slate-400">RUC {f.cliente_ruc}</span>}
                    </td>
                    <td className="px-3 py-3 capitalize text-slate-600">{f.condicion === "credito" ? "Crédito" : "Contado"}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{gs(f.exentas)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{gs(f.gravado_5)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{gs(f.gravado_10)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-600">{gs(f.iva_5 + f.iva_10)}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-bold text-[#3F8E91]">{gs(f.total)}</td>
                    <td className="px-4 py-3 text-center">
                      <a
                        href={`/api/ventas/${f.venta_id}/factura?w=80`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Ver factura"
                        className="inline-flex items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-[#4FAEB2]/10 hover:text-[#3F8E91]"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/70 text-sm font-bold text-slate-800">
                  <td className="px-5 py-3" colSpan={4}>TOTALES ({tot?.cantidad ?? 0})</td>
                  <td className="px-3 py-3 text-right tabular-nums">{gs(tot?.exentas ?? 0)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{gs(tot?.gravado_5 ?? 0)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{gs(tot?.gravado_10 ?? 0)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{gs((tot?.iva_5 ?? 0) + (tot?.iva_10 ?? 0))}</td>
                  <td className="px-3 py-3 text-right tabular-nums text-[#3F8E91]">{gs(tot?.total ?? 0)}</td>
                  <td className="px-4 py-3" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
