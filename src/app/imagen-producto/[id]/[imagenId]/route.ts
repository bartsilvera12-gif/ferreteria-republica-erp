/**
 * GET /imagen-producto/<producto-id>/<imagen-id>  (SOLO host del sitio público)
 *
 * URL pública ESTABLE para una imagen específica de la galería. Valida:
 * host público + producto (empresa + es_vendible + visible_web, vía
 * getProductoPublico) + que la imagen pertenece al producto/empresa.
 *
 * SSRF-safe (igual que FASE 2): imagen_path privado → download server-side;
 * imagen_url pública HTTPS → redirect (sin fetch server-side arbitrario).
 * Nunca expone imagen_path ni la service role.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSitioHost } from "@/app/_sitio/host";
import { isUuid } from "@/app/_sitio/slug";
import { getProductoPublico, SITIO_EMPRESA_ID } from "@/app/_sitio/producto-read";
import { getGaleriaImagenPg } from "@/lib/inventario/server/galeria-pg";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { downloadGaleriaObjeto } from "@/lib/inventario/galeria-imagen-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMG_CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; imagenId: string }> }
) {
  if (!isSitioHost(request.headers.get("host"))) {
    return new NextResponse(null, { status: 404 });
  }
  const { id: productoId, imagenId } = await params;
  if (!isUuid(productoId) || !isUuid(imagenId)) {
    return new NextResponse(null, { status: 404 });
  }

  // El producto debe ser público (empresa + vendible + visible).
  let producto;
  try {
    producto = await getProductoPublico(productoId);
  } catch {
    return new NextResponse(null, { status: 503, headers: { "retry-after": "120" } });
  }
  if (!producto) return new NextResponse(null, { status: 404 });

  // La imagen debe pertenecer al producto/empresa.
  let row;
  try {
    const schema = await fetchDataSchemaForEmpresaId(SITIO_EMPRESA_ID);
    row = await getGaleriaImagenPg(schema, SITIO_EMPRESA_ID, productoId, imagenId);
  } catch {
    return new NextResponse(null, { status: 503, headers: { "retry-after": "120" } });
  }
  if (!row) return new NextResponse(null, { status: 404 });

  if (row.imagen_path) {
    const supabase = createServiceRoleClient();
    const obj = await downloadGaleriaObjeto(supabase, row.imagen_path);
    if (!obj) return new NextResponse(null, { status: 404 });
    return new NextResponse(obj.buffer as unknown as BodyInit, {
      status: 200,
      headers: { "content-type": obj.contentType, "cache-control": IMG_CACHE },
    });
  }
  if (row.imagen_url && /^https:\/\//i.test(row.imagen_url)) {
    return new NextResponse(null, {
      status: 302,
      headers: { location: row.imagen_url, "cache-control": "public, s-maxage=3600" },
    });
  }
  return new NextResponse(null, { status: 404 });
}
