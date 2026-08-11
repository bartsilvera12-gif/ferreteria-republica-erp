import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listCuentasPagar, type EstadoCuentaPagar } from "@/lib/proveedores/server/cuentas-pagar-pg";

const ESTADOS = new Set(["pendiente", "parcial", "vencida", "pagada", "todas"]);

/**
 * GET /api/proveedores/cuentas-pagar?proveedor=&estado=&solo_pendientes=1
 * Deudas a proveedores (compras a crédito) con saldo, vencimiento y estado.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = request.nextUrl.searchParams;
    const estadoRaw = (sp.get("estado") ?? "todas").toLowerCase();
    const estado = (ESTADOS.has(estadoRaw) ? estadoRaw : "todas") as EstadoCuentaPagar | "todas";

    const data = await listCuentasPagar(schema, ctx.auth.empresa_id, {
      proveedor: sp.get("proveedor") ?? undefined,
      estado,
      soloPendientes: sp.get("solo_pendientes") === "1",
    });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/proveedores/cuentas-pagar]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar cuentas por pagar."), { status: 500 });
  }
}
