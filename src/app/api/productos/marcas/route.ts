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
