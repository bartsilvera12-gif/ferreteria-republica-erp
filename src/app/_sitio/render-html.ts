/**
 * Generación de HTML server-side para las páginas públicas de producto y
 * categoría. Todo el contenido SEO (title, description, canonical, OG, JSON-LD y
 * el contenido visible) va en el HTML inicial, SIN depender de JavaScript.
 *
 * Los datos del JSON-LD coinciden con lo visible. No se inventan marca, GTIN,
 * reviews, rating, specs, stock ni precios. Todo valor dinámico proviene de la
 * BD (no confiable) y pasa por escape HTML / JSON-LD seguro.
 */
import { SITIO_ORIGIN } from "./host";
import { gtinSchema, productoPath, categoriaPath } from "./slug";
import type { ProductoPublico, CategoriaPublica } from "./producto-read";
import type { GaleriaImagenRow } from "@/lib/inventario/server/galeria-pg";
import { sanitizeRichHtml } from "@/lib/sanitize/rich-text";

const WA_NUMERO = (process.env.SITIO_WHATSAPP || "595994707092").replace(/[^0-9]/g, "");
const OG_FALLBACK = `${SITIO_ORIGIN}/assets/hero-atencion2.png`;

// ── utilidades de escape ────────────────────────────────────────────────────────

/** Escape para HTML (texto y atributos): & < > " ' */
export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * JSON-LD seguro para incrustar dentro de <script type="application/ld+json">.
 * Aunque el valor venga de la BD (no confiable), escapa & < > para que el parser
 * HTML no pueda cerrar/inyectar el bloque: con "<" y ">" escapados, un nombre o
 * descripción con "</script><script>...</script>" NO puede crear un <script>
 * ejecutable extra. (El contenido de application/ld+json no se ejecuta como JS.)
 */
function jsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

/** Formato de precio en guaraníes: "Gs. 1.234.567". */
export function fmtGs(n: number): string {
  const v = Math.round(Number(n) || 0);
  return "Gs. " + v.toLocaleString("es-PY");
}

function truncate(s: string, max = 160): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

// ── lógica de negocio (idéntica al catálogo) ────────────────────────────────────

/**
 * Precio efectivo: replica EXACTAMENTE _discActive + _discEffPrice del catálogo
 * (public/sitio/index.html) para que el precio del HTML, del JSON-LD/Offer y del
 * catálogo sea idéntico. Solo aplica descuento si el tipo es 'percentage' o
 * 'fixed' y la ventana temporal está vigente. No cambia la lógica comercial.
 */
export function precioEfectivo(p: ProductoPublico, now = Date.now()): number {
  const base = Number(p.precio_venta) || 0;
  const t = p.discount_type;
  const v = Number(p.discount_value || 0);
  if (!t || v <= 0) return base;
  if (t !== "percentage" && t !== "fixed") return base;
  const s = p.discount_starts_at ? Date.parse(p.discount_starts_at) : null;
  const e = p.discount_ends_at ? Date.parse(p.discount_ends_at) : null;
  if (s !== null && !Number.isNaN(s) && now < s) return base;
  if (e !== null && !Number.isNaN(e) && now > e) return base;
  const ef = t === "percentage" ? base - (base * v) / 100 : base - v;
  return Math.max(0, Math.round(ef));
}

export function estaDisponible(p: ProductoPublico): boolean {
  return (Number(p.stock_actual) || 0) > 0;
}

/**
 * URL de imagen ESTABLE para SEO. Si el producto ya tiene imagen_url pública se
 * usa directamente; si viene de imagen_path (bucket privado) se usa el proxy
 * estable /imagen-producto/<id> (nunca una signed URL temporal que vence).
 */
export function imagenEstable(p: ProductoPublico): string | null {
  if (p.imagen_url) return p.imagen_url;
  if (p.imagen_path) return `${SITIO_ORIGIN}/imagen-producto/${p.id}`;
  return null;
}

/**
 * URLs ESTABLES de las imágenes de la galería (principal primero). Cada imagen
 * usa /imagen-producto/<producto>/<imagen>. Si no hay galería, cae a la imagen
 * principal legacy (imagenEstable). Devuelve [] si no hay ninguna.
 */
export function galeriaImagenesUrls(p: ProductoPublico, galeria?: GaleriaImagenRow[]): string[] {
  if (galeria && galeria.length > 0) {
    return galeria.map((g) => `${SITIO_ORIGIN}/imagen-producto/${p.id}/${g.id}`);
  }
  const single = imagenEstable(p);
  return single ? [single] : [];
}

