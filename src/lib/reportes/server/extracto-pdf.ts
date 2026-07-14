/**
 * Genera el PDF del extracto de crédito de un cliente (pdf-lib, A4).
 * Incluye logo + membrete, datos del cliente, resumen, sus ventas a crédito
 * (con vencimiento/mora) y los cobros registrados. Paginado automático.
 */
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import type { ExtractoCliente } from "@/lib/reportes/types";

const TURQUESA = rgb(79 / 255, 174 / 255, 178 / 255);
const TURQUESA_OSC = rgb(63 / 255, 142 / 255, 145 / 255);
const GRIS = rgb(0.42, 0.45, 0.5);
const GRIS_CLARO = rgb(0.88, 0.9, 0.92);
const NEGRO = rgb(0.1, 0.12, 0.15);
const ROJO = rgb(0.86, 0.15, 0.15);
const VERDE = rgb(0.02, 0.5, 0.35);

const A4: [number, number] = [595.28, 841.89];
const MX = 40;          // margen lateral
const TOP = 802;        // y inicial
const BOTTOM = 56;      // límite inferior

function gs(v: number): string {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fecha(iso: string | null): string {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
/** Recorta el texto para que entre en `max` puntos. */
function fit(t: string, f: PDFFont, size: number, max: number): string {
  let s = String(t ?? "");
  if (f.widthOfTextAtSize(s, size) <= max) return s;
  while (s.length > 1 && f.widthOfTextAtSize(s + "…", size) > max) s = s.slice(0, -1);
  return s + "…";
}

function logoBytes(): Uint8Array | null {
  try {
    const p = path.join(process.cwd(), "public", "brand", "ferreteriarepublica-doc-logo.png");
    if (fs.existsSync(p)) return new Uint8Array(fs.readFileSync(p));
  } catch { /* sin logo */ }
  return null;
}

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  reg: PDFFont;
  bold: PDFFont;
  logo: PDFImage | null;
  empresa: { nombre: string; telefono: string; direccion: string };
}

function nuevaPagina(c: Ctx) {
  c.page = c.doc.addPage(A4);
  c.y = TOP;
  encabezado(c, false);
}
/** Asegura espacio vertical; si no hay, salta de página. */
function espacio(c: Ctx, alto: number) {
  if (c.y - alto < BOTTOM) nuevaPagina(c);
}

function encabezado(c: Ctx, primera: boolean) {
  const { page, bold, reg } = c;
  if (c.logo) {
    const w = 92;
    const h = (c.logo.height / c.logo.width) * w;
    page.drawImage(c.logo, { x: MX, y: c.y - h + 6, width: w, height: Math.min(h, 44) });
  }
  page.drawText(c.empresa.nombre, { x: MX + (c.logo ? 104 : 0), y: c.y - 10, size: 13, font: bold, color: NEGRO });
  let sy = c.y - 24;
  if (c.empresa.telefono) {
    page.drawText(`Tel: ${c.empresa.telefono}`, { x: MX + (c.logo ? 104 : 0), y: sy, size: 8, font: reg, color: GRIS });
    sy -= 11;
  }
  if (c.empresa.direccion) {
    page.drawText(fit(c.empresa.direccion, reg, 8, 260), { x: MX + (c.logo ? 104 : 0), y: sy, size: 8, font: reg, color: GRIS });
  }

  const titulo = "EXTRACTO DE CRÉDITO";
  const tw = bold.widthOfTextAtSize(titulo, 12);
  page.drawText(titulo, { x: A4[0] - MX - tw, y: c.y - 10, size: 12, font: bold, color: TURQUESA_OSC });
  const sub = `Emitido: ${fecha(new Date().toISOString())}`;
  const sw = reg.widthOfTextAtSize(sub, 8);
  page.drawText(sub, { x: A4[0] - MX - sw, y: c.y - 24, size: 8, font: reg, color: GRIS });

  c.y -= 50;
  page.drawRectangle({ x: MX, y: c.y, width: A4[0] - MX * 2, height: 2, color: TURQUESA });
  c.y -= (primera ? 18 : 16);
}

/** Dibuja una fila de tabla. cols: [texto, x, ancho, align, color?] */
function fila(
  c: Ctx,
  cols: { t: string; x: number; w: number; align?: "l" | "r" | "c"; bold?: boolean; color?: ReturnType<typeof rgb> }[],
  size = 8.5
) {
  for (const col of cols) {
    const f = col.bold ? c.bold : c.reg;
    const t = fit(col.t, f, size, col.w);
    const tw = f.widthOfTextAtSize(t, size);
    const x =
      col.align === "r" ? col.x + col.w - tw : col.align === "c" ? col.x + (col.w - tw) / 2 : col.x;
    c.page.drawText(t, { x, y: c.y, size, font: f, color: col.color ?? NEGRO });
  }
}

export async function buildExtractoPdf(
  data: ExtractoCliente,
  empresa: { nombre: string; telefono: string; direccion: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lb = logoBytes();
  const logo = lb ? await doc.embedPng(lb) : null;

  const c: Ctx = { doc, page: doc.addPage(A4), y: TOP, reg, bold, logo, empresa };
  encabezado(c, true);

  const W = A4[0] - MX * 2;

  // ── Cliente + resumen ────────────────────────────────────────────────────
  const boxH = 62;
  espacio(c, boxH + 10);
  c.page.drawRectangle({ x: MX, y: c.y - boxH, width: W / 2 - 6, height: boxH, borderColor: GRIS_CLARO, borderWidth: 1 });
  c.page.drawText("CLIENTE", { x: MX + 8, y: c.y - 14, size: 7, font: bold, color: GRIS });
  c.page.drawText(fit(data.cliente.nombre, bold, 10, W / 2 - 26), { x: MX + 8, y: c.y - 28, size: 10, font: bold, color: NEGRO });
  let cy = c.y - 40;
  const cliLines = [
    data.cliente.ruc ? `RUC/CI: ${data.cliente.ruc}` : "",
    data.cliente.telefono ? `Tel: ${data.cliente.telefono}` : "",
    data.cliente.direccion ?? "",
  ].filter(Boolean);
  for (const l of cliLines.slice(0, 2)) {
    c.page.drawText(fit(l, reg, 8, W / 2 - 26), { x: MX + 8, y: cy, size: 8, font: reg, color: GRIS });
    cy -= 10;
  }

  // Resumen (4 mini cajas a la derecha)
  const rx = MX + W / 2 + 6;
  const rw = (W / 2 - 6 - 6) / 2;
  const minis: { l: string; v: string; col: ReturnType<typeof rgb> }[] = [
    { l: "TOTAL A CRÉDITO", v: gs(data.totales.total), col: NEGRO },
    { l: "COBRADO", v: gs(data.totales.cobrado), col: VERDE },
    { l: "SALDO PENDIENTE", v: gs(data.totales.saldo), col: TURQUESA_OSC },
    { l: "VENCIDO", v: gs(data.totales.vencido), col: data.totales.vencido > 0 ? ROJO : GRIS },
  ];
  minis.forEach((m, i) => {
    const bx = rx + (i % 2) * (rw + 6);
    const by = c.y - (Math.floor(i / 2) === 0 ? 28 : 62);
    c.page.drawRectangle({ x: bx, y: by, width: rw, height: 28, borderColor: GRIS_CLARO, borderWidth: 1 });
    c.page.drawText(m.l, { x: bx + 6, y: by + 17, size: 6, font: bold, color: GRIS });
    c.page.drawText(fit(m.v, bold, 9, rw - 12), { x: bx + 6, y: by + 6, size: 9, font: bold, color: m.col });
  });
  c.y -= boxH + 18;

  // ── Ventas a crédito ─────────────────────────────────────────────────────
  espacio(c, 40);
  c.page.drawText("VENTAS A CRÉDITO", { x: MX, y: c.y, size: 8, font: bold, color: GRIS });
  c.y -= 14;

  const cw = [70, 58, 78, 78, 78, 78, 55]; // N° / fecha / venc / total / cobrado / saldo / estado
  const cx: number[] = [];
  let acc = MX;
  for (const w of cw) { cx.push(acc); acc += w; }

  const header = () => {
    c.page.drawRectangle({ x: MX, y: c.y - 4, width: W, height: 16, color: rgb(0.898, 0.957, 0.957) });
    fila(c, [
      { t: "N° VENTA", x: cx[0], w: cw[0], bold: true, color: TURQUESA_OSC },
      { t: "FECHA", x: cx[1], w: cw[1], bold: true, color: TURQUESA_OSC },
      { t: "VENCIMIENTO", x: cx[2], w: cw[2], bold: true, color: TURQUESA_OSC },
      { t: "TOTAL", x: cx[3], w: cw[3], align: "r", bold: true, color: TURQUESA_OSC },
      { t: "COBRADO", x: cx[4], w: cw[4], align: "r", bold: true, color: TURQUESA_OSC },
      { t: "SALDO", x: cx[5], w: cw[5], align: "r", bold: true, color: TURQUESA_OSC },
      { t: "ESTADO", x: cx[6], w: cw[6], align: "c", bold: true, color: TURQUESA_OSC },
    ], 7);
    c.y -= 18;
  };
  header();

  const ESTADO: Record<string, string> = { pendiente: "Pendiente", parcial: "Parcial", pagada: "Pagada", vencida: "Vencida" };
  for (const q of data.cuentas) {
    espacio(c, 16);
    if (c.y === TOP - 68) header(); // reencabezar si saltó de página
    const venc = q.dias_vencido > 0 ? `${fecha(q.fecha_vencimiento)} (${q.dias_vencido}d)` : fecha(q.fecha_vencimiento);
    fila(c, [
      { t: q.numero_venta ?? "—", x: cx[0], w: cw[0] },
      { t: fecha(q.fecha_emision), x: cx[1], w: cw[1] },
      { t: venc, x: cx[2], w: cw[2], color: q.dias_vencido > 0 ? ROJO : NEGRO },
      { t: gs(q.total), x: cx[3], w: cw[3], align: "r" },
      { t: gs(q.cobrado), x: cx[4], w: cw[4], align: "r", color: VERDE },
      { t: gs(q.saldo), x: cx[5], w: cw[5], align: "r", bold: true },
      { t: ESTADO[q.estado] ?? q.estado, x: cx[6], w: cw[6], align: "c", color: GRIS },
    ]);
    c.y -= 6;
    c.page.drawRectangle({ x: MX, y: c.y, width: W, height: 0.5, color: GRIS_CLARO });
    c.y -= 10;
  }

  // Totales
  espacio(c, 22);
  c.page.drawRectangle({ x: MX, y: c.y - 4, width: W, height: 16, color: rgb(0.898, 0.957, 0.957) });
  fila(c, [
    { t: "TOTALES", x: cx[0], w: cw[0] + cw[1] + cw[2], bold: true, color: TURQUESA_OSC },
    { t: gs(data.totales.total), x: cx[3], w: cw[3], align: "r", bold: true, color: TURQUESA_OSC },
    { t: gs(data.totales.cobrado), x: cx[4], w: cw[4], align: "r", bold: true, color: TURQUESA_OSC },
    { t: gs(data.totales.saldo), x: cx[5], w: cw[5], align: "r", bold: true, color: TURQUESA_OSC },
  ], 8.5);
  c.y -= 30;

  // ── Cobros ───────────────────────────────────────────────────────────────
  if (data.cobros.length > 0) {
    espacio(c, 40);
    c.page.drawText("COBROS REGISTRADOS", { x: MX, y: c.y, size: 8, font: bold, color: GRIS });
    c.y -= 14;

    const pw = [66, 70, 90, 160, 109];
    const px: number[] = [];
    let pacc = MX;
    for (const w of pw) { px.push(pacc); pacc += w; }

    c.page.drawRectangle({ x: MX, y: c.y - 4, width: W, height: 16, color: rgb(0.898, 0.957, 0.957) });
    fila(c, [
      { t: "FECHA", x: px[0], w: pw[0], bold: true, color: TURQUESA_OSC },
      { t: "N° VENTA", x: px[1], w: pw[1], bold: true, color: TURQUESA_OSC },
      { t: "MÉTODO", x: px[2], w: pw[2], bold: true, color: TURQUESA_OSC },
      { t: "REFERENCIA", x: px[3], w: pw[3], bold: true, color: TURQUESA_OSC },
      { t: "MONTO", x: px[4], w: pw[4], align: "r", bold: true, color: TURQUESA_OSC },
    ], 7);
    c.y -= 18;

    const METODO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", cheque: "Cheque" };
    for (const p of data.cobros) {
      espacio(c, 16);
      fila(c, [
        { t: fecha(p.fecha_pago), x: px[0], w: pw[0] },
        { t: p.numero_venta ?? "—", x: px[1], w: pw[1] },
        { t: p.metodo_pago ? (METODO[p.metodo_pago] ?? p.metodo_pago) : "—", x: px[2], w: pw[2] },
        { t: p.referencia ?? "—", x: px[3], w: pw[3], color: GRIS },
        { t: gs(p.monto), x: px[4], w: pw[4], align: "r", bold: true, color: VERDE },
      ]);
      c.y -= 6;
      c.page.drawRectangle({ x: MX, y: c.y, width: W, height: 0.5, color: GRIS_CLARO });
      c.y -= 10;
    }
  }

  // ── Pie ──────────────────────────────────────────────────────────────────
  espacio(c, 30);
  c.y -= 8;
  const nota = "Documento de seguimiento interno. Los saldos reflejan el estado a la fecha de emisión de este extracto.";
  const nw = reg.widthOfTextAtSize(nota, 7);
  c.page.drawText(nota, { x: (A4[0] - nw) / 2, y: Math.max(BOTTOM - 16, 30), size: 7, font: reg, color: GRIS });

  // Numeración de páginas
  const paginas = doc.getPages();
  paginas.forEach((p, i) => {
    const t = `${i + 1} / ${paginas.length}`;
    const tw = reg.widthOfTextAtSize(t, 7);
    p.drawText(t, { x: A4[0] - MX - tw, y: 28, size: 7, font: reg, color: GRIS });
  });

  return await doc.save();
}
