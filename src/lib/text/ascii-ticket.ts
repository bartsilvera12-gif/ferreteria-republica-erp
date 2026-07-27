/**
 * Transliteración a ASCII para tickets térmicos.
 *
 * Las ticketeras imprimen en modo texto con una tabla de caracteres (code
 * page) que no siempre tiene tildes ni ñ: "República" sale "Rep$blica" y
 * "PEQUEÑA" sale "PEQUE?A". El HTML del ticket es UTF-8 correcto, pero el
 * firmware de la impresora igual lo rompe. La solución robusta y estándar en
 * comprobantes térmicos es mandar solo ASCII.
 *
 * Quita acentos (á→a, í→i, ñ→n, Ñ→N…), normaliza signos y descarta cualquier
 * carácter fuera de ASCII. No toca dígitos, letras básicas ni la puntuación.
 */
export function asciiTicket(s: string): string {
  return String(s ?? "")
    // Descompone letras acentuadas y elimina las marcas diacríticas.
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Signos de apertura (no existen en las code pages básicas).
    .replace(/¿/g, "?")
    .replace(/¡/g, "!")
    // Comillas y guiones "tipográficos" → sus equivalentes ASCII.
    .replace(/[“”″]/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    // Símbolos que el ticket usa a propósito: se MAPEAN, no se descartan.
    .replace(/×/g, "x")     // "2 × Gs" → "2 x Gs"
    .replace(/·/g, "-")     // separador "· Mesa" → "- Mesa"
    .replace(/→/g, "->")
    .replace(/[─━]/g, "-")  // líneas divisorias
    // Símbolos sueltos que suelen imprimir basura.
    .replace(/°/g, "")
    .replace(/[₲]/g, "Gs")
    // Cualquier cosa que todavía no sea ASCII imprimible se descarta.
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}
