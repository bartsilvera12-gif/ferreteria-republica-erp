/**
 * Unit tests PUROS (sin BD ni red) del feed de Google Merchant Center.
 * Ejecutar:  tsx scripts/qa-merchant-feed-unit.ts
 *
 * Cubre: mapeo de campos g:, precio/oferta (coincide con precioEfectivo de la
 * ficha), availability, gtin real vs interno, identifier_exists, tope de
 * additional_image_link, escape XML y estructura del <rss>.
 */
import {
  resolveMerchantItem,
  renderItemXml,
  renderFeedXml,
  xmlEscape,
  type ProductoMerchant,
} from "@/app/_sitio/merchant-feed";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

function prod(over: Partial<ProductoMerchant> = {}): ProductoMerchant {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    nombre: "Taladro Percutor 750W",
    sku: "TAL-750",
    descripcion: "Taladro percutor profesional.",
    descripcion_html: null,
    precio_venta: 500000,
    stock_actual: 5,
    unidad_medida: "UNIDAD",
    codigo_barras: null,
    imagen_url: null,
    imagen_path: "e/p/x.jpg",
    categoria_principal_id: null,
    categoria: null,
    discount_type: null,
    discount_value: null,
    discount_starts_at: null,
    discount_ends_at: null,
    updated_at: null,
    marca: null,
    codigo_barras_interno: null,
    controla_stock: null,
    ...over,
  } as ProductoMerchant;
}
const IMGS = ["https://ferreteriarepublica.com.py/imagen-producto/ID/A"];

console.log("\n[1] campos básicos + link + price PYG");
{
  const it = resolveMerchantItem(prod(), IMGS, "Herramientas")!;
  ok(it !== null, "item apto no es null");
  ok(it.id === "TAL-750", "g:id = SKU");
  ok(it.price === "500000 PYG", "price en PYG entero");
  ok(it.salePrice === null, "sin oferta → sin sale_price");
  ok(it.availability === "in_stock", "stock>0 → in_stock");
  ok(it.condition === "new", "condition new");
  ok(it.productType === "Herramientas", "product_type = categoría");
  ok(it.link.startsWith("https://ferreteriarepublica.com.py/producto/") && it.link.includes(prod().id), "link absoluto con slug+uuid");
  ok(it.imageLink === IMGS[0], "image_link = primera url");
}

console.log("\n[2] oferta vigente (coincide con precioEfectivo)");
{
  const it = resolveMerchantItem(prod({ discount_type: "percentage", discount_value: 10 }), IMGS, null)!;
  ok(it.price === "500000 PYG", "price = base");
  ok(it.salePrice === "450000 PYG", "sale_price = base - 10%");
}
{
  const fixed = resolveMerchantItem(prod({ discount_type: "fixed", discount_value: 50000 }), IMGS, null)!;
  ok(fixed.salePrice === "450000 PYG", "descuento fijo aplicado");
}
{
  // Descuento fuera de ventana temporal → NO aplica.
  const futuro = resolveMerchantItem(prod({ discount_type: "percentage", discount_value: 10, discount_starts_at: "2999-01-01T00:00:00Z" }), IMGS, null)!;
  ok(futuro.salePrice === null, "descuento futuro no vigente → sin sale_price");
}

console.log("\n[3] availability");
{
  ok(resolveMerchantItem(prod({ stock_actual: 0 }), IMGS, null)!.availability === "out_of_stock", "stock 0 + controla → out_of_stock");
  ok(resolveMerchantItem(prod({ stock_actual: 0, controla_stock: false }), IMGS, null)!.availability === "in_stock", "stock 0 pero no controla stock → in_stock");
}

console.log("\n[4] aptitud (precio>0, con imagen)");
{
  ok(resolveMerchantItem(prod({ precio_venta: 0 }), IMGS, null) === null, "precio 0 → item null (excluido)");
  ok(resolveMerchantItem(prod(), [], null) === null, "sin imagen → item null (excluido)");
}

console.log("\n[5] gtin real vs interno / identifier_exists");
{
  const gtinOk = resolveMerchantItem(prod({ codigo_barras: "5901234123457" }), IMGS, null)!;
  ok(gtinOk.gtin === "5901234123457", "código de barras válido → g:gtin");
  ok(gtinOk.identifierExists === true, "con gtin → identifierExists true");

  const interno = resolveMerchantItem(prod({ codigo_barras: "5901234123457", codigo_barras_interno: true }), IMGS, null)!;
  ok(interno.gtin === null, "código interno → NO se usa como gtin");
  ok(interno.identifierExists === false, "interno y sin marca → identifierExists false");

  const conMarca = resolveMerchantItem(prod({ marca: "Bosch" }), IMGS, null)!;
  ok(conMarca.brand === "Bosch" && conMarca.identifierExists === true, "con marca → brand + identifierExists true");
}

console.log("\n[6] additional_image_link tope 10");
{
  const many = Array.from({ length: 15 }, (_, i) => `https://x/${i}`);
  const it = resolveMerchantItem(prod(), many, null)!;
  ok(it.imageLink === many[0], "image_link = principal");
  ok(it.additionalImageLinks.length === 10, "additional_image_link cap a 10");
}

console.log("\n[7] renderItemXml / escape / identifier_exists");
{
  const it = resolveMerchantItem(prod({ nombre: 'Cable <b> & "cobre"', marca: null, codigo_barras: null }), IMGS, null)!;
  const xml = renderItemXml(it);
  ok(xml.startsWith("<item>") && xml.endsWith("</item>"), "envuelto en <item>");
  ok(xml.includes("<g:identifier_exists>no</g:identifier_exists>"), "sin marca ni gtin → identifier_exists=no");
  ok(!xml.includes("Cable <b>"), "nombre con < > & no rompe el XML (escapado)");
  ok(xml.includes("&lt;b&gt;") && xml.includes("&amp;"), "escape XML aplicado");
  ok(xml.includes("<g:price>500000 PYG</g:price>"), "precio en el XML");
}
{
  const it = resolveMerchantItem(prod({ discount_type: "percentage", discount_value: 20, marca: "Truper" }), IMGS, "Manuales")!;
  const xml = renderItemXml(it);
  ok(xml.includes("<g:sale_price>400000 PYG</g:sale_price>"), "sale_price en XML cuando hay oferta");
  ok(xml.includes("<g:brand>Truper</g:brand>"), "brand en XML");
  ok(!xml.includes("identifier_exists"), "con marca NO se emite identifier_exists");
  ok(xml.includes("<g:product_type>Manuales</g:product_type>"), "product_type en XML");
}

console.log("\n[8] renderFeedXml estructura RSS");
{
  const feed = renderFeedXml([renderItemXml(resolveMerchantItem(prod(), IMGS, null)!)]);
  ok(feed.includes('<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">'), "declara namespace g:");
  ok(feed.includes("<channel>") && feed.includes("</channel>"), "tiene channel");
  ok(feed.includes("<item>"), "incluye el item");
  ok(xmlEscape(`a&b<c>"d'`) === "a&amp;b&lt;c&gt;&quot;d&apos;", "xmlEscape correcto");
}

console.log(`\n${fail === 0 ? "OK" : "FALLÓ"} — ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
