import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { resolverImagenesPublicas } from "@/lib/inventario/imagen-storage";

export const dynamic = "force-dynamic";

/**
 * Empresa que provee el contenido del sitio. Mismo override que en
 * /api/sitio/productos.
 */
const SITIO_EMPRESA_ID =
  process.env.SITIO_EMPRESA_ID?.trim() || "75f4194a-a24a-4e9b-830e-4506f2d9b2a6";

/**
 * GET /api/sitio/ofertas-home
 *
 * Devuelve el contenido del banner "Ofertas de la semana" del home:
 *  - countdownEnd: ISO string | null
 *  - productos: hasta 3 productos marcados con oferta_semana_destacada=true
 *
 * Sin auth (sitio publico). Cache HTTP 2 min con SWR.
 */
export async function GET() {
  const supabase = createServiceRoleClient();

  const [emp, prods] = await Promise.all([
    supabase
      .from("empresas")
      .select("ofertas_countdown_end")
      .eq("id", SITIO_EMPRESA_ID)
      .maybeSingle(),
    supabase
      .from("productos")
      .select(
        `id, nombre, sku, precio_venta, imagen_url, imagen_path, descripcion,
         unidad_medida, stock_actual,
         discount_type, discount_value, discount_starts_at, discount_ends_at,
         categoria:categoria_principal_id ( id, nombre )`
      )
      .eq("empresa_id", SITIO_EMPRESA_ID)
      .eq("es_vendible", true)
      .eq("oferta_semana_destacada", true)
      .order("nombre", { ascending: true })
      .limit(3),
  ]);

  if (emp.error || prods.error) {
    return NextResponse.json(
      {
        error: "No se pudo cargar la configuracion de ofertas",
        details: emp.error?.message || prods.error?.message,
      },
      { status: 500 }
    );
  }

  // Firmar imagen_path (bucket privado) → imagen_url que lee el sitio.
  const productos = await resolverImagenesPublicas(
    supabase,
    (prods.data ?? []) as Array<{ imagen_url?: string | null; imagen_path?: string | null }>
  );

  return NextResponse.json(
    {
      countdownEnd: emp.data?.ofertas_countdown_end ?? null,
      productos,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=120, stale-while-revalidate=60",
      },
    }
  );
}
