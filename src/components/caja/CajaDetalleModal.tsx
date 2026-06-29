"use client";

import { useEffect, useState } from "react";
import { X, ArrowDownCircle, ArrowUpCircle, ShoppingCart, DoorOpen, Wallet } from "lucide-react";
import { getCajaDetalle } from "@/lib/reportes/storage";
import type { CajaDetalle, MedioPagoCaja } from "@/lib/caja/types";

function formatGs(v: number) {
  return `Gs. ${Math.round(v).toLocaleString("es-PY")}`;
}
function formatHora(iso: string) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return "—";
  }
}
function formatFechaHora(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const fch = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    return `${fch} ${formatHora(iso)}`;
  } catch {
    return iso;
  }
}

const MEDIO_LABEL: Record<MedioPagoCaja, string> = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  otro: "Otro",
};

/** Una fila unificada de la línea de tiempo del turno. */
type TimelineRow = {
  key: string;
  ts: string;
  icon: React.ReactNode;
  tipo: string;
  tipoClass: string;
  detalle: string;
  medio: MedioPagoCaja | null;
  monto: number;
  signo: 1 | -1;
  tachado?: boolean;
};

export default function CajaDetalleModal({
  cajaId,
  onClose,
}: {
  cajaId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CajaDetalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    setCargando(true);
    setError(null);
    getCajaDetalle(cajaId)
      .then((d) => {
        if (cancel) return;
        if (!d) setError("No se pudo cargar el detalle del turno.");
        setData(d);
      })
      .finally(() => {
        if (!cancel) setCargando(false);
      });
    return () => {
      cancel = true;
    };
  }, [cajaId]);

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const c = data?.caja;

  // Línea de tiempo unificada: apertura + ventas + movimientos manuales.
  const timeline: TimelineRow[] = [];
  if (c) {
    timeline.push({
      key: "apertura",
      ts: c.fecha_apertura,
      icon: <DoorOpen className="h-3.5 w-3.5" />,
      tipo: "Apertura",
      tipoClass: "bg-[#E5F4F4] text-[#3F8E91]",
      detalle: c.abierta_por_nombre ? `Abrió ${c.abierta_por_nombre}` : "Apertura de caja",
      medio: "efectivo",
      monto: c.monto_apertura,
      signo: 1,
    });
    for (const v of data!.ventas) {
      const tv = v.tipo_venta ? ` · ${v.tipo_venta}` : "";
      timeline.push({
        key: `v-${v.id}`,
        ts: v.fecha,
        icon: <ShoppingCart className="h-3.5 w-3.5" />,
        tipo: "Venta",
        tipoClass: "bg-emerald-50 text-emerald-700",
        detalle: `${v.numero_control ?? "Venta"}${tv}`,
        medio: v.metodo_pago,
        monto: v.total,
        signo: 1,
        tachado: v.estado === "anulada",
      });
    }
    for (const m of data!.movimientos) {
      const esEntrada = m.tipo === "ingreso" || (m.tipo === "ajuste" && m.monto >= 0);
      const tipoLabel =
        m.tipo === "ingreso"
          ? "Ingreso"
          : m.tipo === "egreso"
          ? "Egreso"
          : m.tipo === "retiro"
          ? "Retiro"
          : "Ajuste";
      const autor = m.usuario_nombre || m.usuario_email;
      timeline.push({
        key: `m-${m.id}`,
        ts: m.created_at,
        icon: esEntrada ? <ArrowDownCircle className="h-3.5 w-3.5" /> : <ArrowUpCircle className="h-3.5 w-3.5" />,
        tipo: tipoLabel,
        tipoClass: esEntrada ? "bg-sky-50 text-sky-700" : "bg-amber-50 text-amber-700",
        detalle: autor ? `${m.concepto} · ${autor}` : m.concepto,
        medio: m.medio_pago,
        monto: Math.abs(m.monto),
        signo: esEntrada ? 1 : -1,
      });
    }
    timeline.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  }

  const dif = c?.diferencia ?? null;
  const difClass =
    dif == null ? "text-slate-400" : dif === 0 ? "text-emerald-600" : dif < 0 ? "text-red-600" : "text-amber-600";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(ev) => ev.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-[#4FAEB2]/20 bg-gradient-to-r from-[#4FAEB2]/8 to-transparent px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-lg font-bold text-slate-900">
                <Wallet className="h-4 w-4 text-[#4FAEB2]" />
                Detalle del turno
              </h3>
              {c && (
                <p className="mt-0.5 text-sm text-slate-500">
                  {formatFechaHora(c.fecha_apertura)}
                  {c.fecha_cierre ? ` → ${formatFechaHora(c.fecha_cierre)}` : " · en curso"}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {cargando ? (
            <p className="animate-pulse py-6 text-center text-sm text-slate-500">Cargando…</p>
          ) : error || !c ? (
            <p className="py-6 text-center text-sm text-red-600">{error ?? "Sin datos."}</p>
          ) : (
            <div className="space-y-5">
              {/* Resumen del arqueo */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <Resumen label="Vendido" value={formatGs(c.total_vendido)} hint={`${c.cantidad_ventas} venta(s)`} accent />
                <Resumen label="Efectivo" value={formatGs(c.total_efectivo)} />
                <Resumen label="Tarjeta" value={formatGs(c.total_tarjeta)} />
                <Resumen label="Transferencia" value={formatGs(c.total_transferencia)} />
                <Resumen label="Efectivo esperado" value={formatGs(c.efectivo_esperado)} hint="apertura + efectivo ± movs" />
                <Resumen
                  label="Contado / Diferencia"
                  value={c.monto_cierre_contado == null ? "—" : formatGs(c.monto_cierre_contado)}
                  hint={dif == null ? "turno abierto" : `${dif > 0 ? "+" : ""}${formatGs(dif)}`}
                  hintClass={difClass}
                />
              </div>

              {/* Línea de tiempo */}
              <div>
                <h4 className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
                  <span className="inline-block h-3.5 w-1 rounded-full bg-[#4FAEB2]" />
                  Movimientos del turno
                </h4>
                {timeline.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">Sin movimientos en este turno.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Hora</th>
                          <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Movimiento</th>
                          <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Detalle</th>
                          <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Método</th>
                          <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Monto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {timeline.map((r) => (
                          <tr key={r.key} className="hover:bg-slate-50/70">
                            <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-slate-500">{formatHora(r.ts)}</td>
                            <td className="px-3 py-2">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.tipoClass}`}>
                                {r.icon}
                                {r.tipo}
                              </span>
                            </td>
                            <td className={`px-3 py-2 text-xs ${r.tachado ? "text-slate-400 line-through" : "text-slate-700"}`}>
                              {r.detalle}
                              {r.tachado && <span className="ml-1 text-[10px] font-semibold text-red-500">(anulada)</span>}
                            </td>
                            <td className="px-3 py-2 text-xs text-slate-500">{r.medio ? MEDIO_LABEL[r.medio] : "—"}</td>
                            <td
                              className={`px-3 py-2 text-right text-xs font-semibold tabular-nums ${
                                r.tachado ? "text-slate-400 line-through" : r.signo < 0 ? "text-red-600" : "text-emerald-600"
                              }`}
                            >
                              {r.signo < 0 ? "−" : "+"}
                              {formatGs(r.monto)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {c.observacion_cierre && (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span className="font-semibold text-slate-700">Observación de cierre:</span> {c.observacion_cierre}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-slate-100 px-5 py-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Resumen({
  label,
  value,
  hint,
  hintClass,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  hintClass?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.07]" : "border-slate-200 bg-white"}`}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-bold tabular-nums ${accent ? "text-[#3F8E91]" : "text-slate-800"}`}>{value}</p>
      {hint && <p className={`mt-0.5 text-[11px] tabular-nums ${hintClass ?? "text-slate-400"}`}>{hint}</p>}
    </div>
  );
}
