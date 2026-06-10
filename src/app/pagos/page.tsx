"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, Loader2 } from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";

type Cuenta = {
  id: string;
  cliente_id: string;
  cliente_nombre: string;
  venta_id: string;
  numero_venta: string | null;
  fecha_emision: string | null;
  fecha_vencimiento: string | null;
  moneda: string;
  total: number;
  saldo: number;
  estado: string;
  vencida: boolean;
};
type Cobro = {
  id: string;
  cliente_id: string | null;
  cliente_nombre: string;
  numero_venta: string | null;
  fecha_pago: string | null;
  monto: number;
  metodo_pago: string;
  referencia: string | null;
};
type Resumen = { total_pendiente: number; total_vencido: number; cobrado_mes: number; parciales: number };

const ESTADO_BADGE: Record<string, string> = {
  pendiente: "bg-amber-100 text-amber-700",
  parcial: "bg-sky-100 text-sky-700",
  pagado: "bg-emerald-100 text-emerald-700",
  vencido: "bg-red-100 text-red-700",
  anulado: "bg-slate-100 text-slate-500",
};
type TabId = "pendientes" | "parciales" | "vencidas" | "pagadas" | "todos" | "cobros";
const TABS: { id: TabId; label: string }[] = [
  { id: "pendientes", label: "Pendientes" },
  { id: "parciales", label: "Parciales" },
  { id: "vencidas", label: "Vencidas" },
  { id: "pagadas", label: "Pagadas" },
  { id: "todos", label: "Todas" },
  { id: "cobros", label: "Cobros registrados" },
];
const METODOS = ["efectivo", "transferencia", "tarjeta", "otro"] as const;

