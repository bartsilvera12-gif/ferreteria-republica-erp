import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { anularVenta, AnularVentaBloqueadaError } from "@/lib/ventas/server/anular-venta-pg";

/**
 * POST /api/ventas/[id]/anular
 * Anula la venta y revierte sus efectos en UNA transacción: reintegra stock
 * (movimientos inversos), saca la venta de la caja (estado 'anulada'), anula la
 * cuenta por cobrar si la venta era a crédito y no tiene cobros, y —si hay
 * factura autoimpresor— registra la reversa en nota_credito_autoimpresor.
 * La venta NO se borra: queda auditada.
 */
export async function POST(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctxParams.params;
    const auth = await getUserAndEmpresa(request);
    if (!auth?.empresa_id) {
      return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    }
    const body = (await request.json().catch(() => ({}))) as { motivo?: string };
    const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
    const resultado = await anularVenta(
      schema,
      auth.empresa_id,
      { id: auth.usuarioCatalogId ?? null, nombre: auth.nombre ?? auth.user?.email ?? null },
      id,
      typeof body.motivo === "string" ? body.motivo : null
    );
    return NextResponse.json(successResponse({ venta: resultado }));
  } catch (err) {
    if (err instanceof AnularVentaBloqueadaError) {
      return NextResponse.json(
        { success: false, error: err.message, motivo: err.motivo },
        { status: err.motivo === "venta_no_encontrada" ? 404 : 409 }
      );
    }
    const msg = err instanceof Error ? err.message : "No se pudo anular la venta.";
    console.error("[/api/ventas/[id]/anular POST]", msg);
    return NextResponse.json(errorResponse(msg), { status: 500 });
  }
}
