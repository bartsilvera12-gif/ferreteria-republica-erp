import { NextResponse, type NextRequest } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";

export const dynamic = "force-dynamic";

/**
 * GET /api/configuracion/ofertas-home
 *
 * Estado del banner "Ofertas de la semana" del home (admin):
 *  - countdownEnd: ISO | null
 *  - productos: lista de productos actualmente marcados como
 *    oferta_semana_destacada=true (max 3 logicos).
 *
 * Requiere sesion ERP.
 */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const sb = ctx.supabase;

  const [emp, prods] = await Promise.all([
    sb.from("empresas").select("ofertas_countdown_end").eq("id", empresaId).maybeSingle(),
    sb
      .from("productos")
      .select(
        "id, nombre, sku, precio_venta, discount_type, discount_value, discount_starts_at, discount_ends_at"
      )
      .eq("empresa_id", empresaId)
      .eq("oferta_semana_destacada", true)
      .order("nombre", { ascending: true }),
  ]);

  if (emp.error || prods.error) {
    return NextResponse.json(
      { error: emp.error?.message || prods.error?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    countdownEnd: emp.data?.ofertas_countdown_end ?? null,
    productos: prods.data ?? [],
  });
}

/**
 * PUT /api/configuracion/ofertas-home
 * body: { countdownEnd: ISO | null, productosIds: string[] (max 3) }
 *
 * Setea el countdown y marca EXACTAMENTE los productos indicados como
 * oferta_semana_destacada=true. Los no listados quedan en false.
 */
export async function PUT(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const empresaId = ctx.auth.empresa_id;
  const sb = ctx.supabase;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const countdownEnd =
    typeof body.countdownEnd === "string" && body.countdownEnd.trim()
      ? body.countdownEnd
      : null;
  const productosIdsRaw = Array.isArray(body.productosIds) ? body.productosIds : [];
  const productosIds = productosIdsRaw
    .filter((v: unknown): v is string => typeof v === "string" && v.length > 0)
    .slice(0, 3);

  // 1) Empresa: actualizar countdown
  const upEmp = await sb
    .from("empresas")
    .update({ ofertas_countdown_end: countdownEnd })
    .eq("id", empresaId);
  if (upEmp.error) {
    return NextResponse.json({ error: upEmp.error.message }, { status: 500 });
  }

  // 2) Productos: limpiar todos los marcados + setear los nuevos
  const clear = await sb
    .from("productos")
    .update({ oferta_semana_destacada: false })
    .eq("empresa_id", empresaId)
    .eq("oferta_semana_destacada", true);
  if (clear.error) {
    return NextResponse.json({ error: clear.error.message }, { status: 500 });
  }

  if (productosIds.length > 0) {
    const set = await sb
      .from("productos")
      .update({ oferta_semana_destacada: true })
      .eq("empresa_id", empresaId)
      .in("id", productosIds);
    if (set.error) {
      return NextResponse.json({ error: set.error.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    success: true,
    countdownEnd,
    productosIds,
  });
}
