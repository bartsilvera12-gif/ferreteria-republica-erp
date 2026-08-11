"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RotateCcw, Printer, FileText, Truck, ChevronDown, Wallet, ClipboardList } from "lucide-react";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import MobileFab from "@/components/ui/MobileFab";
import { getVentas } from "@/lib/ventas/storage";
import PedidosPendientesCaja from "./PedidosPendientesCaja";
import PedidosConsultaPendientes from "./PedidosConsultaPendientes";
import CajaControlPanel from "@/components/caja/CajaControlPanel";
import DevolucionWizard from "@/components/devoluciones/DevolucionWizard";
import { productoMatchesQuery } from "@/lib/productos/token-search";
import type { Venta, TipoVenta, TipoIvaVenta } from "@/lib/ventas/types";

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d    = new Date(iso);
    const dd   = String(d.getDate()).padStart(2, "0");
    const mm   = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh   = String(d.getHours()).padStart(2, "0");
    const min  = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

// ── Constantes de estilo ───────────────────────────────────────────────────────

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none";

/**
 * Base compartida de los botones de acción de cada fila: misma altura y sin
 * corte de línea, para que queden alineados aunque cambie la etiqueta.
 * El color lo aporta cada botón.
 */
const BTN_ACCION =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition-colors";

const tipoVentaBadge: Record<TipoVenta, string> = {
  CONTADO: "bg-blue-50 text-blue-700",
  CREDITO: "bg-orange-50 text-orange-700",
};

const ivaLabel: Record<TipoIvaVenta, string> = {
  EXENTA: "Exenta",
  "5%":   "IVA 5%",
  "10%":  "IVA 10%",
};


// ── Helpers de fila ───────────────────────────────────────────────────────────

/** Muestra el primer producto de la venta y un badge con el resto. */
function ResumenProductos({ v }: { v: Venta }) {
  const primero = v.items[0];
  if (!primero) {
    return (
      <span className="text-xs text-gray-400">Sin líneas cargadas</span>
    );
  }
  const extra   = v.items.length - 1;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium text-gray-800 leading-tight">
        {primero.producto_nombre}
      </span>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="font-mono text-xs text-gray-400">{primero.sku}</span>
        {extra > 0 && (
          <span className="bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full font-medium">
            +{extra} más
          </span>
        )}
      </div>
    </div>
  );
}

