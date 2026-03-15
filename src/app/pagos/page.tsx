"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getFacturas } from "@/lib/gestion-clientes/storage";
import MontoInput from "@/components/ui/MontoInput";
import { getClientes } from "@/lib/clientes/storage";
import { apiCreatePago } from "@/lib/api/client";
import type { Factura } from "@/lib/gestion-clientes/types";

const inputClass = "w-full border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white text-sm";
const labelClass = "block text-xs font-medium text-slate-500 mb-1";

function formatFecha(str: string) {
  if (!str) return "—";
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

export default function PagosPage() {
  const [facturas, setFacturas] = useState<Factura[]>([]);
  const [clientes, setClientes] = useState<{ id: string; nombre: string }[]>([]);
  const [modalPago, setModalPago] = useState(false);
  const [facturaSeleccionada, setFacturaSeleccionada] = useState<Factura | null>(null);
  const [formPago, setFormPago] = useState({ monto: "", fecha_pago: "", metodo_pago: "efectivo" as const, referencia: "" });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    getFacturas().then(setFacturas);
    getClientes().then((c) => setClientes(c.map((x) => ({ id: x.id, nombre: (x.empresa ?? x.nombre_contacto) || "—" }))));
  }, []);

  const pendientes = facturas.filter((f) => f.saldo > 0);
  const clienteMap = Object.fromEntries(clientes.map((c) => [c.id, c.nombre]));

  async function handleRegistrarPago(e: React.FormEvent) {
    e.preventDefault();
    const f = facturaSeleccionada;
    if (!f) return;
    setGuardando(true);
    await apiCreatePago({
      factura_id: f.id,
      monto: parseFloat(formPago.monto) || 0,
      fecha_pago: formPago.fecha_pago,
      metodo_pago: formPago.metodo_pago,
      referencia: formPago.referencia || undefined,
    });
    setModalPago(false);
    setFacturaSeleccionada(null);
    getFacturas().then(setFacturas);
    setGuardando(false);
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Pagos</h1>
        <p className="text-sm text-gray-500 mt-0.5">Registrar pagos de facturas pendientes de cobro</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Facturas pendientes de cobro</h2>
          <span className="text-xs text-slate-500">{pendientes.length} facturas con saldo</span>
        </div>
        {pendientes.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-sm">No hay facturas pendientes de cobro.</p>
            <Link href="/clientes" className="text-[#0EA5E9] hover:underline text-sm mt-2 inline-block">
              Ir a Clientes →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {["Número", "Cliente", "Fecha", "Vencimiento", "Total", "Saldo", "Estado", "Acción"].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-600 px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pendientes.map((f) => (
                  <tr key={f.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-800">{f.numero_factura}</td>
                    <td className="px-4 py-3">
                      <Link href={`/clientes/${f.cliente_id}`} className="text-[#0EA5E9] hover:underline truncate max-w-[140px] block">
                        {clienteMap[f.cliente_id] ?? `Cliente #${f.cliente_id.slice(0, 8)}`}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatFecha(f.fecha)}</td>
                    <td className="px-4 py-3 text-slate-600">{formatFecha(f.fecha_vencimiento)}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">Gs. {f.monto.toLocaleString("es-PY")}</td>
                    <td className="px-4 py-3 font-semibold text-amber-600">Gs. {f.saldo.toLocaleString("es-PY")}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{f.estado}</span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setFacturaSeleccionada(f);
                          setFormPago({ monto: String(f.saldo), fecha_pago: new Date().toISOString().slice(0, 10), metodo_pago: "efectivo", referencia: "" });
                          setModalPago(true);
                        }}
                        className="text-xs font-medium text-[#0EA5E9] hover:underline"
                      >
                        Registrar pago
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalPago && facturaSeleccionada && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModalPago(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Registrar pago</h3>
            <p className="text-sm text-slate-600 mb-4">
              Factura {facturaSeleccionada.numero_factura} — Saldo: Gs. {facturaSeleccionada.saldo.toLocaleString("es-PY")}
            </p>
            <form onSubmit={handleRegistrarPago} className="space-y-4">
              <div>
                <label className={labelClass}>Monto</label>
                <MontoInput
                  value={formPago.monto}
                  onChange={(n) => setFormPago((p) => ({ ...p, monto: String(n) }))}
                  className={inputClass}
                  required
                />
              </div>
              <div>
                <label className={labelClass}>Fecha pago</label>
                <input type="date" value={formPago.fecha_pago} onChange={(e) => setFormPago((p) => ({ ...p, fecha_pago: e.target.value }))} className={inputClass} required />
              </div>
              <div>
                <label className={labelClass}>Método de pago</label>
                <select value={formPago.metodo_pago} onChange={(e) => setFormPago((p) => ({ ...p, metodo_pago: e.target.value as "efectivo" }))} className={inputClass}>
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="cheque">Cheque</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Referencia</label>
                <input type="text" value={formPago.referencia} onChange={(e) => setFormPago((p) => ({ ...p, referencia: e.target.value }))} className={inputClass} placeholder="Nº de comprobante" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={guardando} className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                  Guardar
                </button>
                <button type="button" onClick={() => setModalPago(false)} className="border border-slate-200 px-4 py-2 rounded-lg text-sm hover:bg-slate-50">
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
