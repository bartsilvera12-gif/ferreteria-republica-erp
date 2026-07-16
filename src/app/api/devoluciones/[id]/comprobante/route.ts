import { NextRequest, NextResponse } from "next/server";
import { getUserAndEmpresa } from "@/lib/middleware/auth";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { devolucionesEnabled } from "@/lib/devoluciones/feature-flag";
import { getDevolucion } from "@/lib/devoluciones/server/devoluciones-pg";
import { membreteTicket } from "@/lib/documentos/membrete";

/**
 * GET /api/devoluciones/[id]/comprobante?w=58|80&auto=1
 * Comprobante NO FISCAL de la devolución, en formato ticket térmico.
 */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function gs(v: number): string {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function fechaHora(iso: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return String(iso); }
}

export async function GET(request: NextRequest, ctxParams: { params: Promise<{ id: string }> }) {
  if (!devolucionesEnabled()) return new NextResponse("No encontrado", { status: 404 });
  const { id } = await ctxParams.params;
  const url = new URL(request.url);
  const widthMm: 58 | 80 = url.searchParams.get("w") === "58" ? 58 : 80;
  const autoPrint = url.searchParams.get("auto") === "1";

  const auth = await getUserAndEmpresa(request);
  if (!auth?.empresa_id) return new NextResponse("No autorizado", { status: 401 });
  const schema = await fetchDataSchemaForEmpresaId(auth.empresa_id);
  const d = await getDevolucion(schema, auth.empresa_id, id);
  if (!d) return new NextResponse("Devolución no encontrada", { status: 404 });

  const f = widthMm === 58 ? 11 : 12;
  const filas = (d.items ?? []).map((it) => `
    <tr class="it"><td class="qty"><strong>${it.cantidad_devuelta}×</strong></td>
      <td class="name">${esc(it.producto_nombre)}</td>
      <td class="amt">${gs(it.total_devuelto)}</td></tr>
    <tr class="sub"><td></td><td colspan="2">${it.cantidad_devuelta} × ${gs(it.precio_unitario)} · ${
      it.condicion === "danado" ? "dañado, no vuelve al stock" : it.reintegra_stock ? "vuelve al stock" : "no vuelve al stock"
    }</td></tr>`).join("");

  const cambios = (d.cambios ?? []).map((c) => `
    <tr class="it"><td class="qty"><strong>${c.cantidad}×</strong></td>
      <td class="name">${esc(c.producto_nombre)}</td>
      <td class="amt">${gs(c.total)}</td></tr>`).join("");

  const dif = d.diferencia;
  const difTxt = dif > 0 ? "Diferencia cobrada" : dif < 0 ? "Reembolso" : "Sin movimiento";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>${esc(d.numero_devolucion)} — Comprobante de devolución</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Courier New", monospace; font-size:${f}px; color:#000; background:#f1f1f1; margin:0; padding:20px; }
  .paper { background:#fff; width:${widthMm}mm; margin:0 auto; padding:6mm 4mm; box-shadow:0 1px 4px rgba(0,0,0,.1); }
  hr { border:none; border-top:1px dashed #000; margin:2mm 0; }
  .doc-title { text-align:center; font-weight:800; font-size:${f + 2}px; letter-spacing:1px; }
  .doc-num { text-align:center; font-weight:700; font-size:${f + 1}px; }
  .kv { font-size:${f - 1}px; }
  .kv div { display:flex; justify-content:space-between; gap:6px; }
  table { width:100%; border-collapse:collapse; }
  td { vertical-align:top; padding:0.4mm 0; }
  td.qty { width:8mm; }
  td.amt { text-align:right; white-space:nowrap; }
  tr.sub td { color:#333; font-size:${f - 2}px; padding-bottom:1mm; }
  .sec { font-weight:700; font-size:${f - 1}px; margin-top:1mm; }
  .tot div { display:flex; justify-content:space-between; gap:6px; font-size:${f - 1}px; }
  .tot .big { font-weight:800; font-size:${f + 2}px; border-top:1px solid #000; padding-top:1mm; margin-top:1mm; }
  .foot { text-align:center; font-size:${f - 2}px; margin-top:3mm; }
  .anulada { text-align:center; font-weight:800; color:#b91c1c; margin:2mm 0; }
  .actions { max-width:${widthMm}mm; margin:8mm auto 0; text-align:center; }
  .actions button { padding:8px 16px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  .actions a { margin-left:12px; font-size:13px; color:#444; }
  @media print { body { background:#fff; padding:0; } .paper { width:${widthMm}mm; box-shadow:none; padding:2mm; margin:0; } .actions { display:none; } @page { margin:0; size:${widthMm}mm auto; } }
</style></head>
<body>
  <section class="paper">
    ${membreteTicket()}
    <div class="doc-title">DEVOLUCIÓN</div>
    <div class="doc-num">${esc(d.numero_devolucion)}</div>
    ${d.estado === "anulada" ? `<div class="anulada">*** ANULADA ***</div>` : ""}
    <div class="kv" style="margin-top:1mm;">
      <div><span>Fecha</span><span>${esc(fechaHora(d.created_at))}</span></div>
      <div><span>Venta</span><span>${esc(d.venta_numero_control ?? "—")}</span></div>
      ${d.cliente_nombre ? `<div><span>Cliente</span><span>${esc(d.cliente_nombre)}</span></div>` : ""}
      <div><span>Tipo</span><span>${d.tipo === "total" ? "TOTAL" : "PARCIAL"}</span></div>
      <div><span>Resolución</span><span>${d.resolucion === "cambio" ? "CAMBIO" : "REEMBOLSO"}</span></div>
      <div><span>Usuario</span><span>${esc(d.usuario_nombre ?? "—")}</span></div>
    </div>
    <hr>
    <div class="sec">Productos devueltos</div>
    <table><tbody>${filas}</tbody></table>
    <hr>
    <div class="tot"><div><span>Total devuelto</span><span>${gs(d.total_devuelto)}</span></div></div>
    ${cambios ? `<hr><div class="sec">Productos entregados</div><table><tbody>${cambios}</tbody></table>
      <div class="tot"><div><span>Total entregado</span><span>${gs(d.total_entregado)}</span></div></div>` : ""}
    <hr>
    <div class="tot">
      <div class="big"><span>${difTxt}</span><span>${gs(Math.abs(dif))}</span></div>
      ${dif !== 0 ? `<div><span>Método</span><span>${esc((d.metodo_reembolso ?? "").toUpperCase())}</span></div>` : ""}
    </div>
    ${d.motivo ? `<hr><div class="kv"><div><span>Motivo</span><span>${esc(d.motivo)}</span></div></div>` : ""}
    ${d.requiere_nota_credito ? `<div class="foot" style="font-weight:700;">Esta devolución puede requerir una Nota de Crédito fiscal.</div>` : ""}
    <div class="foot" style="font-style:italic;">Comprobante interno de devolución — no válido como documento fiscal.</div>
  </section>
  <div class="actions">
    <button type="button" onclick="window.print()">Imprimir</button>
    <a href="?w=${widthMm === 80 ? 58 : 80}">Cambiar a ${widthMm === 80 ? 58 : 80}mm</a>
  </div>
  <script>try{ if(${autoPrint ? "true" : "false"}){ setTimeout(function(){window.print();},250); } }catch(e){}</script>
</body></html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
