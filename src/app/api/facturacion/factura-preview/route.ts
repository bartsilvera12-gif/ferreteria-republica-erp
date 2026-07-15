import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getAutoimpresor } from "@/lib/facturacion/server/facturacion-modo-pg";
import { liquidarIva } from "@/lib/facturacion/autoimpresor/emitir-factura";
import { renderFacturaTicketHTML } from "@/lib/facturacion/autoimpresor/render-factura-ticket";
import { EMPRESA_DOC } from "@/lib/documentos/membrete";

/**
 * GET /api/facturacion/factura-preview?w=58|80
 *
 * Vista previa del FORMATO de la factura autoimpresor con datos de EJEMPLO, sin
 * necesidad de una venta real. Siempre borrador ("SIN VALIDEZ FISCAL"), no
 * consume numeración ni toca la base. Toma el emisor de la config real para que
 * se vea con el timbrado/RUC/dirección cargados. Sirve para revisar el diseño
 * desde la pantalla de configuración antes de activar.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const widthMm: 58 | 80 = url.searchParams.get("w") === "58" ? 58 : 80;
  const origin = url.origin;

  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  const cfg = await getAutoimpresor(schema, empresaId);

  const emisor = {
    razon_social: cfg.razon_social_emisor?.trim() || EMPRESA_DOC.nombre,
    ruc: cfg.ruc_emisor?.trim() || "—",
    direccion: cfg.direccion_matriz?.trim() || "",
    telefono: cfg.telefono?.trim() || EMPRESA_DOC.telefono || "",
    logoUrl: EMPRESA_DOC.logoUrl,
  };

  // Ítems de ejemplo (representativos de una ferretería, con 10% y exenta).
  const itemsRaw = [
    { producto_nombre: "CEMENTO PORTLAND 50KG", cantidad: 2, precio_venta: 55000, total_linea: 110000, monto_iva: 10000, tipo_iva: "10%" },
    { producto_nombre: "MARTILLO CARPINTERO 16OZ MANGO FIBRA", cantidad: 1, precio_venta: 48500, total_linea: 48500, monto_iva: 4409, tipo_iva: "10%" },
    { producto_nombre: "GUANTE DE TRABAJO NITRILO", cantidad: 3, precio_venta: 12000, total_linea: 36000, monto_iva: 3273, tipo_iva: "10%" },
  ];
  const items = itemsRaw.map((it) => ({
    cantidad: it.cantidad,
    descripcion: it.producto_nombre,
    precioUnitario: it.precio_venta,
    totalLinea: it.total_linea,
    tipo_iva: it.tipo_iva,
  }));
  const liq = liquidarIva(itemsRaw);

  const est = cfg.establecimiento_codigo?.trim() || "001";
  const punto = cfg.punto_expedicion_codigo?.trim() || "002";
  const numeroCompleto = `${est.padStart(3, "0").slice(-3)}-${punto.padStart(3, "0").slice(-3)}-XXXXXXX`;

  const html = renderFacturaTicketHTML({
    borrador: true,
    motivoBorrador: "Vista previa del formato (datos de ejemplo).",
    widthMm,
    emisor,
    origin,
    timbrado: {
      numero: cfg.timbrado_numero?.trim() || "—",
      inicio: cfg.timbrado_inicio_vigencia,
      fin: cfg.timbrado_fin_vigencia,
    },
    numeroCompleto,
    fechaEmision: new Date().toISOString(),
    condicion: "contado",
    cliente: { nombre: "CLIENTE DE EJEMPLO", ruc: "0000000-0" },
    ventaNumeroControl: "EJEMPLO",
    items,
    liq,
    autoPrint: false,
  });

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
