/**
 * Lecturas SOLO LECTURA para el sitio público. Reutiliza el mismo patrón que
 * `src/app/api/sitio/productos/route.ts`:
 *   - createServiceRoleClient (server-side; la key nunca llega al navegador)
 *   - filtros obligatorios: empresa correcta + es_vendible=true + visible_web=true
 *   - SELECT únicamente (sin INSERT/UPDATE/DELETE/RPC de escritura)
 *
 * El SELECT expone SOLO columnas públicas. Nunca costos, márgenes, proveedores,
 * stock_minimo, IDs de otras empresas, etc. `imagen_path` se lee pero jamás se
 * imprime en el HTML (se usa server-side para el proxy de imagen).
 */
import { createServiceRoleClient } from "@/lib/supabase/service-admin";

/** Empresa proveedora del sitio público (Ferretería República). */
export const SITIO_EMPRESA_ID =
  process.env.SITIO_EMPRESA_ID?.trim() || "75f4194a-a24a-4e9b-830e-4506f2d9b2a6";

export type ProductoPublico = {
  id: string;
  nombre: string;
  sku: string | null;
  descripcion: string | null;
  precio_venta: number | string | null;
  stock_actual: number | string | null;
  unidad_medida: string | null;
  codigo_barras: string | null;
  imagen_url: string | null;
  imagen_path: string | null; // server-side only — nunca al HTML
  categoria_principal_id: string | null;
  categoria: { id: string; nombre: string } | null;
  discount_type: string | null;
  discount_value: number | string | null;
  discount_starts_at: string | null;
  discount_ends_at: string | null;
  updated_at: string | null;
};

const PUBLIC_SELECT = `
  id, nombre, sku, descripcion, precio_venta, stock_actual, unidad_medida,
  codigo_barras, imagen_url, imagen_path, categoria_principal_id, updated_at,
  discount_type, discount_value, discount_starts_at, discount_ends_at,
  categoria:categoria_principal_id ( id, nombre )
`;

/** Producto público por id exacto. null si no existe o no pasa los filtros. */
export async function getProductoPublico(id: string): Promise<ProductoPublico | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("productos")
    .select(PUBLIC_SELECT)
    .eq("empresa_id", SITIO_EMPRESA_ID)
    .eq("es_vendible", true)
    .eq("visible_web", true)
    .eq("id", id)
    .maybeSingle();
  // Distinguir "no existe" (null -> 404) de "error de BD" (throw -> 5xx). Un
  // error transitorio NUNCA debe volverse 404 (desindexaría productos reales).
  if (error) throw new Error(`getProductoPublico: ${error.message}`);
  return (data as unknown as ProductoPublico) ?? null;
}

export type CategoriaPublica = {
  id: string;
  nombre: string;
  descripcion: string | null;
};

/** Categoría pública por id exacto (activa, de la empresa). null si no aplica. */
export async function getCategoriaPublica(id: string): Promise<CategoriaPublica | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("categorias_productos")
    .select("id, nombre, descripcion")
    .eq("empresa_id", SITIO_EMPRESA_ID)
    .eq("activo", true)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getCategoriaPublica: ${error.message}`);
  return (data as unknown as CategoriaPublica) ?? null;
}

/** Productos vendibles/visibles de una categoría, PAGINADO (no carga todo). */
export async function getProductosDeCategoria(
  categoriaId: string,
  opts: { limit: number; offset: number }
): Promise<{ productos: ProductoPublico[]; total: number }> {
  const supabase = createServiceRoleClient();
  const { data, error, count } = await supabase
    .from("productos")
    .select(PUBLIC_SELECT, { count: "exact" })
    .eq("empresa_id", SITIO_EMPRESA_ID)
    .eq("es_vendible", true)
    .eq("visible_web", true)
    .eq("categoria_principal_id", categoriaId)
    .order("nombre", { ascending: true })
    .range(opts.offset, opts.offset + opts.limit - 1);
  if (error) throw new Error(`getProductosDeCategoria: ${error.message}`);
  return { productos: (data ?? []) as unknown as ProductoPublico[], total: count ?? 0 };
}

/** Fila mínima para el sitemap (sin imágenes, sin datos sensibles). */
export type SitemapProductoRow = { id: string; nombre: string; updated_at: string | null };

/**
 * Itera TODOS los productos vendibles/visibles con paginación por CURSOR (keyset):
 * order by id asc + `id > lastId` + limit. Ventajas sobre offset/range:
 *  - orden determinístico y estable;
 *  - si el catálogo cambia mientras se genera el sitemap, no se omiten ni
 *    duplican productos por el corrimiento de offsets.
 * NO usa count:"planned". Solo lee id, nombre y updated_at.
 */
export async function* iterarProductosSitemap(
  batchSize = 1000
): AsyncGenerator<SitemapProductoRow> {
  const supabase = createServiceRoleClient();
  let lastId: string | null = null;
  for (;;) {
    let q = supabase
      .from("productos")
      .select("id, nombre, updated_at")
      .eq("empresa_id", SITIO_EMPRESA_ID)
      .eq("es_vendible", true)
      .eq("visible_web", true)
      .order("id", { ascending: true })
      .limit(batchSize);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    // Un error a mitad de la iteración debe abortar (5xx), no truncar en silencio
    // el sitemap dejando productos afuera.
    if (error) throw new Error(`iterarProductosSitemap: ${error.message}`);
    if (!data || data.length === 0) return;
    for (const row of data) yield row as SitemapProductoRow;
    if (data.length < batchSize) return;
    lastId = data[data.length - 1].id;
  }
}

export type SitemapCategoriaRow = { id: string; nombre: string };

/**
 * Categorías activas de la empresa con al menos 1 producto REALMENTE público
 * (empresa correcta + es_vendible=true + visible_web=true).
 *
 * Se usa `!inner` en el embed para que PostgREST haga un INNER JOIN: la categoría
 * solo aparece si tiene ≥1 producto que pasa los filtros, y el array embebido solo
 * contiene esos productos. El embed anida (no aplana), así que la categoría NO se
 * duplica aunque tenga varios productos que matcheen. El filtro JS `length > 0`
 * queda como defensa adicional. Antes el embed no filtraba, así que una categoría
 * con solo productos ocultos/no vendibles entraba al sitemap.
 */
export async function listarCategoriasSitemap(): Promise<SitemapCategoriaRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("categorias_productos")
    .select("id, nombre, productos:productos!categoria_principal_id!inner ( id )")
    .eq("empresa_id", SITIO_EMPRESA_ID)
    .eq("activo", true)
    .eq("productos.es_vendible", true)
    .eq("productos.visible_web", true)
    .order("nombre", { ascending: true });
  if (error) throw new Error(`listarCategoriasSitemap: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; nombre: string; productos?: unknown[] }>)
    .filter((c) => Array.isArray(c.productos) && c.productos.length > 0)
    .map((c) => ({ id: c.id, nombre: c.nombre }));
}
