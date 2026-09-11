/**
 * Lectura SOLO LECTURA para el feed de Google Merchant Center.
 *
 * Reutiliza el patrón del sitio público (createServiceRoleClient + filtros
 * empresa/es_vendible/visible_web) y agrega los campos que el feed necesita
 * (marca, codigo_barras_interno, controla_stock). Filtra a productos con imagen
 * y precio > 0 (requisitos de Merchant). Pagina por CURSOR (keyset) igual que el
 * sitemap. La galería secundaria se trae en BULK (una query por lote), sin N+1.
 *
 * No toca ERP ni escribe nada.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { GaleriaImagenRow } from "@/lib/inventario/server/galeria-pg";
import { SITIO_EMPRESA_ID } from "./producto-read";
import type { ProductoMerchant } from "./merchant-feed";

const MERCHANT_SELECT = `
  id, nombre, sku, descripcion, precio_venta, stock_actual, unidad_medida,
  codigo_barras, imagen_url, imagen_path, categoria_principal_id, updated_at,
  discount_type, discount_value, discount_starts_at, discount_ends_at,
  marca, codigo_barras_interno, controla_stock,
  categoria:categoria_principal_id ( id, nombre )
`;

/**
 * Itera los productos aptos para el feed, en LOTES (para poder traer la galería
 * en bulk por lote). Filtros: empresa + es_vendible + visible_web + con imagen
 * (imagen_path o imagen_url) + precio_venta > 0. Cursor keyset por id.
 */
export async function* iterarProductosMerchant(
  batchSize = 500
): AsyncGenerator<ProductoMerchant[]> {
  const supabase = createServiceRoleClient();
  let lastId: string | null = null;
  for (;;) {
    let q = supabase
      .from("productos")
      .select(MERCHANT_SELECT)
      .eq("empresa_id", SITIO_EMPRESA_ID)
      .eq("es_vendible", true)
      .eq("visible_web", true)
      .or("imagen_path.not.is.null,imagen_url.not.is.null")
      .gt("precio_venta", 0)
      .order("id", { ascending: true })
      .limit(batchSize);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) throw new Error(`iterarProductosMerchant: ${error.message}`);
    if (!data || data.length === 0) return;
    yield data as unknown as ProductoMerchant[];
    if (data.length < batchSize) return;
    lastId = (data[data.length - 1] as unknown as { id: string }).id;
  }
}

/**
 * Trae en UNA sola query todas las imágenes de galería de un conjunto de
 * productos (principal primero), agrupadas por producto_id. Usa el pg Pool (rol
 * postgres), igual que el resto de la galería. Si el pool no está disponible,
 * lanza — el caller degrada a solo imagen principal (imagenEstable).
 */
export async function getGaleriaBulk(
  schemaRaw: string,
  empresaId: string,
  productoIds: string[]
): Promise<Map<string, GaleriaImagenRow[]>> {
  const map = new Map<string, GaleriaImagenRow[]>();
  if (productoIds.length === 0) return map;
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool de Postgres no disponible.");
  const t = quoteSchemaTable(schema, "producto_imagenes");
  const { rows } = await pool.query(
    `SELECT producto_id, id, imagen_path, imagen_url, orden, es_principal FROM ${t}
      WHERE empresa_id=$1::uuid AND producto_id = ANY($2::uuid[])
      ORDER BY es_principal DESC, orden ASC, id ASC`,
    [empresaId, productoIds]
  );
  for (const r of rows as Array<GaleriaImagenRow & { producto_id: string }>) {
    const arr = map.get(r.producto_id) ?? [];
    arr.push({
      id: r.id,
      imagen_path: r.imagen_path,
      imagen_url: r.imagen_url,
      orden: r.orden,
      es_principal: r.es_principal,
    });
    map.set(r.producto_id, arr);
  }
  return map;
}
