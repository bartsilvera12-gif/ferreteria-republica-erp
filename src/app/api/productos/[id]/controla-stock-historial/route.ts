import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/** GET /api/productos/[id]/controla-stock-historial: bitácora de cambios de "Controla stock". */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const pool = getChatPostgresPool();
    if (!pool) throw new Error("Pool de base de datos no disponible.");
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id));
    const t = quoteSchemaTable(schema, "producto_controla_stock_historial");
    const r = await pool.query(
      `SELECT id, fecha, valor_anterior, valor_nuevo, usuario_nombre
         FROM ${t}
        WHERE empresa_id = $1::uuid AND producto_id = $2::uuid
        ORDER BY fecha DESC LIMIT 200`,
      [ctx.auth.empresa_id, id]
    );
    return NextResponse.json(successResponse({ historial: r.rows }));
  } catch (err) {
    console.error("[/api/productos/[id]/controla-stock-historial GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el historial."), { status: 500 });
  }
}
