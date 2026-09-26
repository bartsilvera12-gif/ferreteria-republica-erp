import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuthWithRol } from "@/lib/supabase/tenant-api";
import { esRolAdminEmpresaOGlobal } from "@/lib/auth/rol-empresa";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { ajustarCredito, CreditoOperacionError } from "@/lib/creditos/server/anticipos-pg";

/**
 * POST /api/clientes/[id]/saldo-favor/ajuste — ajuste o reverso del saldo a favor.
 * SOLO admin/administrador/super_admin. Nunca borra historial (agrega movimiento
 * 'ajuste' o 'reverso').
 * Body: { modo: 'ajuste' | 'reverso', monto?, movimiento_id?, motivo }
 */
export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuthWithRol(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    if (!esRolAdminEmpresaOGlobal(ctx.auth.rol)) {
      return NextResponse.json(errorResponse("Solo un administrador puede ajustar o anular el saldo a favor."), { status: 403 });
    }
    const { auth } = ctx;
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const usuario = { id: auth.user?.id ?? null, nombre: auth.nombre ?? auth.user?.email ?? null };

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const modo = body.modo === "reverso" ? "reverso" : "ajuste";
    const motivo = typeof body.motivo === "string" ? body.motivo : null;
    const monto = body.monto != null ? Number(body.monto) : undefined;
    const movimientoId = typeof body.movimiento_id === "string" ? body.movimiento_id : undefined;

    try {
      const out = await ajustarCredito(schema, auth.empresa_id, {
        clienteId: id, modo, monto, movimientoId, motivo, usuario,
      });
      return NextResponse.json(successResponse(out));
    } catch (e) {
      if (e instanceof CreditoOperacionError) return NextResponse.json(errorResponse(e.message), { status: e.status });
      const msg = e instanceof Error ? e.message : "No se pudo ajustar el saldo.";
      console.error("[saldo-favor/ajuste POST]", msg);
      return NextResponse.json(errorResponse(msg), { status: 500 });
    }
  } catch (err) {
    console.error("[saldo-favor/ajuste POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo ajustar el saldo."), { status: 500 });
  }
}