function fmtGs(n: number, moneda = "PYG") {
  return (moneda === "USD" ? "USD " : "Gs. ") + Math.round(Number(n) || 0).toLocaleString("es-PY");
}
function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function PagosPage() {
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cobros, setCobros] = useState<Cobro[]>([]);
  const [resumen, setResumen] = useState<Resumen>({ total_pendiente: 0, total_vencido: 0, cobrado_mes: 0, parciales: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("pendientes");
  const [toast, setToast] = useState<string | null>(null);

  const [cobrando, setCobrando] = useState<Cuenta | null>(null);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState<(typeof METODOS)[number]>("efectivo");
  const [referencia, setReferencia] = useState("");
  const [guardandoCobro, setGuardandoCobro] = useState(false);
  const [errorCobro, setErrorCobro] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithSupabaseSession("/api/cobros/cuentas", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setError(body?.error ?? "No se pudieron cargar las cuentas por cobrar.");
        return;
      }
      setCuentas((body.data?.cuentas ?? []) as Cuenta[]);
      setCobros((body.data?.cobros ?? []) as Cobro[]);
      setResumen((body.data?.resumen ?? { total_pendiente: 0, total_vencido: 0, cobrado_mes: 0, parciales: 0 }) as Resumen);
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const cuentasVisibles = useMemo(() => {
    switch (tab) {
      case "pendientes": return cuentas.filter((c) => c.estado === "pendiente");
      case "parciales": return cuentas.filter((c) => c.estado === "parcial");
      case "vencidas": return cuentas.filter((c) => c.vencida && c.estado !== "pagado" && c.estado !== "anulado");
      case "pagadas": return cuentas.filter((c) => c.estado === "pagado");
      case "todos": return cuentas;
      default: return [];
    }
  }, [cuentas, tab]);

  function abrirCobro(c: Cuenta) {
    setCobrando(c);
    setMonto(String(c.saldo));
    setMetodo("efectivo");
    setReferencia("");
    setErrorCobro(null);
  }

  async function registrarCobro() {
    if (!cobrando || guardandoCobro) return;
    const m = Number(monto);
    if (!(m > 0)) { setErrorCobro("El monto debe ser mayor a cero."); return; }
    if (m > cobrando.saldo + 0.001) { setErrorCobro("El monto supera el saldo pendiente."); return; }
    setGuardandoCobro(true);
    setErrorCobro(null);
    try {
      const res = await fetchWithSupabaseSession("/api/cobros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta_por_cobrar_id: cobrando.id, monto: m, metodo_pago: metodo, referencia: referencia.trim() || null }),
      });
      const body = await res.json();
      if (!res.ok || body?.success === false) {
        setErrorCobro(body?.error ?? "No se pudo registrar el pago.");
        return;
      }
      setCobrando(null);
      setToast("Pago registrado");
      setTimeout(() => setToast(null), 2800);
      await cargar();
    } catch {
      setErrorCobro("Error de red al registrar el pago.");
    } finally {
      setGuardandoCobro(false);
    }
  }

  return (
    <div className="space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">✓ {toast}</div>
      )}

      <div className="flex items-center gap-3">
        <Banknote className="h-7 w-7 text-[#4FAEB2]" />
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Pagos</h1>
          <p className="text-gray-600">Cuentas por cobrar y registro de cobros de clientes.</p>
        </div>
      </div>

      {/* Resumen */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-gray-400">Total pendiente</div>
          <div className="mt-1 text-xl font-bold text-slate-800">{fmtGs(resumen.total_pendiente)}</div>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-red-500">Vencido</div>
          <div className="mt-1 text-xl font-bold text-red-700">{fmtGs(resumen.total_vencido)}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-emerald-600">Cobrado este mes</div>
          <div className="mt-1 text-xl font-bold text-emerald-700">{fmtGs(resumen.cobrado_mes)}</div>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <div className="text-xs uppercase tracking-wide text-sky-600">Cuentas parciales</div>
          <div className="mt-1 text-xl font-bold text-sky-700">{resumen.parciales}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? "bg-white border border-slate-200 border-b-white -mb-px text-[#4FAEB2]" : "text-slate-600 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="p-8 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</div>
      ) : tab === "cobros" ? (
        /* Historial de cobros */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {cobros.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">Sin cobros registrados todavía.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">Fecha</th>
                    <th className="py-3 px-4 font-medium">Cliente</th>
                    <th className="py-3 px-4 font-medium">Venta</th>
                    <th className="py-3 px-4 font-medium">Método</th>
                    <th className="py-3 px-4 font-medium">Referencia</th>
                    <th className="py-3 px-4 font-medium text-right">Monto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cobros.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-2.5 px-4 text-gray-600">{fmtFecha(c.fecha_pago)}</td>
                      <td className="py-2.5 px-4 text-gray-700">
                        {c.cliente_id ? (
                          <Link href={`/clientes/${c.cliente_id}/estado-cuenta`} className="hover:text-[#4FAEB2] hover:underline">{c.cliente_nombre}</Link>
                        ) : c.cliente_nombre}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-gray-700">{c.numero_venta ?? "—"}</td>
                      <td className="py-2.5 px-4 capitalize text-gray-600">{c.metodo_pago}</td>
                      <td className="py-2.5 px-4 text-gray-500">{c.referencia ?? "—"}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-semibold text-emerald-700">{fmtGs(c.monto)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Tabla de cuentas por cobrar */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {cuentasVisibles.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">No hay cuentas en esta pestaña.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="py-3 px-4 font-medium">Cliente</th>
                    <th className="py-3 px-4 font-medium">Venta</th>
                    <th className="py-3 px-4 font-medium">Emisión</th>
                    <th className="py-3 px-4 font-medium">Vencimiento</th>
                    <th className="py-3 px-4 font-medium text-right">Total</th>
                    <th className="py-3 px-4 font-medium text-right">Cobrado</th>
                    <th className="py-3 px-4 font-medium text-right">Saldo</th>
                    <th className="py-3 px-4 font-medium">Estado</th>
                    <th className="py-3 px-4 font-medium text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cuentasVisibles.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 text-gray-700">
                        <Link href={`/clientes/${c.cliente_id}/estado-cuenta`} className="hover:text-[#4FAEB2] hover:underline">{c.cliente_nombre}</Link>
                      </td>
                      <td className="py-3 px-4 font-mono font-medium text-gray-800">{c.numero_venta ?? "—"}</td>
                      <td className="py-3 px-4 text-gray-600">{fmtFecha(c.fecha_emision)}</td>
                      <td className={`py-3 px-4 ${c.vencida ? "font-semibold text-red-600" : "text-gray-600"}`}>{fmtFecha(c.fecha_vencimiento)}</td>
                      <td className="py-3 px-4 text-right tabular-nums">{fmtGs(c.total, c.moneda)}</td>
                      <td className="py-3 px-4 text-right tabular-nums text-emerald-700">{fmtGs(c.total - c.saldo, c.moneda)}</td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-gray-800">{fmtGs(c.saldo, c.moneda)}</td>
                      <td className="py-3 px-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO_BADGE[c.vencida && c.estado !== "pagado" ? "vencido" : c.estado] ?? ESTADO_BADGE.pendiente}`}>
                          {c.vencida && c.estado !== "pagado" && c.estado !== "anulado" ? "Vencido" : c.estado.charAt(0).toUpperCase() + c.estado.slice(1)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        {c.estado === "pagado" || c.estado === "anulado" ? (
                          <span className="text-xs text-gray-400">—</span>
                        ) : (
                          <button onClick={() => abrirCobro(c)} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#3F8E91]">
                            Registrar pago
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal registrar pago */}
      {cobrando && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4">
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h3 className="text-base font-semibold text-gray-900">Registrar pago</h3>
              <p className="text-xs text-gray-500">{cobrando.numero_venta} · {cobrando.cliente_nombre} · Saldo {fmtGs(cobrando.saldo, cobrando.moneda)}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {errorCobro && <div className="rounded-md bg-red-50 border border-red-200 p-2.5 text-sm text-red-700">{errorCobro}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Monto a cobrar</label>
                <input type="number" min="0" step="1" value={monto} onChange={(e) => setMonto(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
                <button type="button" onClick={() => setMonto(String(cobrando.saldo))} className="mt-1 text-xs text-[#4FAEB2] hover:underline">Cobrar saldo total</button>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Método de pago</label>
                <select value={metodo} onChange={(e) => setMetodo(e.target.value as (typeof METODOS)[number])} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm bg-white">
                  {METODOS.map((m) => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Referencia (opcional)</label>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="Nº comprobante, transferencia…" />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button onClick={() => setCobrando(null)} className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={registrarCobro} disabled={guardandoCobro} className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#4FAEB2] px-5 py-2 text-sm font-medium text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {guardandoCobro ? <><Loader2 className="h-4 w-4 animate-spin" /> Guardando…</> : "Confirmar pago"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
