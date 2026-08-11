import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const n = (v: unknown): number => { const x = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/**
 * GET /api/compras/ultimo-precio?ids=uuid,uuid,...  (máx 200)
 *
 * Para el control de precios en recepción de compras: devuelve, por producto, el
 * costo y el precio de venta de la ÚLTIMA compra recibida (la más reciente), para
 * poder comparar contra lo que se está cargando ahora. Usa DISTINCT ON sobre
 * `compras`. Solo lectura, sin efectos.
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

    const ids = (request.nextUrl.searchParams.get("ids") ?? "")
      .split(",").map((s) => s.trim()).filter((s) => RE_UUID.test(s));
    const unicos = Array.from(new Set(ids)).slice(0, 200);
    if (unicos.length === 0) return NextResponse.json(successResponse({ items: {} }));

    const { rows } = await pool.query(
      `SELECT DISTINCT ON (producto_id)
              producto_id, costo_unitario, precio_venta, fecha, numero_factura, proveedor_nombre
         FROM ${tC}
        WHERE empresa_id = $1::uuid AND producto_id = ANY($2::uuid[])
        ORDER BY producto_id, fecha DESC, id DESC`,
      [empresaId, unicos]
    );

    const items: Record<string, { costo: number; precio_venta: number; fecha: string; numero_factura: string | null; proveedor_nombre: string | null }> = {};
    for (const r of rows as Record<string, unknown>[]) {
      const pid = String(r.producto_id ?? "");
      if (!pid) continue;
      items[pid] = {
        costo: n(r.costo_unitario),
        precio_venta: n(r.precio_venta),
        fecha: String(r.fecha ?? ""),
        numero_factura: (r.numero_factura as string | null) ?? null,
        proveedor_nombre: (r.proveedor_nombre as string | null) ?? null,
      };
    }

    return NextResponse.json(successResponse({ items }));
  } catch (err) {
    console.error("[/api/compras/ultimo-precio]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo obtener el último precio de compra."), { status: 500 });
  }
}
