import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAutoimpresor } from "@/lib/facturacion/server/facturacion-modo-pg";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";
import { buildComprobanteVentaPdf, type ComprobantePdfData, type ComprobanteEmisor, type ComprobantePdfItem } from "@/lib/ventas/server/comprobante-venta-pdf";

/**
 * GET /api/ventas/[id]/comprobante — Comprobante de venta A4 como PDF real (no
 * fiscal). Se sirve inline: el visor del navegador permite imprimir o descargar.
 * Con ?download=1 fuerza la descarga del archivo.
 */
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

  const iQ = await ctx.supabase
    .from("ventas_items")
    .select("producto_nombre, sku, cantidad, total_linea, tipo_iva, presentacion_nombre, presentacion_cantidad_base")
    .eq("venta_id", id).eq("empresa_id", empresaId);
  if (iQ.error) return new NextResponse(`Error items: ${iQ.error.message}`, { status: 500 });
  const items: ComprobantePdfItem[] = ((iQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
    cantidad: Number(r.cantidad ?? 0),
    producto_nombre: String(r.producto_nombre ?? ""),
    sku: (r.sku as string | null) ?? null,
    total_linea: Number(r.total_linea ?? 0),
    tipo_iva: (r.tipo_iva as string | null) ?? null,
    presentacion_nombre: (r.presentacion_nombre as string | null) ?? null,
    presentacion_cantidad_base: r.presentacion_cantidad_base == null ? null : Number(r.presentacion_cantidad_base),
  }));

  let cliente: ComprobantePdfData["cliente"] = null;
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

  // Emisor: datos reales del autoimpresor (razón social, RUC, dirección, teléfono).
  let emisor: ComprobanteEmisor = {
    nombre: EMPRESA_DOC.nombre, ruc: null, direccion: EMPRESA_DOC.direccion[0] ?? null,
    telefono: EMPRESA_DOC.telefono || null, actividad: EMPRESA_DOC.actividad[0] ?? null,
  };
  try {
    const schema = await fetchDataSchemaForEmpresaId(empresaId);
    const cfg = await getAutoimpresor(schema, empresaId);
    emisor = {
      nombre: cfg.razon_social_emisor?.trim() || EMPRESA_DOC.nombre,
      ruc: cfg.ruc_emisor?.trim() || null,
      direccion: cfg.direccion_matriz?.trim() || EMPRESA_DOC.direccion[0] || null,
      telefono: cfg.telefono?.trim() || EMPRESA_DOC.telefono || null,
      actividad: EMPRESA_DOC.actividad[0] ?? null,
    };
  } catch { /* fallback a EMPRESA_DOC */ }

  const data: ComprobantePdfData = {
    numero_control: String(venta.numero_control ?? ""),
    fecha: String(venta.fecha ?? ""),
    metodo_pago: (venta.metodo_pago as string | null) ?? null,
    tipo_venta: (venta.tipo_venta as string | null) ?? null,
    observaciones: (venta.observaciones as string | null) ?? null,
    cajero: (venta.usuario_nombre as string | null) ?? null,
    vendedor: null,
    cliente,
    items,
  };

  const pdf = await buildComprobanteVentaPdf(data, emisor);
  const slug = String(venta.numero_control ?? "comprobante").replace(/[^a-zA-Z0-9-]+/g, "-");
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="comprobante-${slug}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
