/**
 * GET /google-merchant.xml  (SOLO host del sitio público)
 *
 * Feed RSS 2.0 (namespace g:) para Google Merchant Center / Shopping. Contiene
 * los productos vendibles/visibles con imagen y precio > 0. Reutiliza los mismos
 * datos, precio (precioEfectivo) e imágenes estables (galeriaImagenesUrls) que la
 * ficha pública, para que el feed coincida con la landing (requisito de Google).
 *
 * Solo lectura. No toca ERP ni base de datos (no escribe).
 */
import { NextResponse, type NextRequest } from "next/server";
import { isSitioHost } from "@/app/_sitio/host";
import { SITIO_EMPRESA_ID } from "@/app/_sitio/producto-read";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { galeriaImagenesUrls } from "@/app/_sitio/render-html";
import { iterarProductosMerchant, getGaleriaBulk } from "@/app/_sitio/merchant-read";
import { resolveMerchantItem, renderItemXml, renderFeedXml } from "@/app/_sitio/merchant-feed";
import type { GaleriaImagenRow } from "@/lib/inventario/server/galeria-pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSitioHost(request.headers.get("host"))) {
    return new NextResponse(null, { status: 404 });
  }

  const schema = await fetchDataSchemaForEmpresaId(SITIO_EMPRESA_ID);
  const items: string[] = [];

  for await (const batch of iterarProductosMerchant()) {
    const ids = batch.map((p) => p.id);
    // Galería secundaria en bulk (1 query/lote). Si el pool no está disponible,
    // se degrada a solo imagen principal (galeriaImagenesUrls cae a imagenEstable).
    let galeriaMap = new Map<string, GaleriaImagenRow[]>();
    try {
      galeriaMap = await getGaleriaBulk(schema, SITIO_EMPRESA_ID, ids);
    } catch (e) {
      console.error("[google-merchant] galería bulk no disponible:", e instanceof Error ? e.message : e);
    }
    for (const p of batch) {
      const urls = galeriaImagenesUrls(p, galeriaMap.get(p.id));
      const item = resolveMerchantItem(p, urls, p.categoria?.nombre ?? null);
      if (item) items.push(renderItemXml(item));
    }
  }

  return new NextResponse(renderFeedXml(items), {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=UTF-8",
      // Feed relativamente estable; Merchant lo re-descarga programado.
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
