/**
 * Construcción PURA del feed de Google Merchant Center / Shopping (RSS 2.0 con
 * namespace `g:`). Sin BD ni red: recibe productos ya leídos + URLs de imagen ya
 * resueltas y devuelve el XML. Así es testeable y el precio sale de la MISMA
 * función `precioEfectivo` que usa la ficha pública (Google exige que el precio
 * del feed coincida con el de la landing).
 *
 * Solo lectura del catálogo público; no toca ERP ni BD.
 */
import { SITIO_ORIGIN } from "./host";
import { productoPath, validGtin } from "./slug";
import { precioEfectivo } from "./render-html";
import type { ProductoPublico } from "./producto-read";

/** Producto público + campos extra que el feed necesita (marca/gtin/stock). */
export type ProductoMerchant = ProductoPublico & {
  marca?: string | null;
  codigo_barras_interno?: boolean | null;
  controla_stock?: boolean | null;
};

export type MerchantItem = {
  id: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  availability: "in_stock" | "out_of_stock";
  price: string; // "10000 PYG"
  salePrice: string | null; // "8000 PYG" si hay oferta vigente
  brand: string | null;
  gtin: string | null;
  identifierExists: boolean; // false → se emite g:identifier_exists=no
  productType: string | null;
  condition: "new";
};

const MAX_ADDITIONAL_IMAGES = 10; // límite de Google para additional_image_link

function collapse(s: string, max: number): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

/** Escape XML para & < > " '. */
export function xmlEscape(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Normaliza un producto a MerchantItem. Devuelve null si NO es apto para el feed
 * (sin precio > 0 o sin imagen), para no publicar items que Google rechazaría.
 * `imageUrls` viene de `galeriaImagenesUrls` (principal primero, URLs estables).
 */
export function resolveMerchantItem(
  p: ProductoMerchant,
  imageUrls: string[],
  categoriaNombre: string | null,
  now = Date.now()
): MerchantItem | null {
  const base = Number(p.precio_venta) || 0;
  if (base <= 0) return null; // Google exige precio > 0
  if (!imageUrls || imageUrls.length === 0) return null; // image_link obligatorio

  const efectivo = precioEfectivo(p, now);
  const salePrice = efectivo < base ? `${efectivo} PYG` : null;

  const controla = p.controla_stock !== false; // null/undefined = controla stock
  const stock = Number(p.stock_actual) || 0;
  const availability: MerchantItem["availability"] =
    !controla || stock > 0 ? "in_stock" : "out_of_stock";

  // GTIN solo si el código de barras NO es interno y es un GTIN real (check digit).
  const gtin = p.codigo_barras_interno ? null : validGtin(p.codigo_barras);
  const brand = typeof p.marca === "string" && p.marca.trim() ? p.marca.trim() : null;
  const identifierExists = Boolean(gtin || brand);

  const id = typeof p.sku === "string" && p.sku.trim() ? p.sku.trim() : p.id;
  const descripcionBase =
    typeof p.descripcion === "string" && p.descripcion.trim()
      ? p.descripcion
      : `${p.nombre}. Ferretería República, Paraguay.`;

  return {
    id,
    title: collapse(p.nombre, 150),
    description: collapse(descripcionBase, 5000),
    link: `${SITIO_ORIGIN}${productoPath(p.nombre, p.id)}`,
    imageLink: imageUrls[0],
    additionalImageLinks: imageUrls.slice(1, 1 + MAX_ADDITIONAL_IMAGES),
    availability,
    price: `${Math.round(base)} PYG`,
    salePrice,
    brand,
    gtin,
    identifierExists,
    productType: categoriaNombre && categoriaNombre.trim() ? categoriaNombre.trim() : null,
    condition: "new",
  };
}

/** Renderiza un <item> del feed a partir de un MerchantItem normalizado. */
export function renderItemXml(it: MerchantItem): string {
  const t: string[] = [];
  t.push(`<g:id>${xmlEscape(it.id)}</g:id>`);
  t.push(`<g:title>${xmlEscape(it.title)}</g:title>`);
  t.push(`<g:description>${xmlEscape(it.description)}</g:description>`);
  t.push(`<g:link>${xmlEscape(it.link)}</g:link>`);
  t.push(`<g:image_link>${xmlEscape(it.imageLink)}</g:image_link>`);
  for (const u of it.additionalImageLinks) {
    t.push(`<g:additional_image_link>${xmlEscape(u)}</g:additional_image_link>`);
  }
  t.push(`<g:availability>${it.availability}</g:availability>`);
  t.push(`<g:price>${xmlEscape(it.price)}</g:price>`);
  if (it.salePrice) t.push(`<g:sale_price>${xmlEscape(it.salePrice)}</g:sale_price>`);
  t.push(`<g:condition>${it.condition}</g:condition>`);
  if (it.brand) t.push(`<g:brand>${xmlEscape(it.brand)}</g:brand>`);
  if (it.gtin) t.push(`<g:gtin>${xmlEscape(it.gtin)}</g:gtin>`);
  if (!it.identifierExists) t.push(`<g:identifier_exists>no</g:identifier_exists>`);
  if (it.productType) t.push(`<g:product_type>${xmlEscape(it.productType)}</g:product_type>`);
  return `<item>${t.join("")}</item>`;
}

/** Envuelve los <item> ya renderizados en el <rss>/<channel> del feed. */
export function renderFeedXml(itemsXml: string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">',
    "<channel>",
    "<title>Ferretería República — Catálogo</title>",
    `<link>${xmlEscape(SITIO_ORIGIN)}</link>`,
    "<description>Feed de productos para Google Merchant Center / Shopping.</description>",
    ...itemsXml,
    "</channel>",
    "</rss>",
  ].join("\n");
}
