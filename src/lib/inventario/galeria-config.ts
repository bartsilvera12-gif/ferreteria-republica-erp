/**
 * Configuración ÚNICA del límite de imágenes por producto.
 *
 * Fuente de verdad compartida entre backend y UI para evitar contradicciones:
 *  - DEFAULT_MAX_PRODUCT_IMAGES: tope por defecto (cuando no hay env).
 *  - HARD_MAX_PRODUCT_IMAGES: techo absoluto que el env nunca puede superar.
 *  - clampMaxProductImages: normaliza el valor del env a [1, HARD_MAX], default DEFAULT.
 *
 * Este módulo es PURO (sin imports con efectos) → seguro de importar tanto en
 * componentes cliente como en server / scripts.
 */
export const DEFAULT_MAX_PRODUCT_IMAGES = 8;
export const HARD_MAX_PRODUCT_IMAGES = 20;

/** Normaliza un valor arbitrario (ej. env) al rango permitido. */
export function clampMaxProductImages(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > HARD_MAX_PRODUCT_IMAGES) {
    return DEFAULT_MAX_PRODUCT_IMAGES;
  }
  return Math.floor(n);
}
