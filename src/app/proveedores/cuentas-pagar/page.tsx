"use client";

/**
 * /proveedores/cuentas-pagar — Cuentas por pagar (#17).
 * Deudas a proveedores (compras a crédito) con saldo, vencimiento y estado.
 * Permite registrar pagos (en efectivo generan egreso en la caja abierta).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { Wallet, Loader2, Search, X, CheckCircle2, AlertTriangle } from "lucide-react";

type Estado = "pendiente" | "parcial" | "vencida" | "pagada";
interface Cuenta {
  numero_control: string; proveedor_id: string | null; proveedor_nombre: string;
  numero_factura: string | null; fecha: string; fecha_factura: string | null;
  plazo_dias: number | null; vencimiento: string | null;
  total_compra: number; pagado: number; saldo: number; estado: Estado; dias_vencido: number;
}
interface Totales { total_compra: number; pagado: number; saldo: number; vencido: number; cantidad: number; }

function gs(v: number) { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }
function fh(iso: string | null) {
  if (!iso) return "—";
  try { return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "2-digit" }).format(new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso)); }
  catch { return iso; }
}
const inputCls = "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

const ESTADO_BADGE: Record<Estado, string> = {
  pendiente: "bg-slate-100 text-slate-600",
  parcial: "bg-sky-100 text-sky-700",
  vencida: "bg-red-100 text-red-700",
  pagada: "bg-emerald-100 text-emerald-700",
};
const ESTADO_LABEL: Record<Estado, string> = { pendiente: "Pendiente", parcial: "Parcial", vencida: "Vencida", pagada: "Pagada" };

export default function CuentasPagarPage() {
  const [proveedor, setProveedor] = useState("");
  const [estado, setEstado] = useState<Estado | "todas">("todas");
  const [items, setItems] = useState<Cuenta[]>([]);
  const [totales, setTotales] = useState<Totales>({ total_compra: 0, pagado: 0, saldo: 0, vencido: 0, cantidad: 0 });
  const [cargando, setCargando] = useState(false);
  const [pagando, setPagando] = useState<Cuenta | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams();
      if (proveedor.trim()) p.set("proveedor", proveedor.trim());
      if (estado !== "todas") p.set("estado", estado);
      const r = await fetch(`/api/proveedores/cuentas-pagar?${p.toString()}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (j?.success) { setItems(j.data.items as Cuenta[]); setTotales(j.data.totales as Totales); }
    } finally { setCargando(false); }
  }, [proveedor, estado]);

  useEffect(() => { cargar(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [estado]);

  const filtrados = useMemo(() => items, [items]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Zentra · Compras" title="Cuentas por pagar" description="Deudas a proveedores por compras a crédito: saldo, vencimiento y registro de pagos." backHref="/proveedores" backLabel="Proveedores" />

      {/* Totales */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Deudas" value={String(totales.cantidad)} hint="compras a crédito con saldo" />
        <Stat label="Saldo total" value={gs(totales.saldo)} accent />
        <Stat label="Vencido" value={gs(totales.vencido)} danger={totales.vencido > 0} />
        <Stat label="Pagado" value={gs(totales.pagado)} />
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm lg:col-span-2"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Proveedor</span>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input type="text" value={proveedor} onChange={(e) => setProveedor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && cargar()} placeholder="Nombre del proveedor" className={`${inputCls} pl-9`} />
            </div>
          </label>
          <label className="text-sm"><span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Estado</span>
            <select value={estado} onChange={(e) => setEstado(e.target.value as Estado | "todas")} className={`${inputCls} bg-white`}>
              <option value="todas">Todas</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
              <option value="vencida">Vencida</option>
              <option value="pagada">Pagada</option>
            </select></label>
          <div className="flex items-end">
            <button type="button" onClick={cargar} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#4FAEB2] px-6 py-2.5 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 hover:bg-[#3F8E91]">
              <Search className="h-4 w-4" /> Buscar
            </button>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="flex items-center gap-2 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-3.5">
          <Wallet className="h-4 w-4 text-[#4FAEB2]" />
          <h2 className="text-[15px] font-bold text-slate-800">Deudas a proveedores</h2>
          {cargando && <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />}
          {!cargando && <span className="text-xs text-slate-400">{filtrados.length} compra(s)</span>}
        </div>
        {cargando ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">Cargando…</p>
        ) : filtrados.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Sin deudas para los filtros seleccionados.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-semibold">Proveedor / Compra</th>
                  <th className="px-3 py-3 font-semibold">Vencimiento</th>
                  <th className="px-3 py-3 text-right font-semibold">Total</th>
                  <th className="px-3 py-3 text-right font-semibold">Pagado</th>
                  <th className="px-3 py-3 text-right font-semibold">Saldo</th>
                  <th className="px-3 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtrados.map((c) => (
                  <tr key={c.numero_control} className="hover:bg-[#4FAEB2]/[0.03]">
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-slate-800">{c.proveedor_nombre}</span>
                      <div className="text-[11px] text-slate-400">{c.numero_control}{c.numero_factura ? ` · Factura ${c.numero_factura}` : ""}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                      {fh(c.vencimiento)}
                      {c.dias_vencido > 0 && <span className="ml-1 text-[11px] font-semibold text-red-600">({c.dias_vencido}d)</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{gs(c.total_compra)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-slate-500">{gs(c.pagado)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-slate-900">{gs(c.saldo)}</td>
                    <td className="px-3 py-2.5"><span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_BADGE[c.estado]}`}>{ESTADO_LABEL[c.estado]}</span></td>
                    <td className="px-4 py-2.5 text-right">
                      {c.saldo > 0 ? (
                        <button type="button" onClick={() => setPagando(c)} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3F8E91]">Pagar</button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Saldada</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pagando && (
        <PagoModal cuenta={pagando} onClose={() => setPagando(null)} onDone={() => { setPagando(null); cargar(); }} />
      )}
    </div>
  );
}

function Stat({ label, value, hint, accent, danger }: { label: string; value: string; hint?: string; accent?: boolean; danger?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${danger ? "border-red-200 bg-red-50/40" : accent ? "border-[#4FAEB2]/30 bg-[#4FAEB2]/5" : "border-slate-200 bg-white"}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${danger ? "text-red-700" : "text-slate-900"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function PagoModal({ cuenta, onClose, onDone }: { cuenta: Cuenta; onClose: () => void; onDone: () => void }) {
  const [monto, setMonto] = useState(String(Math.round(cuenta.saldo)));
  const [medio, setMedio] = useState<"efectivo" | "transferencia" | "tarjeta" | "otro">("efectivo");
  const [obs, setObs] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const montoNum = Math.round(Number(monto) || 0);
  const invalido = !(montoNum > 0) || montoNum > cuenta.saldo;

  async function submit() {
    setError(null);
    if (invalido) { setError(montoNum > cuenta.saldo ? "El pago supera el saldo pendiente." : "Ingresá un monto válido."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/proveedores/pagos", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ numero_control: cuenta.numero_control, monto: montoNum, medio_pago: medio, observacion: obs.trim() || null }),
      });
      const j = await r.json();
      if (!j?.success) { setError(j?.error || "No se pudo registrar el pago."); return; }
      onDone();
    } catch { setError("Error de red al registrar el pago."); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Registrar pago</h3>
            <p className="text-sm text-slate-500">{cuenta.proveedor_nombre} · {cuenta.numero_control}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">Saldo pendiente</span><span className="font-bold tabular-nums text-slate-900">{gs(cuenta.saldo)}</span></div>
        </div>

        <div className="space-y-3">
          <label className="block text-sm"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Monto a pagar</span>
            <input type="number" min={1} max={cuenta.saldo} value={monto} onChange={(e) => setMonto(e.target.value)} className={inputCls} autoFocus /></label>
          <label className="block text-sm"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Medio de pago</span>
            <select value={medio} onChange={(e) => setMedio(e.target.value as typeof medio)} className={`${inputCls} bg-white`}>
              <option value="efectivo">Efectivo (egresa de caja)</option>
              <option value="transferencia">Transferencia</option>
              <option value="tarjeta">Tarjeta</option>
              <option value="otro">Otro</option>
            </select></label>
          {medio === "efectivo" && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Requiere una caja abierta: se registrará un egreso de efectivo por este monto.
            </p>
          )}
          <label className="block text-sm"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Observación (opcional)</span>
            <input type="text" value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Ej: N° de transferencia" className={inputCls} /></label>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mt-5 flex gap-3">
          <button type="button" onClick={submit} disabled={busy || invalido} className="flex-1 rounded-xl bg-[#4FAEB2] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-40">
            {busy ? "Registrando…" : `Pagar ${gs(montoNum)}`}
          </button>
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm hover:bg-slate-50">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
