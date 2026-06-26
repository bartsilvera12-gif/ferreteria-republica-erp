"use client";

/**
 * Lista de pedidos del modulo Consulta que esperan ser cobrados desde Caja.
 *
 * Se renderiza arriba en /ventas, debajo del header y arriba del bloque
 * legacy de PedidosPendientesCaja. Click en una fila -> abre
 * /ventas/nueva?pedido_caja_id=X para que el cajero precargue.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Receipt, ArrowRight, Loader2 } from "lucide-react";

type Pedido = {
  id: string;
  titulo: string;
  cliente_nombre: string | null;
  total_estimado: number;
  items_count: number;
  armado_por_email: string | null;
  created_at: string | null;
};

function fmtGs(n: number) {
  return "Gs. " + Math.round(n || 0).toLocaleString("es-PY");
}
function fmtFecha(iso: string | null) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString("es-PY", { day: "2-digit", month: "2-digit" }) +
      " · " +
      d.toLocaleTimeString("es-PY", { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return iso;
  }
}

export default function PedidosConsultaPendientes() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    fetch("/api/pedidos-caja?estado=pendiente", {
      credentials: "include",
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j?.success && Array.isArray(j.data?.pedidos)) {
          const raw = j.data.pedidos as Array<Record<string, unknown>>;
          setPedidos(
            raw.map((p) => ({
              id: String(p.id),
              titulo: String(p.titulo ?? ""),
              cliente_nombre: p.cliente_nombre ? String(p.cliente_nombre) : null,
              total_estimado: Number(p.total_estimado) || 0,
              items_count: Array.isArray(p.items)
                ? (p.items as unknown[]).length
                : 0,
              armado_por_email: p.armado_por_email
                ? String(p.armado_por_email)
                : null,
              created_at: p.created_at ? String(p.created_at) : null,
            }))
          );
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  if (loading || pedidos.length === 0) return null;

  return (
    <div className="rounded-2xl border-2 border-[#4FAEB2]/25 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#4FAEB2] flex items-center justify-center shadow-sm shadow-[#4FAEB2]/30">
            <Receipt className="h-4.5 w-4.5 text-white" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-slate-800 leading-none flex items-center gap-2">
              Pedidos pendientes (Consulta)
              <span className="inline-flex items-center justify-center min-w-[28px] h-[22px] px-2 rounded-full bg-[#4FAEB2] text-white text-[11px] font-bold tabular-nums">
                {pedidos.length}
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Pedidos armados por vendedores desde Consulta. Click en uno para cobrar.
            </p>
          </div>
        </div>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-[#4FAEB2]" />}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
            <tr>
              <th className="px-5 py-3 font-semibold">Pedido</th>
              <th className="px-3 py-3 font-semibold">Cliente</th>
              <th className="px-3 py-3 font-semibold">Vendedor</th>
              <th className="px-3 py-3 text-right font-semibold">Items</th>
              <th className="px-3 py-3 text-right font-semibold">Total</th>
              <th className="px-3 py-3 font-semibold">Hace</th>
              <th className="px-3 py-3 text-right font-semibold">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pedidos.map((p) => (
              <tr key={p.id} className="hover:bg-[#4FAEB2]/3 transition-colors">
                <td className="px-5 py-3 font-semibold text-slate-800">
                  {p.titulo}
                </td>
                <td className="px-3 py-3 text-slate-600">
                  {p.cliente_nombre ?? (
                    <span className="text-slate-300">— Sin cliente</span>
                  )}
                </td>
                <td className="px-3 py-3 text-slate-500 text-xs">
                  {p.armado_por_email ?? (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                  {p.items_count}
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-[#3F8E91]">
                  {fmtGs(p.total_estimado)}
                </td>
                <td className="px-3 py-3 text-slate-500 text-xs tabular-nums whitespace-nowrap">
                  {fmtFecha(p.created_at)}
                </td>
                <td className="px-3 py-3 text-right">
                  <Link
                    href={`/ventas/nueva?pedido_caja_id=${p.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] text-white text-xs font-bold px-3 py-1.5 transition-colors shadow-sm shadow-[#4FAEB2]/30"
                  >
                    Cobrar
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
