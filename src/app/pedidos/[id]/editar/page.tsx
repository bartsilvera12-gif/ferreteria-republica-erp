"use client";

/**
 * /pedidos/[id]/editar — Edita un pedido en estado 'pendiente' o 'en_caja'.
 *
 * Reutiliza el mismo UI de carrito que /pedidos/nuevo: buscador, agregar
 * items, presentaciones, tipo de precio. La diferencia es que precarga
 * el pedido existente y al confirmar hace PATCH (no POST).
 */

import { useEffect, useMemo, useRef, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Trash2,
  Loader2,
  X,
  Receipt,
  Plus,
  Minus,
  User,
  Package,
  Save,
  ImageIcon,
} from "lucide-react";
import { fetchWithSupabaseSession } from "@/lib/api/fetch-with-supabase-session";
import { getClientes } from "@/lib/clientes/storage";
import {
  pasoCantidad,
  permiteDecimales,
  clampCantidad,
} from "@/lib/productos/unidades";
import CantidadInput from "@/components/ui/CantidadInput";
import type { Cliente } from "@/lib/clientes/types";
import ClienteBuscador from "@/components/clientes/ClienteBuscador";
import CrearClienteModal from "@/components/clientes/CrearClienteModal";

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
  cantidad_minima_mayorista?: number | null;
  stock_actual: number;
  unidad_medida: string;
  imagen_url?: string | null;
};

type CartItem = {
  producto_id: string;
  producto_nombre: string;
  sku: string;
  stock_actual: number;
  unidad_medida: string;
  cantidad: number;
  tipo_precio: "minorista" | "mayorista" | "distribuidor";
  tipo_iva: "EXENTA" | "5%" | "10%";
  /** Precio efectivo mostrado/cobrado (tipo + presentación aplicados). */
  precio_venta: number;
  /** Precio minorista base del producto (estable). */
  precio_minorista: number;
  precio_mayorista: number;
  precio_distribuidor: number;
  cantidad_minima_mayorista: number | null;
  /** true si se fijó el tipo/precio a mano: no auto-cambiar por cantidad. */
  precio_manual?: boolean;
  imagen_url: string | null;
  presentacion_id: string | null;
  presentacion_nombre: string | null;
  presentacion_cantidad_base: number | null;
  presentaciones: PresentacionLite[];
};

function fmtGs(v: number) {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}

function precioPorTipoBase(
  p: { precio_venta: number; precio_mayorista: number; precio_distribuidor: number },
  tipo: "minorista" | "mayorista" | "distribuidor"
) {
  if (tipo === "mayorista") return p.precio_mayorista > 0 ? p.precio_mayorista : p.precio_venta;
  if (tipo === "distribuidor") return p.precio_distribuidor > 0 ? p.precio_distribuidor : p.precio_venta;
  return p.precio_venta;
}

/** Precio efectivo de un ítem para un tipo (base por canal × cantidad_base). */
function precioEfectivoItem(it: CartItem, tipo: "minorista" | "mayorista" | "distribuidor"): number {
  const base = precioPorTipoBase(
    { precio_venta: it.precio_minorista, precio_mayorista: it.precio_mayorista, precio_distribuidor: it.precio_distribuidor },
    tipo
  );
  const cantBase = it.presentacion_cantidad_base ?? 1;
  const pres = it.presentaciones.find((p) => p.id === it.presentacion_id);
  return Math.round(pres && pres.precio_venta != null && pres.precio_venta > 0 ? pres.precio_venta : base * cantBase);
}

/** Aplica el precio por canal según la cantidad (mayorista al llegar al mínimo),
 *  salvo que el tipo/precio se haya fijado a mano. */
function conTierAuto(it: CartItem): CartItem {
  if (it.precio_manual) return it;
  const min = it.cantidad_minima_mayorista;
  const tipo = it.precio_mayorista > 0 && min != null && min > 0 && it.cantidad >= min ? "mayorista" : "minorista";
  return { ...it, tipo_precio: tipo, precio_venta: precioEfectivoItem(it, tipo) };
}

