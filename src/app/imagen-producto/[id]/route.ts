/**
 * GET /imagen-producto/<uuid>  (SOLO host del sitio público)
 *
 * URL PÚBLICA ESTABLE para la imagen del producto (canonical/OG/JSON-LD). El ERP
 * guarda la imagen en un bucket PRIVADO (imagen_path) y las signed URLs vencen;
 * por eso proxeamos los bytes server-side y entregamos una URL estable para
 * Google. No expone imagen_path, ni signed URLs, ni la service role key.
 *
 * Seguridad: valida hostname del sitio, resuelve el producto por UUID y exige
 * empresa correcta + es_vendible=true + visible_web=true (vía getProductoPublico).
 * 404 si el producto no corresponde o no tiene imagen.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSitioHost } from "@/app/_sitio/host";
import { isUuid } from "@/app/_sitio/slug";
import { getProductoPublico } from "@/app/_sitio/producto-read";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { PRODUCTOS_IMAGENES_BUCKET } from "@/lib/inventario/imagen-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMG_CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";

function typeFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSitioHost(request.headers.get("host"))) {
    return new NextResponse(null, { status: 404 });
  }

  const { id } = await params;
  if (!isUuid(id)) return new NextResponse(null, { status: 404 });

  let producto;
  try {
    producto = await getProductoPublico(id);
  } catch {
    // Error de BD (no "no existe"): 5xx reintentable, nunca 404.
    return new NextResponse(null, { status: 503, headers: { "retry-after": "120" } });
  }
  if (!producto) return new NextResponse(null, { status: 404 });

  // Imagen en bucket privado → descargar server-side y stream de los bytes.
  if (producto.imagen_path) {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.storage
      .from(PRODUCTOS_IMAGENES_BUCKET)
      .download(producto.imagen_path);
    if (error || !data) return new NextResponse(null, { status: 404 });
    const buf = Buffer.from(await data.arrayBuffer());
    const contentType = data.type || typeFromPath(producto.imagen_path);
    return new NextResponse(buf, {
      status: 200,
      headers: { "content-type": contentType, "cache-control": IMG_CACHE },
    });
  }

  // Imagen con imagen_url pública: NO hacemos fetch server-side (evitar SSRF
  // hacia URLs internas: http://169.254.169.254, http://localhost, 10.x, etc.).
  // Validamos que sea HTTPS y REDIRIGIMOS; el cliente/Googlebot la resuelve
  // directo. El servidor nunca hace la request, así que no hay superficie de
  // SSRF ni de DNS rebinding. La URL SEO estable sigue siendo
  // /imagen-producto/<uuid>. imagen_url pública se asume estable (no signed);
  // el cache del redirect es moderado (1h).
  if (producto.imagen_url && /^https:\/\//i.test(producto.imagen_url)) {
    return new NextResponse(null, {
      status: 302,
      headers: {
        location: producto.imagen_url,
        "cache-control": "public, s-maxage=3600",
      },
    });
  }

  return new NextResponse(null, { status: 404 });
}
