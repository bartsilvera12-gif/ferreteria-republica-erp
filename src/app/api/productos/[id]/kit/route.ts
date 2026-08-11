import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { getKit, saveKit, type KitComponenteInput } from "@/lib/inventario/server/kit-pg";

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/productos/[id]/kit — componentes del kit (receta activa) del producto. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!RE_UUID.test(id)) return NextResponse.json(errorResponse("Producto inválido."), { status: 400 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getKit(schema, ctx.auth.empresa_id, id);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    console.error("[/api/productos/[id]/kit GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo cargar el kit."), { status: 500 });
  }
}

/** PUT /api/productos/[id]/kit — define/actualiza componentes. Body: { componentes: [{producto_id, cantidad, unidad_medida}] }. */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const { id } = await params;
    if (!RE_UUID.test(id)) return NextResponse.json(errorResponse("Producto inválido."), { status: 400 });
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const raw = Array.isArray(body.componentes) ? (body.componentes as Record<string, unknown>[]) : [];
    const componentes: KitComponenteInput[] = raw.map((c) => ({
      producto_id: String(c.producto_id ?? ""),
      cantidad: Number(c.cantidad),
      unidad_medida: c.unidad_medida == null ? null : String(c.unidad_medida),
    }));

    const data = await saveKit(schema, ctx.auth.empresa_id, id, componentes, ctx.auth.usuarioCatalogId ?? null);
    return NextResponse.json(successResponse(data));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "No se pudo guardar el kit.";
    const status = /no encontrado/i.test(msg) ? 404 : 500;
    console.error("[/api/productos/[id]/kit PUT]", msg);
    return NextResponse.json(errorResponse(msg), { status });
  }
}
