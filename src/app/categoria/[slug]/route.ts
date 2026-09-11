/**
 * GET /categoria/<slug>-<uuid>[?page=N]  (SOLO host del sitio público)
 *
 * HTML server-side indexable con H1, title, description, canonical y listado de
 * productos PAGINADO con enlaces <a> reales a cada ficha. No carga todos los
 * productos de la categoría de una sola vez. Aislado del ERP (Route Handler).
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSitioHost, SITIO_ORIGIN } from "@/app/_sitio/host";
import { parseSlugId, slugify } from "@/app/_sitio/slug";
import { getCategoriaPublica, getProductosDeCategoria } from "@/app/_sitio/producto-read";
import { renderCategoriaHtml, render404Html } from "@/app/_sitio/render-html";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

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
    return htmlResponse(render404Html("Esa categoría no existe."), 404);
  }

  let cat;
  try {
    cat = await getCategoriaPublica(parsed.id);
  } catch {
    return new NextResponse("Servicio temporalmente no disponible.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "120" },
    });
  }
  if (!cat) {
    return htmlResponse(render404Html("Esa categoría no existe o no está disponible."), 404);
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);

  // 301 si el slug textual cambió respecto del nombre actual (preserva ?page).
  const canonicalSlug = slugify(cat.nombre);
  if (parsed.slug !== canonicalSlug) {
    const qs = page > 1 ? `?page=${page}` : "";
    return NextResponse.redirect(
      `${SITIO_ORIGIN}/categoria/${canonicalSlug}-${cat.id}${qs}`,
      301
    );
  }

  let productos, total;
  try {
    ({ productos, total } = await getProductosDeCategoria(cat.id, {
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }));
  } catch {
    return new NextResponse("Servicio temporalmente no disponible.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "120" },
    });
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Página fuera de rango (y hay productos): 404 para no indexar páginas vacías.
  if (page > totalPages && total > 0) {
    return htmlResponse(render404Html("Esa página de la categoría no existe."), 404);
  }

  return htmlResponse(
    renderCategoriaHtml(cat, productos, { page, totalPages, total }),
    200,
    "public, s-maxage=600, stale-while-revalidate=300"
  );
}
