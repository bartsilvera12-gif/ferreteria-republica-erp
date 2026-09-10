/**
 * Helpers server-side compartidos por los route handlers de galería:
 *  - resolveGaleriaCtx: auth + empresa + schema + ownership del producto.
 *  - toGaleriaDto: DTO que NO expone imagen_path (solo id/orden/es_principal +
 *    preview_url firmada temporal para admin, o la URL pública si es legacy).
 */
import { NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { signGaleriaPreview } from "@/lib/inventario/galeria-imagen-storage";
import type { GaleriaCtx } from "@/lib/inventario/galeria-service";
import type { GaleriaImagenRow } from "@/lib/inventario/server/galeria-pg";

export type ResolveResult = { ctx: GaleriaCtx; error?: undefined } | { ctx?: undefined; error: NextResponse };

export async function resolveGaleriaCtx(request: Request, productoId: string): Promise<ResolveResult> {
  const tenant = await getTenantSupabaseFromAuth(request);
  if (!tenant) return { error: NextResponse.json({ error: "No autorizado" }, { status: 401 }) };
  const empresaId = tenant.auth.empresa_id;
  const supabase = tenant.supabase;
  const { data: prod } = await supabase
    .from("productos")
    .select("id")
    .eq("empresa_id", empresaId)
    .eq("id", productoId)
    .maybeSingle();
  if (!prod) return { error: NextResponse.json({ error: "Producto no encontrado" }, { status: 404 }) };
  const schema = await fetchDataSchemaForEmpresaId(empresaId);
  return { ctx: { empresaId, schema, supabase } };
}

export type GaleriaImagenDto = {
  id: string;
  orden: number;
  es_principal: boolean;
  preview_url: string | null;
};

export async function toGaleriaDto(ctx: GaleriaCtx, row: GaleriaImagenRow): Promise<GaleriaImagenDto> {
  let preview_url: string | null = null;
  if (row.imagen_path) preview_url = await signGaleriaPreview(ctx.supabase, row.imagen_path, 3600);
  else if (row.imagen_url) preview_url = row.imagen_url;
  return { id: row.id, orden: row.orden, es_principal: row.es_principal, preview_url };
}
