import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";

/**
 * GET /api/productos/marcas
 *
 * Lista las marcas ya registradas (valores distintos de productos.marca de la
 * empresa), ordenadas alfabéticamente. Sirve para el desplegable de marca del
 * producto y para el filtro del listado de inventario.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });

    const { data, error } = await ctx.supabase
      .from("productos")
      .select("marca")
      .eq("empresa_id", ctx.auth.empresa_id)
      .not("marca", "is", null)
      .range(0, 99999);
    if (error) throw new Error(error.message);

    // Deduplicar sin distinguir mayúsculas/espacios; se conserva la primera grafía vista.
    const vistas = new Map<string, string>();
    for (const r of (data ?? []) as Array<{ marca: string | null }>) {
      const m = (r.marca ?? "").trim();
      if (!m) continue;
      const k = m.toLowerCase();
      if (!vistas.has(k)) vistas.set(k, m);
    }
    const marcas = [...vistas.values()].sort((a, b) => a.localeCompare(b, "es"));
    return NextResponse.json(successResponse({ marcas }));
  } catch (err) {
    console.error("[/api/productos/marcas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las marcas."), { status: 500 });
  }
}

/** Ids de los productos de la empresa que tienen esa marca (sin distinguir mayúsculas/espacios). */
async function idsConMarca(ctx: NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>>, marca: string) {
  const { data, error } = await ctx.supabase
    .from("productos")
    .select("id, marca")
    .eq("empresa_id", ctx.auth.empresa_id)
    .not("marca", "is", null)
    .range(0, 99999);
  if (error) throw new Error(error.message);
  const k = marca.trim().toLowerCase();
  return ((data ?? []) as Array<{ id: string; marca: string | null }>)
    .filter((r) => (r.marca ?? "").trim().toLowerCase() === k)
    .map((r) => r.id);
}

async function actualizarMarca(
  ctx: NonNullable<Awaited<ReturnType<typeof getTenantSupabaseFromAuth>>>,
  ids: string[],
  valor: string | null,
) {
  for (let i = 0; i < ids.length; i += 200) {
    const { error } = await ctx.supabase
      .from("productos")
      .update({ marca: valor })
      .eq("empresa_id", ctx.auth.empresa_id)
      .in("id", ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
}

/**
 * PATCH /api/productos/marcas  { actual, nuevo }
 * Renombra la marca en todos los productos que la usan (por ej. pasarla a MAYÚSCULAS).
 */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { actual?: string; nuevo?: string };
    const actual = (body.actual ?? "").trim();
    const nuevo = (body.nuevo ?? "").trim();
    if (!actual || !nuevo) {
      return NextResponse.json(errorResponse("Indicá la marca y el nombre nuevo."), { status: 400 });
    }
    const ids = await idsConMarca(ctx, actual);
    if (ids.length === 0) {
      return NextResponse.json(errorResponse("La marca no existe."), { status: 404 });
    }
    await actualizarMarca(ctx, ids, nuevo);
    return NextResponse.json(successResponse({ marca: nuevo, productos: ids.length }));
  } catch (err) {
    console.error("[/api/productos/marcas PATCH]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo editar la marca."), { status: 500 });
  }
}

/**
 * DELETE /api/productos/marcas  { marca, confirmar? }
 * Si la marca está en productos, sin "confirmar" no la quita: devuelve cuántos
 * productos la usan. Con "confirmar" deja esos productos sin marca (no se borran).
 */
export async function DELETE(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const body = (await request.json().catch(() => ({}))) as { marca?: string; confirmar?: boolean };
    const marca = (body.marca ?? "").trim();
    if (!marca) return NextResponse.json(errorResponse("Indicá la marca."), { status: 400 });
    const ids = await idsConMarca(ctx, marca);
    if (ids.length > 0 && !body.confirmar) {
      return NextResponse.json(successResponse({ requiereConfirmacion: true, productos: ids.length }));
    }
    await actualizarMarca(ctx, ids, null);
    return NextResponse.json(successResponse({ requiereConfirmacion: false, productos: ids.length }));
  } catch (err) {
    console.error("[/api/productos/marcas DELETE]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudo eliminar la marca."), { status: 500 });
  }
}
