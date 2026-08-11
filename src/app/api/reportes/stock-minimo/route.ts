import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * GET /api/reportes/stock-minimo — productos por debajo del stock mínimo.
 * Regla: entra al reporte si stock_actual < stock_minimo (con mínimo definido > 0).
 * Ej: mínimo 50 y stock 49 → entra. Ordena por mayor faltante primero.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(empresaId));
    const pool = getChatPostgresPool();
    if (!pool) throw new Error("Pool no disponible.");

    const tP = quoteSchemaTable(schema, "productos");
    const tCat = quoteSchemaTable(schema, "categorias_productos");
    const tProv = quoteSchemaTable(schema, "proveedores");

    const { rows } = await pool.query(
      `SELECT p.id::text AS id, p.nombre, p.sku, p.codigo_barras, p.marca, p.unidad_medida,
              p.stock_actual, p.stock_minimo,
              (p.stock_minimo - p.stock_actual) AS faltante,
              cat.nombre AS categoria_nombre,
              prov.nombre AS proveedor_nombre
         FROM ${tP} p
         LEFT JOIN ${tCat} cat ON cat.id = p.categoria_principal_id AND cat.empresa_id = p.empresa_id
         LEFT JOIN ${tProv} prov ON prov.id = p.proveedor_principal_id AND prov.empresa_id = p.empresa_id
        WHERE p.empresa_id = $1::uuid
          AND COALESCE(p.activo, true) = true
          AND COALESCE(p.controla_stock, true) = true
          AND COALESCE(p.stock_minimo, 0) > 0
          AND COALESCE(p.stock_actual, 0) < p.stock_minimo
        ORDER BY (p.stock_minimo - p.stock_actual) DESC, p.nombre ASC
        LIMIT 5000`,
      [empresaId]
    );

    const items = rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      nombre: String(r.nombre ?? ""),
      sku: (r.sku as string | null) ?? null,
      codigo_barras: (r.codigo_barras as string | null) ?? null,
      marca: (r.marca as string | null) ?? null,
      unidad_medida: (r.unidad_medida as string | null) ?? "UNIDAD",
      stock_actual: n(r.stock_actual),
      stock_minimo: n(r.stock_minimo),
      faltante: n(r.faltante),
      categoria_nombre: (r.categoria_nombre as string | null) ?? null,
      proveedor_nombre: (r.proveedor_nombre as string | null) ?? null,
    }));

    return NextResponse.json(successResponse({ items, total: items.length }));
  } catch (err) {
    console.error("[/api/reportes/stock-minimo]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo generar el reporte de stock mínimo."), { status: 500 });
  }
}
