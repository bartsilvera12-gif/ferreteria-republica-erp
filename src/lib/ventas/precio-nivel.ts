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
