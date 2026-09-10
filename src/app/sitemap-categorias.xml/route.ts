/**
 * GET /sitemap-categorias.xml  (SOLO host del sitio público)
 *
 * <urlset> con las categorías activas que tienen al menos 1 producto
 * vendible/visible. No incluye rutas privadas del ERP.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSitioHost, SITIO_ORIGIN } from "@/app/_sitio/host";
import { categoriaPath } from "@/app/_sitio/slug";
import { listarCategoriasSitemap } from "@/app/_sitio/producto-read";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(request: NextRequest) {
  if (!isSitioHost(request.headers.get("host"))) {
    return new NextResponse(null, { status: 404 });
  }

  const categorias = await listarCategoriasSitemap();
  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const c of categorias) {
    const loc = `${SITIO_ORIGIN}${categoriaPath(c.nombre, c.id)}`;
    parts.push(`<url><loc>${xmlEsc(loc)}</loc></url>`);
  }
  parts.push("</urlset>");

  return new NextResponse(parts.join("\n"), {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=UTF-8",
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
