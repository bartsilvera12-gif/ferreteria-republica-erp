import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listEntidadesBancarias } from "@/lib/ventas/server/pago-detalle-pg";

/** GET /api/entidades-bancarias — entidades activas (Caja/Banco/Tarjeta/Billetera) para el cobro. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const entidades = await listEntidadesBancarias(schema, ctx.auth.empresa_id);
    return NextResponse.json(successResponse({ entidades }));
  } catch (err) {
    console.error("[/api/entidades-bancarias]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las entidades."), { status: 500 });
  }
}
