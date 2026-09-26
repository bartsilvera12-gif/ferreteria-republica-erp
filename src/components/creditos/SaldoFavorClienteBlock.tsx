"use client";

/**
 * Bloque "Saldo a favor" para la ficha del cliente (tab Estado de cuenta):
 * saldo disponible + historial + registrar anticipo, ajuste/anulación (admin) y
 * usar el saldo para pagar cuotas. Autocontenido: consulta sus propios endpoints.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";

interface Movimiento {
  id: string; tipo: string; monto: number; motivo: string | null;
  usuario_nombre: string | null; created_at: string;
}
interface CuentaPend { id: string; numero_venta: string | null; saldo: number; estado: string; }

const fmtGs = (v: number) => `Gs. ${Math.round(Number(v) || 0).toLocaleString("es-PY")}`;
const fmtFecha = (iso: string) => { try { const d = new Date(iso); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`; } catch { return ""; } };
const TIPO_LABEL: Record<string, string> = {
  anticipo: "Anticipo", devolucion: "Devolución", consumo_venta: "Uso en venta",
  retiro_efectivo: "Retiro efectivo", ajuste: "Ajuste", reverso: "Reverso",
};

export default function SaldoFavorClienteBlock({
  clienteId, esAdmin, onAfterChange,
}: { clienteId: string; esAdmin: boolean; onAfterChange?: () => void }) {
  const [saldo, setSaldo] = useState(0);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [cuentas, setCuentas] = useState<CuentaPend[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Modal anticipo
  const [mAnt, setMAnt] = useState(false);
  const [aMonto, setAMonto] = useState(""); const [aMedio, setAMedio] = useState("efectivo");
  const [aConcepto, setAConcepto] = useState(""); const [aObs, setAObs] = useState("");
  // Modal ajuste
  const [mAj, setMAj] = useState(false);
  const [ajMonto, setAjMonto] = useState(""); const [ajMotivo, setAjMotivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [accionId, setAccionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const r = await fetch(`/api/clientes/${clienteId}/saldo-favor`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? "No se pudo cargar el saldo.");
      setSaldo(Number(j.data.saldo) || 0);
      setMovs((j.data.movimientos ?? []) as Movimiento[]);
    } catch (e) { setError(e instanceof Error ? e.message : "Error al cargar."); }
    finally { setCargando(false); }
  }, [clienteId]);

  const loadCuentas = useCallback(async () => {
    try {
      const r = await fetch(`/api/cobros/cuentas?cliente_id=${clienteId}`, { credentials: "include", cache: "no-store" });
      const j = await r.json();
      const arr = (j?.data?.cuentas ?? j?.cuentas ?? []) as Array<Record<string, unknown>>;
      setCuentas(arr
        .map((c) => ({ id: String(c.id), numero_venta: (c.numero_venta as string) ?? null, saldo: Number(c.saldo) || 0, estado: String(c.estado ?? "") }))
        .filter((c) => c.saldo > 0 && c.estado !== "anulado" && c.estado !== "pagado"));
    } catch { setCuentas([]); }
  }, [clienteId]);

  useEffect(() => { load(); loadCuentas(); }, [load, loadCuentas]);

  async function post(url: string, body: Record<string, unknown>) {
    const r = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) throw new Error(j?.error ?? "Operación fallida.");
    return j.data as Record<string, unknown>;
  }

  async function registrarAnticipo() {
    setError(null); setAviso(null);
    const monto = Number(aMonto);
    if (!(monto > 0)) { setError("Ingresá un monto mayor a cero."); return; }
    setGuardando(true);
    try {
      const d = await post(`/api/clientes/${clienteId}/saldo-favor`, { monto, medio_pago: aMedio, concepto: aConcepto.trim() || null, observacion: aObs.trim() || null });
      setMAnt(false); setAMonto(""); setAConcepto(""); setAObs("");
      const rec = d.recibo as { id: string; numero_recibo: string } | null;
      setAviso(rec ? `Anticipo registrado. Recibo ${rec.numero_recibo}.` : (d.recibo_warning ? `Anticipo registrado (recibo pendiente: ${d.recibo_warning}).` : "Anticipo registrado."));
      if (rec) window.open(`/api/recibos-dinero/${rec.id}/pdf?auto=1`, "_blank", "noopener");
      await load(); onAfterChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo registrar el anticipo."); }
    finally { setGuardando(false); }
  }

  async function ajustar() {
    setError(null);
    const monto = Number(ajMonto);
    if (!monto) { setError("Ingresá un monto (positivo suma, negativo resta)."); return; }
    if (!ajMotivo.trim()) { setError("El ajuste requiere un motivo."); return; }
    setGuardando(true);
    try {
      await post(`/api/clientes/${clienteId}/saldo-favor/ajuste`, { modo: "ajuste", monto, motivo: ajMotivo.trim() });
      setMAj(false); setAjMonto(""); setAjMotivo(""); setAviso("Ajuste registrado.");
      await load(); onAfterChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo ajustar."); }
    finally { setGuardando(false); }
  }

  async function revertir(mov: Movimiento) {
    if (!confirm(`¿Revertir este movimiento (${TIPO_LABEL[mov.tipo] ?? mov.tipo} ${fmtGs(mov.monto)})? Se agrega un movimiento de reverso, no se borra el historial.`)) return;
    setError(null); setAccionId(mov.id);
    try {
      await post(`/api/clientes/${clienteId}/saldo-favor/ajuste`, { modo: "reverso", movimiento_id: mov.id, motivo: `Reverso de ${TIPO_LABEL[mov.tipo] ?? mov.tipo}` });
      setAviso("Movimiento revertido."); await load(); onAfterChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo revertir."); }
    finally { setAccionId(null); }
  }

  async function pagarCuota(cta: CuentaPend) {
    const usar = Math.min(cta.saldo, saldo);
    if (!(usar > 0)) return;
    if (!confirm(`Pagar ${fmtGs(usar)} de la cuenta ${cta.numero_venta ?? ""} con el saldo a favor. No genera ingreso de caja. ¿Confirmás?`)) return;
    setError(null); setAccionId(cta.id);
    try {
      const d = await post(`/api/clientes/${clienteId}/saldo-favor/pagar-cuota`, { cuenta_por_cobrar_id: cta.id, monto: usar });
      const rec = d.recibo as { id: string; numero_recibo: string } | null;
      setAviso(rec ? `Cuota pagada con saldo. Recibo ${rec.numero_recibo}.` : "Cuota pagada con saldo.");
      await load(); await loadCuentas(); onAfterChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo pagar la cuota."); }
    finally { setAccionId(null); }
  }

  return (
    <div className="space-y-4 rounded-xl border-2 border-[#4FAEB2]/20 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Saldo a favor disponible</p>
          <p className="mt-0.5 text-2xl font-bold tabular-nums text-[#3F8E91]">{cargando ? "…" : fmtGs(saldo)}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => { setMAnt(true); setError(null); }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] px-3 py-2 text-sm font-semibold text-white hover:bg-[#3F8E91]">
            <Plus className="h-4 w-4" /> Registrar anticipo
          </button>
          {esAdmin && (
            <button type="button" onClick={() => { setMAj(true); setError(null); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              <SlidersHorizontal className="h-4 w-4" /> Ajuste
            </button>
          )}
        </div>
      </div>

      {error && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {aviso && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{aviso}</div>}

      {/* Usar saldo en cuotas pendientes */}
      {saldo > 0 && cuentas.length > 0 && (
        <div className="rounded-lg border border-[#4FAEB2]/30 bg-[#4FAEB2]/[0.05] p-3">
          <p className="mb-2 text-xs font-semibold text-[#3F8E91]">Usar saldo en una cuota pendiente</p>
          <ul className="space-y-1.5">
            {cuentas.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-slate-700">{c.numero_venta ?? "—"} · saldo {fmtGs(c.saldo)}</span>
                <button type="button" disabled={accionId === c.id} onClick={() => pagarCuota(c)}
                  className="rounded-md border border-[#4FAEB2]/50 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] hover:bg-[#4FAEB2] hover:text-white disabled:opacity-50">
                  {accionId === c.id ? "…" : `Pagar ${fmtGs(Math.min(c.saldo, saldo))} con saldo`}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Historial */}
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Historial de saldo</p>
        {cargando ? (
          <p className="py-4 text-center text-sm text-slate-400"><Loader2 className="inline h-4 w-4 animate-spin" /></p>
        ) : movs.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">Sin movimientos de saldo a favor.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-3 py-2 text-left">Fecha</th><th className="px-3 py-2 text-left">Tipo</th><th className="px-3 py-2 text-left">Motivo</th><th className="px-3 py-2 text-right">Monto</th><th className="px-3 py-2 text-left">Usuario</th>{esAdmin && <th className="px-3 py-2" />}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {movs.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs text-slate-600">{fmtFecha(m.created_at)}</td>
                    <td className="px-3 py-2 text-xs font-medium text-slate-700">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{m.motivo ?? "—"}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${m.monto >= 0 ? "text-emerald-700" : "text-rose-600"}`}>{m.monto >= 0 ? "+" : ""}{fmtGs(m.monto)}</td>
                    <td className="px-3 py-2 text-xs text-slate-500">{m.usuario_nombre ?? "—"}</td>
                    {esAdmin && (
                      <td className="px-3 py-2 text-right">
                        {m.tipo !== "reverso" && (
                          <button type="button" disabled={accionId === m.id} onClick={() => revertir(m)} title="Revertir"
                            className="inline-flex items-center gap-1 rounded-md border border-rose-200 px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-500 hover:text-white disabled:opacity-50">
                            <RotateCcw className="h-3 w-3" /> Revertir
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Registrar anticipo */}
      {mAnt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !guardando && setMAnt(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-base font-bold text-slate-800">Registrar anticipo / saldo a favor</h3>
            <div className="space-y-3">
              <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-slate-500">Monto recibido</span>
                <input type="number" min={0} value={aMonto} onChange={(e) => setAMonto(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20" placeholder="0" /></label>
              <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-slate-500">Medio de pago</span>
                <select value={aMedio} onChange={(e) => setAMedio(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#4FAEB2]">
                  <option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="tarjeta">Tarjeta</option><option value="otro">Otro</option>
                </select></label>
              <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-slate-500">Concepto</span>
                <input value={aConcepto} onChange={(e) => setAConcepto(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#4FAEB2]" placeholder="Anticipo / saldo a favor" /></label>
              <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-slate-500">Observación (opcional)</span>
                <input value={aObs} onChange={(e) => setAObs(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#4FAEB2]" /></label>
              <p className="text-xs text-slate-400">Genera un ingreso en la caja abierta y un recibo. Requiere una caja abierta.</p>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setMAnt(false)} disabled={guardando} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
              <button type="button" onClick={registrarAnticipo} disabled={guardando} className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Registrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Ajuste (admin) */}
      {mAj && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => !guardando && setMAj(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-1 text-base font-bold text-slate-800">Ajuste manual de saldo</h3>
            <p className="mb-3 text-xs text-slate-500">Positivo suma, negativo resta. Queda registrado (no borra historial).</p>
            <div className="space-y-3">
              <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-slate-500">Monto (con signo)</span>
                <input type="number" value={ajMonto} onChange={(e) => setAjMonto(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm tabular-nums outline-none focus:border-[#4FAEB2]" placeholder="-50000" /></label>
              <label className="block text-sm"><span className="mb-1 block text-xs font-semibold text-slate-500">Motivo</span>
                <input value={ajMotivo} onChange={(e) => setAjMotivo(e.target.value)} className="h-11 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-[#4FAEB2]" placeholder="Motivo del ajuste" /></label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setMAj(false)} disabled={guardando} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
              <button type="button" onClick={ajustar} disabled={guardando} className="inline-flex items-center gap-2 rounded-lg bg-[#4FAEB2] px-5 py-2 text-sm font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50">
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />} Guardar ajuste
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
