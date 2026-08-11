/**
 * Comprobante de venta A4 como PDF real (pdf-lib). Documento comercial NO fiscal
 * (distinto del ticket térmico y de la factura del autoimpresor). Se sirve inline
 * (el visor del navegador permite imprimir o descargar) o como adjunto.
 *
 * Logo en NEGRO (silueta 1-bit, misma imagen que el ticket) por pedido: el logo
 * a color se veía lavado en la hoja.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { montosFacturaItemGsPrecioIncluyeIva, type TasaIvaItem } from "@/lib/facturacion/factura-item-montos";

const TINTA = rgb(0.1, 0.12, 0.14);      // casi negro
const SLATE = rgb(0.22, 0.27, 0.34);
const GRIS = rgb(0.42, 0.45, 0.5);
const GRIS_CLARO = rgb(0.85, 0.87, 0.89);
const GRIS_LINEA = rgb(0.91, 0.93, 0.94);
const GRIS_FONDO = rgb(0.96, 0.965, 0.97);

const A4: [number, number] = [595.28, 841.89];
const MX = 48;
const TOP = 800;
const BOTTOM = 92;

export interface ComprobantePdfItem {
  cantidad: number;
  producto_nombre: string;
  sku: string | null;
  total_linea: number;
  tipo_iva: string | null;
  presentacion_nombre?: string | null;
  presentacion_cantidad_base?: number | null;
}
export interface ComprobantePdfData {
  numero_control: string;
  fecha: string;
  metodo_pago: string | null;
  tipo_venta: string | null;
  observaciones: string | null;
  cajero: string | null;
  vendedor: string | null;
  cliente: { nombre: string | null; ruc: string | null; documento: string | null; direccion: string | null; telefono: string | null } | null;
  items: ComprobantePdfItem[];
}
export interface ComprobanteEmisor {
  nombre: string;
  ruc: string | null;
  direccion: string | null;
  telefono: string | null;
  actividad: string | null;
}

function money(v: number): string {
  return "Gs. " + (Math.round(Number(v) || 0)).toLocaleString("es-PY", { maximumFractionDigits: 0 });
}
function fechaHora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}
function tasaDe(tipo: string | null): TasaIvaItem {
  const s = (tipo ?? "").toLowerCase();
  if (s.includes("exent")) return 0;
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10);
  if (n === 0) return 0;
  if (n === 5) return 5;
  return 10;
}
function fit(t: string, f: PDFFont, size: number, max: number): string {
  let s = String(t ?? "");
  if (f.widthOfTextAtSize(s, size) <= max) return s;
  while (s.length > 1 && f.widthOfTextAtSize(s + "…", size) > max) s = s.slice(0, -1);
  return s + "…";
}
function wrap(t: string, f: PDFFont, size: number, max: number): string[] {
  const words = String(t ?? "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const tryLine = cur ? `${cur} ${w}` : w;
    if (f.widthOfTextAtSize(tryLine, size) <= max) cur = tryLine;
    else { if (cur) lines.push(cur); cur = f.widthOfTextAtSize(w, size) > max ? fit(w, f, size, max) : w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function logoBytes(): Uint8Array | null {
  try {
    // Logo NEGRO (mismo que el ticket): silueta nítida sobre transparente.
    const p = path.join(process.cwd(), "public", "brand", "ferreteriarepublica-ticket-logo-bw.png");
    if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p));
  } catch { /* sin logo */ }
  return null;
}

interface Ctx { doc: PDFDocument; page: PDFPage; y: number; reg: PDFFont; bold: PDFFont; logo: PDFImage | null; emisor: ComprobanteEmisor; }

function membrete(c: Ctx) {
  const { page, bold, reg, emisor } = c;
  const rightX = A4[0] - MX;
  let ly = c.y;
  if (c.logo) {
    const w = 96;
    const h = (c.logo.height / c.logo.width) * w;
    const hh = Math.min(h, 46);
    page.drawImage(c.logo, { x: MX, y: c.y - hh + 4, width: (hh / h) * w, height: hh });
  }
  const drawR = (t: string, size: number, f: PDFFont, color = GRIS) => {
    const tw = f.widthOfTextAtSize(t, size);
    page.drawText(t, { x: rightX - tw, y: ly, size, font: f, color });
  };
  drawR(fit(emisor.nombre, bold, 13, 320), 13, bold, TINTA); ly -= 15;
  if (emisor.actividad) { for (const ln of wrap(emisor.actividad, reg, 7.5, 320).slice(0, 2)) { drawR(ln, 7.5, reg); ly -= 10; } }
  if (emisor.ruc) { drawR(`RUC: ${emisor.ruc}`, 8, reg); ly -= 11; }
  if (emisor.direccion) { drawR(fit(emisor.direccion, reg, 8, 320), 8, reg); ly -= 11; }
  if (emisor.telefono) { drawR(`Tel: ${emisor.telefono}`, 8, reg); ly -= 11; }
  c.y -= 58;
  page.drawRectangle({ x: MX, y: c.y, width: A4[0] - MX * 2, height: 1.4, color: TINTA });
  c.y -= 24;
}