/** Miniatura con fallback. */
function ProductoThumb({ url, alt }: { url?: string | null; alt: string }) {
  const [err, setErr] = useState(false);
  if (!url || err) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-100 bg-slate-50 text-slate-300">
        <ImageIcon className="h-4 w-4" />
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} loading="lazy" onError={() => setErr(true)} className="h-10 w-10 shrink-0 rounded-md border border-slate-100 object-cover" />;
}

export default function EditarPedidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: pedidoId } = use(params);
  const router = useRouter();

  // ---- Estado de carga del pedido ----
  const [loadingPedido, setLoadingPedido] = useState(true);
  const [pedidoError, setPedidoError] = useState<string | null>(null);
  const [numero, setNumero] = useState<string>("");
  const [estado, setEstado] = useState<string>("");

  // ---- Carrito + cliente ----
  const [cart, setCart] = useState<CartItem[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState<string>("");
  const [showCrearCliente, setShowCrearCliente] = useState(false);

  // ---- Buscador inline ----
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ProductoHit[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [hlIdx, setHlIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLUListElement>(null);

  // ---- Guardar ----
  const [guardando, setGuardando] = useState(false);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // Cargar pedido + clientes al montar
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [resPed, listClientes] = await Promise.all([
          fetchWithSupabaseSession(`/api/pedidos-caja/${pedidoId}`, { cache: "no-store" }),
          getClientes().catch(() => []),
        ]);
        const j = await resPed.json();
        if (cancel) return;
        if (!resPed.ok || !j?.success || !j.data?.pedido) {
          setPedidoError(j?.error ?? "Pedido no encontrado.");
          setLoadingPedido(false);
          return;
        }
        setClientes(listClientes);
        const p = j.data.pedido as {
          numero: string | null;
          titulo: string;
          estado: string;
          cliente_id: string | null;
          items: Array<{
            producto_id: string;
            producto_nombre: string;
            sku: string | null;
            cantidad: number;
            precio_venta: number;
            tipo_precio?: "minorista" | "mayorista" | "distribuidor";
            tipo_iva?: "EXENTA" | "5%" | "10%";
            presentacion_id?: string | null;
            presentacion_nombre?: string | null;
            presentacion_cantidad_base?: number | null;
          }>;
        };
        setNumero(p.numero ?? p.titulo);
        setEstado(p.estado);
        setClienteId(p.cliente_id ?? "");

        if (p.estado === "facturado" || p.estado === "cancelado") {
          setPedidoError(
            `Este pedido está ${p.estado === "facturado" ? "facturado" : "cancelado"} y no se puede editar.`
          );
          setLoadingPedido(false);
          return;
        }

        // Cargar presentaciones + meta de cada producto para reconstruir el carrito.
        const productosIds = [...new Set(p.items.map((it) => it.producto_id))];
        const productosMeta = new Map<string, ProductoHit>();
        const presentacionesMap = new Map<string, PresentacionLite[]>();
        await Promise.all(
          productosIds.map(async (prodId) => {
            try {
              const [rp, rpres] = await Promise.all([
                fetchWithSupabaseSession(`/api/productos/${prodId}`, { cache: "no-store" }),
                fetchWithSupabaseSession(`/api/productos/${prodId}/presentaciones`, { cache: "no-store" }),
              ]);
              const jp = await rp.json();
              const jpres = await rpres.json();
              if (jp?.success && jp.data?.producto) {
                const x = jp.data.producto as Record<string, unknown>;
                productosMeta.set(prodId, {
                  id: String(x.id),
                  nombre: String(x.nombre ?? ""),
                  sku: String(x.sku ?? ""),
                  precio_venta: Number(x.precio_venta) || 0,
                  precio_mayorista: Number(x.precio_mayorista) || 0,
                  precio_distribuidor:
                    x.precio_distribuidor == null ? null : Number(x.precio_distribuidor),
                  cantidad_minima_mayorista:
                    x.cantidad_minima_mayorista == null ? null : Number(x.cantidad_minima_mayorista),
                  stock_actual: Number(x.stock_actual) || 0,
                  unidad_medida: String(x.unidad_medida ?? "Unidad"),
                  imagen_url: (x.imagen_url as string | null) ?? null,
                });
              }
              if (jpres?.success) {
                const list = (jpres.data?.presentaciones ?? []) as PresentacionLite[];
                presentacionesMap.set(prodId, list.filter((x) => x.activo));
              }
            } catch { /* best effort por producto */ }
          })
        );

        const cartReconstruido: CartItem[] = p.items.map((it) => {
          const meta = productosMeta.get(it.producto_id);
          const pres = presentacionesMap.get(it.producto_id) ?? [];
          return {
            producto_id: it.producto_id,
            producto_nombre: it.producto_nombre,
            sku: it.sku ?? "",
            stock_actual: meta?.stock_actual ?? 0,
            unidad_medida: meta?.unidad_medida ?? "Unidad",
            cantidad: Number(it.cantidad) || 1,
            tipo_precio: (it.tipo_precio as CartItem["tipo_precio"]) ?? "minorista",
            tipo_iva: (it.tipo_iva as CartItem["tipo_iva"]) ?? "10%",
            precio_venta: Number(it.precio_venta) || 0,
            precio_minorista: meta?.precio_venta ?? (Number(it.precio_venta) || 0),
            precio_mayorista: meta?.precio_mayorista ?? 0,
            precio_distribuidor: meta?.precio_distribuidor ?? 0,
            cantidad_minima_mayorista: meta?.cantidad_minima_mayorista ?? null,
            // El pedido ya tenía su precio: se respeta (no auto-cambiar) hasta que
            // el cajero cambie el tipo o la cantidad a mano.
            precio_manual: true,
            imagen_url: meta?.imagen_url ?? null,
            presentacion_id: it.presentacion_id ?? null,
            presentacion_nombre: it.presentacion_nombre ?? null,
            presentacion_cantidad_base: it.presentacion_cantidad_base ?? null,
            presentaciones: pres,
          };
        });
        setCart(cartReconstruido);
        setLoadingPedido(false);
      } catch (e) {
        if (!cancel) {
          setPedidoError(e instanceof Error ? e.message : "Error de red");
          setLoadingPedido(false);
        }
      }
    })();
    return () => { cancel = true; };
  }, [pedidoId]);

  // ---- Buscador de productos (debounce) ----
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) { setHits([]); return; }
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
        const items = ((j?.data?.items ?? []) as Record<string, unknown>[]).map((p) => ({
          id: String(p.id),
          nombre: String(p.nombre ?? ""),
          sku: String(p.sku ?? ""),
          precio_venta: Number(p.precio_venta) || 0,
          precio_mayorista: Number(p.precio_mayorista) || 0,
          precio_distribuidor: p.precio_distribuidor == null ? null : Number(p.precio_distribuidor),
          cantidad_minima_mayorista: p.cantidad_minima_mayorista == null ? null : Number(p.cantidad_minima_mayorista),
          stock_actual: Number(p.stock_actual) || 0,
          unidad_medida: String(p.unidad_medida ?? "Unidad"),
          imagen_url: (p.imagen_url as string | null) ?? null,
        }));
        setHits(items);
      } finally {
        if (!cancel) setBuscando(false);
      }
    }, 250);
    return () => { cancel = true; clearTimeout(t); };
  }, [q]);

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
    const ex = cart.find((x) => x.producto_id === p.id);
    if (ex) {
      setCart((prev) =>
        prev.map((x) =>
          x.producto_id === p.id ? conTierAuto({ ...x, cantidad: x.cantidad + 1 }) : x
        )
      );
      return;
    }
    const pres = await loadPresentaciones(p.id);
    const def = pres.find((x) => x.es_default && x.activo) ?? pres[0] ?? null;
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
        tipo_iva: "10%",
        precio_venta: p.precio_venta,
        precio_minorista: p.precio_venta,
        precio_mayorista: p.precio_mayorista,
        precio_distribuidor: p.precio_distribuidor ?? 0,
        cantidad_minima_mayorista: p.cantidad_minima_mayorista ?? null,
        precio_manual: false,
        imagen_url: p.imagen_url ?? null,
        presentacion_id: def ? def.id : null,
        presentacion_nombre: def ? def.nombre : null,
        presentacion_cantidad_base: def ? def.cantidad_base : null,
        presentaciones: pres,
      },
    ]);
  }

  function updateCart(id: string, patch: Partial<CartItem>) {
    setCart((prev) => prev.map((x) => (x.producto_id === id ? { ...x, ...patch } : x)));
  }
  function removeFromCart(id: string) {
    setCart((prev) => prev.filter((x) => x.producto_id !== id));
  }
  function changeCantidad(id: string, delta: number) {
    // `delta` en pasos: 0,1 en unidades por peso/medida, 1 en discretas.
    setCart((prev) =>
      prev.map((x) =>
        x.producto_id === id
          ? conTierAuto({ ...x, cantidad: clampCantidad(x.cantidad + delta * pasoCantidad(x.unidad_medida), x.unidad_medida) })
          : x
      )
    );
  }
  function changeTipoPrecio(id: string, tipo: "minorista" | "mayorista" | "distribuidor") {
    const it = cart.find((x) => x.producto_id === id);
    if (!it) return;
    // Elegir el tipo a mano fija el precio: no se auto-cambia por cantidad.
    updateCart(id, { tipo_precio: tipo, precio_venta: precioEfectivoItem(it, tipo), precio_manual: true });
  }
  function changePresentacion(id: string, presentacionId: string) {
    const it = cart.find((x) => x.producto_id === id);
    if (!it) return;
    const pres = it.presentaciones.find((p) => p.id === presentacionId);
    if (!pres) return;
    const base = precioPorTipoBase(
      {
        precio_venta: it.precio_minorista,
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

  async function guardar() {
    if (cart.length === 0) {
      setErrMsg("El pedido debe tener al menos un producto.");
      return;
    }
    setGuardando(true);
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
          unidad_medida: it.unidad_medida,
          cantidad: it.cantidad,
          precio_venta: it.precio_venta,
          tipo_precio: it.tipo_precio,
          tipo_iva: it.tipo_iva,
          presentacion_id: it.presentacion_id,
          presentacion_nombre: it.presentacion_nombre,
          presentacion_cantidad_base: it.presentacion_cantidad_base,
        })),
      };
      const r = await fetchWithSupabaseSession(`/api/pedidos-caja/${pedidoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j?.success) throw new Error(j?.error ?? `Error ${r.status}`);
      setOkMsg("Pedido actualizado. Redirigiendo...");
      setTimeout(() => router.push("/pedidos"), 900);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setGuardando(false);
    }
  }

  // Resaltar el primer resultado al cambiar los hits.
  useEffect(() => { setHlIdx(0); }, [hits]);
  useEffect(() => {
    if (hlIdx >= 0) resultsRef.current?.querySelector(`[data-idx="${hlIdx}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hlIdx]);

  // Atajos globales de teclado (última versión de guardar via ref).
  const guardarRef = useRef(guardar);
  guardarRef.current = guardar;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "Enter") { e.preventDefault(); guardarRef.current(); }
      else if (ctrl && (e.key === "k" || e.key === "K")) { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inputClass =
    "h-10 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm outline-none transition-all hover:border-slate-300 focus:border-[#4FAEB2] focus:ring-2 focus:ring-[#4FAEB2]/20";

  if (loadingPedido) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-7 w-7 animate-spin text-[#4FAEB2]" />
      </div>
    );
  }

  if (pedidoError) {
    return (
      <div className="w-full py-8 px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl border-2 border-red-200 p-8 text-center max-w-md mx-auto">
          <p className="text-sm font-bold text-red-700">{pedidoError}</p>
          <Link
            href="/pedidos"
            className="inline-flex items-center gap-2 mt-4 text-sm font-semibold text-[#3F8E91] hover:underline"
          >
            ← Volver al listado
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full py-8 px-4 sm:px-6 lg:px-8 space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#4FAEB2]/8 border border-[#4FAEB2]/30 px-3 py-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-[#3F8E91] mb-3">
            <Receipt className="h-3 w-3 text-[#4FAEB2]" />
            Pedidos · Editar
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 tracking-tight leading-tight">
            Editar {numero}
          </h1>
          <p className="text-[14px] text-slate-500 mt-1.5">
            Estado actual:{" "}
            <span className="font-semibold capitalize">{estado.replace("_", " ")}</span>.
            Podés cambiar items, cliente y precios; el total se recalcula automáticamente.
          </p>
        </div>
        <Link
          href="/pedidos"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-[#4FAEB2] hover:text-[#3F8E91]"
        >
          ← Cancelar
        </Link>
      </header>

      {/* Buscador (full width) */}
      <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-4 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#4FAEB2]" />
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setHlIdx((i) => Math.min(i + 1, hits.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHlIdx((i) => Math.max(i - 1, 0)); }
              else if (e.key === "Enter") {
                e.preventDefault();
                const p = hits[hlIdx] ?? hits[0];
                if (p && !cart.some((c) => c.producto_id === p.id)) { addToCart(p); setQ(""); }
              } else if (e.key === "Escape") { setQ(""); }
            }}
            placeholder="Agregar más productos al pedido…"
            className="h-14 w-full rounded-2xl border-2 border-[#4FAEB2]/25 bg-white pl-12 pr-10 text-base outline-none focus:border-[#4FAEB2] focus:ring-4 focus:ring-[#4FAEB2]/15"
            autoComplete="off"
          />
          {q && (
            <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-4 w-4" />
            </button>
          )}
          {buscando && <Loader2 className="absolute right-10 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-[#4FAEB2]" />}
        </div>

        {q.trim().length >= 2 && hits.length > 0 && (
          <ul ref={resultsRef} className="mt-3 max-h-[320px] space-y-2 overflow-y-auto">
            {hits.map((p, i) => {
              const yaEnCarrito = cart.some((c) => c.producto_id === p.id);
              return (
                <li
                  key={p.id}
                  data-idx={i}
                  onMouseEnter={() => setHlIdx(i)}
                  className={`flex items-center gap-3 rounded-xl border-2 bg-white p-3 transition-all ${
                    i === hlIdx ? "border-[#4FAEB2]/60 ring-2 ring-[#4FAEB2]/15" : "border-slate-100 hover:border-[#4FAEB2]/40"
                  }`}
                >
                  <ProductoThumb url={p.imagen_url} alt={p.nombre} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-bold text-slate-800">{p.nombre}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="font-mono">{p.sku}</span> · {p.stock_actual} {p.unidad_medida} · {fmtGs(p.precio_venta)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addToCart(p)}
                    disabled={yaEnCarrito}
                    className="inline-flex items-center gap-1 rounded-lg bg-[#4FAEB2] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3F8E91] disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {yaEnCarrito ? "En pedido" : "Agregar"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Tabla del pedido (full width) — misma vista que Nuevo */}
      <div className="overflow-hidden rounded-2xl border-2 border-[#4FAEB2]/20 bg-white shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#4FAEB2]/15 bg-gradient-to-r from-[#4FAEB2]/5 to-transparent px-5 py-4">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-slate-800">
            <Receipt className="h-4 w-4 text-[#4FAEB2]" />
            Pedido a armar
            {cart.length > 0 && (
              <span className="inline-flex h-[22px] min-w-[24px] items-center justify-center rounded-full bg-[#4FAEB2] px-2 text-[11px] font-bold tabular-nums text-white">
                {cart.length}
              </span>
            )}
          </h2>
          <p className="text-xs text-slate-500">Elegí productos arriba; revisá cantidades y precios acá.</p>
        </div>

        {cart.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-[#4FAEB2]/20 bg-[#4FAEB2]/8">
              <Package className="h-6 w-6 text-[#4FAEB2]" />
            </div>
            <p className="text-sm font-semibold text-slate-700">Sin productos todavía</p>
            <p className="mt-1 text-xs text-slate-400">Buscá uno arriba y agregalo al pedido.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Producto</th>
                  <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Presentación</th>
                  <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">Precio</th>
                  <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500">IVA</th>
                  <th className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">Cant.</th>
                  <th className="px-3 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Precio unit.</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">Subtotal</th>
                  <th className="w-10 px-2 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cart.map((it) => {
                  const cantBase = it.presentacion_cantidad_base ?? 1;
                  return (
                    <tr
                      key={it.producto_id}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        const tag = (e.target as HTMLElement).tagName;
                        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
                        if (e.key === "+" || e.key === "=") { e.preventDefault(); changeCantidad(it.producto_id, 1); }
                        else if (e.key === "-") { e.preventDefault(); changeCantidad(it.producto_id, -1); }
                        else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeFromCart(it.producto_id); }
                      }}
                      className="align-middle outline-none transition-colors hover:bg-[#4FAEB2]/5 focus:bg-[#4FAEB2]/10 focus:ring-2 focus:ring-inset focus:ring-[#4FAEB2]/50"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <ProductoThumb url={it.imagen_url} alt={it.producto_nombre} />
                          <div className="min-w-0">
                            <p className="font-semibold leading-snug text-slate-900">{it.producto_nombre}</p>
                            <p className="font-mono text-[11px] text-slate-500">{it.sku}</p>
                            {cantBase !== 1 && (
                              <p className="text-[11px] tabular-nums text-slate-500">= {it.cantidad * cantBase} {it.unidad_medida}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <select
                          value={it.presentacion_id ?? ""}
                          onChange={(e) => changePresentacion(it.producto_id, e.target.value)}
                          disabled={it.presentaciones.length <= 1}
                          className="w-full min-w-[130px] rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          {it.presentaciones.length === 0 ? (
                            <option value="">— Sin presentación —</option>
                          ) : (
                            it.presentaciones.map((pp) => (
                              <option key={pp.id} value={pp.id}>
                                {pp.nombre}{pp.cantidad_base !== 1 ? ` (= ${pp.cantidad_base} ${it.unidad_medida})` : ""}
                              </option>
                            ))
                          )}
                        </select>
                      </td>
                      <td className="px-3 py-3">
                        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                          {(["minorista", "mayorista", "distribuidor"] as const).map((t) => {
                            const sel = it.tipo_precio === t;
                            return (
                              <button key={t} type="button" onClick={() => changeTipoPrecio(it.producto_id, t)}
                                className={`px-2 py-1.5 text-[11px] font-semibold transition-colors ${sel ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                                {t === "minorista" ? "Min" : t === "mayorista" ? "May" : "Dist"}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
                          {(["EXENTA", "5%", "10%"] as const).map((iva) => {
                            const sel = it.tipo_iva === iva;
                            return (
                              <button key={iva} type="button" onClick={() => updateCart(it.producto_id, { tipo_iva: iva })}
                                className={`px-2 py-1.5 text-[11px] font-semibold transition-colors ${sel ? "bg-[#4FAEB2] text-white" : "bg-white text-slate-600 hover:bg-slate-100"}`}>
                                {iva === "EXENTA" ? "Ex" : iva}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="mx-auto flex w-fit items-center rounded-md border border-slate-200 bg-white">
                          <button onClick={() => changeCantidad(it.producto_id, -1)} className="h-8 w-8 rounded-l-md text-slate-500 hover:bg-slate-100"><Minus className="mx-auto h-3.5 w-3.5" /></button>
                          <CantidadInput
                            value={it.cantidad}
                            unidad={it.unidad_medida}
                            onChange={(n) => setCart((prev) => prev.map((x) => (x.producto_id === it.producto_id ? conTierAuto({ ...x, cantidad: n }) : x)))}
                            className={`h-8 text-center text-sm tabular-nums outline-none ${permiteDecimales(it.unidad_medida) ? "w-16" : "w-12"}`}
                          />
                          <button onClick={() => changeCantidad(it.producto_id, 1)} className="h-8 w-8 rounded-r-md text-slate-500 hover:bg-slate-100"><Plus className="mx-auto h-3.5 w-3.5" /></button>
                        </div>
                        {permiteDecimales(it.unidad_medida) && (
                          <p className="mt-0.5 text-center text-[10px] font-semibold uppercase text-[#3F8E91]">{it.unidad_medida}</p>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <input
                          type="number"
                          min={0}
                          value={it.precio_venta}
                          onChange={(e) => updateCart(it.producto_id, { precio_venta: Math.max(0, Number(e.target.value) || 0), precio_manual: true })}
                          className="h-8 w-28 rounded-md border border-slate-200 bg-white px-2 text-right text-sm tabular-nums"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-sm font-bold tabular-nums text-[#3F8E91]">{fmtGs(it.cantidad * it.precio_venta)}</span>
                      </td>
                      <td className="px-2 py-3 text-center">
                        <button onClick={() => removeFromCart(it.producto_id)} className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label="Quitar">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Cliente + total + guardar */}
      {cart.length > 0 && (
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_380px]">
          <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
            <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <User className="h-3.5 w-3.5 text-[#4FAEB2]" />
              Cliente (opcional)
            </label>
            <ClienteBuscador clientes={clientes} value={clienteId} onChange={setClienteId} />
            {!clienteId && (
              <button type="button" onClick={() => setShowCrearCliente(true)} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#3F8E91] hover:underline">
                <Plus className="h-3.5 w-3.5" /> Crear cliente nuevo
              </button>
            )}
          </div>

          <div className="rounded-2xl border-2 border-[#4FAEB2]/20 bg-white p-5 shadow-[0_2px_10px_-2px_rgba(79,174,178,0.12)]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Total</span>
              <span className="text-2xl font-bold tabular-nums text-slate-900">{fmtGs(totalCart)}</span>
            </div>
            {errMsg && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">{errMsg}</p>}
            {okMsg && <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">{okMsg}</p>}
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || cart.length === 0}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#4FAEB2] py-3 text-sm font-bold text-white shadow-md shadow-[#4FAEB2]/30 transition-colors hover:bg-[#3F8E91] disabled:opacity-50"
            >
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar cambios
              <kbd className="ml-1 rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold">Ctrl↵</kbd>
            </button>
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400">
              <span><kbd className="rounded border border-slate-300 bg-slate-50 px-1">↑</kbd><kbd className="rounded border border-slate-300 bg-slate-50 px-1">↓</kbd> elegir · <kbd className="rounded border border-slate-300 bg-slate-50 px-1">↵</kbd> agregar</span>
              <span>fila: <kbd className="rounded border border-slate-300 bg-slate-50 px-1">+</kbd><kbd className="rounded border border-slate-300 bg-slate-50 px-1">−</kbd> · <kbd className="rounded border border-slate-300 bg-slate-50 px-1">Supr</kbd> quita</span>
              <span><kbd className="rounded border border-slate-300 bg-slate-50 px-1">Ctrl</kbd>+<kbd className="rounded border border-slate-300 bg-slate-50 px-1">K</kbd> buscar</span>
            </div>
          </div>
        </div>
      )}

      {showCrearCliente && (
        <CrearClienteModal
          onClose={() => setShowCrearCliente(false)}
          onCreated={async (c) => {
            setShowCrearCliente(false);
            try { setClientes(await getClientes()); } catch { /* igual seleccionamos por id */ }
            setClienteId(c.id);
          }}
        />
      )}
    </div>
  );
}
