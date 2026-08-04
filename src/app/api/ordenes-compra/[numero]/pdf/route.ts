import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getOrdenCompra } from "@/lib/ordenes-compra/server/ordenes-compra-pg";
import { membreteA4 } from "@/lib/documentos/membrete";

function gs(v: number): string { return Math.round(v || 0).toLocaleString("es-PY"); }
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fechaDia(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
  } catch { return iso; }
}
function ivaLbl(t: string): string { return t === "exenta" ? "Exenta" : `${t}%`; }
const n = (v: unknown): number => { const x = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/** GET /api/ordenes-compra/[numero]/pdf — orden de compra imprimible A4. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ numero: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  try {
    const { numero } = await params;
    const numeroOc = decodeURIComponent(numero);
    const url = new URL(request.url);
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const filas = await getOrdenCompra(schema, ctx.auth.empresa_id, numeroOc);
    if (filas.length === 0) return new NextResponse("Orden de compra no encontrada", { status: 404 });

    const cab = filas[0];
    const moneda = String(cab.moneda) === "USD" ? "USD" : "Gs.";
    const tipoPago = String(cab.tipo_pago) === "credito" ? `Crédito${cab.plazo_dias ? ` (${cab.plazo_dias} días)` : ""}` : "Contado";

    let subtotal = 0, iva = 0, total = 0;
    const items = filas.map((f) => {
      const cant = n(f.cantidad);
      const costo = n(f.costo_unitario);
      const tot = n(f.total);
      subtotal += n(f.subtotal); iva += n(f.monto_iva); total += tot;
      return `<tr>
        <td>${esc(f.producto_nombre)}${f.unidad_medida ? ` <span class="u">${esc(f.unidad_medida)}</span>` : ""}</td>
        <td class="num">${gs(cant)}</td>
        <td class="num">${gs(costo)}</td>
        <td class="ctr">${esc(ivaLbl(String(f.iva_tipo)))}</td>
        <td class="num">${gs(tot)}</td>
      </tr>`;
    }).join("");

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Orden de compra ${esc(cab.numero_oc)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111; background:#f1f1f1; margin:0; padding:22px; }
  .doc { background:#fff; max-width:820px; margin:0 auto; padding:26px 30px; box-shadow:0 1px 6px rgba(0,0,0,.12); }
  .titulo { text-align:center; font-weight:800; font-size:16px; letter-spacing:1.5px; border:2px solid #111; padding:7px; margin:10px 0 12px; }
  .row { display:flex; flex-wrap:wrap; gap:24px; font-size:12px; margin-bottom:14px; }
  .box { flex:1; min-width:220px; border:1px solid #e2e7ef; border-radius:8px; padding:10px 12px; }
  .box h3 { margin:0 0 6px; font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#3F8E91; }
  .box b { color:#111; }
  table { width:100%; border-collapse:collapse; font-size:12px; margin-top:6px; }
  th, td { border:1px solid #dcdcdc; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#f4f7f7; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#3F8E91; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.ctr, th.ctr { text-align:center; }
  .u { color:#888; font-size:10px; }
  tfoot td { border-top:2px solid #111; font-weight:700; background:#fafafa; }
  .obs { margin-top:12px; font-size:11px; color:#555; }
  .foot { margin-top:18px; font-size:10.5px; color:#666; border-top:1px dashed #bbb; padding-top:8px; }
  .actions { max-width:820px; margin:14px auto 0; text-align:center; }
  .actions button { padding:8px 18px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; } .actions { display:none; } @page { size:A4; margin:12mm; } }
</style></head>
<body><div class="doc">
  ${membreteA4()}
  <div class="titulo">ORDEN DE COMPRA</div>
  <div class="row">
    <div class="box"><h3>Orden</h3>
      <div><b>N°:</b> ${esc(cab.numero_oc)}</div>
      <div><b>Fecha:</b> ${esc(fechaDia(cab.fecha))}</div>
      <div><b>Condición:</b> ${esc(tipoPago)}</div>
      <div><b>Moneda:</b> ${moneda === "USD" ? "Dólares (USD)" : "Guaraníes (Gs.)"}</div>
    </div>
    <div class="box"><h3>Proveedor</h3>
      <div><b>${esc(cab.proveedor_nombre || "—")}</b></div>
      ${cab.numero_factura ? `<div>N° factura: ${esc(cab.numero_factura)}</div>` : ""}
      ${cab.nro_timbrado ? `<div>Timbrado: ${esc(cab.nro_timbrado)}</div>` : ""}
    </div>
  </div>
  <table>
    <thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Costo unit. (${moneda})</th><th class="ctr">IVA</th><th class="num">Total (${moneda})</th></tr></thead>
    <tbody>${items}</tbody>
    <tfoot>
      <tr><td colspan="4">Subtotal (sin IVA)</td><td class="num">${gs(subtotal)}</td></tr>
      <tr><td colspan="4">IVA</td><td class="num">${gs(iva)}</td></tr>
      <tr><td colspan="4">TOTAL</td><td class="num">${gs(total)}</td></tr>
    </tfoot>
  </table>
  ${cab.observacion ? `<div class="obs"><b>Observación:</b> ${esc(cab.observacion)}</div>` : ""}
  <div class="foot">Orden de compra generada desde Zentra — Ferretería República. Documento interno, no fiscal.</div>
</div>
<div class="actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>try{ if(new URL(location.href).searchParams.get('auto')==='1'){ setTimeout(function(){window.print();},300); } }catch(e){}</script>
</body></html>`;

    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    console.error("[/api/ordenes-compra/[numero]/pdf]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar la orden de compra.", { status: 500 });
  }
}
