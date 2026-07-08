import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { resolverImagenesPublicas } from "@/lib/inventario/imagen-storage";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Empresa que provee los productos del sitio publico.
 * Default: Ferreteria Republica (creada al setup). Override via env por si en
 * el futuro se cambia.
 */
const SITIO_EMPRESA_ID =
  process.env.SITIO_EMPRESA_ID?.trim() || "75f4194a-a24a-4e9b-830e-4506f2d9b2a6";

/**
 * GET /api/sitio/productos
 *
 * Lista productos vendibles del schema ferreteriarepublica. Pensado para
 * consumirse desde el sitio publico (mismo dominio, sin auth).
 *
 * Query params (todos opcionales):
 *  - categoria=<uuid>  Filtra por categoria_principal_id
 *  - q=<text>          Busqueda case-insensitive en nombre
 *  - destacado=1       Solo productos marcados como destacados (home)
 *  - en_oferta=1       Solo productos con descuento activo AHORA (sitio filtra)
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
  const destacado = ["1", "true", "yes"].includes(
    (searchParams.get("destacado") ?? "").toLowerCase()
  );
  const enOferta = ["1", "true", "yes"].includes(
    (searchParams.get("en_oferta") ?? "").toLowerCase()
  );

  const supabase = createServiceRoleClient();

  let query = supabase
    .from("productos")
    .select(
      `id, nombre, sku, precio_venta, imagen_url, imagen_path, descripcion,
       unidad_medida, stock_actual, categoria_principal_id, destacado,
       discount_type, discount_value, discount_starts_at, discount_ends_at,
       categoria:categoria_principal_id ( id, nombre )`,
      // "planned" usa estadisticas de pg_stats en vez de COUNT(*) exacto.
      // Es 50-100x mas rapido sobre tablas grandes (16k+ rows) y suficientemente
      // preciso para mostrar "Mostrando 1-25 de ~16.869". Con count: "exact"
      // el TTFB del endpoint era ~1.6s, con "planned" baja a <200ms.
      { count: "planned" }
    )
    .eq("empresa_id", SITIO_EMPRESA_ID)
    .eq("es_vendible", true)
    .order("nombre", { ascending: true })
    .range(offset, offset + limit - 1);

  if (categoria) {
    query = query.eq("categoria_principal_id", categoria);
  }
  if (search) {
    query = query.ilike("nombre", `%${search}%`);
  }
  if (destacado) {
    query = query.eq("destacado", true);
  }
  if (enOferta) {
    // Pre-filtro server-side: tiene tipo y valor > 0. La ventana temporal
    // se valida client-side con isDiscountWindowActive() (los timestamps
    // dependen del reloj del cliente).
    query = query
      .not("discount_type", "is", null)
      .gt("discount_value", 0);
  }

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: "No se pudieron obtener los productos", details: error.message },
      { status: 500 }
    );
  }

  // El ERP guarda la imagen en imagen_path (bucket privado) con imagen_url en
  // null. Firmamos el path y lo devolvemos como imagen_url, que es lo que lee el
  // sitio. Sin esto, la imagen cargada nunca se refleja en la web.
  const productos = await resolverImagenesPublicas(
    supabase,
    (data ?? []) as Array<{ imagen_url?: string | null; imagen_path?: string | null }>
  );

  return NextResponse.json(
    {
      productos,
      total: count ?? 0,
      limit,
      offset,
    },
    {
      headers: {
        // Cache 5 min en CDN/proxy + 60s stale while revalidate.
        // El conteo "planned" no cambia constantemente; ok cachear.
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    }
  );
}
