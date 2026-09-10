/**
 * GET /sitemap-productos.xml  (SOLO host del sitio público)
 *
 * UN SOLO <urlset> dinámico con TODOS los productos vendibles/visibles. Estamos
 * por debajo del límite estándar (50.000 URLs / 50 MB), así que no usamos shards.
 * Internamente pagina por lotes (para no chocar con límites de PostgREST) y NO
 * usa count:"planned" (que podría dejar productos afuera): itera hasta que un
 * lote vuelve incompleto. Solo lee id, nombre y updated_at (lastmod real).
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSitioHost, SITIO_ORIGIN } from "@/app/_sitio/host";
import { productoPath } from "@/app/_sitio/slug";
import { iterarProductosSitemap } from "@/app/_sitio/producto-read";

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

  const parts: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];

  for await (const row of iterarProductosSitemap()) {
    // loc: SIEMPRE absoluta https, sin query strings, escapada para XML.
    const loc = `${SITIO_ORIGIN}${productoPath(row.nombre, row.id)}`;
    // lastmod: solo si updated_at es una fecha válida YYYY-MM-DD; si es null o
    // inválida se OMITE (no se inventa fecha).
    const raw = row.updated_at ? String(row.updated_at).slice(0, 10) : "";
    const lastmod = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    parts.push(
      `<url><loc>${xmlEsc(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`
    );
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
