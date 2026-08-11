import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
// Paraguay = UTC-3 fijo. En Postgres hay que usar el INTERVAL (el string '-03:00' invierte el signo).
const PY = "AT TIME ZONE INTERVAL '-3 hours'";

/**
 * GET /api/reportes/productos-vendidos
 *  - desde, hasta (YYYY-MM-DD, hora Asunción)
 *  - producto_id? / categoria_id?  (filtros opcionales)
 *  - modo = detallado | resumido
 * Detallado: cada venta de ese producto (fecha, factura, cajero, vendedor, cant, precio).
 * Resumido: unidades y total agrupados por producto.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(empresaId));
    const pool = getChatPostgresPool();
    if (!pool) throw new Error("Pool no disponible.");

    const sp = request.nextUrl.searchParams;
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? String(sp.get("desde")) : `${hoy.slice(0, 7)}-01`;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? String(sp.get("hasta")) : hoy;
    const productoId = RE_UUID.test(sp.get("producto_id") ?? "") ? String(sp.get("producto_id")) : null;
    const categoriaId = RE_UUID.test(sp.get("categoria_id") ?? "") ? String(sp.get("categoria_id")) : null;
    const modo = (sp.get("modo") ?? "resumido").toLowerCase() === "detallado" ? "detallado" : "resumido";

    const tVi = quoteSchemaTable(schema, "ventas_items");
    const tV = quoteSchemaTable(schema, "ventas");
    const tP = quoteSchemaTable(schema, "productos");
    const tCat = quoteSchemaTable(schema, "categorias_productos");
    const tFa = quoteSchemaTable(schema, "factura_autoimpresor");
    const tPc = quoteSchemaTable(schema, "pedidos_caja");
    const tU = quoteSchemaTable(schema, "usuarios");

    const args: unknown[] = [empresaId, desde, hasta];
    const cond: string[] = [];
    if (productoId) { args.push(productoId); cond.push(`vi.producto_id = $${args.length}::uuid`); }
    if (categoriaId) { args.push(categoriaId); cond.push(`p.categoria_principal_id = $${args.length}::uuid`); }
    const extra = cond.length ? ` AND ${cond.join(" AND ")}` : "";

    const baseFrom = `
      FROM ${tVi} vi
      JOIN ${tV} v ON v.id = vi.venta_id AND v.empresa_id = vi.empresa_id
      LEFT JOIN ${tP} p ON p.id = vi.producto_id AND p.empresa_id = vi.empresa_id
      LEFT JOIN ${tCat} cat ON cat.id = p.categoria_principal_id AND cat.empresa_id = p.empresa_id
      WHERE vi.empresa_id = $1::uuid
        AND (v.fecha ${PY})::date BETWEEN $2::date AND $3::date
        AND COALESCE(v.estado, '') <> 'anulada'
        ${extra}`;

    if (modo === "detallado") {
      const { rows } = await pool.query(
        `SELECT v.fecha, v.numero_control, v.usuario_nombre AS cajero,
                vi.producto_id::text AS producto_id, vi.producto_nombre, cat.nombre AS categoria_nombre,
                vi.cantidad, vi.precio_venta, vi.total_linea,
                (SELECT fa.numero_completo FROM ${tFa} fa WHERE fa.venta_id = v.id AND fa.empresa_id = v.empresa_id LIMIT 1) AS numero_factura,
                (SELECT COALESCE(NULLIF(TRIM(u2.nombre), ''), NULLIF(split_part(pc2.armado_por_email, '@', 1), ''))
                   FROM ${tPc} pc2 LEFT JOIN ${tU} u2 ON u2.email = pc2.armado_por_email
                  WHERE pc2.venta_id = v.id AND pc2.empresa_id = v.empresa_id
                  ORDER BY pc2.created_at ASC LIMIT 1) AS vendedor
         ${baseFrom}
         ORDER BY v.fecha DESC
         LIMIT 5000`,
        args
      );
      const items = rows.map((r: Record<string, unknown>) => ({
        fecha: String(r.fecha ?? ""),
        numero_control: String(r.numero_control ?? ""),
        numero_factura: (r.numero_factura as string | null) ?? null,
        cajero: (r.cajero as string | null) ?? null,
        vendedor: (r.vendedor as string | null) ?? null,
        producto_id: String(r.producto_id ?? ""),
        producto_nombre: String(r.producto_nombre ?? ""),
        categoria_nombre: (r.categoria_nombre as string | null) ?? null,
        cantidad: n(r.cantidad),
        precio_venta: n(r.precio_venta),
        total_linea: n(r.total_linea),
      }));
      return NextResponse.json(successResponse({ modo, desde, hasta, items }));
    }

    // Resumido: unidades + total por producto.
    const { rows } = await pool.query(
      `SELECT vi.producto_id::text AS producto_id, MAX(vi.producto_nombre) AS producto_nombre,
              MAX(cat.nombre) AS categoria_nombre,
              SUM(vi.cantidad) AS unidades, SUM(vi.total_linea) AS total,
              COUNT(DISTINCT v.id) AS ventas
       ${baseFrom}
       GROUP BY vi.producto_id
       ORDER BY SUM(vi.cantidad) DESC
       LIMIT 5000`,
      args
    );
    const items = rows.map((r: Record<string, unknown>) => ({
      producto_id: String(r.producto_id ?? ""),
      producto_nombre: String(r.producto_nombre ?? ""),
      categoria_nombre: (r.categoria_nombre as string | null) ?? null,
      unidades: n(r.unidades),
      total: n(r.total),
      ventas: n(r.ventas),
    }));
    const totalGeneral = items.reduce((s, i) => s + i.total, 0);
    const unidadesGeneral = items.reduce((s, i) => s + i.unidades, 0);
    return NextResponse.json(successResponse({ modo, desde, hasta, items, totalGeneral, unidadesGeneral }));
  } catch (err) {
    console.error("[/api/reportes/productos-vendidos]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el reporte de productos vendidos."), { status: 500 });
  }
}
