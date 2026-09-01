import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { listCompras, insertCompraConImpacto } from "@/lib/compras/server/compras-pg";

const PAGE_SIZE_DEFAULT = 50;

/** `?fecha=YYYY-MM-DD`; devuelve null si el formato no es valido. */
function fechaParam(sp: URLSearchParams, key: string): string | null {
  const raw = sp.get(key)?.trim();
  if (!raw) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/**
 * GET /api/compras — lista via PG directo, con busqueda, filtros y paginacion
 * resueltos en la base.
 *
 * Query: `q`, `tipo_pago` (contado|credito), `desde`, `hasta` (YYYY-MM-DD),
 * `page` (1-based), `page_size`.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const sp = request.nextUrl.searchParams;
    const tipoPagoRaw = sp.get("tipo_pago")?.trim();
    const pageRaw = parseInt(sp.get("page") ?? "1", 10);
    const pageSizeRaw = parseInt(sp.get("page_size") ?? String(PAGE_SIZE_DEFAULT), 10);

    const { rows, total, page, pageSize } = await listCompras(schema, ctx.auth.empresa_id, {
      q: sp.get("q"),
      tipoPago: tipoPagoRaw === "contado" || tipoPagoRaw === "credito" ? tipoPagoRaw : null,
      desde: fechaParam(sp, "desde"),
      hasta: fechaParam(sp, "hasta"),
      page: Number.isNaN(pageRaw) ? 1 : pageRaw,
      pageSize: Number.isNaN(pageSizeRaw) ? PAGE_SIZE_DEFAULT : pageSizeRaw,
    });

    return NextResponse.json(
      successResponse({ compras: rows, total, page, page_size: pageSize })
    );
  } catch (err) {
    console.error("[/api/compras GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las compras."), { status: 500 });
  }
}

/**
 * POST /api/compras — crea compra + movimiento ENTRADA + actualiza producto.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = await fetchDataSchemaForEmpresaId(empresaId);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const req = (k: string) => body[k] != null && String(body[k]).trim() !== "";

    if (!req("proveedor_id")) return NextResponse.json(errorResponse("Falta el proveedor."), { status: 400 });
    if (!req("producto_id")) return NextResponse.json(errorResponse("Falta el producto."), { status: 400 });
    if (!req("cantidad") || Number(body.cantidad) <= 0)
      return NextResponse.json(errorResponse("La cantidad debe ser mayor a 0."), { status: 400 });
    if (!req("costo_unitario") || Number(body.costo_unitario) <= 0)
      return NextResponse.json(errorResponse("El costo unitario debe ser mayor a 0."), { status: 400 });
    if (!req("precio_venta") || Number(body.precio_venta) <= 0)
      return NextResponse.json(errorResponse("El precio de venta debe ser mayor a 0."), { status: 400 });
    if (!req("nro_timbrado"))
      return NextResponse.json(errorResponse("Falta el N° de timbrado."), { status: 400 });

    try {
      const out = await insertCompraConImpacto(schema, empresaId, {
        proveedor_id: String(body.proveedor_id),
        proveedor_nombre: String(body.proveedor_nombre ?? ""),
        producto_id: String(body.producto_id),
        producto_nombre: String(body.producto_nombre ?? ""),
        cantidad: Number(body.cantidad) || 0,
        moneda: body.moneda === "USD" ? "USD" : "PYG",
        tipo_cambio: Number(body.tipo_cambio) || 1,
        costo_unitario_original: Number(body.costo_unitario_original) || Number(body.costo_unitario) || 0,
        costo_unitario: Number(body.costo_unitario) || 0,
        iva_tipo: ["0", "5", "10"].includes(String(body.iva_tipo)) ? String(body.iva_tipo) : "10",
        subtotal: Number(body.subtotal) || 0,
        monto_iva: Number(body.monto_iva) || 0,
        total: Number(body.total) || 0,
        precio_venta: Number(body.precio_venta) || 0,
        margen_venta: body.margen_venta != null ? Number(body.margen_venta) : null,
        tipo_pago: body.tipo_pago === "credito" ? "credito" : "contado",
        plazo_dias: body.plazo_dias != null && String(body.plazo_dias).trim() !== ""
          ? parseInt(String(body.plazo_dias), 10) || null : null,
        nro_timbrado: String(body.nro_timbrado).trim().toUpperCase(),
        created_by: ctx.auth.usuarioCatalogId ?? null,
        usuario_nombre: ctx.auth.user?.email ?? null,
      });

      return NextResponse.json(successResponse({
        compra: out.compra,
        movimiento_id: out.movimiento_id,
        warning: out.movimiento_warning,
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      const code = (e as { code?: string })?.code;
      const detail = (e as { detail?: string })?.detail;
      console.error("[/api/compras POST]", { schema, empresaId, msg, code, detail });
      if (code === "23503") {
        return NextResponse.json(
          errorResponse("Proveedor o producto inválido. Verificá los datos seleccionados."),
          { status: 400 }
        );
      }
      if (code === "23505") {
        return NextResponse.json(
          errorResponse("Conflicto al generar el número de control. Reintentá."),
          { status: 409 }
        );
      }
      return NextResponse.json(
        errorResponse("No se pudo guardar la compra. Revisá los datos e intentá nuevamente."),
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("[/api/compras POST] outer", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo guardar la compra."), { status: 500 });
  }
}
