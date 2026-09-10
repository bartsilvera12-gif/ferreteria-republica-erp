/**
 * Sanitización server-side de rich text para descripción/especificaciones de
 * producto. La sanitización NUNCA depende del frontend.
 *
 * Pipeline (correcciones aprobadas):
 *   input HTML → sanitizeRichHtml() → HTML seguro → htmlToPlainText(HTML seguro)
 *   → texto plano (para descripcion, búsqueda, meta description, JSON-LD).
 *
 * Allowlist: p br strong em b i h2 h3 ul ol li a.  Prohibido: h1 img video
 * iframe script style class id on* javascript: data:.  Enlaces: solo http/https/
 * mailto, con rel="nofollow noopener noreferrer".
 */
import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "b", "i", "h2", "h3", "ul", "ol", "li", "a"];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { a: ["http", "https", "mailto"] },
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // script/style/textarea/option: se descarta el tag Y su contenido (default de la lib).
  transformTags: {
    a: (_tag, attribs) => {
      const out: Record<string, string> = {};
      if (attribs.href) out.href = attribs.href; // el scheme lo filtra allowedSchemesByTag
      out.rel = "nofollow noopener noreferrer";
      if (attribs.target === "_blank") out.target = "_blank";
      return { tagName: "a", attribs: out };
    },
  },
};

/** Sanitiza HTML de rich text con allowlist estricta. Devuelve HTML seguro. */
export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return "";
  return sanitizeHtml(String(input), OPTIONS).trim();
}

/**
 * Deriva texto plano de HTML **ya sanitizado**. No usa dependencia extra:
 * inserta saltos en límites de bloque, quita todos los tags (allowlist vacía,
 * que además decodifica entidades) y normaliza espacios/saltos excesivos.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&"); // amp al final para no doble-decodificar
}

export function htmlToPlainText(safeHtml: string | null | undefined): string {
  if (!safeHtml) return "";
  const withBreaks = String(safeHtml)
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|h2|h3|li|ul|ol)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  // sanitize-html quita los tags pero RE-CODIFICA entidades; las decodificamos
  // para dejar texto plano limpio (meta description, búsqueda, JSON-LD).
  const text = decodeEntities(sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} }));
  return text
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Procesa el rich text entrante: sanitiza y deriva el texto plano SIEMPRE a
 * partir del HTML ya sanitizado (nunca del HTML crudo).
 */
export function processRichText(inputHtml: string | null | undefined): { html: string; text: string } {
  const html = sanitizeRichHtml(inputHtml);
  const text = htmlToPlainText(html);
  return { html, text };
}

/**
 * Decide qué persistir para descripcion / descripcion_html según el body:
 *  A) descripcion_html presente → sanitiza HTML y DERIVA descripcion plano
 *     (ignora cualquier `descripcion` contradictoria recibida).
 *  B) solo descripcion presente (caller legacy) → actualiza descripcion y pone
 *     descripcion_html = NULL, para no dejar HTML viejo contradiciendo el texto.
 *  C) ninguno presente → no toca nada (devuelve {}).
 * Devuelve solo las claves que hay que escribir.
 */
export function resolveDescripcionFields(body: {
  descripcion_html?: unknown;
  descripcion?: unknown;
}): { descripcion?: string | null; descripcion_html?: string | null } {
  if (body.descripcion_html !== undefined) {
    const { html, text } = processRichText(
      typeof body.descripcion_html === "string" ? body.descripcion_html : ""
    );
    return { descripcion_html: html || null, descripcion: text || null };
  }
  if (body.descripcion !== undefined) {
    const d = body.descripcion == null ? null : String(body.descripcion).trim() || null;
    return { descripcion: d, descripcion_html: null };
  }
  return {};
}

/**
 * Convierte texto plano legacy (descripcion sin descripcion_html) a HTML seguro
 * SOLO para inicializar el editor en memoria (no se persiste al abrir).
 */
export function plainTextToSafeHtml(text: string | null | undefined): string {
  const t = String(text ?? "").trim();
  if (!t) return "";
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return t
    .split(/\n{2,}/)
    .map((p) => "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>")
    .join("");
}
