import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getReporteCajasPg } from "@/lib/caja/reporte-pg";
import { resolverRangoCajas } from "@/lib/caja/reporte-rango";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";

/** GET /api/reportes/cajas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const sp = new URL(request.url).searchParams;
    const rango = resolverRangoCajas(sp.get("desde"), sp.get("hasta"));

    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getReporteCajasPg(schema, ctx.auth.empresa_id, rango);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/cajas]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de caja."), { status: 500 });
  }
}
