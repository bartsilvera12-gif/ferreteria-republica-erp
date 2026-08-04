import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getItemsDeVenta } from "@/lib/reportes/server/reporte-ventas-detalle-pg";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/reportes/ventas-detalle/items?venta_id=UUID — productos de una venta. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const ventaId = (new URL(request.url).searchParams.get("venta_id") ?? "").trim();
    if (!RE_UUID.test(ventaId)) return NextResponse.json(errorResponse("venta_id inválido."), { status: 400 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const items = await getItemsDeVenta(schema, ctx.auth.empresa_id, ventaId);
    return NextResponse.json(successResponse({ items }));
  } catch (err) {
    console.error("[/api/reportes/ventas-detalle/items]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar los productos de la venta."), { status: 500 });
  }
}
