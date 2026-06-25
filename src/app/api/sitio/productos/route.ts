import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * GET /api/sitio/productos
 *
 * Lista productos vendibles del schema ferreteriarepublica. Pensado para
 * consumirse desde el sitio publico (mismo dominio, sin auth).
 *
 * Query params (todos opcionales):
 *  - categoria=<uuid>  Filtra por categoria_principal_id
 *  - q=<text>          Busqueda case-insensitive en nombre
 *  - limit, offset     Paginacion
 *
 * Cada producto incluye `categoria` con { id, nombre } via embed PostgREST
 * usando la FK productos.categoria_principal_id -> categorias_productos.id.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const limitParam = Number(searchParams.get("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  const offsetParam = Number(searchParams.get("offset"));
  const offset = Number.isFinite(offsetParam) && offsetParam > 0 ? offsetParam : 0;

  const categoria = searchParams.get("categoria");
  const search = searchParams.get("q")?.trim();

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("productos")
    .select(
      `id, nombre, sku, precio_venta, imagen_url, descripcion,
       unidad_medida, stock_actual, categoria_principal_id,
       categoria:categoria_principal_id ( id, nombre )`,
      { count: "exact" }
    )
    .eq("es_vendible", true)
    .order("nombre", { ascending: true })
    .range(offset, offset + limit - 1);

  if (categoria) {
    query = query.eq("categoria_principal_id", categoria);
  }
  if (search) {
    query = query.ilike("nombre", `%${search}%`);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: "No se pudieron obtener los productos", details: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      productos: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60",
      },
    }
  );
}
