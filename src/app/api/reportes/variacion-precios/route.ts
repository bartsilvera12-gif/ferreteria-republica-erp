import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PY = "AT TIME ZONE INTERVAL '-3 hours'"; // Paraguay UTC-3 fijo.
const n = (v: unknown): number => { const x = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/**
 * GET /api/reportes/variacion-precios — productos con variación de costo y/o
 * precio de venta entre recepciones de compra consecutivas (LAG sobre `compras`).
 * Filtros: desde, hasta (hora Asunción), proveedor (opcional). Muestra quién recibió.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(empresaId));
    const pool = getChatPostgresPool();
    if (!pool) throw new Error("Pool no disponible.");
    const tC = quoteSchemaTable(schema, "compras");

    const sp = request.nextUrl.searchParams;
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? String(sp.get("desde")) : `${hoy.slice(0, 7)}-01`;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? String(sp.get("hasta")) : hoy;
    const proveedor = (sp.get("proveedor") ?? "").trim();

    const args: unknown[] = [empresaId, desde, hasta];
    let provCond = "";
    if (proveedor) { args.push(`%${proveedor}%`); provCond = `AND s.proveedor_nombre ILIKE $${args.length}`; }

    // LAG sobre TODO el historial del producto; luego se filtra el rango pedido.
    const { rows } = await pool.query(
      `WITH s AS (
         SELECT producto_id, producto_nombre, fecha, numero_control, proveedor_nombre, usuario_nombre,
                costo_unitario AS costo_act,
                LAG(costo_unitario) OVER (PARTITION BY producto_id ORDER BY fecha, id) AS costo_ant,
                precio_venta AS precio_act,
                LAG(precio_venta) OVER (PARTITION BY producto_id ORDER BY fecha, id) AS precio_ant
           FROM ${tC}
          WHERE empresa_id = $1::uuid
       )
       SELECT * FROM s
        WHERE costo_ant IS NOT NULL
          AND (s.fecha ${PY})::date BETWEEN $2::date AND $3::date
          AND (costo_act <> costo_ant OR COALESCE(precio_act,0) <> COALESCE(precio_ant,0))
          ${provCond}
        ORDER BY s.fecha DESC
        LIMIT 5000`,
      args
    );

    const items = rows.map((r: Record<string, unknown>) => {
      const costoAnt = n(r.costo_ant), costoAct = n(r.costo_act);
      const precioAnt = n(r.precio_ant), precioAct = n(r.precio_act);
      return {
        producto_id: String(r.producto_id ?? ""),
        producto_nombre: String(r.producto_nombre ?? ""),
        fecha: String(r.fecha ?? ""),
        numero_control: String(r.numero_control ?? ""),
        proveedor_nombre: (r.proveedor_nombre as string | null) ?? "—",
        usuario_nombre: (r.usuario_nombre as string | null) ?? null,
        costo_ant: costoAnt, costo_act: costoAct,
        costo_var_monto: costoAct - costoAnt,
        costo_var_pct: costoAnt > 0 ? ((costoAct - costoAnt) / costoAnt) * 100 : null,
        precio_ant: precioAnt, precio_act: precioAct,
        precio_var_monto: precioAct - precioAnt,
        precio_var_pct: precioAnt > 0 ? ((precioAct - precioAnt) / precioAnt) * 100 : null,
      };
    });

    return NextResponse.json(successResponse({ desde, hasta, items }));
  } catch (err) {
    console.error("[/api/reportes/variacion-precios]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el reporte de variación de precios."), { status: 500 });
  }
}
