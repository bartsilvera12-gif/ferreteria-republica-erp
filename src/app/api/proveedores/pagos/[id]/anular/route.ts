import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularPagoProveedor } from "@/lib/proveedores/server/cuentas-pagar-pg";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** POST /api/proveedores/pagos/[id]/anular — baja reversible del pago (y su egreso de caja). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const { id } = await params;
    if (!RE_UUID.test(id)) return NextResponse.json(errorResponse("Pago inválido."), { status: 400 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const motivo = body.motivo == null || String(body.motivo).trim() === "" ? null : String(body.motivo).slice(0, 300);

    const ok = await anularPagoProveedor(schema, ctx.auth.empresa_id, id, ctx.auth.usuarioCatalogId ?? null, motivo);
    if (!ok) return NextResponse.json(errorResponse("El pago no existe o ya estaba anulado."), { status: 409 });
    return NextResponse.json(successResponse({ anulado: true }));
  } catch (err) {
    console.error("[/api/proveedores/pagos/anular]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo anular el pago."), { status: 500 });
  }
}
