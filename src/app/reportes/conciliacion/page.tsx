"use client";

import { useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/StatCard";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import MesSelector from "@/components/reportes/MesSelector";
import { getConciliacionReporte } from "@/lib/reportes/storage";
import { mesActualAsuncion } from "@/lib/fechas/asuncion-bounds";
import type { ConciliacionReporte } from "@/lib/reportes/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}
const METODO: Record<string, string> = {
  efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta",
  qr: "QR", billetera: "Billetera", otro: "Otro",
};
const metodoLabel = (m: string | null) => (m ? METODO[m] ?? m : "—");

export default function ConciliacionReportePage() {
  const [mes, setMes] = useState(mesActualAsuncion());
  const [data, setData] = useState<ConciliacionReporte | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    getConciliacionReporte(mes).then((d) => { if (!cancel) { setData(d); setCargando(false); } });
    return () => { cancel = true; };
  }, [mes]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Zentra · Reportes"
        title="Conciliación bancaria"
        description="Cobros por método y entidad — detalle por venta del período"
        backHref="/reportes"
        backLabel="Reportes"
        actions={
          <div className="flex items-center gap-3">
            <MesSelector mes={mes} onChange={setMes} />
            <ExportExcelButton url={`/api/reportes/conciliacion/export?mes=${mes}`} />
          </div>
        }
      />

      {cargando ? (
        <p className="text-slate-500 animate-pulse">Cargando…</p>
      ) : !data ? (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6 text-slate-500">
          No se pudo cargar la conciliación.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard compact label="Total cobrado" value={formatGs(data.totalCobrado)} accent hint="según detalle de cobro" />
            <StatCard compact label="Operaciones" value={String(data.cantidadOperaciones)} />
            <StatCard compact label="Ventas con detalle" value={String(data.ventasConDetalle)} hint={`de ${data.cantidadVentas} ventas`} />
            <StatCard compact label="Ventas sin detalle" value={String(data.ventasSinDetalle)} hint="no conciliadas" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Por método */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-4">Por método</h2>
              {data.porMetodo.length === 0 ? (
                <p className="text-sm text-slate-400">Sin cobros con detalle.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Método</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Operaciones</th>
                      <th className="py-2.5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porMetodo.map((m, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-700">{metodoLabel(m.clave)}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{m.cantidad}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold text-slate-800">{formatGs(m.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Por entidad */}
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
              <h2 className="text-base font-semibold text-slate-800 mb-4">Por entidad / caja</h2>
              {data.porEntidad.length === 0 ? (
                <p className="text-sm text-slate-400">Sin cobros con detalle.</p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Entidad</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Operaciones</th>
                      <th className="py-2.5 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porEntidad.map((e, i) => (
                      <tr key={i} className="border-b border-slate-100 last:border-0">
                        <td className="py-2.5 pr-4 text-slate-700">{e.clave}</td>
                        <td className="py-2.5 pr-4 text-right tabular-nums text-slate-600">{e.cantidad}</td>
                        <td className="py-2.5 text-right tabular-nums font-semibold text-slate-800">{formatGs(e.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Detalle por venta */}
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Detalle por venta</h2>
            {data.ventas.length === 0 ? (
              <p className="text-sm text-slate-400">No hay ventas en el período.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="py-2.5 pr-4 font-medium">Fecha</th>
                      <th className="py-2.5 pr-4 font-medium">N° Venta</th>
                      <th className="py-2.5 pr-4 font-medium">Cliente</th>
                      <th className="py-2.5 pr-4 font-medium">Método</th>
                      <th className="py-2.5 pr-4 font-medium">Entidad</th>
                      <th className="py-2.5 pr-4 font-medium">Referencia</th>
                      <th className="py-2.5 pr-4 font-medium text-right">Monto</th>
                      <th className="py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.ventas.map((v) => (
                      <tr key={v.venta_id} className="border-b border-slate-100 last:border-0">
                        <td className="py-3 pr-4 text-slate-600 text-xs tabular-nums">{formatFecha(v.fecha)}</td>
                        <td className="py-3 pr-4 font-mono text-xs text-slate-500">{v.numero_control}</td>
                        <td className="py-3 pr-4 text-slate-700">{v.cliente ?? "—"}</td>
                        <td className="py-3 pr-4 text-slate-600">{metodoLabel(v.metodo_pago)}</td>
                        <td className="py-3 pr-4 text-slate-600">{v.entidad ?? "—"}</td>
                        <td className="py-3 pr-4 text-slate-500 text-xs">{v.referencia ?? "—"}</td>
                        <td className="py-3 pr-4 text-right tabular-nums font-semibold text-slate-800">{v.monto != null ? formatGs(v.monto) : "—"}</td>
                        <td className="py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            v.con_detalle ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                          }`}>
                            {v.con_detalle ? "Con detalle" : "Sin detalle"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
