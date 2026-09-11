/**
 * Slugs y validaciones para las URLs públicas de producto/categoría.
 *
 * Esquema de URL:  /producto/<slug-del-nombre>-<uuid-completo>
 *                  /categoria/<slug-del-nombre>-<uuid-completo>
 *
 * El UUID completo (formato fijo 8-4-4-4-12) permite resolver el registro con
 * una consulta EXACTA por id, sin recorrer el catálogo. El slug es cosmético:
 * si no coincide con el nombre actual, la ruta hace 301 al canónico correcto.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_ID_RE =
  /^(.*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** minúsculas, sin acentos, no-alfanumérico → '-', colapsado y recortado. */
export function slugify(input: string): string {
  const s = (input || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // quita acentos: á→a, é→e, ñ→n, ü→u
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return s || "item";
}

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Extrae { slug, id } de `<slug>-<uuid>`. Devuelve null si no hay UUID final. */
export function parseSlugId(param: string): { slug: string; id: string } | null {
  const decoded = safeDecode(param);
  const m = decoded.match(SLUG_ID_RE);
  if (!m) return null;
  return { slug: m[1], id: m[2].toLowerCase() };
}

export function productoPath(nombre: string, id: string): string {
  return `/producto/${slugify(nombre)}-${id}`;
}

export function categoriaPath(nombre: string, id: string): string {
  return `/categoria/${slugify(nombre)}-${id}`;
}

/**
 * Valida `codigo_barras` como GTIN real (GTIN-8/12/13/14): solo dígitos, longitud
 * válida y dígito verificador mod-10 correcto. Devuelve el GTIN normalizado o null.
 * Así nunca declaramos como GTIN un código interno que no lo sea.
 */
export function validGtin(code: string | null | undefined): string | null {
  if (!code) return null;
  const digits = code.trim();
  if (!/^\d+$/.test(digits)) return null;
  if (![8, 12, 13, 14].includes(digits.length)) return null;
  const nums = digits.split("").map(Number);
  const check = nums.pop() as number;
  let sum = 0;
  // Cuerpo de derecha a izquierda: pesos alternos 3,1,3,1...
  for (let i = nums.length - 1, pos = 0; i >= 0; i--, pos++) {
    sum += nums[i] * (pos % 2 === 0 ? 3 : 1);
  }
  const cd = (10 - (sum % 10)) % 10;
  return cd === check ? digits : null;
}

/**
 * Devuelve la propiedad Schema.org específica del GTIN según su longitud
 * (gtin8/gtin12/gtin13/gtin14) y el valor validado, o null si no valida.
 * Google prefiere la propiedad específica sobre el genérico `gtin`.
 */
export function gtinSchema(
  code: string | null | undefined
): { prop: "gtin8" | "gtin12" | "gtin13" | "gtin14"; value: string } | null {
  const v = validGtin(code);
  if (!v) return null;
  const prop =
    v.length === 8 ? "gtin8" : v.length === 12 ? "gtin12" : v.length === 13 ? "gtin13" : "gtin14";
  return { prop, value: v };
}