/** Determina qué mostrar en la celda IVA cuando hay múltiples ítems. */
function ivaResumen(v: Venta): string {
  const tipos = [...new Set(v.items.map((i) => i.tipo_iva))];
  if (tipos.length === 1) return ivaLabel[tipos[0]];
  return "Mixto";
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function VentasPage() {
  const [todas,      setTodas]      = useState<Venta[]>([]);
  const [busqueda,   setBusqueda]   = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoVenta | "">("");
  // Devoluciones: la UI solo aparece si el feature flag server-side está activo.
  const [devolucionesOn, setDevolucionesOn] = useState(false);
  const [devolverVentaId, setDevolverVentaId] = useState<string | null>(null);
  const [filtroIva,  setFiltroIva]  = useState<TipoIvaVenta | "">("");
  const [pagina,     setPagina]     = useState(1);
  const POR_PAGINA = 25;
  const [detalle,    setDetalle]    = useState<Venta | null>(null);
  // Para no distraer al cajero: caja e historial de ventas arrancan colapsados;
  // solo "Pedidos por cobrar" queda siempre visible.
  const [showCajas,   setShowCajas]   = useState(false);
  const [showOrdenes, setShowOrdenes] = useState(false);

  // Feature flag server-side: sin él, la UI de devoluciones no se muestra.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/devoluciones/flag", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setDevolucionesOn(j?.data?.enabled === true); })
      .catch(() => { if (!cancelled) setDevolucionesOn(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getVentas().then((data) => {
      if (cancelled) return;
      const ordenadas = [...data].sort((a, b) => {
        const ta = new Date(a.fecha).getTime();
        const tb = new Date(b.fecha).getTime();
        return tb - ta || b.numero_control.localeCompare(a.numero_control);
      });
      setTodas(ordenadas);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtradas = todas.filter((v) => {
    // Búsqueda por tokens: número de control, nombre o SKU de cualquier ítem.
    if (busqueda.trim() !== "" && !productoMatchesQuery(
      busqueda,
      v.numero_control,
      v.numero_factura ?? "",
      v.cliente_nombre ?? "",
      ...v.items.map((i) => i.producto_nombre),
      ...v.items.map((i) => i.sku),
    )) return false;
    // Tipo de venta
    if (filtroTipo !== "" && v.tipo_venta !== filtroTipo) return false;
    // IVA: coincide si al menos un ítem tiene ese tipo
    if (filtroIva !== "" && !v.items.some((i) => i.tipo_iva === filtroIva))
      return false;
    return true;
  });

  const hayFiltros = busqueda || filtroTipo || filtroIva;

  // Paginación (cliente): la búsqueda/filtros aplican sobre TODO y después se
  // corta en páginas de POR_PAGINA. Al cambiar filtros, se vuelve a la página 1.
  useEffect(() => { setPagina(1); }, [busqueda, filtroTipo, filtroIva]);
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const paginadas = filtradas.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA);
  const desde = filtradas.length === 0 ? 0 : (paginaSegura - 1) * POR_PAGINA + 1;
  const hasta = Math.min(paginaSegura * POR_PAGINA, filtradas.length);

  return (
    <div className="space-y-8">

      <div>
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }}
          />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">
            Zentra · Operaciones
          </p>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">Caja</h1>
            <p className="mt-0.5 text-xs text-slate-500">Cobro, facturación y cierre de pedidos</p>
          </div>
          {devolucionesOn && (
            <Link
              href="/ventas/devoluciones"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              Devoluciones
            </Link>
          )}
        </div>
      </div>

      {/* Información de caja — colapsada por defecto para no distraer al cajero. */}
      <div>
        <button
          type="button"
          onClick={() => setShowCajas((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm ring-1 ring-[#4FAEB2]/15 transition-colors hover:bg-slate-50"
          aria-expanded={showCajas}
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Wallet className="h-4 w-4 text-[#4FAEB2]" />
            Información de caja
            <span className="text-xs font-normal text-slate-400">{showCajas ? "(tocá para ocultar)" : "(tocá para ver)"}</span>
          </span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showCajas ? "rotate-180" : ""}`} />
        </button>
        {showCajas && <div className="mt-3"><CajaControlPanel /></div>}
      </div>

      <PedidosConsultaPendientes />
      <PedidosPendientesCaja />


      {/* ── Tabla de ventas ───────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setShowOrdenes((v) => !v)}
            className="flex items-center gap-2 text-xl font-semibold text-slate-900"
            aria-expanded={showOrdenes}
          >
            <ClipboardList className="h-5 w-5 text-[#4FAEB2]" />
            Órdenes de venta
            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${showOrdenes ? "rotate-180" : ""}`} />
            <span className="text-xs font-normal text-slate-400">{showOrdenes ? "(ocultar)" : "(ver historial)"}</span>
          </button>
          <Link
            href="/ventas/nueva"
            className="bg-[#0EA5E9] hover:bg-[#0284C7] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            + Nueva venta
          </Link>
        </div>

        {showOrdenes && (<>
        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input
            type="text"
            placeholder="Buscar por número, cliente, producto o SKU..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-64`}
          />
          <FancySelect
            value={filtroTipo}
            onChange={(v) => setFiltroTipo(v as TipoVenta | "")}
            ariaLabel="Filtrar por tipo de venta"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los tipos" },
              { value: "CONTADO", label: "Contado" },
              { value: "CREDITO", label: "Crédito" },
            ]}
          />
          <FancySelect
            value={filtroIva}
            onChange={(v) => setFiltroIva(v as TipoIvaVenta | "")}
            ariaLabel="Filtrar por IVA"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los IVA" },
              { value: "EXENTA", label: "Exenta" },
              { value: "5%", label: "IVA 5%" },
              { value: "10%", label: "IVA 10%" },
            ]}
          />
          {hayFiltros && (
            <button
              onClick={() => { setBusqueda(""); setFiltroTipo(""); setFiltroIva(""); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400">
            {filtradas.length} de {todas.length} ventas
          </span>
        </div>


        {/* Tabla — min-w fuerza scroll horizontal en mobile; columnas secundarias
            (Items, Cant total, IVA, Pago) se ocultan progresivamente. */}
        <EdgeScrollArea>
          <table className="w-full min-w-[760px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-sm font-semibold">
                <th className="py-3 pr-4 font-medium">Factura</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="hidden py-3 pr-4 text-center font-medium lg:table-cell">Ítems</th>
                <th className="py-3 pr-4 font-medium text-right hidden lg:table-cell">Cant. total</th>
                <th className="py-3 pr-4 font-medium hidden lg:table-cell">IVA</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Tipo</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Pago</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Vendedor</th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="py-3 font-medium text-center">Ticket</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-gray-400">
                    {todas.length === 0
                      ? "No hay ventas registradas"
                      : "Ninguna venta coincide con los filtros"}
                  </td>
                </tr>
              ) : (
                paginadas.map((v) => {
                  const cantTotal = v.items.reduce((s, i) => s + i.cantidad, 0);
                  return (
                    <tr key={v.id} onClick={() => setDetalle(v)} className="border-b border-slate-200 last:border-0 hover:bg-[#4FAEB2]/[0.04] transition-colors cursor-pointer">
                      <td className="py-4 pr-4 font-mono text-xs align-middle">
                        {v.numero_factura ? (
                          <span className="text-gray-700">{v.numero_factura}</span>
                        ) : (
                          <span className="text-gray-400" title={v.numero_control}>{v.numero_control} <span className="text-[10px]">(s/factura)</span></span>
                        )}
                      </td>
                      <td className="py-4 pr-4 align-middle">
                        <ResumenProductos v={v} />
                      </td>
                      <td className="hidden py-4 pr-4 text-center align-middle lg:table-cell">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                          {v.items.length}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right tabular-nums text-gray-700 align-middle hidden lg:table-cell">
                        {cantTotal}
                      </td>
                      <td className="py-4 pr-4 align-middle hidden lg:table-cell">
                        <span className="px-2 py-1 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700">
                          {ivaResumen(v)}
                        </span>
                      </td>
                      <td className="py-4 pr-4 text-right tabular-nums font-semibold text-gray-800 align-middle">
                        {formatGs(v.total)}
                      </td>
                      <td className="hidden py-4 pr-4 align-middle lg:table-cell">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${tipoVentaBadge[v.tipo_venta]}`}>
                          {v.tipo_venta === "CONTADO"
                            ? "Contado"
                            : `Crédito ${v.plazo_dias ?? ""}d`}
                        </span>
                      </td>
                      <td className="hidden py-4 pr-4 align-middle text-xs text-gray-600 lg:table-cell">
                        {v.metodo_pago === "tarjeta" ? "Tarjeta"
                          : v.metodo_pago === "transferencia" ? "Transfer."
                          : v.metodo_pago === "efectivo" ? "Efectivo"
                          : v.metodo_pago === "mixto" ? "Mixto"
                          : "—"}
                      </td>
                      <td className="hidden py-4 pr-4 align-middle text-xs text-gray-600 lg:table-cell">
                        {v.vendedor || "—"}
                      </td>
                      <td className="py-4 pr-4 text-gray-500 text-xs tabular-nums align-middle">
                        {formatFecha(v.fecha)}
                      </td>
                      <td className="py-4 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          {/* El motor rechaza ventas anuladas server-side con un mensaje claro. */}
                          {devolucionesOn && (
                            <button
                              type="button"
                              onClick={() => setDevolverVentaId(v.id)}
                              className={`${BTN_ACCION} border-amber-200 bg-amber-50 text-amber-800 hover:border-amber-300 hover:bg-amber-100`}
                              title="Ver detalle y registrar una devolución"
                            >
                              <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Devolver
                            </button>
                          )}
                          {/* Excluyentes: con cliente la venta se factura; sin cliente solo lleva ticket interno. */}
                          {v.cliente_id ? (
                            <a
                              href={`/api/ventas/${v.id}/factura`}
                              target="_blank"
                              rel="noopener"
                              className={`${BTN_ACCION} border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] text-[#3F8E91] hover:border-[#4FAEB2]/60 hover:bg-[#4FAEB2]/[0.16]`}
                              title="Factura autoimpresor (formato ticket)"
                            >
                              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Factura
                            </a>
                          ) : (
                            <a
                              href={`/api/ventas/${v.id}/ticket?mode=comandas`}
                              target="_blank"
                              rel="noopener"
                              className={`${BTN_ACCION} border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50`}
                              title="Ticket interno (venta sin cliente, no lleva factura)"
                            >
                              <Printer className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Imprimir
                            </a>
                          )}
                          <a
                            href={`/api/ventas/${v.id}/comprobante`}
                            target="_blank"
                            rel="noopener"
                            className={`${BTN_ACCION} border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100`}
                            title="Comprobante de venta A4 (PDF, no fiscal)"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            Comprobante
                          </a>
                          {v.genera_nota_remision && (
                            <a
                              href={`/api/ventas/${v.id}/ticket?tipo=remision`}
                              target="_blank"
                              rel="noopener"
                              className={`${BTN_ACCION} border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-300 hover:bg-sky-100`}
                              title="Nota de remisión (documento no fiscal)"
                            >
                              <Truck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              Remisión
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

        {/* Paginación */}
        {filtradas.length > POR_PAGINA && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-gray-500">
              Mostrando {desde}–{hasta} de {filtradas.length}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={paginaSegura <= 1}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                ← Anterior
              </button>
              <span className="px-2 text-xs font-medium text-slate-600">
                Página {paginaSegura} de {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={paginaSegura >= totalPaginas}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
        </>)}

      </div>

      {/* FAB mobile: acceso 1-tap a "+ Nueva venta" desde cualquier scroll position */}
      <MobileFab href="/ventas/nueva" label="Nueva venta" />

      {detalle && <VentaDetalleModal venta={detalle} onClose={() => setDetalle(null)} />}

      {devolucionesOn && devolverVentaId && (
        <DevolucionWizard
          ventaId={devolverVentaId}
          onClose={() => setDevolverVentaId(null)}
          onDone={(devId) => {
            setDevolverVentaId(null);
            // Comprobante no fiscal + refresco del listado (cambia el estado de la venta).
            try { window.open(`/api/devoluciones/${devId}/comprobante?auto=1`, "_blank", "noopener"); } catch {}
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}

// ── Modal de detalle de venta ───────────────────────────────────────────────────

interface PagoDetalle {
  id: string;
  metodo_pago: string;
  entidad_nombre_snapshot: string | null;
  monto: string | number;
  referencia: string | null;
  titular: string | null;
  fecha_acreditacion: string | null;
  observacion: string | null;
}

function VentaDetalleModal({ venta, onClose }: { venta: Venta; onClose: () => void }) {
  const cantTotal = venta.items.reduce((s, i) => s + i.cantidad, 0);
  const esElectronico = venta.metodo_pago === "tarjeta" || venta.metodo_pago === "transferencia";
  const [pagos, setPagos] = useState<PagoDetalle[]>([]);

  // Solo para pagos electrónicos: traer banco/comprobante/monto de la venta.
  useEffect(() => {
    if (!esElectronico) return;
    let cancel = false;
    fetch(`/api/ventas/${venta.id}/pagos`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancel && j?.success) setPagos((j.data?.pagos ?? []) as PagoDetalle[]); })
      .catch(() => {});
    return () => { cancel = true; };
  }, [venta.id, esElectronico]);

  const pagoLabel =
    venta.metodo_pago === "tarjeta" ? "Tarjeta / débito"
    : venta.metodo_pago === "transferencia" ? "Transferencia"
    : venta.metodo_pago === "efectivo" ? "Efectivo"
    : venta.metodo_pago === "mixto" ? "Mixto"
    : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <div>
            <h3 className="font-mono text-sm font-bold text-[#3F8E91]">{venta.numero_control}</h3>
            <p className="mt-0.5 text-xs text-slate-500">Detalle de la venta</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </div>

        {/* Meta: fecha/hora, vendedor, tipo, pago */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-4">
          <Meta label="Fecha y hora" value={formatFecha(venta.fecha)} />
          <Meta label="Vendedor" value={venta.vendedor || "—"} />
          <Meta
            label="Tipo"
            value={venta.tipo_venta === "CONTADO" ? "Contado" : `Crédito ${venta.plazo_dias ?? ""}d`}
          />
          <Meta label="Pago" value={pagoLabel} />
        </div>

        {/* Datos del pago electrónico (transferencia / tarjeta) */}
        {esElectronico && (
          <div className="px-5 pb-1">
            <div className="rounded-xl border border-[#4FAEB2]/25 bg-[#4FAEB2]/[0.05] p-4">
              <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-[#3F8E91]">
                Datos del pago · {pagoLabel}
              </p>
              {pagos.length === 0 ? (
                <p className="text-xs text-slate-400">Sin datos de pago registrados para esta venta.</p>
              ) : (
                <div className="space-y-3">
                  {pagos.map((p) => (
                    <div key={p.id} className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                      {p.entidad_nombre_snapshot && (
                        <Meta label={venta.metodo_pago === "tarjeta" ? "Banco / POS" : "Banco"} value={p.entidad_nombre_snapshot} />
                      )}
                      <Meta label="Monto" value={formatGs(Number(p.monto) || 0)} />
                      {p.referencia && <Meta label="N° comprobante" value={p.referencia} />}
                      {p.titular && <Meta label="Titular" value={p.titular} />}
                      {p.fecha_acreditacion && <Meta label="Acreditación" value={p.fecha_acreditacion} />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Ítems */}
        <div className="max-h-[50vh] overflow-y-auto px-5 pb-2 pt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">Productos</p>
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-center font-semibold">Cant.</th>
                  <th className="px-3 py-2 text-right font-semibold">P. Unit.</th>
                  <th className="px-3 py-2 text-center font-semibold">IVA</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {venta.items.map((it, idx) => (
                  <tr key={`${it.producto_id}-${idx}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-slate-800">{it.producto_nombre}</div>
                      <div className="font-mono text-xs text-slate-400">{it.sku}</div>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-slate-700">{it.cantidad}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{formatGs(it.precio_venta)}</td>
                    <td className="px-3 py-2 text-center text-xs text-slate-500">{ivaLabel[it.tipo_iva]}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-800">{formatGs(it.total_linea)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totales */}
        <div className="border-t border-slate-100 px-5 py-4">
          <div className="ml-auto max-w-xs space-y-1 text-sm">
            <Fila label={`Subtotal (${venta.items.length} ítem(s), ${cantTotal} u.)`} value={formatGs(venta.subtotal)} />
            <Fila label="IVA" value={formatGs(venta.monto_iva)} />
            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-900">
              <span>Total</span>
              <span className="tabular-nums">{formatGs(venta.total)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-0.5 break-words text-sm font-medium text-slate-800" title={value}>{value}</p>
    </div>
  );
}

function Fila({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-slate-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
