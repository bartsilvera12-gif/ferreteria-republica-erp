/**
 * Construcción PURA del body de creación de producto (POST /api/productos).
 *
 * Extraído de `saveProducto` para poder testear el PAYLOAD real sin red.
 *
 * FIX legacy (descripcion / descripcion_html):
 *   `descripcion_html` se agrega al body SOLO si el caller lo proporcionó
 *   explícitamente (`!== undefined`). Un caller legacy que solo manda
 *   `descripcion` NO debe emitir `descripcion_html: null`, porque el backend
 *   (`resolveDescripcionFields`) prioriza la presencia de `descripcion_html`
 *   (regla A) y terminaría borrando la descripción legacy.
 *
 *   - A) descripcion_html presente (string o null) → se incluye; el backend
 *        sanitiza/deriva (o limpia ambos si es null/"").
 *   - B) solo descripcion               → se incluye descripcion, se OMITE
 *        descripcion_html → backend guarda descripcion y pone html=NULL.
 *   - C) ninguno relevante              → alta sin descripción (descripcion=null).
 */
import type { Producto } from "./types";

/** Igual que `NuevoProductoData` pero con las descripciones OPCIONALES, para
 * distinguir `undefined` (no enviado) de `null` (enviado explícitamente). */
export type CrearProductoInput = Omit<Producto, "id" | "descripcion" | "descripcion_html"> & {
  descripcion?: string | null;
  descripcion_html?: string | null;
};

export function buildCreateProductoBody(datos: CrearProductoInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    nombre: datos.nombre,
    sku: datos.sku,
    costo_promedio: datos.costo_promedio,
    precio_venta: datos.precio_venta,
    precio_mayorista: datos.precio_mayorista ?? null,
    cantidad_minima_mayorista: datos.cantidad_minima_mayorista ?? null,
    precio_distribuidor: datos.precio_distribuidor ?? null,
    stock_actual: datos.stock_actual ?? 0,
    stock_minimo: datos.stock_minimo ?? 0,
    unidad_medida: datos.unidad_medida || "Unidad",
    metodo_valuacion: datos.metodo_valuacion,
    codigo_barras:
      datos.codigo_barras !== undefined && datos.codigo_barras !== null && datos.codigo_barras !== ""
        ? datos.codigo_barras
        : null,
    codigo_barras_interno: datos.codigo_barras_interno === true,
    categoria_principal_id: datos.categoria_principal_id ?? null,
    ubicacion_principal_id: datos.ubicacion_principal_id ?? null,
    proveedor_principal_id: datos.proveedor_principal_id ?? null,
    es_vendible: typeof datos.es_vendible === "boolean" ? datos.es_vendible : true,
    es_insumo: typeof datos.es_insumo === "boolean" ? datos.es_insumo : false,
    controla_stock: typeof datos.controla_stock === "boolean" ? datos.controla_stock : true,
    destacado: typeof datos.destacado === "boolean" ? datos.destacado : false,
    visible_web: typeof datos.visible_web === "boolean" ? datos.visible_web : true,
    discount_type:
      datos.discount_type === "percentage" || datos.discount_type === "fixed"
        ? datos.discount_type
        : null,
    discount_value:
      typeof datos.discount_value === "number" && datos.discount_value >= 0
        ? datos.discount_value
        : 0,
    discount_starts_at: datos.discount_starts_at ?? null,
    discount_ends_at: datos.discount_ends_at ?? null,
    valorizado: typeof datos.valorizado === "boolean" ? datos.valorizado : true,
    unidad_compra: datos.unidad_compra ?? null,
    unidad_receta: datos.unidad_receta ?? null,
    factor_compra_receta:
      typeof datos.factor_compra_receta === "number" && datos.factor_compra_receta > 0
        ? datos.factor_compra_receta
        : 1,
    tiempo_prep_minutos:
      typeof datos.tiempo_prep_minutos === "number" && datos.tiempo_prep_minutos >= 0
        ? datos.tiempo_prep_minutos
        : 0,
    // `descripcion` (texto plano legacy) se envía siempre; el backend la usa en
    // la regla B, o la ignora/deriva bajo la regla A si hay descripcion_html.
    descripcion: datos.descripcion ?? null,
  };
  // descripcion_html: SOLO si el caller lo proporcionó (undefined = no enviado).
  if (datos.descripcion_html !== undefined) {
    body.descripcion_html = datos.descripcion_html;
  }
  return body;
}