function pie(doc: PDFDocument, reg: PDFFont, negocio: string) {
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    p.drawRectangle({ x: MX, y: 60, width: A4[0] - MX * 2, height: 0.6, color: GRIS_LINEA });
    const nota = `Este documento no es una factura legal y no tiene validez tributaria. Comprobante interno de ${negocio}.`;
    const nw = reg.widthOfTextAtSize(nota, 7);
    p.drawText(nota, { x: (A4[0] - nw) / 2, y: 48, size: 7, font: reg, color: GRIS });
    const pg = `Página ${i + 1} de ${paginas.length}`;
    const pw = reg.widthOfTextAtSize(pg, 7);
    p.drawText(pg, { x: A4[0] - MX - pw, y: 48, size: 7, font: reg, color: GRIS });
  });
}

export async function buildComprobanteVentaPdf(data: ComprobantePdfData, emisor: ComprobanteEmisor): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lb = logoBytes();
  const logo = lb ? await doc.embedPng(lb) : null;

  const c: Ctx = { doc, page: doc.addPage(A4), y: TOP, reg, bold, logo, emisor };
  const W = A4[0] - MX * 2;
  membrete(c);

  // Título + badge
  c.page.drawText("COMPROBANTE DE VENTA", { x: MX, y: c.y - 6, size: 19, font: bold, color: TINTA });
  const badge = "DOCUMENTO NO FISCAL";
  const bw = bold.widthOfTextAtSize(badge, 7.5);
  c.page.drawRectangle({ x: A4[0] - MX - bw - 16, y: c.y - 10, width: bw + 16, height: 18, color: GRIS_FONDO, borderColor: GRIS_CLARO, borderWidth: 0.8 });
  c.page.drawText(badge, { x: A4[0] - MX - bw - 8, y: c.y - 4, size: 7.5, font: bold, color: SLATE });
  c.y -= 30;

  // Cajas: Comprobante (izq) + Cliente (der)
  const colW = (W - 16) / 2;
  const boxTop = c.y;
  const rx = MX + colW + 16;
  c.page.drawText("COMPROBANTE", { x: MX, y: boxTop, size: 7.5, font: bold, color: GRIS });
  c.page.drawText("CLIENTE", { x: rx, y: boxTop, size: 7.5, font: bold, color: GRIS });
  c.page.drawRectangle({ x: MX, y: boxTop - 5, width: colW, height: 0.8, color: GRIS_CLARO });
  c.page.drawRectangle({ x: rx, y: boxTop - 5, width: colW, height: 0.8, color: GRIS_CLARO });

  const esCredito = (data.tipo_venta ?? "").toUpperCase() === "CREDITO";
  let ly = boxTop - 18;
  const lLine = (label: string, val: string) => {
    c.page.drawText(label, { x: MX, y: ly, size: 8.5, font: bold, color: SLATE });
    const kw = bold.widthOfTextAtSize(label + " ", 8.5);
    c.page.drawText(fit(val, reg, 8.5, colW - kw), { x: MX + kw, y: ly, size: 8.5, font: reg, color: SLATE });
    ly -= 13;
  };
  lLine("N°:", data.numero_control);
  lLine("Fecha:", fechaHora(data.fecha));
  if (data.cajero) lLine("Cajero:", data.cajero);
  if (data.vendedor) lLine("Vendedor:", data.vendedor);
  // chip condición
  const chip = esCredito ? "CRÉDITO" : "CONTADO";
  const cw2 = bold.widthOfTextAtSize(chip, 8);
  c.page.drawRectangle({ x: MX, y: ly - 4, width: cw2 + 14, height: 15, color: esCredito ? rgb(0.99, 0.9, 0.9) : rgb(0.87, 0.96, 0.9) });
  c.page.drawText(chip, { x: MX + 7, y: ly, size: 8, font: bold, color: esCredito ? rgb(0.6, 0.1, 0.1) : rgb(0.09, 0.4, 0.2) });
  const leftBottom = ly - 8;

  // Cliente
  let ry = boxTop - 18;
  const cli = data.cliente && (data.cliente.nombre || data.cliente.ruc || data.cliente.documento);
  if (cli) {
    c.page.drawText(fit(data.cliente!.nombre || "—", bold, 10, colW), { x: rx, y: ry, size: 10, font: bold, color: TINTA }); ry -= 13;
    const lineas = [
      data.cliente!.ruc ? `RUC: ${data.cliente!.ruc}` : (data.cliente!.documento ? `Doc: ${data.cliente!.documento}` : ""),
      data.cliente!.telefono ? `Tel: ${data.cliente!.telefono}` : "",
      data.cliente!.direccion ?? "",
    ].filter(Boolean);
    for (const l of lineas) { c.page.drawText(fit(l, reg, 8.5, colW), { x: rx, y: ry, size: 8.5, font: reg, color: SLATE }); ry -= 12; }
  } else {
    c.page.drawText("Consumidor final", { x: rx, y: ry, size: 9, font: reg, color: SLATE }); ry -= 12;
  }
  c.y = Math.min(leftBottom, ry) - 16;

  // Tabla: Cant · Descripción · IVA · P.Unit · Importe
  const cw = [56, 0, 42, 84, 88];
  cw[1] = W - (cw[0] + cw[2] + cw[3] + cw[4]);
  const cx: number[] = []; let acc = MX; for (const w of cw) { cx.push(acc); acc += w; }
  const drawHeader = () => {
    c.page.drawRectangle({ x: MX, y: c.y - 6, width: W, height: 20, color: TINTA });
    const th = (t: string, i: number, align: "l" | "r" | "c") => {
      const tw = bold.widthOfTextAtSize(t, 7.5);
      const x = align === "r" ? cx[i] + cw[i] - tw - 8 : align === "c" ? cx[i] + (cw[i] - tw) / 2 : cx[i] + 8;
      c.page.drawText(t, { x, y: c.y, size: 7.5, font: bold, color: rgb(1, 1, 1) });
    };
    th("CANT.", 0, "c"); th("DESCRIPCIÓN", 1, "l"); th("IVA", 2, "c"); th("P. UNIT.", 3, "r"); th("IMPORTE", 4, "r");
    c.y -= 24;
  };
  drawHeader();

  let sumSub = 0, sumEx = 0, sumIva5 = 0, sumIva10 = 0, sumTot = 0;
  const NAME_LH = 12, SKU_LH = 11, PAD = 9;
  for (const it of data.items) {
    const cant = Number(it.cantidad) || 0;
    const tasa = tasaDe(it.tipo_iva);
    const totalLinea = Number(it.total_linea) || 0;
    const { subtotal, iva } = montosFacturaItemGsPrecioIncluyeIva(totalLinea, tasa);
    sumSub += subtotal; sumTot += totalLinea;
    if (tasa === 0) sumEx += totalLinea; else if (tasa === 5) sumIva5 += iva; else sumIva10 += iva;
    const punit = cant > 0 ? totalLinea / cant : totalLinea;

    const pres = (it.presentacion_nombre ?? "").trim();
    const cantBase = it.presentacion_cantidad_base != null ? Number(it.presentacion_cantidad_base) : 1;
    const showsPres = !!pres && pres.toLowerCase() !== "unidad";
    const cantTxt = showsPres ? `${cant} ${pres}` : `${cant}`;
    const skuTxt = [it.sku ? String(it.sku) : "", showsPres && cantBase > 1 ? `= ${cant * cantBase} u.` : ""].filter(Boolean).join("   ");

    const nameLines = wrap(it.producto_nombre, bold, 9.5, cw[1] - 16);
    const rowH = nameLines.length * NAME_LH + (skuTxt ? SKU_LH : 0) + PAD;
    if (c.y - rowH < BOTTOM + 40) { c.page = doc.addPage(A4); c.y = TOP; membrete(c); drawHeader(); }

    const baseY = c.y - 3;
    c.page.drawText(fit(cantTxt, reg, 8.5, cw[0] - 6), { x: cx[0] + (cw[0] - reg.widthOfTextAtSize(fit(cantTxt, reg, 8.5, cw[0] - 6), 8.5)) / 2, y: baseY, size: 8.5, font: reg, color: SLATE });
    let dy = baseY;
    for (const ln of nameLines) { c.page.drawText(ln, { x: cx[1] + 8, y: dy, size: 9.5, font: bold, color: TINTA }); dy -= NAME_LH; }
    if (skuTxt) c.page.drawText(fit(skuTxt, reg, 8, cw[1] - 16), { x: cx[1] + 8, y: dy, size: 8, font: reg, color: GRIS });
    const ivaTxt = tasa === 0 ? "Ex." : `${tasa}%`;
    c.page.drawText(ivaTxt, { x: cx[2] + (cw[2] - reg.widthOfTextAtSize(ivaTxt, 8.5)) / 2, y: baseY, size: 8.5, font: reg, color: SLATE });
    const pu = money(punit);
    c.page.drawText(pu, { x: cx[3] + cw[3] - reg.widthOfTextAtSize(pu, 8.5) - 8, y: baseY, size: 8.5, font: reg, color: SLATE });
    const tot = money(totalLinea);
    c.page.drawText(tot, { x: cx[4] + cw[4] - bold.widthOfTextAtSize(tot, 8.5) - 8, y: baseY, size: 8.5, font: bold, color: TINTA });

    c.y -= rowH;
    c.page.drawRectangle({ x: MX, y: c.y + 4, width: W, height: 0.6, color: GRIS_LINEA });
  }

  // Totales + observaciones (dos columnas)
  if (c.y < BOTTOM + 150) { c.page = doc.addPage(A4); c.y = TOP; membrete(c); }
  c.y -= 16;
  const totTop = c.y;
  const totW = 240; const totX = A4[0] - MX - totW;
  const totLine = (k: string, v: string) => {
    c.page.drawText(k, { x: totX, y: c.y, size: 9.5, font: reg, color: GRIS });
    c.page.drawText(v, { x: A4[0] - MX - reg.widthOfTextAtSize(v, 9.5), y: c.y, size: 9.5, font: reg, color: SLATE });
    c.y -= 15;
  };
  totLine("Subtotal (sin IVA)", money(sumSub));
  if (sumEx > 0) totLine("Exentas", money(sumEx));
  if (sumIva5 > 0) totLine("IVA 5%", money(sumIva5));
  if (sumIva10 > 0) totLine("IVA 10%", money(sumIva10));
  c.y -= 4;
  const barH = 30;
  c.page.drawRectangle({ x: totX - 14, y: c.y - barH, width: totW + 14, height: barH, color: TINTA });
  const barMid = c.y - barH / 2;
  c.page.drawText("TOTAL", { x: totX, y: barMid - 4.5, size: 12, font: bold, color: rgb(1, 1, 1) });
  const totalTxt = money(sumTot);
  c.page.drawText(totalTxt, { x: A4[0] - MX - bold.widthOfTextAtSize(totalTxt, 14), y: barMid - 5, size: 14, font: bold, color: rgb(1, 1, 1) });
  const metodo = ((): string => {
    const m = data.metodo_pago;
    if (m === "tarjeta") return "Tarjeta"; if (m === "transferencia") return "Transferencia";
    if (m === "efectivo") return "Efectivo"; if (m === "mixto") return "Mixto"; return "—";
  })();
  c.y -= barH + 6;
  const fp = `Forma de pago: ${metodo}`;
  c.page.drawText(fp, { x: A4[0] - MX - reg.widthOfTextAtSize(fp, 9.5), y: c.y, size: 9.5, font: reg, color: SLATE });

  // Observaciones (columna izquierda, a la altura de los totales)
  if (data.observaciones) {
    let oy = totTop;
    c.page.drawText("OBSERVACIONES", { x: MX, y: oy, size: 7.5, font: bold, color: GRIS }); oy -= 14;
    for (const ln of wrap(data.observaciones, reg, 9, totX - MX - 20)) { c.page.drawText(ln, { x: MX, y: oy, size: 9, font: reg, color: SLATE }); oy -= 12; }
  }

  // Firmas
  c.y -= 40;
  if (c.y < BOTTOM + 30) { c.page = doc.addPage(A4); c.y = TOP; membrete(c); c.y -= 30; }
  const half = (W - 40) / 2;
  const firm = (x: number, label: string) => {
    c.page.drawRectangle({ x, y: c.y, width: half, height: 0.8, color: GRIS });
    const lw = reg.widthOfTextAtSize(label, 8);
    c.page.drawText(label, { x: x + (half - lw) / 2, y: c.y - 12, size: 8, font: reg, color: GRIS });
  };
  firm(MX, "Entregué conforme");
  firm(MX + half + 40, "Recibí conforme");

  pie(doc, reg, emisor.nombre);
  return await doc.save();
}
