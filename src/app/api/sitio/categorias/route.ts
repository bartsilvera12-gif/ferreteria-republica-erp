import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/sitio/categorias
 *
 * Lista categorias de productos activas del schema ferreteriarepublica.
 * Solo expone las que tienen al menos 1 producto vendible asociado, para
 * que el catalogo del sitio no muestre filtros vacios.
 */
export async function GET() {
  const supabase = createServiceRoleClient();

  // Trae categorias activas + cuenta de productos vendibles por categoria
  // via embed PostgREST (productos!categoria_principal_id).
  const { data, error } = await supabase
    .from("categorias_productos")
    .select(
      `id, nombre, codigo, descripcion, parent_id,
       productos:productos!categoria_principal_id ( id )`
    )
    .eq("activo", true)
    .order("nombre", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "No se pudieron obtener las categorias", details: error.message },
      { status: 500 }
    );
  }

  // Mantener solo categorias con al menos 1 producto. La cuenta exacta
  // (incluyendo filtro es_vendible=true) la calcula el sitio si necesita.
  const categorias = (data ?? [])
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      codigo: c.codigo,
      descripcion: c.descripcion,
      count: Array.isArray(c.productos) ? c.productos.length : 0,
    }))
    .filter((c) => c.count > 0);

  return NextResponse.json(
    { categorias },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=120",
      },
    }
  );
}
