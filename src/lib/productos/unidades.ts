/**
 * Reglas de cantidad según la unidad de medida del producto.
 *
 * La ferretería vende de dos formas distintas y el sistema tiene que respetar
 * las dos:
 *   - Por UNIDAD (un martillo, un tornillo): cantidades enteras. Permitir
 *     decimales acá solo habilita errores de tipeo.
 *   - Por peso o medida (clavos por kilo, manguera por metro): cantidades
 *     fraccionadas. Forzar enteros hace imposible vender medio kilo y deja el
 *     stock descuadrado contra la realidad física.
 */

/** Unidades que se venden fraccionadas. */
const FRACCIONABLES = new Set([
  "METRO", "METROS", "MT", "M",
  "KILOGRAMO", "KILOGRAMOS", "KILO", "KILOS", "KG",
  "LITRO", "LITROS", "LT", "L",
  "GRAMO", "GRAMOS", "GR", "G",
  "MILILITRO", "ML",
  "METRO CUADRADO", "M2", "METRO LINEAL", "ML2",
  "TONELADA", "TN",
]);

function normalizar(unidad?: string | null): string {
  return String(unidad ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().trim();
}

/** ¿Este producto admite cantidades con decimales? */
export function permiteDecimales(unidad?: string | null): boolean {
  return FRACCIONABLES.has(normalizar(unidad));
}

/** Incremento de los botones +/- y del atributo `step` del input. */
export function pasoCantidad(unidad?: string | null): number {
  return permiteDecimales(unidad) ? 0.1 : 1;
}

/** Cantidad mínima vendible. */
export function minimoCantidad(unidad?: string | null): number {
  return permiteDecimales(unidad) ? 0.01 : 1;
}

/** Cuántos decimales se conservan al guardar. */
export function decimalesCantidad(unidad?: string | null): number {
  return permiteDecimales(unidad) ? 2 : 0;
}

/**
 * Interpreta lo que el usuario escribió respetando la unidad.
 * Acepta coma como separador decimal (acá se escribe "2,5" y no "2.5").
 * Devuelve `null` si el texto todavía no es un número válido, para que el
 * input lo deje seguir escribiendo en vez de saltar a un valor por defecto.
 */
export function parseCantidad(raw: string, unidad?: string | null): number | null {
  const txt = String(raw ?? "").replace(",", ".").trim();
  if (txt === "") return null;
  const n = permiteDecimales(unidad) ? parseFloat(txt) : parseInt(txt, 10);
  if (!Number.isFinite(n)) return null;
  return redondearCantidad(n, unidad);
}

/** Ajusta a los decimales admitidos por la unidad. */
export function redondearCantidad(n: number, unidad?: string | null): number {
  const dec = decimalesCantidad(unidad);
  const f = 10 ** dec;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** Aplica el mínimo de la unidad (para que nunca quede 0 o negativo). */
export function clampCantidad(n: number, unidad?: string | null): number {
  return Math.max(minimoCantidad(unidad), redondearCantidad(n, unidad));
}

/** Muestra la cantidad sin decimales sobrantes: 2 y no "2.00". */
export function formatCantidad(n: number, unidad?: string | null): string {
  if (!Number.isFinite(n)) return "0";
  return permiteDecimales(unidad)
    ? String(redondearCantidad(n, unidad))
    : String(Math.round(n));
}
