/**
 * Precio por nivel (minorista / mayorista / distribuidor) — fuente ÚNICA de la
 * lógica, para que la pantalla de venta y el buscador no se contradigan.
 *
 * `minorista` usa el precio de venta base. `mayorista`/`distribuidor` usan su
 * precio propio SOLO si está cargado (> 0); si no, caen al minorista (fallback).
 * El fallback se mantiene para líneas ya cargadas/históricas, pero la UI debe
 * usar `nivelConfigurado` para NO dejar elegir un nivel sin precio propio.
 */
export type NivelPrecio = "minorista" | "mayorista" | "distribuidor";

export interface PreciosNivel {
  /** Precio minorista base (precio_venta). Requerido para `precioNivel`. */
  minorista?: number | null;
  mayorista?: number | null;
  distribuidor?: number | null;
}

const pos = (v: number | null | undefined): number | null =>
  v != null && Number(v) > 0 ? Number(v) : null;

/** ¿El producto tiene un precio propio cargado para ese nivel? (minorista siempre sí). */
export function nivelConfigurado(p: PreciosNivel, tipo: NivelPrecio): boolean {
  if (tipo === "mayorista") return pos(p.mayorista) != null;
  if (tipo === "distribuidor") return pos(p.distribuidor) != null;
  return true; // minorista
}

/** Precio del nivel elegido, con fallback a minorista si el nivel no tiene precio propio. */
export function precioNivel(p: PreciosNivel, tipo: NivelPrecio): number {
  const base = Number(p.minorista) || 0;
  if (tipo === "mayorista") return pos(p.mayorista) ?? base;
  if (tipo === "distribuidor") return pos(p.distribuidor) ?? base;
  return base;
}

/** Precios por nivel de una PRESENTACIÓN (ya por presentación, no por unidad). */
export interface PreciosPresentacion {
  cantidad_base: number;
  /** Precio minorista de la presentación (el `precio_venta`/override actual). */
  minorista?: number | null;
  mayorista?: number | null;
  distribuidor?: number | null;
}

/**
 * Precio de una línea con PRESENTACIÓN + nivel (opción C):
 *  1) si la presentación tiene cargado el precio de ese nivel → se usa ese;
 *  2) si no, se usa el precio del PRODUCTO para ese nivel × cantidad_base;
 *  3) minorista siempre queda configurado (cae al minorista del producto × base);
 *     mayorista/distribuidor: si NO hay ni en la presentación ni en el producto,
 *     `configurado=false` (la UI lo deshabilita y el server lo rechaza — NO cae a minorista).
 */
export function precioPresentacionNivel(
  prod: PreciosNivel,
  pres: PreciosPresentacion,
  tipo: NivelPrecio
): { precio: number; configurado: boolean } {
  const presNivel = tipo === "mayorista" ? pos(pres.mayorista) : tipo === "distribuidor" ? pos(pres.distribuidor) : pos(pres.minorista);
  if (presNivel != null) return { precio: presNivel, configurado: true };
  const base = Number(pres.cantidad_base) > 0 ? Number(pres.cantidad_base) : 1;
  if (tipo === "minorista") return { precio: Math.round((Number(prod.minorista) || 0) * base), configurado: true };
  const prodNivel = tipo === "mayorista" ? pos(prod.mayorista) : pos(prod.distribuidor);
  if (prodNivel == null) return { precio: 0, configurado: false };
  return { precio: Math.round(prodNivel * base), configurado: true };
}
