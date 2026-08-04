import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getReporteVentasDetalle } from "@/lib/reportes/server/reporte-ventas-detalle-pg";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function parseFiltrosVentas(sp: URLSearchParams) {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
  const desde = RE_FECHA.test(sp.get("desde") ?? "") ? String(sp.get("desde")) : `${hoy.slice(0, 7)}-01`;
  const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? String(sp.get("hasta")) : hoy;
  const tipoRaw = (sp.get("tipo") ?? "").toUpperCase();
  const facRaw = (sp.get("facturada") ?? "").toLowerCase();
  const cobRaw = (sp.get("cobro") ?? "").toLowerCase();
  const RE_HORA = /^\d{1,2}:\d{2}$/;
  const hDesde = (sp.get("hora_desde") ?? "").trim();
  const hHasta = (sp.get("hora_hasta") ?? "").trim();
  return {
    desde, hasta,
    horaDesde: RE_HORA.test(hDesde) ? hDesde : null,
    horaHasta: RE_HORA.test(hHasta) ? hHasta : null,
    clienteId: sp.get("cliente_id")?.trim() || null,
    cajero: sp.get("cajero")?.trim() || null,
    vendedor: sp.get("vendedor")?.trim() || null,
    codigo: sp.get("codigo")?.trim() || null,
    tipo: (tipoRaw === "CONTADO" || tipoRaw === "CREDITO" ? tipoRaw : "") as "" | "CONTADO" | "CREDITO",
    facturada: (facRaw === "si" || facRaw === "no" ? facRaw : "") as "" | "si" | "no",
    cobro: (cobRaw === "cobrado" || cobRaw === "pendiente" ? cobRaw : "") as "" | "cobrado" | "pendiente",
    soloAnuladas: sp.get("solo_anuladas") === "1",
  };
}

/** GET /api/reportes/ventas-detalle — ventas filtradas (JSON). */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const filtros = parseFiltrosVentas(new URL(request.url).searchParams);
    const data = await getReporteVentasDetalle(schema, ctx.auth.empresa_id, filtros);
    return NextResponse.json(successResponse({ ...data, filtros }));
  } catch (err) {
    console.error("[/api/reportes/ventas-detalle]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el reporte de ventas."), { status: 500 });
  }
}
