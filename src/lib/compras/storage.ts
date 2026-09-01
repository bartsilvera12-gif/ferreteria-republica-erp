import type { Compra } from "./types";

interface CompraApiRow {
  id: string; numero_control: string; proveedor_id: string; proveedor_nombre: string;
  producto_id: string; producto_nombre: string; cantidad: string | number; moneda: string;
  tipo_cambio: string | number; costo_unitario_original: string | number;
  costo_unitario: string | number; iva_tipo: string;
  subtotal: string | number; monto_iva: string | number; total: string | number;
  precio_venta: string | number; margen_venta: string | number | null;
  tipo_pago: string; plazo_dias: number | null; nro_timbrado: string; estado: string;
  fecha: string;
}

function mapRow(r: CompraApiRow): Compra {
  return {
    id: r.id,
    numero_control: r.numero_control,
    proveedor_id: r.proveedor_id,
    proveedor_nombre: r.proveedor_nombre,
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    cantidad: Number(r.cantidad),
    moneda: (r.moneda === "USD" ? "USD" : "PYG") as Compra["moneda"],
    tipo_cambio: Number(r.tipo_cambio),
    costo_unitario_original: Number(r.costo_unitario_original),
    costo_unitario: Number(r.costo_unitario),
    iva_tipo: r.iva_tipo as Compra["iva_tipo"],
    subtotal: Number(r.subtotal),
    monto_iva: Number(r.monto_iva),
    total: Number(r.total),
    precio_venta: Number(r.precio_venta),
    margen_venta: r.margen_venta != null ? Number(r.margen_venta) : 0,
    tipo_pago: r.tipo_pago as Compra["tipo_pago"],
    plazo_dias: r.plazo_dias ?? undefined,
    nro_timbrado: r.nro_timbrado,
    fecha: r.fecha,
  };
}

export interface ComprasQuery {
  /** N.o de control, proveedor, producto o timbrado. */
  q?: string;
  tipoPago?: "contado" | "credito" | "";
  /** YYYY-MM-DD */
  desde?: string;
  /** YYYY-MM-DD */
  hasta?: string;
  page?: number;
  pageSize?: number;
}

export interface ComprasPage {
  compras: Compra[];
  /** Total de compras que cumplen el filtro, no solo las de esta pagina. */
  total: number;
  page: number;
  pageSize: number;
}

/** Query string compartido por el listado y el export a Excel. */
export function comprasQueryString(query: ComprasQuery = {}): string {
  const sp = new URLSearchParams();
  if (query.q?.trim()) sp.set("q", query.q.trim());
  if (query.tipoPago) sp.set("tipo_pago", query.tipoPago);
  if (query.desde) sp.set("desde", query.desde);
  if (query.hasta) sp.set("hasta", query.hasta);
  return sp.toString();
}

const PAGE_SIZE_DEFAULT = 50;

export async function getCompras(query: ComprasQuery = {}): Promise<ComprasPage> {
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : PAGE_SIZE_DEFAULT;
  const vacia: ComprasPage = { compras: [], total: 0, page, pageSize };

  try {
    const sp = new URLSearchParams(comprasQueryString(query));
    sp.set("page", String(page));
    sp.set("page_size", String(pageSize));

    const r = await fetch(`/api/compras?${sp.toString()}`, {
      credentials: "include",
      cache: "no-store",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      console.error("[compras] getCompras:", (j as { error?: string })?.error ?? r.status);
      return vacia;
    }
    const data = j.data as {
      compras?: CompraApiRow[];
      total?: number;
      page?: number;
      page_size?: number;
    };
    return {
      compras: (data.compras ?? []).map(mapRow),
      total: Number(data.total ?? 0),
      page: Number(data.page ?? page),
      pageSize: Number(data.page_size ?? pageSize),
    };
  } catch (e) {
    console.error("[compras] getCompras:", e);
    return vacia;
  }
}

export interface SaveCompraResult {
  success: true;
  compra: Compra;
  warning?: string | null;
}
export interface SaveCompraError {
  success: false;
  error: string;
}

export async function saveCompra(
  datos: Omit<Compra, "id" | "numero_control" | "fecha">
): Promise<SaveCompraResult | SaveCompraError> {
  try {
    const r = await fetch("/api/compras", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datos),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) {
      const err = (j as { error?: string })?.error ?? `Error ${r.status} al guardar la compra.`;
      console.error("[compras] saveCompra:", err);
      return { success: false, error: err };
    }
    const data = j.data as { compra?: CompraApiRow; warning?: string | null };
    if (!data.compra) {
      return { success: false, error: "Respuesta inválida del servidor." };
    }
    return { success: true, compra: mapRow(data.compra), warning: data.warning ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error de red";
    console.error("[compras] saveCompra:", e);
    return { success: false, error: msg };
  }
}
