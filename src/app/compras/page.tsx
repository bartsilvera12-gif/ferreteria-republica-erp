"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getCompras, comprasQueryString } from "@/lib/compras/storage";
import ExportExcelButton from "@/components/ui/ExportExcelButton";
import EdgeScrollArea from "@/components/ui/EdgeScrollArea";
import { FancySelect } from "@/components/ui/FancySelect";
import type { Compra, TipoPago } from "@/lib/compras/types";

const inputFilterClass =
  "border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0EA5E9] focus:outline-none bg-white";

const paginadorBtnClass =
  "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";

function formatGs(valor: number) {
  return `Gs. ${valor.toLocaleString("es-PY")}`;
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

const ivaLabel: Record<string, string> = {
  exenta: "Exenta",
  "5": "IVA 5%",
  "10": "IVA 10%",
};

const PAGE_SIZE = 50;

export default function ComprasPage() {
  /**
   * Resultado servido, etiquetado con la consulta que lo produjo. Mientras la
   * consulta actual no coincide con la etiqueta, la pantalla esta cargando y
   * sigue mostrando el resultado anterior en vez de parpadear en blanco.
   */
  const [resultado, setResultado] = useState<{
    clave: string;
    compras: Compra[];
    total: number;
  } | null>(null);
  const [pagina, setPagina] = useState(1);

  /** Lo que el usuario esta tipeando. */
  const [busqueda, setBusqueda] = useState("");
  /** Lo que efectivamente se manda al servidor (debounce de 350 ms). */
  const [busquedaAplicada, setBusquedaAplicada] = useState("");
  const [filtroTipoPago, setFiltroTipoPago] = useState<TipoPago | "">("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  useEffect(() => {
    const id = setTimeout(() => {
      setBusquedaAplicada(busqueda);
      setPagina(1);
    }, 350);
    return () => clearTimeout(id);
  }, [busqueda]);

  const clave = JSON.stringify([busquedaAplicada, filtroTipoPago, desde, hasta, pagina]);
  const cargando = resultado?.clave !== clave;
  const compras = resultado?.compras ?? [];
  const total = resultado?.total ?? 0;

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
      setResultado({ clave, compras: data.compras, total: data.total });
    });
    return () => { cancel = true; };
  }, [clave, busquedaAplicada, filtroTipoPago, desde, hasta, pagina]);

  const hayFiltros = Boolean(busqueda || filtroTipoPago || desde || hasta);
  const limpiarFiltros = useCallback(() => {
    setBusqueda("");
    setFiltroTipoPago("");
    setDesde("");
    setHasta("");
    setPagina(1);
  }, []);

  const totalPaginas = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const primeraFila = total === 0 ? 0 : (pagina - 1) * PAGE_SIZE + 1;
  const ultimaFila = Math.min(pagina * PAGE_SIZE, total);

  const exportQs = comprasQueryString({ q: busquedaAplicada, tipoPago: filtroTipoPago, desde, hasta });
  const exportUrl = exportQs ? `/api/compras/export?${exportQs}` : "/api/compras/export";

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
            Zentra · Adquisiciones
          </p>
        </div>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-slate-900">Compras</h1>
        <p className="mt-0.5 text-xs text-slate-500">Registro de órdenes de compra a proveedores</p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm ring-1 ring-[#4FAEB2]/15 p-6">

        <div className="flex justify-between items-center mb-5">
          <h2 className="text-xl font-semibold">Órdenes de compra</h2>
          <div className="flex items-center gap-3">
            <ExportExcelButton url={exportUrl} />
            <Link
              href="/compras/nueva"
              className="rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-[#4FAEB2]/25 transition-colors hover:bg-[#3F8E91] active:scale-95"
            >
              + Nueva compra
            </Link>
          </div>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-3 mb-5 pb-5 border-b border-gray-100">
          <input
            type="text"
            placeholder="Buscar por proveedor, producto o N° control..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className={`${inputFilterClass} min-w-72`}
          />
          <FancySelect
            value={filtroTipoPago}
            onChange={(v) => { setFiltroTipoPago(v as TipoPago | ""); setPagina(1); }}
            ariaLabel="Filtrar por tipo de pago"
            className="w-44"
            size="sm"
            options={[
              { value: "", label: "Todos los pagos" },
              { value: "contado", label: "Contado" },
              { value: "credito", label: "Crédito" },
            ]}
          />
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Desde
            <input
              type="date"
              value={desde}
              onChange={(e) => { setDesde(e.target.value); setPagina(1); }}
              className={inputFilterClass}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Hasta
            <input
              type="date"
              value={hasta}
              onChange={(e) => { setHasta(e.target.value); setPagina(1); }}
              className={inputFilterClass}
            />
          </label>
          {hayFiltros && (
            <button
              onClick={limpiarFiltros}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors px-2"
            >
              Limpiar filtros
            </button>
          )}
          <span className="ml-auto text-sm text-gray-400 tabular-nums">
            {cargando
              ? "Buscando..."
              : total === 0
              ? "Sin resultados"
              : `${primeraFila}-${ultimaFila} de ${total} compras`}
          </span>
        </div>

        {/* Tabla */}
        <EdgeScrollArea>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b text-gray-500">
                <th className="py-3 pr-4 font-medium">N° Control</th>
                <th className="py-3 pr-4 font-medium">Proveedor</th>
                <th className="py-3 pr-4 font-medium">Producto</th>
                <th className="py-3 pr-4 font-medium text-right">Cant.</th>
                <th className="py-3 pr-4 font-medium text-right">Costo unit.</th>
                <th className="py-3 pr-4 font-medium">IVA</th>
                <th className="py-3 pr-4 font-medium text-right">Total</th>
                <th className="py-3 pr-4 font-medium text-right">Margen</th>
                <th className="py-3 pr-4 font-medium">Pago</th>
                <th className="py-3 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {compras.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-400">
                    {cargando
                      ? "Cargando compras..."
                      : hayFiltros
                      ? "Ninguna compra coincide con los filtros"
                      : "No hay compras registradas"}
                  </td>
                </tr>
              ) : (
                compras.map((c) => (
                  <tr key={c.id} className="border-b border-slate-200 last:border-0 hover:bg-[#4FAEB2]/[0.04] transition-colors">
                    <td className="py-4 pr-4 font-mono text-xs text-gray-500">
                      {c.numero_control}
                    </td>
                    <td className="py-4 pr-4 font-medium text-gray-800">
                      {c.proveedor_nombre}
                    </td>
                    <td className="py-4 pr-4 text-gray-600">{c.producto_nombre}</td>
                    <td className="py-4 pr-4 text-right tabular-nums text-gray-700">
                      {c.cantidad}
                    </td>
                    <td className="py-4 pr-4 text-right tabular-nums text-gray-600 text-xs">
                      {c.moneda === "USD" && c.costo_unitario_original != null ? (
                        <span>
                          USD {c.costo_unitario_original.toLocaleString("es-PY")}
                          <br />
                          <span className="text-gray-400">≈ {formatGs(c.costo_unitario)}</span>
                        </span>
                      ) : (
                        formatGs(c.costo_unitario ?? c.total)
                      )}
                    </td>
                    <td className="py-4 pr-4 text-xs text-gray-500">
                      {c.iva_tipo ? ivaLabel[c.iva_tipo] : "—"}
                    </td>
                    <td className="py-4 pr-4 text-right tabular-nums font-semibold text-gray-800">
                      {formatGs(c.total)}
                    </td>
                    <td className="py-4 pr-4 text-right tabular-nums text-sm font-medium text-green-600">
                      {c.margen_venta != null ? `${c.margen_venta.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-4 pr-4">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${c.tipo_pago ? tipoPagoBadge[c.tipo_pago] : "bg-gray-100 text-gray-500"}`}>
                        {c.tipo_pago === "contado" ? "Contado" : c.tipo_pago === "credito" ? `Crédito ${c.plazo_dias ?? ""}d` : "—"}
                      </span>
                    </td>
                    <td className="py-4 text-gray-500 text-xs tabular-nums">
                      {formatFecha(c.fecha)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </EdgeScrollArea>

        {/* Paginacion */}
        {total > PAGE_SIZE && (
          <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1 || cargando}
              className={paginadorBtnClass}
            >
              Anterior
            </button>
            <span className="text-xs text-slate-500 tabular-nums">
              Pagina {pagina} de {totalPaginas}
            </span>
            <button
              type="button"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas || cargando}
              className={paginadorBtnClass}
            >
              Siguiente
            </button>
          </div>
        )}

      </div>

    </div>
  );
}
