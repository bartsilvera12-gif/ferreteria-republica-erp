import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { renderComprobanteVentaA4, type ComprobanteItem } from "@/lib/ventas/server/render-comprobante-venta";

/**
 * GET /api/ventas/[id]/comprobante?auto=1
 * Comprobante de venta A4 (HTML imprimible, NO fiscal). Con `auto=1` abre el
 * diálogo de impresión (→ Guardar como PDF).
 */
const NEGOCIO_FALLBACK = "Ferretería República";

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  const { id } = await ctxParams.params;
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;

  const vQ = await ctx.supabase
    .from("ventas")
    .select("id, numero_control, fecha, metodo_pago, tipo_venta, observaciones, usuario_nombre, cliente_id")
    .eq("id", id).eq("empresa_id", empresaId).maybeSingle();
  if (vQ.error) return new NextResponse(`Error: ${vQ.error.message}`, { status: 500 });
  if (!vQ.data) return new NextResponse("Venta no encontrada", { status: 404 });
  const venta = vQ.data as Record<string, unknown>;

  let negocio = NEGOCIO_FALLBACK;
  const envName = (process.env.NEURA_CLIENT_NAME ?? "").trim();
  if (envName) negocio = envName;
  else {
    try {
      const eQ = await ctx.supabase.from("empresas").select("nombre_empresa").eq("id", empresaId).maybeSingle();
      const n = (eQ.data as { nombre_empresa?: string | null } | null)?.nombre_empresa?.trim();
      if (n) negocio = n;
    } catch { /* fallback */ }
  }

  const iQ = await ctx.supabase
    .from("ventas_items")
    .select("producto_nombre, sku, cantidad, precio_venta, total_linea, tipo_iva, presentacion_nombre, presentacion_cantidad_base")
    .eq("venta_id", id).eq("empresa_id", empresaId);
  if (iQ.error) return new NextResponse(`Error items: ${iQ.error.message}`, { status: 500 });
  const items: ComprobanteItem[] = ((iQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
    cantidad: Number(r.cantidad ?? 0),
    producto_nombre: String(r.producto_nombre ?? ""),
    sku: (r.sku as string | null) ?? null,
    precio_venta: Number(r.precio_venta ?? 0),
    total_linea: Number(r.total_linea ?? 0),
    tipo_iva: (r.tipo_iva as string | null) ?? null,
    presentacion_nombre: (r.presentacion_nombre as string | null) ?? null,
    presentacion_cantidad_base: r.presentacion_cantidad_base == null ? null : Number(r.presentacion_cantidad_base),
  }));

  let cliente: { nombre: string | null; ruc: string | null; documento: string | null; direccion: string | null; telefono: string | null } | null = null;
  if (venta.cliente_id) {
    const cQ = await ctx.supabase
      .from("clientes")
      .select("empresa, nombre, nombre_contacto, ruc, documento, direccion, telefono")
      .eq("id", venta.cliente_id).eq("empresa_id", empresaId).maybeSingle();
    const c = cQ.data as Record<string, string | null> | null;
    if (c) {
      const s = (v: string | null | undefined) => (typeof v === "string" && v.trim() ? v.trim() : null);
      cliente = {
        nombre: s(c.empresa) || s(c.nombre_contacto) || s(c.nombre),
        ruc: s(c.ruc), documento: s(c.documento), direccion: s(c.direccion), telefono: s(c.telefono),
      };
    }
  }

  const origin = new URL(request.url).origin;
  const html = renderComprobanteVentaA4({
    negocio,
    numero_control: String(venta.numero_control ?? ""),
    fecha: String(venta.fecha ?? ""),
    metodo_pago: (venta.metodo_pago as string | null) ?? null,
    tipo_venta: (venta.tipo_venta as string | null) ?? null,
    observaciones: (venta.observaciones as string | null) ?? null,
    cajero: (venta.usuario_nombre as string | null) ?? null,
    vendedor: null,
    cliente,
    items,
    origin,
  });

  return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
