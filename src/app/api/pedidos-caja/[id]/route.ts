import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { mapPedidoCaja, PEDIDO_CAJA_COLS } from "@/lib/pedidos-caja/server";

/**
 * GET /api/pedidos-caja/[id]
 *   Devuelve un pedido por id. Se usa al precargar /ventas/nueva?pedido_id=X.
 *
 * DELETE /api/pedidos-caja/[id]?motivo=...
 *   Marca como cancelado (no borra fisico).
 */
export async function GET(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const q = await ctx.supabase
      .from("pedidos_caja")
      .select(PEDIDO_CAJA_COLS)
      .eq("empresa_id", ctx.auth.empresa_id)
      .eq("id", id)
      .maybeSingle();
    if (q.error) return NextResponse.json(errorResponse(q.error.message), { status: 400 });
    if (!q.data) return NextResponse.json(errorResponse("Pedido no encontrado."), { status: 404 });

    return NextResponse.json(
      successResponse({ pedido: mapPedidoCaja((q.data as unknown) as Record<string, unknown>) })
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cargar el pedido.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  ctxParams: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctxParams.params;
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { supabase: sb, auth } = ctx;

    const url = new URL(request.url);
    const motivo = (url.searchParams.get("motivo") ?? "").trim().slice(0, 500) || null;

    const upd = await sb
      .from("pedidos_caja")
      .update({
        estado: "cancelado",
        cancelado_por_id: auth.usuarioCatalogId ?? null,
        cancelado_motivo: motivo,
        cancelado_at: new Date().toISOString(),
      })
      .eq("empresa_id", auth.empresa_id)
      .eq("id", id)
      .eq("estado", "pendiente");
    if (upd.error) return NextResponse.json(errorResponse(upd.error.message), { status: 400 });

    return NextResponse.json(successResponse({ ok: true }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo cancelar el pedido.";
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
