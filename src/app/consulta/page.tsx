"use client";

/**
 * Modulo Consulta — el vendedor arma un pedido y lo envia a Caja.
 *
 * Flujo:
 *   1. Buscar producto (nombre / SKU).
 *   2. Ver stock + precio.
 *   3. Elegir presentacion + cantidad + tipo de precio.
 *   4. Cliente opcional.
 *   5. "Enviar a caja" -> pedido_caja queda 'pendiente' para el cajero en /ventas/nueva.
 *   6. Lista 'mis pedidos enviados' con estado + boton cancelar.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Trash2,
  Send,
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  X,
  Receipt,
  Plus,
  Minus,
  User,
  Package,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getClientes } from "@/lib/clientes/storage";
import type { Cliente } from "@/lib/clientes/types";

type PresentacionLite = {
  id: string;
  nombre: string;
  cantidad_base: number;
  precio_venta: number | null;
  es_default: boolean;
  activo: boolean;
};

type ProductoHit = {
  id: string;
  nombre: string;
  sku: string;
  precio_venta: number;
  precio_mayorista: number;
  precio_distribuidor?: number | null;
  stock_actual: number;
  unidad_medida: string;
};

type CartItem = {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  unidad_medida: string;
  cantidad: number;
  tipo_precio: "minorista" | "mayorista" | "distribuidor";
  precio_venta: number;
  precio_mayorista: number;
  precio_distribuidor: number;
  // Presentacion (opcional)
  presentacion_id: string | null;
  presentacion_nombre: string | null;
  presentacion_cantidad_base: number | null;
  // Cache de presentaciones del producto para el selector inline.
  presentaciones: PresentacionLite[];
};

type MiPedido = {
  id: string;
  titulo: string;
  cliente_nombre: string | null;
  total_estimado: number;
  items_count: number;
  estado: "pendiente" | "facturado" | "cancelado";
  venta_numero: string | null;
  created_at: string | null;
  facturado_at: string | null;
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
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

function precioPorTipoBase(
  p: { precio_venta: number; precio_mayorista: number; precio_distribuidor: number },
  tipo: "minorista" | "mayorista" | "distribuidor"
) {
  if (tipo === "mayorista") return p.precio_mayorista > 0 ? p.precio_mayorista : p.precio_venta;
  if (tipo === "distribuidor") return p.precio_distribuidor > 0 ? p.precio_distribuidor : p.precio_venta;
  return p.precio_venta;
}

export default function ConsultaPage() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductoHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState<string>("");
  const [enviando, setEnviando] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [misPedidos, setMisPedidos] = useState<MiPedido[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Busqueda con debounce
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    let cancel = false;
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const res = await fetchWithSupabaseSession(
          `/api/productos/search?q=${encodeURIComponent(trimmed)}&limit=20`,
          { cache: "no-store" }
        );
        const j = await res.json();
        if (cancel) return;
        const items = ((j?.data?.items ?? []) as Record<string, unknown>[]).map(
          (p) => ({
            id: String(p.id),
            nombre: String(p.nombre ?? ""),
            sku: String(p.sku ?? ""),
            precio_venta: Number(p.precio_venta) || 0,
            precio_mayorista: Number(p.precio_mayorista) || 0,
            precio_distribuidor:
              p.precio_distribuidor == null ? null : Number(p.precio_distribuidor),
            stock_actual: Number(p.stock_actual) || 0,
            unidad_medida: String(p.unidad_medida ?? "Unidad"),
          })
        );
        setHits(items);
      } finally {
        if (!cancel) setBuscando(false);
      }
    }, 250);
    return () => {
      cancel = true;
      clearTimeout(t);
    };
  }, [q]);

  const refreshMisPedidos = useCallback(async () => {
    try {
      const r = await fetchWithSupabaseSession(
        "/api/pedidos-caja?estado=todos&mios=1",
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!j?.success) return;
      const raw = (j.data?.pedidos ?? []) as Array<Record<string, unknown>>;
      setMisPedidos(
        raw.map((p) => ({
          id: String(p.id),
          titulo: String(p.titulo ?? ""),
          cliente_nombre: p.cliente_nombre ? String(p.cliente_nombre) : null,
          total_estimado: Number(p.total_estimado) || 0,
          items_count: Array.isArray(p.items) ? (p.items as unknown[]).length : 0,
          estado:
            p.estado === "facturado"
              ? "facturado"
              : p.estado === "cancelado"
              ? "cancelado"
              : "pendiente",
          venta_numero: p.venta_numero ? String(p.venta_numero) : null,
          created_at: p.created_at ? String(p.created_at) : null,
          facturado_at: p.facturado_at ? String(p.facturado_at) : null,
        }))
      );
    } catch {
      /* opcional */
    }
  }, []);

  useEffect(() => {
    getClientes().then(setClientes).catch(() => setClientes([]));
    void refreshMisPedidos();
    inputRef.current?.focus();
  }, [refreshMisPedidos]);

  async function loadPresentaciones(prodId: string): Promise<PresentacionLite[]> {
    try {
      const r = await fetchWithSupabaseSession(
        `/api/productos/${prodId}/presentaciones`,
        { cache: "no-store" }
      );
      const j = await r.json();
      if (!j?.success) return [];
      const list = (j.data?.presentaciones ?? []) as PresentacionLite[];
      return list.filter((p) => p.activo);
    } catch {
      return [];
    }
  }

  async function addToCart(p: ProductoHit) {
    // Si ya esta en el carrito, sumamos +1.
    const ex = cart.find((x) => x.producto_id === p.id);
    if (ex) {
      setCart((prev) =>
        prev.map((x) =>
          x.producto_id === p.id ? { ...x, cantidad: x.cantidad + 1 } : x
        )
      );
      setOkMsg(null);
      setErrMsg(null);
      return;
    }
    // Cargar presentaciones para el selector inline.
    const pres = await loadPresentaciones(p.id);
    const def =
      pres.find((x) => x.es_default && x.activo) ?? pres[0] ?? null;
    setCart((prev) => [
      ...prev,
      {
        producto_id: p.id,
        producto_nombre: p.nombre,
        sku: p.sku,
        stock_actual: p.stock_actual,
        unidad_medida: p.unidad_medida,
        cantidad: 1,
        tipo_precio: "minorista",
        precio_venta: p.precio_venta,
        precio_mayorista: p.precio_mayorista,
        precio_distribuidor: p.precio_distribuidor ?? 0,
        presentacion_id: def ? def.id : null,
        presentacion_nombre: def ? def.nombre : null,
        presentacion_cantidad_base: def ? def.cantidad_base : null,
        presentaciones: pres,
      },
    ]);
    setOkMsg(null);
    setErrMsg(null);
  }

  function updateCart(id: string, patch: Partial<CartItem>) {
    setCart((prev) =>
      prev.map((x) => (x.producto_id === id ? { ...x, ...patch } : x))
    );
  }
  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((x) => x.producto_id !== id));
  }

  function changeCantidad(id: string, delta: number) {
    setCart((prev) =>
      prev.map((x) =>
        x.producto_id === id
          ? { ...x, cantidad: Math.max(1, x.cantidad + delta) }
          : x
      )
    );
  }

  function changeTipoPrecio(
    id: string,
    tipo: "minorista" | "mayorista" | "distribuidor"
  ) {
    const it = cart.find((x) => x.producto_id === id);
    if (!it) return;
    // Recalcular precio_venta con cantidad_base.
    const base = precioPorTipoBase(
      {
        precio_venta: it.precio_venta,
        precio_mayorista: it.precio_mayorista,
        precio_distribuidor: it.precio_distribuidor,
      },
      tipo
    );
    const cantBase = it.presentacion_cantidad_base ?? 1;
    const pres = it.presentaciones.find((p) => p.id === it.presentacion_id);
    const efectivo =
      pres && pres.precio_venta != null && pres.precio_venta > 0
        ? pres.precio_venta
        : base * cantBase;
    updateCart(id, {
      tipo_precio: tipo,
      precio_venta: Math.round(efectivo),
    });
  }

  function changePresentacion(id: string, presentacionId: string) {
    const it = cart.find((x) => x.producto_id === id);
    if (!it) return;
    const pres = it.presentaciones.find((p) => p.id === presentacionId);
    if (!pres) return;
    const base = precioPorTipoBase(
      {
        precio_venta: it.precio_venta,
        precio_mayorista: it.precio_mayorista,
        precio_distribuidor: it.precio_distribuidor,
      },
      it.tipo_precio
    );
    const efectivo =
      pres.precio_venta != null && pres.precio_venta > 0
        ? pres.precio_venta
        : base * pres.cantidad_base;
    updateCart(id, {
      presentacion_id: pres.id,
      presentacion_nombre: pres.nombre,
      presentacion_cantidad_base: pres.cantidad_base,
      precio_venta: Math.round(efectivo),
    });
  }

  const totalCart = useMemo(
    () => cart.reduce((s, it) => s + it.cantidad * it.precio_venta, 0),
    [cart]
  );

  async function cancelarPedido(p: MiPedido) {
    const ok = window.confirm(
      `¿Cancelar el pedido "${p.titulo}"?\n\n` +
        `Total: ${fmtGs(p.total_estimado)} · ${p.items_count} item(s)\n\n` +
        `El cajero ya no lo va a ver. Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    try {
      const r = await fetchWithSupabaseSession(
        `/api/pedidos-caja/${p.id}?motivo=cancelado+por+vendedor`,
        { method: "DELETE" }
      );
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      void refreshMisPedidos();
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "No se pudo cancelar el pedido."
      );
    }
  }

  async function enviar() {
    if (cart.length === 0) {
      setErrMsg("El pedido está vacío.");
      return;
    }
    setEnviando(true);
    setErrMsg(null);
    setOkMsg(null);
    try {
      const cliente = clientes.find((c) => c.id === clienteId);
      const nombreCli = cliente
        ? cliente.empresa || cliente.nombre_contacto || null
        : null;
      const body = {
        cliente_id: clienteId || null,
        cliente_nombre: nombreCli,
        cliente_telefono: cliente?.telefono ?? null,
        items: cart.map((it) => ({
          producto_id: it.producto_id,
          producto_nombre: it.producto_nombre,
          sku: it.sku,
          cantidad: it.cantidad,
          precio_venta: it.precio_venta,
          tipo_precio: it.tipo_precio,
          presentacion_id: it.presentacion_id,
          presentacion_nombre: it.presentacion_nombre,
          presentacion_cantidad_base: it.presentacion_cantidad_base,
        })),
      };
      const r = await fetchWithSupabaseSession("/api/pedidos-caja", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setOkMsg(`Pedido "${j.data.pedido.titulo}" enviado a Caja.`);
      setCart([]);
      setClienteId("");
      void refreshMisPedidos();
    } catch (e) {
      setErrMsg(
        e instanceof Error ? e.message : "No se pudo enviar el pedido."
      );
    } finally {
      setEnviando(false);
    }
  }

  const inputClass =
    "h-10 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm outline-none transition-all hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Header */}
      <header>
        <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-3">
          <Receipt className="h-3 w-3 text-[#4FAEB2]" />
          Salón · Vendedor
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight">
          Consulta de productos
        </h1>
        <p className="text-[14px] text-slate-500 mt-1.5">
          Buscá un producto, armá el pedido y mandalo a Caja para que se cobre.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        {/* Columna izquierda: Buscador + resultados */}
        <div className="space-y-4">
          {/* Buscador */}
          <div className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] p-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre o SKU…"
                className={`${inputClass} w-full pl-10 pr-9 h-12 text-base`}
                autoComplete="off"
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {buscando && (
                <Loader2 className="absolute right-9 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-[#4FAEB2]" />
              )}
            </div>
          </div>

          {/* Resultados */}
          {q.trim().length < 2 ? (
            <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
              <Search className="h-7 w-7 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-500">
                Escribí al menos 2 caracteres para buscar
              </p>
            </div>
          ) : hits.length === 0 && !buscando ? (
            <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center">
              <Package className="h-7 w-7 text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-500">
                Sin resultados para &quot;{q}&quot;
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {hits.map((p) => {
                const yaEnCarrito = cart.some((c) => c.producto_id === p.id);
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border-2 border-slate-100 bg-white p-3.5 hover:border-[#4FAEB2]/40 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-slate-800 truncate">
                          {p.nombre}
                        </h3>
                        <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 flex-wrap">
                          <span className="font-mono">{p.sku}</span>
                          <span className="text-slate-300">·</span>
                          <span
                            className={`font-semibold ${
                              p.stock_actual <= 0
                                ? "text-red-600"
                                : p.stock_actual < 5
                                ? "text-amber-600"
                                : "text-emerald-700"
                            }`}
                          >
                            {p.stock_actual <= 0
                              ? "Sin stock"
                              : `${p.stock_actual} ${p.unidad_medida}`}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-base font-bold text-slate-800 tabular-nums">
                          {fmtGs(p.precio_venta)}
                        </div>
                        {p.precio_mayorista > 0 &&
                          p.precio_mayorista !== p.precio_venta && (
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              May: {fmtGs(p.precio_mayorista)}
                            </div>
                          )}
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                      <button
                        type="button"
                        onClick={() => addToCart(p)}
                        disabled={yaEnCarrito}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold px-3.5 py-2 transition-colors shadow-sm shadow-[#4FAEB2]/30"
                      >
                        <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        {yaEnCarrito ? "Ya en pedido" : "Agregar al pedido"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Columna derecha: carrito sticky */}
        <aside className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden h-fit lg:sticky lg:top-4">
          <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent">
            <h2 className="text-[15px] font-bold text-slate-800 flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[#4FAEB2]" />
              Pedido a armar
              {cart.length > 0 && (
                <span className="inline-flex items-center justify-center min-w-[24px] h-[22px] px-2 rounded-full bg-[#4FAEB2] text-white text-[11px] font-bold tabular-nums">
                  {cart.length}
                </span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Cuando termines, mandalo a la caja para cobrar.
            </p>
          </div>

          {cart.length === 0 ? (
            <div className="py-10 text-center px-6">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-[#4FAEB2]/8 border border-[#4FAEB2]/20 mb-3">
                <Package className="h-6 w-6 text-[#4FAEB2]" />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                Sin productos todavía
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Buscá uno a la izquierda y agregalo.
              </p>
            </div>
          ) : (
            <>
              <ul className="px-3 py-3 space-y-2 max-h-[420px] overflow-y-auto">
                {cart.map((it) => {
                  const hayPres = it.presentaciones.length > 1;
                  const cantBase = it.presentacion_cantidad_base ?? 1;
                  return (
                    <li
                      key={it.producto_id}
                      className="rounded-xl border border-slate-200 bg-slate-50/40 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-bold text-slate-800 truncate">
                            {it.producto_nombre}
                          </p>
                          <p className="text-[10.5px] text-slate-500 font-mono">
                            {it.sku}
                          </p>
                        </div>
                        <button
                          onClick={() => removeFromCart(it.producto_id)}
                          className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
                          aria-label="Quitar"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Presentacion (solo si hay >1) */}
                      {hayPres && (
                        <div className="mt-2">
                          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                            Presentación
                          </label>
                          <select
                            value={it.presentacion_id ?? ""}
                            onChange={(e) =>
                              changePresentacion(it.producto_id, e.target.value)
                            }
                            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                          >
                            {it.presentaciones.map((pp) => (
                              <option key={pp.id} value={pp.id}>
                                {pp.nombre}
                                {pp.cantidad_base !== 1
                                  ? ` (= ${pp.cantidad_base} ${it.unidad_medida})`
                                  : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Tipo de precio */}
                      <div className="mt-2 grid grid-cols-3 gap-1">
                        {(
                          ["minorista", "mayorista", "distribuidor"] as const
                        ).map((t) => {
                          const sel = it.tipo_precio === t;
                          return (
                            <button
                              key={t}
                              type="button"
                              onClick={() => changeTipoPrecio(it.producto_id, t)}
                              className={`rounded-md py-1 text-[10.5px] font-semibold border transition-colors ${
                                sel
                                  ? "border-[#4FAEB2] bg-[#4FAEB2] text-white"
                                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                              }`}
                            >
                              {t === "minorista"
                                ? "Min"
                                : t === "mayorista"
                                ? "May"
                                : "Dist"}
                            </button>
                          );
                        })}
                      </div>

                      {/* Cantidad + precio + subtotal */}
                      <div className="mt-2 grid grid-cols-[auto_1fr_1fr] gap-2 items-end">
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                            Cant.
                          </label>
                          <div className="flex items-center gap-0 border border-slate-200 rounded-md bg-white">
                            <button
                              onClick={() => changeCantidad(it.producto_id, -1)}
                              className="h-7 w-7 text-slate-500 hover:bg-slate-100 rounded-l-md"
                            >
                              <Minus className="h-3 w-3 mx-auto" />
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={it.cantidad}
                              onChange={(e) =>
                                updateCart(it.producto_id, {
                                  cantidad: Math.max(1, parseInt(e.target.value) || 1),
                                })
                              }
                              className="w-10 h-7 text-center text-xs tabular-nums outline-none"
                            />
                            <button
                              onClick={() => changeCantidad(it.producto_id, 1)}
                              className="h-7 w-7 text-slate-500 hover:bg-slate-100 rounded-r-md"
                            >
                              <Plus className="h-3 w-3 mx-auto" />
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">
                            Precio
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={it.precio_venta}
                            onChange={(e) =>
                              updateCart(it.producto_id, {
                                precio_venta: Math.max(
                                  0,
                                  Number(e.target.value) || 0
                                ),
                              })
                            }
                            className="w-full h-7 rounded-md border border-slate-200 bg-white px-2 text-xs tabular-nums"
                          />
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
                            Subtotal
                          </p>
                          <p className="text-sm font-bold text-[#3F8E91] tabular-nums">
                            {fmtGs(it.cantidad * it.precio_venta)}
                          </p>
                        </div>
                      </div>

                      {/* Equivalencia (si presentacion != base) */}
                      {cantBase !== 1 && (
                        <p className="mt-1.5 text-[10.5px] text-slate-500 tabular-nums">
                          = {it.cantidad * cantBase} {it.unidad_medida}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Cliente + Total + CTA */}
              <div className="border-t border-slate-200 px-4 py-4 space-y-3 bg-slate-50/30">
                <div>
                  <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 flex items-center gap-1">
                    <User className="h-3 w-3" />
                    Cliente (opcional)
                  </label>
                  <select
                    value={clienteId}
                    onChange={(e) => setClienteId(e.target.value)}
                    className={`${inputClass} w-full text-xs`}
                  >
                    <option value="">— Sin cliente —</option>
                    {clientes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.empresa || c.nombre_contacto || "Cliente"}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                  <span className="text-sm font-semibold text-slate-700">Total</span>
                  <span className="text-lg font-bold tabular-nums text-slate-900">
                    {fmtGs(totalCart)}
                  </span>
                </div>

                {errMsg && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-md px-2.5 py-2">{errMsg}</p>}
                {okMsg && <p className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md px-2.5 py-2">{okMsg}</p>}

                <button
                  type="button"
                  onClick={enviar}
                  disabled={enviando || cart.length === 0}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#4FAEB2] hover:bg-[#3F8E91] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold py-3 transition-colors shadow-md shadow-[#4FAEB2]/30"
                >
                  {enviando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Enviar a Caja
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* Mis pedidos enviados */}
      <section className="bg-white rounded-2xl border-2 border-[#4FAEB2]/20 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)] overflow-hidden">
        <div className="px-5 py-4 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent">
          <h2 className="text-[15px] font-bold text-slate-800">
            Mis pedidos enviados
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Últimos 200 — pendientes en caja, facturados y cancelados.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-slate-50/70 text-slate-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="px-5 py-3 text-left font-semibold">Pedido</th>
                <th className="px-3 py-3 text-left font-semibold">Cliente</th>
                <th className="px-3 py-3 text-right font-semibold">Items</th>
                <th className="px-3 py-3 text-right font-semibold">Total</th>
                <th className="px-3 py-3 text-left font-semibold">Estado</th>
                <th className="px-3 py-3 text-left font-semibold">Fecha</th>
                <th className="px-3 py-3 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {misPedidos.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-slate-400">
                    Todavía no enviaste ningún pedido.
                  </td>
                </tr>
              ) : (
                misPedidos.map((p) => (
                  <tr key={p.id} className="hover:bg-[#4FAEB2]/3 transition-colors">
                    <td className="px-5 py-3 font-semibold text-slate-800">
                      {p.titulo}
                    </td>
                    <td className="px-3 py-3 text-slate-600">
                      {p.cliente_nombre ?? <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">
                      {p.items_count}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-bold text-slate-900">
                      {fmtGs(p.total_estimado)}
                    </td>
                    <td className="px-3 py-3">
                      {p.estado === "facturado" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" />
                          Cobrado{p.venta_numero ? ` · ${p.venta_numero}` : ""}
                        </span>
                      ) : p.estado === "cancelado" ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          <XCircle className="h-3 w-3" />
                          Cancelado
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          <Clock className="h-3 w-3" />
                          Pendiente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-500 tabular-nums whitespace-nowrap">
                      {fmtFecha(p.created_at)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {p.estado === "pendiente" ? (
                        <button
                          type="button"
                          onClick={() => cancelarPedido(p)}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <XCircle className="h-3 w-3" />
                          Cancelar
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="text-xs text-slate-400 text-center">
        Los pedidos pendientes aparecen en{" "}
        <Link
          href="/ventas"
          className="font-semibold text-[#3F8E91] hover:underline"
        >
          Caja
        </Link>{" "}
        para que el cajero los cobre.
      </div>
    </div>
  );
}
