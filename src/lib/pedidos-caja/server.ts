/**
 * Helpers server-side para pedidos_caja.
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import type { PedidoCaja, PedidoCajaItem } from "./types";

export const PEDIDO_CAJA_COLS =
  "id, titulo, cliente_id, cliente_nombre, cliente_telefono, observacion, items, " +
  "total_estimado, estado, venta_id, venta_numero, " +
  "armado_por_id, armado_por_email, created_at, facturado_at, " +
  "cancelado_at, cancelado_motivo";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function mapItems(raw: unknown): PedidoCajaItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const tp = r.tipo_precio;
    return {
      producto_id: String(r.producto_id ?? ""),
      producto_nombre: String(r.producto_nombre ?? ""),
      sku: r.sku == null ? null : String(r.sku),
      cantidad: num(r.cantidad),
      precio_venta: num(r.precio_venta),
      tipo_precio:
        tp === "mayorista" || tp === "distribuidor" ? tp : "minorista",
      presentacion_id: r.presentacion_id == null ? null : String(r.presentacion_id),
      presentacion_nombre:
        r.presentacion_nombre == null ? null : String(r.presentacion_nombre),
      presentacion_cantidad_base:
        r.presentacion_cantidad_base == null
          ? null
          : num(r.presentacion_cantidad_base),
    };
  });
}

export function mapPedidoCaja(r: Record<string, unknown>): PedidoCaja {
  const est = r.estado;
  return {
    id: String(r.id),
    titulo: String(r.titulo ?? ""),
    cliente_id: r.cliente_id ? String(r.cliente_id) : null,
    cliente_nombre: r.cliente_nombre ? String(r.cliente_nombre) : null,
    cliente_telefono: r.cliente_telefono ? String(r.cliente_telefono) : null,
    observacion: r.observacion ? String(r.observacion) : null,
    items: mapItems(r.items),
    total_estimado: num(r.total_estimado),
    estado:
      est === "facturado" || est === "cancelado" ? est : "pendiente",
    venta_id: r.venta_id ? String(r.venta_id) : null,
    venta_numero: r.venta_numero ? String(r.venta_numero) : null,
    armado_por_id: r.armado_por_id ? String(r.armado_por_id) : null,
    armado_por_email: r.armado_por_email ? String(r.armado_por_email) : null,
    created_at: String(r.created_at ?? ""),
    facturado_at: r.facturado_at ? String(r.facturado_at) : null,
    cancelado_at: r.cancelado_at ? String(r.cancelado_at) : null,
    cancelado_motivo: r.cancelado_motivo ? String(r.cancelado_motivo) : null,
  };
}

/**
 * Marca un pedido como facturado. Se invoca desde create-venta cuando llega
 * pedido_id en el body. Idempotente: si ya esta facturado con la misma venta
 * no hace nada. Si esta facturado con otra venta o cancelado, throwea.
 */
export async function marcarPedidoFacturado(
  sb: AppSupabaseClient,
  empresaId: string,
  pedidoId: string,
  ventaId: string,
  ventaNumero: string
): Promise<void> {
  const q = await sb
    .from("pedidos_caja")
    .select("estado, venta_id")
    .eq("empresa_id", empresaId)
    .eq("id", pedidoId)
    .maybeSingle();
  if (q.error) throw new Error(q.error.message);
  if (!q.data) return; // pedido no existe -> best-effort, ignoramos.
  const row = q.data as { estado: string; venta_id: string | null };
  if (row.estado === "facturado") {
    if (row.venta_id && row.venta_id !== ventaId) {
      throw new Error(`Pedido ya facturado con otra venta (${row.venta_id}).`);
    }
    return; // idempotente
  }
  if (row.estado === "cancelado") {
    throw new Error("El pedido está cancelado, no se puede facturar.");
  }
  const upd = await sb
    .from("pedidos_caja")
    .update({
      estado: "facturado",
      venta_id: ventaId,
      venta_numero: ventaNumero,
      facturado_at: new Date().toISOString(),
    })
    .eq("empresa_id", empresaId)
    .eq("id", pedidoId)
    .eq("estado", "pendiente");
  if (upd.error) throw new Error(upd.error.message);
}
