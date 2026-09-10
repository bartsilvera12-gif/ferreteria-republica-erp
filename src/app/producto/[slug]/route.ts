/**
 * GET /producto/<slug>-<uuid>  (SOLO host del sitio público)
 *
 * Devuelve HTML COMPLETO server-side, indexable sin JavaScript, con metadata +
 * JSON-LD Product. Aislado del ERP: al ser un Route Handler NO pasa por el Root
 * Layout (ThemeProvider/AuthGuard/AppShell). Si se invoca desde el host del ERP
 * responde 404.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSitioHost, SITIO_ORIGIN } from "@/app/_sitio/host";
import { parseSlugId, slugify } from "@/app/_sitio/slug";
import { getProductoPublico } from "@/app/_sitio/producto-read";
import { renderProductoHtml, render404Html } from "@/app/_sitio/render-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function htmlResponse(body: string, status: number, cache?: string) {
  return new NextResponse(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...(cache ? { "cache-control": cache } : {}),
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  if (!isSitioHost(request.headers.get("host"))) {
    return new NextResponse(null, { status: 404 });
  }

  const { slug } = await params;
  const parsed = parseSlugId(slug);
  if (!parsed) {
    return htmlResponse(render404Html("Ese producto no existe."), 404);
  }

  let producto;
  try {
    producto = await getProductoPublico(parsed.id);
  } catch {
    // Error de BD (no "no existe"): 503 reintentable, nunca 404.
    return new NextResponse("Servicio temporalmente no disponible.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "120" },
    });
  }
  if (!producto) {
    // No existe, es de otra empresa, o no es vendible/visible → 404 real.
    return htmlResponse(render404Html("Ese producto no existe o no está disponible."), 404);
  }

  // Si el slug textual ya no coincide con el nombre actual → 301 al canónico.
  const canonicalSlug = slugify(producto.nombre);
  if (parsed.slug !== canonicalSlug) {
    return NextResponse.redirect(
      `${SITIO_ORIGIN}/producto/${canonicalSlug}-${producto.id}`,
      301
    );
  }

  return htmlResponse(
    renderProductoHtml(producto),
    200,
    "public, s-maxage=600, stale-while-revalidate=300"
  );
}
