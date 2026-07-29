import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getReporteFacturas } from "@/lib/reportes/server/reporte-facturas-pg";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Rango por defecto: primer día del mes actual → hoy (hora Asunción). */
function rangoDefault(): { desde: string; hasta: string } {
  // Fecha en Asunción sin depender de Date.now del server tz.
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
  const desde = `${hoy.slice(0, 7)}-01`;
  return { desde, hasta: hoy };
}

/** GET /api/reportes/facturas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&cliente_id=UUID */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = new URL(request.url).searchParams;
    const def = rangoDefault();
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? String(sp.get("desde")) : def.desde;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? String(sp.get("hasta")) : def.hasta;
    const clienteId = sp.get("cliente_id")?.trim() || null;

    const data = await getReporteFacturas(schema, ctx.auth.empresa_id, { desde, hasta, clienteId });
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/reportes/facturas]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de facturas."), { status: 500 });
  }
}