// ── shell común ─────────────────────────────────────────────────────────────────

const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;font-family:'Montserrat',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0E1B33;background:#F6F7FA;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1100px;margin:0 auto;padding:0 20px}
.hdr{background:#021F5F;color:#fff}
.hdr .wrap{display:flex;align-items:center;justify-content:space-between;height:64px;gap:16px}
.hdr img{height:34px;width:auto}
.hdr nav a{color:#dbe4f5;text-decoration:none;font-weight:600;font-size:14px;margin-left:18px}
.hdr nav a:hover{color:#ffb37a}
.bc{font-size:13px;color:#6b7688;padding:16px 0}
.bc a{color:#3f5a8a;text-decoration:none}
.bc a:hover{text-decoration:underline}
main{padding:8px 0 40px}
.card{background:#fff;border:1px solid #E7ECF3;border-radius:18px;overflow:hidden}
.pgrid{display:grid;grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:28px;align-items:start}
@media(max-width:760px){.pgrid{grid-template-columns:1fr}}
.pimg{aspect-ratio:1/1;background:#0a1f50;display:flex;align-items:center;justify-content:center;overflow:hidden;border-radius:14px}
.pimg img{width:100%;height:100%;object-fit:cover}
.pimg .ph{color:#8ea3c9;font-size:14px}
.thumbs{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.thumbs a{display:block;width:64px;height:64px;border-radius:10px;overflow:hidden;border:2px solid #E7ECF3;background:#0a1f50}
.thumbs a.active{border-color:#E97932}
.thumbs img{width:100%;height:100%;object-fit:cover;display:block}
.specs{margin:22px 0 4px}
.specs h2{font-size:18px;margin:0 0 8px}
.specs p{margin:0 0 8px;line-height:1.6}
.specs ul,.specs ol{margin:0 0 10px;padding-left:20px;line-height:1.6}
.specs a{color:#0f5ec0}
h1{font-size:26px;line-height:1.2;margin:0 0 10px;letter-spacing:-.01em}
.cat-tag{display:inline-block;font-size:12px;font-weight:700;color:#021F5F;background:#eaf0fb;border-radius:999px;padding:5px 12px;text-decoration:none}
.price{font-size:30px;font-weight:800;color:#021F5F;margin:16px 0 4px}
.price .old{font-size:16px;font-weight:600;color:#9aa5b7;text-decoration:line-through;margin-left:10px}
.avail{font-size:14px;font-weight:700;margin:6px 0 14px}
.avail.in{color:#0f9d58}.avail.out{color:#c0392b}
.desc{font-size:15px;line-height:1.6;color:#3a465c;white-space:pre-line}
.meta{margin:16px 0;font-size:13.5px;color:#5a6577}
.meta b{color:#0E1B33}
.cta{display:inline-flex;align-items:center;gap:8px;background:#25D366;color:#fff;font-weight:700;font-size:15px;text-decoration:none;padding:13px 22px;border-radius:12px;margin-top:8px}
.cta.sec{background:#E97932}
.ctas{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px}
.plist{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px;margin-top:8px}
.pitem{display:block;background:#fff;border:1px solid #E7ECF3;border-radius:16px;overflow:hidden;text-decoration:none;color:inherit}
.pitem .t{aspect-ratio:1/1;background:#0a1f50;overflow:hidden}
.pitem .t img{width:100%;height:100%;object-fit:cover}
.pitem .b{padding:12px 14px}
.pitem .n{font-size:14.5px;font-weight:700;line-height:1.3;min-height:38px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pitem .p{font-size:15px;font-weight:800;color:#021F5F;margin-top:6px}
.pager{display:flex;gap:10px;justify-content:center;margin:26px 0 0}
.pager a{background:#fff;border:1px solid #d7deea;border-radius:10px;padding:9px 16px;text-decoration:none;color:#021F5F;font-weight:700;font-size:14px}
.ftr{background:#021F5F;color:#9fb0cf;font-size:13px;text-align:center;padding:22px 0}
.ftr a{color:#dbe4f5;text-decoration:none}
`;

function head(opts: {
  title: string;
  description: string;
  canonical: string;
  robots?: string;
  og: Record<string, string>;
  twitter?: Record<string, string>;
  jsonLdBlocks?: string[];
}): string {
  const og = Object.entries(opts.og)
    .map(([k, v]) => `<meta property="${esc(k)}" content="${esc(v)}">`)
    .join("\n");
  const tw = Object.entries(opts.twitter ?? {})
    .map(([k, v]) => `<meta name="${esc(k)}" content="${esc(v)}">`)
    .join("\n");
  const ld = (opts.jsonLdBlocks ?? [])
    .map((b) => `<script type="application/ld+json">${b}</script>`)
    .join("\n");
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}">
<meta name="robots" content="${esc(opts.robots ?? "index, follow, max-image-preview:large")}">
<link rel="canonical" href="${esc(opts.canonical)}">
<meta name="theme-color" content="#021F5F">
<link rel="icon" type="image/png" href="${SITIO_ORIGIN}/assets/republica-icon.png?v=2">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
${og}
${tw}
${ld}
<style>${BASE_CSS}</style>`;
}

function header(): string {
  return `<header class="hdr"><div class="wrap">
<a href="${SITIO_ORIGIN}/"><img src="${SITIO_ORIGIN}/assets/republica-logo.png" alt="Ferretería República"></a>
<nav><a href="${SITIO_ORIGIN}/">Inicio</a><a href="${SITIO_ORIGIN}/catalogo">Catálogo</a></nav>
</div></header>`;
}

function footer(): string {
  return `<footer class="ftr"><div class="wrap">Ferretería República — Paraguay · <a href="${SITIO_ORIGIN}/catalogo">Ver catálogo</a></div></footer>`;
}

function shell(headHtml: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
${headHtml}
</head>
<body>
${header()}
<div class="wrap">
${bodyHtml}
</div>
${footer()}
</body>
</html>`;
}

// ── página de PRODUCTO ──────────────────────────────────────────────────────────

export function renderProductoHtml(p: ProductoPublico, galeria?: GaleriaImagenRow[]): string {
  const canonical = `${SITIO_ORIGIN}${productoPath(p.nombre, p.id)}`;
  const precio = precioEfectivo(p);
  const base = Number(p.precio_venta) || 0;
  const enOferta = precio < base;
  const disponible = estaDisponible(p);
  // Galería: principal primero. og/twitter usan SOLO la principal; JSON-LD usa el array.
  const imagenes = galeriaImagenesUrls(p, galeria);
  const principal = imagenes[0] || null;
  const ogImg = principal || OG_FALLBACK;
  // Especificaciones rich text: SIEMPRE sanitizar antes de inyectar como HTML.
  const specsHtml = p.descripcion_html ? sanitizeRichHtml(p.descripcion_html) : "";
  const gtin = gtinSchema(p.codigo_barras);
  const catNombre = p.categoria?.nombre || null;
  const catHref = p.categoria ? `${SITIO_ORIGIN}${categoriaPath(p.categoria.nombre, p.categoria.id)}` : null;

  const descReal = (p.descripcion || "").trim();
  const metaDesc = truncate(
    descReal ||
      `${p.nombre} en Ferretería República, Paraguay.${catNombre ? " Categoría: " + catNombre + "." : ""} Consultá precio y disponibilidad.`
  );
  const title = `${p.nombre} | Ferretería República`;

  // JSON-LD Product + Offer (solo valores reales)
  const productLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.nombre,
    description: descReal || metaDesc,
    url: canonical,
    offers: {
      "@type": "Offer",
      url: canonical,
      priceCurrency: "PYG",
      price: String(precio),
      availability: disponible
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
  if (imagenes.length) productLd.image = imagenes; // array: principal primero
  if (p.sku) productLd.sku = p.sku;
  if (gtin) productLd[gtin.prop] = gtin.value; // gtin8/gtin12/gtin13/gtin14
  if (catNombre) productLd.category = catNombre;

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITIO_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Catálogo", item: `${SITIO_ORIGIN}/catalogo` },
      ...(catNombre && catHref
        ? [{ "@type": "ListItem", position: 3, name: catNombre, item: catHref }]
        : []),
      {
        "@type": "ListItem",
        position: catNombre ? 4 : 3,
        name: p.nombre,
        item: canonical,
      },
    ],
  };

  const headHtml = head({
    title,
    description: metaDesc,
    canonical,
    og: {
      "og:type": "product",
      "og:site_name": "Ferretería República",
      "og:title": title,
      "og:description": metaDesc,
      "og:url": canonical,
      "og:locale": "es_PY",
      "og:image": ogImg,
      "product:price:amount": String(precio),
      "product:price:currency": "PYG",
    },
    twitter: {
      "twitter:card": "summary_large_image",
      "twitter:title": title,
      "twitter:description": metaDesc,
      "twitter:image": ogImg,
    },
    jsonLdBlocks: [jsonLd(productLd), jsonLd(breadcrumbLd)],
  });

  const waMsg = `Hola! Quiero consultar por: ${p.nombre}${p.sku ? " (SKU " + p.sku + ")" : ""}.`;
  const waHref = `https://wa.me/${WA_NUMERO}?text=${encodeURIComponent(waMsg)}`;

  const metaLines: string[] = [];
  if (catNombre && catHref) metaLines.push(`<div>Categoría: <a href="${esc(catHref)}"><b>${esc(catNombre)}</b></a></div>`);
  if (p.sku) metaLines.push(`<div>SKU: <b>${esc(p.sku)}</b></div>`);
  if (gtin) metaLines.push(`<div>Código (GTIN): <b>${esc(gtin.value)}</b></div>`);
  if (p.unidad_medida) metaLines.push(`<div>Unidad: <b>${esc(p.unidad_medida)}</b></div>`);

  const body = `
<nav class="bc"><a href="${SITIO_ORIGIN}/">Inicio</a> › <a href="${SITIO_ORIGIN}/catalogo">Catálogo</a>${
    catNombre && catHref ? ` › <a href="${esc(catHref)}">${esc(catNombre)}</a>` : ""
  } › ${esc(p.nombre)}</nav>
<main>
<div class="card" style="padding:22px">
  <div class="pgrid">
    <div>
      <div class="pimg">${
        principal
          ? `<img id="main-img" src="${esc(principal)}" alt="${esc(p.nombre)}" width="440" height="440" decoding="async">`
          : `<span class="ph">Sin imagen</span>`
      }</div>
      ${
        imagenes.length > 1
          ? `<div class="thumbs">${imagenes
              .map(
                (u, i) =>
                  `<a href="${esc(u)}" data-full="${esc(u)}"${i === 0 ? ' class="active"' : ""}><img src="${esc(u)}" alt="${esc(p.nombre)} ${i + 1}" loading="lazy" decoding="async" width="64" height="64"></a>`
              )
              .join("")}</div>`
          : ""
      }
    </div>
    <div>
      ${catNombre && catHref ? `<a class="cat-tag" href="${esc(catHref)}">${esc(catNombre)}</a>` : ""}
      <h1>${esc(p.nombre)}</h1>
      <div class="price">${esc(fmtGs(precio))}${
        enOferta ? `<span class="old">${esc(fmtGs(base))}</span>` : ""
      }</div>
      <div class="avail ${disponible ? "in" : "out"}">${
        disponible ? "● En stock" : "● Sin stock — consultá disponibilidad"
      }</div>
      ${
        specsHtml
          ? `<section class="specs"><h2>Especificaciones</h2>${specsHtml}</section>`
          : descReal
            ? `<p class="desc">${esc(descReal)}</p>`
            : ""
      }
      <div class="meta">${metaLines.join("")}</div>
      <div class="ctas">
        <a class="cta" href="${esc(waHref)}" rel="nofollow">Consultar por WhatsApp</a>
        <a class="cta sec" href="${SITIO_ORIGIN}/catalogo">Ver catálogo completo</a>
      </div>
    </div>
  </div>
</div>
</main>${
    imagenes.length > 1
      ? `
<script>
(function(){
  var thumbs = document.querySelectorAll('.thumbs a');
  var main = document.getElementById('main-img');
  if(!main) return;
  thumbs.forEach(function(a){
    a.addEventListener('click', function(e){
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||(typeof e.button==='number'&&e.button!==0)) return;
      e.preventDefault();
      main.setAttribute('src', a.getAttribute('data-full'));
      thumbs.forEach(function(x){ x.classList.remove('active'); });
      a.classList.add('active');
    });
  });
})();
</script>`
      : ""
  }`;

  return shell(headHtml, body);
}

// ── página de CATEGORÍA ─────────────────────────────────────────────────────────

export function renderCategoriaHtml(
  cat: CategoriaPublica,
  productos: ProductoPublico[],
  info: { page: number; totalPages: number; total: number }
): string {
  const base = `${SITIO_ORIGIN}${categoriaPath(cat.nombre, cat.id)}`;
  // Canonical PROPIO por página: page 1 -> URL base; page N>1 -> conserva ?page=N.
  // Nunca canonicalizamos page 2/3 hacia la página 1 (muestran productos distintos).
  const canonical = info.page > 1 ? `${base}?page=${info.page}` : base;
  const title = `${cat.nombre} | Ferretería República`;
  const descReal = (cat.descripcion || "").trim();
  const metaDesc = truncate(
    descReal ||
      `${cat.nombre} en Ferretería República, Paraguay. Explorá productos de ${cat.nombre} y consultá precio y disponibilidad.`
  );

  const itemsLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: cat.nombre,
    itemListElement: productos.map((p, i) => ({
      "@type": "ListItem",
      position: (info.page - 1) * productos.length + i + 1,
      url: `${SITIO_ORIGIN}${productoPath(p.nombre, p.id)}`,
      name: p.nombre,
    })),
  };
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Inicio", item: `${SITIO_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Catálogo", item: `${SITIO_ORIGIN}/catalogo` },
      { "@type": "ListItem", position: 3, name: cat.nombre, item: base },
    ],
  };

  const headHtml = head({
    title,
    description: metaDesc,
    canonical,
    og: {
      "og:type": "website",
      "og:site_name": "Ferretería República",
      "og:title": title,
      "og:description": metaDesc,
      "og:url": canonical,
      "og:locale": "es_PY",
      "og:image": OG_FALLBACK,
    },
    twitter: {
      "twitter:card": "summary_large_image",
      "twitter:title": title,
      "twitter:description": metaDesc,
      "twitter:image": OG_FALLBACK,
    },
    jsonLdBlocks: [jsonLd(itemsLd), jsonLd(breadcrumbLd)],
  });

  const cards = productos
    .map((p) => {
      const img = imagenEstable(p);
      const href = `${SITIO_ORIGIN}${productoPath(p.nombre, p.id)}`;
      return `<a class="pitem" href="${esc(href)}">
  <div class="t">${img ? `<img src="${esc(img)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">` : ""}</div>
  <div class="b"><div class="n">${esc(p.nombre)}</div><div class="p">${esc(fmtGs(precioEfectivo(p)))}</div></div>
</a>`;
    })
    .join("\n");

  // Enlaces reales <a href> de paginación (funcionan sin JavaScript).
  const pager: string[] = [];
  if (info.page > 1) {
    const prev = info.page - 1 === 1 ? base : `${base}?page=${info.page - 1}`;
    pager.push(`<a href="${esc(prev)}" rel="prev">← Anterior</a>`);
  }
  if (info.page < info.totalPages) {
    pager.push(`<a href="${esc(`${base}?page=${info.page + 1}`)}" rel="next">Siguiente →</a>`);
  }

  const body = `
<nav class="bc"><a href="${SITIO_ORIGIN}/">Inicio</a> › <a href="${SITIO_ORIGIN}/catalogo">Catálogo</a> › ${esc(cat.nombre)}</nav>
<main>
<h1>${esc(cat.nombre)}</h1>
${descReal ? `<p class="desc">${esc(descReal)}</p>` : ""}
<p class="bc" style="padding:4px 0 12px">${info.total} producto${info.total === 1 ? "" : "s"} · página ${info.page} de ${info.totalPages}</p>
<div class="plist">
${cards || "<p>No hay productos en esta categoría por ahora.</p>"}
</div>
${pager.length ? `<div class="pager">${pager.join("")}</div>` : ""}
</main>`;

  return shell(headHtml, body);
}

// ── 404 ─────────────────────────────────────────────────────────────────────────

export function render404Html(mensaje = "No encontramos lo que buscás."): string {
  const headHtml = head({
    title: "No encontrado | Ferretería República",
    description: mensaje,
    canonical: `${SITIO_ORIGIN}/catalogo`,
    robots: "noindex, follow",
    og: {
      "og:type": "website",
      "og:site_name": "Ferretería República",
      "og:title": "No encontrado | Ferretería República",
      "og:url": `${SITIO_ORIGIN}/catalogo`,
    },
  });
  const body = `<main><div class="card" style="padding:40px;text-align:center">
<h1>Página no encontrada</h1>
<p class="desc" style="text-align:center">${esc(mensaje)}</p>
<div class="ctas" style="justify-content:center"><a class="cta sec" href="${SITIO_ORIGIN}/catalogo">Ir al catálogo</a></div>
</div></main>`;
  return shell(headHtml, body);
}
