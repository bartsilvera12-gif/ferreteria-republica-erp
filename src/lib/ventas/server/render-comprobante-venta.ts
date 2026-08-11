/**
 * Comprobante de venta A4 (#2) — documento comercial NO fiscal.
 *
 * Es la versión "en hoja" de una venta, con precios y desglose de IVA, pensada
 * para entregar/guardar como PDF (imprimir → Guardar como PDF). No es la factura
 * del autoimpresor (esa es fiscal, con timbrado) ni el ticket térmico.
 *
 * Render PURO: recibe los datos ya resueltos y devuelve HTML. Así el mismo
 * modelo sirve para la ruta real y para una vista previa con datos de muestra.
 */
import { membreteA4 } from "@/lib/documentos/membrete";
import { montosFacturaItemGsPrecioIncluyeIva, type TasaIvaItem } from "@/lib/facturacion/factura-item-montos";

export interface ComprobanteItem {
  cantidad: number;
  producto_nombre: string;
  sku: string | null;
  precio_venta: number;
  total_linea: number;
  tipo_iva: string | null; // 'exenta' | 'iva_5'/'5' | 'iva_10'/'10'
  presentacion_nombre?: string | null;
  presentacion_cantidad_base?: number | null;
}

export interface ComprobanteVentaData {
  negocio: string;
  numero_control: string;
  fecha: string; // ISO
  metodo_pago: string | null;
  tipo_venta: string | null; // 'CONTADO' | 'CREDITO'
  observaciones: string | null;
  cajero: string | null;
  vendedor: string | null;
  cliente: { nombre: string | null; ruc: string | null; documento: string | null; direccion: string | null; telefono: string | null } | null;
  items: ComprobanteItem[];
  origin?: string;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function gs(v: number): string { return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`; }
function tasaDe(tipo: string | null): TasaIvaItem {
  const s = (tipo ?? "").toLowerCase();
  if (s.includes("exent")) return 0;
  const n = parseInt(s.replace(/[^0-9]/g, ""), 10); // '10%'→10, 'iva_5'→5, '0'→0
  if (n === 0) return 0;
  if (n === 5) return 5;
  return 10;
}
function fecha(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}
function metodoLabel(m: string | null): string {
  if (m === "tarjeta") return "Tarjeta";
  if (m === "transferencia") return "Transferencia";
  if (m === "efectivo") return "Efectivo";
  if (m === "mixto") return "Mixto";
  return "—";
}

export function renderComprobanteVentaA4(data: ComprobanteVentaData): string {
  const esCredito = (data.tipo_venta ?? "").toUpperCase() === "CREDITO";
  let sumSubtotal = 0, sumExentas = 0, sumIva5 = 0, sumIva10 = 0, sumTotal = 0;

  const filas = data.items.map((it) => {
    const cant = Number(it.cantidad) || 0;
    const tasa = tasaDe(it.tipo_iva);
    const totalLinea = Number(it.total_linea) || 0;
    const { subtotal, iva } = montosFacturaItemGsPrecioIncluyeIva(totalLinea, tasa);
    sumSubtotal += subtotal;
    sumTotal += totalLinea;
    if (tasa === 0) sumExentas += totalLinea;
    else if (tasa === 5) sumIva5 += iva;
    else sumIva10 += iva;

    const punit = cant > 0 ? totalLinea / cant : totalLinea;
    const pres = (it.presentacion_nombre ?? "").trim();
    const cantBase = it.presentacion_cantidad_base != null ? Number(it.presentacion_cantidad_base) : 1;
    const showsPres = !!pres && pres.toLowerCase() !== "unidad";
    const cantStr = showsPres ? `${cant} ${esc(pres)}` : `${cant}`;
    const equiv = showsPres && cantBase > 1 ? `<span class="equiv">= ${cant * cantBase} u.</span>` : "";
    const ivaTag = tasa === 0 ? "Ex." : `${tasa}%`;

    return `<tr>
      <td class="c">${cantStr}</td>
      <td class="desc">${esc(it.producto_nombre)}${it.sku ? `<span class="sku">${esc(it.sku)}</span>` : ""}${equiv}</td>
      <td class="c">${ivaTag}</td>
      <td class="r">${gs(punit)}</td>
      <td class="r">${gs(totalLinea)}</td>
    </tr>`;
  }).join("");

  const cli = data.cliente && (data.cliente.nombre || data.cliente.ruc || data.cliente.documento)
    ? [
        `<div><strong>${esc(data.cliente.nombre || "—")}</strong></div>`,
        data.cliente.ruc ? `<div>RUC: ${esc(data.cliente.ruc)}</div>` : "",
        !data.cliente.ruc && data.cliente.documento ? `<div>Doc: ${esc(data.cliente.documento)}</div>` : "",
        data.cliente.telefono ? `<div>Tel: ${esc(data.cliente.telefono)}</div>` : "",
        data.cliente.direccion ? `<div>${esc(data.cliente.direccion)}</div>` : "",
      ].filter(Boolean).join("")
    : `<div>Consumidor final</div>`;

  const totalesFilas = [
    `<tr><td class="lbl">Subtotal (sin IVA)</td><td class="val">${gs(sumSubtotal)}</td></tr>`,
    sumExentas > 0 ? `<tr><td class="lbl">Exentas</td><td class="val">${gs(sumExentas)}</td></tr>` : "",
    sumIva5 > 0 ? `<tr><td class="lbl">IVA 5%</td><td class="val">${gs(sumIva5)}</td></tr>` : "",
    sumIva10 > 0 ? `<tr><td class="lbl">IVA 10%</td><td class="val">${gs(sumIva10)}</td></tr>` : "",
  ].filter(Boolean).join("");

  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Comprobante ${esc(data.numero_control)} — ${esc(data.negocio)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111827; background:#eef0f2; margin:0; padding:24px; }
  .doc { background:#fff; max-width:760px; margin:0 auto; padding:30px 34px; box-shadow:0 1px 8px rgba(0,0,0,.12); }
  .titulo { display:flex; align-items:center; justify-content:space-between; gap:16px; margin:6px 0 18px; }
  .titulo .t { font-weight:800; font-size:17px; letter-spacing:2px; color:#1f2937; }
  .titulo .badge { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px; color:#92400e; background:#fef3c7; border:1px solid #fde68a; border-radius:999px; padding:4px 10px; }
  .row { display:flex; gap:16px; margin-bottom:16px; }
  .box { flex:1; border:1px solid #e5e7eb; border-radius:10px; padding:11px 14px; font-size:12.5px; line-height:1.6; }
  .box h3 { margin:0 0 6px; font-size:10.5px; text-transform:uppercase; letter-spacing:1px; color:#6b7280; }
  .cond { display:inline-block; margin-top:4px; font-size:11px; font-weight:700; border-radius:6px; padding:2px 8px; }
  .cond.contado { background:#dcfce7; color:#166534; }
  .cond.credito { background:#fee2e2; color:#991b1b; }
  table.items { width:100%; border-collapse:collapse; font-size:12.5px; }
  table.items thead th { background:#f3f4f6; border-bottom:2px solid #e5e7eb; padding:8px 10px; text-align:left; font-size:10.5px; text-transform:uppercase; letter-spacing:.5px; color:#4b5563; }
  table.items td { border-bottom:1px solid #f1f1f1; padding:8px 10px; vertical-align:top; }
  table.items td.c, table.items th.c { text-align:center; white-space:nowrap; width:52px; }
  table.items td.r, table.items th.r { text-align:right; white-space:nowrap; }
  table.items td.desc .sku { display:block; font-size:10.5px; color:#9ca3af; font-family:ui-monospace,monospace; }
  table.items td.desc .equiv { display:inline-block; margin-top:2px; font-size:10.5px; color:#6b7280; }
  .bottom { display:flex; justify-content:space-between; gap:24px; margin-top:16px; }
  .obs { flex:1; font-size:12px; color:#374151; }
  .obs .lbl { font-size:10.5px; text-transform:uppercase; letter-spacing:1px; color:#6b7280; margin-bottom:3px; }
  table.tot { width:280px; border-collapse:collapse; font-size:13px; }
  table.tot td { padding:5px 4px; }
  table.tot td.lbl { color:#4b5563; }
  table.tot td.val { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  table.tot tr.total td { border-top:2px solid #111827; font-weight:800; font-size:16px; padding-top:8px; }
  .pago { margin-top:6px; text-align:right; font-size:12.5px; color:#374151; }
  .firmas { display:flex; gap:40px; margin-top:34px; }
  .firma { flex:1; text-align:center; font-size:11px; color:#6b7280; }
  .firma .linea { border-top:1px solid #9ca3af; margin-bottom:5px; padding-top:6px; }
  .legal { margin-top:20px; font-size:10.5px; color:#6b7280; border-top:1px dashed #d1d5db; padding-top:10px; text-align:center; }
  .actions { max-width:760px; margin:14px auto 0; text-align:center; }
  .actions button { padding:9px 18px; font-size:13px; cursor:pointer; border:1px solid #2E7D32; background:#2E7D32; color:#fff; border-radius:8px; font-weight:600; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; padding:14px 8px; } .actions { display:none; } @page { margin:12mm; size:A4; } }
</style></head>
<body>
<div class="doc">
  ${membreteA4(data.origin ?? "")}
  <div class="titulo">
    <span class="t">COMPROBANTE DE VENTA</span>
    <span class="badge">Documento no fiscal</span>
  </div>

  <div class="row">
    <div class="box"><h3>Comprobante</h3>
      <div><strong>N°:</strong> ${esc(data.numero_control)}</div>
      <div><strong>Fecha:</strong> ${esc(fecha(data.fecha))}</div>
      ${data.cajero ? `<div><strong>Cajero:</strong> ${esc(data.cajero)}</div>` : ""}
      ${data.vendedor ? `<div><strong>Vendedor:</strong> ${esc(data.vendedor)}</div>` : ""}
      <div class="cond ${esCredito ? "credito" : "contado"}">${esCredito ? "CRÉDITO" : "CONTADO"}</div>
    </div>
    <div class="box"><h3>Cliente</h3>${cli}</div>
  </div>

  <table class="items">
    <thead><tr>
      <th class="c">Cant.</th><th>Descripción</th><th class="c">IVA</th><th class="r">P. Unit.</th><th class="r">Importe</th>
    </tr></thead>
    <tbody>${filas}</tbody>
  </table>

  <div class="bottom">
    <div class="obs">
      ${data.observaciones ? `<div class="lbl">Observaciones</div>${esc(data.observaciones)}` : ""}
    </div>
    <div>
      <table class="tot">
        <tbody>
          ${totalesFilas}
          <tr class="total"><td class="lbl">TOTAL</td><td class="val">${gs(sumTotal)}</td></tr>
        </tbody>
      </table>
      <div class="pago"><strong>Forma de pago:</strong> ${esc(metodoLabel(data.metodo_pago))}</div>
    </div>
  </div>

  <div class="firmas">
    <div class="firma"><div class="linea"></div>Entregué conforme</div>
    <div class="firma"><div class="linea"></div>Recibí conforme</div>
  </div>

  <div class="legal">
    Este documento no es una factura legal y no tiene validez tributaria. Comprobante interno de ${esc(data.negocio)}.
  </div>
</div>
<div class="actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>try{ if (new URL(location.href).searchParams.get('auto')==='1') setTimeout(function(){window.print();},250); }catch(e){}</script>
</body></html>`;
}
