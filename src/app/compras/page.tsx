"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getCompras, comprasQueryString } from "@/lib/compras/storage";
import { getOrdenesCompra } from "@/lib/ordenes-compra/storage";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import MobileFab from "@/components/ui/MobileFab";
import type { Compra, TipoPago } from "@/lib/compras/types";
import type { OrdenCompra, EstadoOrdenCompra } from "@/lib/ordenes-compra/types";

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white";

const paginadorBtnClass =
  "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

function formatGs(valor: number) {
  return `Gs. ${Math.round(valor).toLocaleString("es-PY")}`;
}

function formatFecha(iso: string) {
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
  } catch {
    return iso;
  }
}

const tipoPagoBadge: Record<TipoPago, string> = {
  contado: "bg-blue-50 text-blue-700",
  credito: "bg-orange-50 text-orange-700",
};

// ── Agrupación por numero_control: 1 compra = N filas ─────────────────────────
type GrupoCompra = {
  numero_control: string;
  proveedor_nombre: string;
  fecha: string;
  tipo_pago: TipoPago;
  plazo_dias?: number;
  items: Compra[];
  total: number;
  comprobante: boolean;
  orden_compra_numero: string | null;
};

function agrupar(rows: Compra[]): GrupoCompra[] {
  const map = new Map<string, GrupoCompra>();
  for (const c of rows) {
    const key = c.numero_control || c.id;
    let g = map.get(key);
    if (!g) {
      g = {
        numero_control: c.numero_control,
        proveedor_nombre: c.proveedor_nombre,
        fecha: c.fecha,
        tipo_pago: c.tipo_pago,
        plazo_dias: c.plazo_dias,
        items: [],
        total: 0,
        comprobante: false,
        orden_compra_numero: c.orden_compra_numero ?? null,
      };
      map.set(key, g);
    }
    g.items.push(c);
    g.total += Number(c.total) || 0;
    if (c.comprobante_storage_path) g.comprobante = true;
  }
  return [...map.values()].sort(
    (a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()
  );
}

function resumenProductos(items: Compra[]): string {
  if (items.length === 0) return "—";
  if (items.length === 1) return items[0].producto_nombre;
  return `${items[0].producto_nombre} + ${items.length - 1} más`;
}

const PAGE_SIZE = 25;

export default function ComprasPage() {
  const [ordenes, setOrdenes] = useState<OrdenCompra[]>([]);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  /** Lo que el usuario tipea; se manda al servidor con 350 ms de debounce. */
  const [busqueda, setBusqueda] = useState("");
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [filtroTipoPago, setFiltroTipoPago] = useState<TipoPago | "">("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [pagina, setPagina] = useState(1);

  /**
   * Resultado servido, etiquetado con la consulta que lo produjo. Mientras la
   * consulta actual no coincide con la etiqueta la pantalla esta cargando, y
   * sigue mostrando el resultado anterior en vez de parpadear en blanco.
   */
  const [resultado, setResultado] = useState<{
    clave: string;
    filas: Compra[];
    total: number;
  } | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      setBusquedaAplicada(busqueda);
      setPagina(1);
    }, 350);
    return () => clearTimeout(id);
  }, [busqueda]);

  const clave = JSON.stringify([busquedaAplicada, filtroTipoPago, desde, hasta, pagina]);
  const cargando = resultado?.clave !== clave;
  const totalCompras = resultado?.total ?? 0;

  useEffect(() => {
    let cancel = false;
    getCompras({
      q: busquedaAplicada,
      tipoPago: filtroTipoPago,
      desde,
      hasta,
      page: pagina,
      pageSize: PAGE_SIZE,
    }).then((data) => {
      if (cancel) return;
      setResultado({ clave, filas: data.compras, total: data.total });
    });
    return () => { cancel = true; };
  }, [clave, busquedaAplicada, filtroTipoPago, desde, hasta, pagina]);

  useEffect(() => {
    let cancel = false;
    getOrdenesCompra().then((data) => { if (!cancel) setOrdenes(data); });
    return () => { cancel = true; };
  }, []);

  /** El servidor ya devuelve solo las compras de la pagina; aca solo se agrupan las filas. */
  const grupos = useMemo(() => agrupar(resultado?.filas ?? []), [resultado]);

  const totalPaginas = Math.max(1, Math.ceil(totalCompras / PAGE_SIZE));
  const primera = totalCompras === 0 ? 0 : (pagina - 1) * PAGE_SIZE + 1;
  const ultima = Math.min(pagina * PAGE_SIZE, totalCompras);

  const exportQs = comprasQueryString({ q: busquedaAplicada, tipoPago: filtroTipoPago, desde, hasta });
  const exportUrl = exportQs ? `/api/compras/export?${exportQs}` : "/api/compras/export";

  const limpiarFiltros = useCallback(() => {
    setBusqueda("");
    setFiltroTipoPago("");
    setDesde("");
    setHasta("");
    setPagina(1);
  }, []);

  // Órdenes de compra por confirmar: pendientes o recibidas parcialmente.
  // El encargado las revisa y confirma la recepción desde acá.
  const ordenesPorConfirmar = useMemo(() => {
    const map = new Map<string, { numero_oc: string; proveedor_nombre: string; fecha: string; estado: EstadoOrdenCompra; items: number; totalPendiente: number }>();
    for (const o of ordenes) {
      if (o.estado !== "pendiente" && o.estado !== "recibida_parcial") continue;
      const g = map.get(o.numero_oc);
      const pendienteLinea = o.cantidad_pendiente * o.costo_unitario;
      if (g) { g.items += 1; g.totalPendiente += pendienteLinea; }
      else map.set(o.numero_oc, { numero_oc: o.numero_oc, proveedor_nombre: o.proveedor_nombre, fecha: o.fecha, estado: o.estado, items: 1, totalPendiente: pendienteLinea });
    }
    return [...map.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [ordenes]);

  const hayFiltros = Boolean(busqueda || filtroTipoPago || desde || hasta);

  function toggle(numero: string) {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(numero)) next.delete(numero);
      else next.add(numero);
      return next;
    });
  }

  return (
    <div className="space-y-8">

      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-[#4FAEB2]"
            style={{ boxShadow: "0 0 0 3px rgba(79, 174, 178, 0.18)" }} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4FAEB2]">Zentra · Adquisiciones</p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Compras</h1>
        <p className="mt-0.5 text-xs text-slate-500">Facturas de proveedor registradas (impactan stock)</p>
      </div>

      {/* Navegación Compras / Órdenes de compra */}
      <div className="flex items-center gap-1 border-b border-slate-200">
        <span className="border-b-2 border-[#4FAEB2] px-4 py-2 text-sm font-semibold text-[#3F8E91]">
          Compras
        </span>
        <Link
          href="/compras/ordenes"
          className="border-b-2 border-transparent px-4 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-[#3F8E91]"
        >
          Órdenes de compra
        </Link>
      </div>

      {/* Órdenes de compra por confirmar (revisar + recibir) */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-800">
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#4FAEB2] px-1.5 text-xs font-bold text-white">
                {ordenesPorConfirmar.length}
              </span>
              Órdenes de compra por confirmar
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Pedidos al proveedor pendientes de recibir. Revisá cada uno y confirmá lo que llegó.
            </p>
          </div>
          <Link href="/compras/ordenes/nueva"
            className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/[0.16] active:scale-95">
            + Nueva orden de compra
          </Link>
        </div>

        {ordenesPorConfirmar.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No hay órdenes de compra pendientes de confirmar. Las órdenes recibidas por completo pasan a “Compras registradas”.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b-2 border-[#4FAEB2]/40 bg-[#E5F4F4]">
                <tr>
                  {["N° OC", "Fecha", "Proveedor", "Ítems", "Pendiente (Gs.)", "Estado", ""].map((h, i) => (
                    <th key={h} className={`px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-[#3F8E91] ${i === 3 || i === 4 ? "text-right" : i === 5 || i === 6 ? "text-center" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ordenesPorConfirmar.map((o) => (
                  <tr key={o.numero_oc} className="transition-colors hover:bg-[#4FAEB2]/5">
                    <td className="px-3 py-2.5 font-mono text-xs font-semibold text-[#3F8E91]">{o.numero_oc}</td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-slate-600">{formatFecha(o.fecha)}</td>
                    <td className="px-3 py-2.5 text-xs font-medium text-slate-800">{o.proveedor_nombre || "—"}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums text-slate-600">{o.items}</td>
                    <td className="px-3 py-2.5 text-right text-xs tabular-nums font-bold text-slate-900">{formatGs(o.totalPendiente)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${o.estado === "pendiente" ? "bg-[var(--badge-warning-bg)] text-[var(--badge-warning-text)]" : "bg-sky-100 text-sky-700"}`}>
                        {o.estado === "pendiente" ? "Pendiente" : "Recibida parcial"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <div className="inline-flex items-center gap-3">
                        <Link href={`/compras/ordenes/${encodeURIComponent(o.numero_oc)}`} className="text-xs font-semibold text-slate-500 hover:text-[#3F8E91] hover:underline">Revisar</Link>
                        <Link href={`/compras/desde-orden/${encodeURIComponent(o.numero_oc)}`} className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#3F8E91]">Confirmar recepción</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-[#4FAEB2]/15 sm:p-5 lg:p-6">

        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Compras registradas</h2>
          <div className="flex items-center gap-3">
            <ExportExcelButton url={exportUrl} />
            <Link href="/compras/desde-orden"
              className="rounded-lg border border-[#4FAEB2]/40 bg-[#4FAEB2]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#3F8E91] transition-colors hover:bg-[#4FAEB2]/[0.16] active:scale-95">
              Desde Orden de Compra
            </Link>
            <Link href="/compras/nueva"
              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95">
              + Nueva compra
            </Link>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input type="text" placeholder="Buscar por proveedor, producto o N° control..."
            value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-0 flex-1 sm:min-w-72`} />
          <FancySelect value={filtroTipoPago} onChange={(v) => { setFiltroTipoPago(v as TipoPago | ""); setPagina(1); }}
            ariaLabel="Filtrar por tipo de pago" className="w-44" size="sm"
            options={[
              { value: "", label: "Todos los pagos" },
              { value: "contado", label: "Contado" },
              { value: "credito", label: "Crédito" },
            ]} />
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Desde
            <input type="date" value={desde}
              onChange={(e) => { setDesde(e.target.value); setPagina(1); }}
              className={inputFilterClass} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Hasta
            <input type="date" value={hasta}
              onChange={(e) => { setHasta(e.target.value); setPagina(1); }}
              className={inputFilterClass} />
          </label>
          {hayFiltros && (
            <button onClick={limpiarFiltros}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2">
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400 tabular-nums">
            {cargando
              ? "Buscando..."
              : totalCompras === 0
              ? "Sin resultados"
              : `${primera}-${ultima} de ${totalCompras} compras`}
          </span>
        </div>

        {/* Tabla agrupada por compra */}
        <EdgeScrollArea>
          <table className="w-full min-w-[760px] lg:min-w-0 text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium">N° Control</th>
                <th className="py-3 pr-4 font-medium">Proveedor</th>
                <th className="py-3 pr-4 font-medium">Productos</th>
                <th className="py-3 pr-4 font-medium text-right">Ítems</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="hidden py-3 pr-4 font-medium lg:table-cell">Pago</th>
                <th className="py-3 pr-4 font-medium">Fecha</th>
                <th className="py-3 font-medium text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {grupos.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400">
                    {cargando
                      ? "Cargando compras..."
                      : hayFiltros
                      ? "Ninguna compra coincide con los filtros"
                      : "No hay compras registradas"}
                  </td>
                </tr>
              ) : (
                grupos.map((g) => {
                  const abierto = expandidos.has(g.numero_control);
                  const multi = g.items.length > 1;
                  return (
                    <FragmentRow key={g.numero_control}>
                      <tr
                        className={`border-b border-slate-200 transition-colors hover:bg-[#4FAEB2]/[0.04] ${multi ? "cursor-pointer" : ""}`}
                        onClick={() => multi && toggle(g.numero_control)}
                      >
                        <td className="py-4 pr-4 font-mono text-xs text-gray-500">
                          {multi && <span className="mr-1 inline-block text-gray-400">{abierto ? "▾" : "▸"}</span>}
                          {g.numero_control}
                        </td>
                        <td className="py-4 pr-4 font-medium text-gray-800">{g.proveedor_nombre}</td>
                        <td className="py-4 pr-4 text-gray-600">
                          <div>{resumenProductos(g.items)}</div>
                          {g.orden_compra_numero && (
                            <Link
                              href={`/compras/ordenes/${encodeURIComponent(g.orden_compra_numero)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-[#E5F4F4] px-2 py-0.5 text-[11px] font-semibold text-[#3F8E91] hover:underline"
                            >
                              {g.orden_compra_numero}
                            </Link>
                          )}
                          {g.comprobante && (
                            <a
                              href={`/api/compras/comprobante?numero_control=${encodeURIComponent(g.numero_control)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-[#4FAEB2] hover:text-[#3F8E91] hover:underline"
                            >
                              📎 Ver comprobante
                            </a>
                          )}
                        </td>
                        <td className="py-4 pr-4 text-right tabular-nums text-gray-700">{g.items.length}</td>
                        <td className="py-4 pr-4 text-right tabular-nums font-semibold text-gray-800">{formatGs(g.total)}</td>
                        <td className="hidden py-4 pr-4 lg:table-cell">
                          <span className={`px-2 py-1 rounded-full text-xs font-semibold ${g.tipo_pago ? tipoPagoBadge[g.tipo_pago] : "bg-gray-100 text-gray-500"}`}>
                            {g.tipo_pago === "contado" ? "Contado" : g.tipo_pago === "credito" ? `Crédito ${g.plazo_dias ?? ""}d` : "—"}
                          </span>
                        </td>
                        <td className="py-4 pr-4 text-gray-500 text-xs tabular-nums">{formatFecha(g.fecha)}</td>
                        <td className="py-4 text-right">
                          {/* Editar: solo compras manuales (las de OC se ajustan desde la orden). */}
                          {!g.orden_compra_numero ? (
                            <Link
                              href={`/compras/${encodeURIComponent(g.numero_control)}/editar`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#4FAEB2]/30 px-2.5 py-1 text-xs font-semibold text-[#3F8E91] transition-colors hover:border-[#4FAEB2] hover:bg-[#4FAEB2] hover:text-white"
                              title="Editar compra"
                            >
                              <Pencil className="h-3.5 w-3.5" /> Editar
                            </Link>
                          ) : (
                            <span className="text-[11px] text-slate-300">—</span>
                          )}
                        </td>
                      </tr>

                      {abierto && multi && g.items.map((it) => (
                        <tr key={it.id} className="border-b border-slate-100 bg-slate-50/50 text-xs">
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4" />
                          <td className="py-2 pr-4 text-gray-700">
                            <span className="font-medium">{it.producto_nombre}</span>
                            <span className="ml-2 font-mono text-gray-400">{formatGs(it.costo_unitario)}/u</span>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{it.cantidad}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-gray-700">{formatGs(it.total)}</td>
                          <td className="hidden lg:table-cell" />
                          <td />
                          <td />
                        </tr>
                      ))}
                    </FragmentRow>
                  );
                })
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

        {/* Paginacion */}
        {totalCompras > PAGE_SIZE && (
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1 || cargando} className={paginadorBtnClass}>
              Anterior
            </button>
            <span className="text-xs text-slate-500 tabular-nums">
              Pagina {pagina} de {totalPaginas}
            </span>
            <button type="button" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas || cargando} className={paginadorBtnClass}>
              Siguiente
            </button>
          </div>
        )}

      </div>

      <MobileFab href="/compras/nueva" label="Nueva compra" />
    </div>
  );
}

/** Wrapper para agrupar fila principal + filas de detalle sin <div> en <tbody>. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
