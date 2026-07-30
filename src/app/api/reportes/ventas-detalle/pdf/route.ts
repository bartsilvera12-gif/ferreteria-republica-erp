import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteVentasDetalle, type VentaReporteRow } from "@/lib/reportes/server/reporte-ventas-detalle-pg";
import { membreteA4 } from "@/lib/documentos/membrete";
import { parseFiltrosVentas } from "../route";

function gs(v: number): string { return Math.round(v || 0).toLocaleString("es-PY"); }
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fh(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}
function fd(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** GET /api/reportes/ventas-detalle/pdf — reporte imprimible A4. */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  try {
    const url = new URL(request.url);
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const f = parseFiltrosVentas(url.searchParams);
    const resumido = url.searchParams.get("resumido") === "1";
    const r = await getReporteVentasDetalle(schema, ctx.auth.empresa_id, f);

    const filas = r.ventas.map((v: VentaReporteRow) => {
      const anulada = v.estado === "anulada";
      return `<tr class="${anulada ? "anul" : ""}">
        <td class="mono">${esc(v.numero_control)}</td>
        <td>${esc(fh(v.fecha))}</td>
        <td>${esc(v.cliente_nombre || "Consumidor Final")}</td>
        <td>${esc(v.cajero || "—")}</td>
        <td class="cap">${v.tipo_venta === "CREDITO" ? "Crédito" : "Contado"}</td>
        <td class="ctr">${v.facturada ? `Sí <span class="mono2">${esc(v.numero_factura ?? "")}</span>` : "No"}</td>
        <td class="ctr">${anulada ? "Anulada" : v.tipo_venta === "CREDITO" ? (v.estado_cobro === "pagado" ? "Cobrada" : "Pendiente") : "Cobrada"}</td>
        <td class="num">${gs(v.total)}</td>
      </tr>`;
    }).join("");

    const tabla = resumido ? "" : `<table>
      <thead><tr>
        <th>N° Venta</th><th>Fecha</th><th>Cliente</th><th>Cajero</th><th>Tipo</th><th class="ctr">Facturada</th><th class="ctr">Cobro</th><th class="num">Total</th>
      </tr></thead>
      <tbody>${filas || `<tr><td colspan="8" class="vacio">Sin ventas para los filtros seleccionados.</td></tr>`}</tbody>
    </table>`;

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Reporte de ventas ${esc(fd(f.desde))} a ${esc(fd(f.hasta))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111; background:#f1f1f1; margin:0; padding:22px; }
  .doc { background:#fff; max-width:1050px; margin:0 auto; padding:26px 30px; box-shadow:0 1px 6px rgba(0,0,0,.12); }
  .titulo { text-align:center; font-weight:800; font-size:16px; letter-spacing:1.5px; border:2px solid #111; padding:7px; margin:10px 0 6px; }
  .rango { text-align:center; font-size:12px; color:#555; margin-bottom:6px; }
  .filtros { text-align:center; font-size:10.5px; color:#777; margin-bottom:14px; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:16px; }
  .card { border:1px solid #e2e7ef; border-radius:8px; padding:8px 14px; text-align:center; min-width:120px; }
  .card .lbl { font-size:9.5px; text-transform:uppercase; letter-spacing:.4px; color:#3F8E91; }
  .card .val { font-size:15px; font-weight:800; color:#111; font-variant-numeric:tabular-nums; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th, td { border:1px solid #dcdcdc; padding:5px 7px; text-align:left; vertical-align:top; }
  th { background:#f4f7f7; font-size:9.5px; text-transform:uppercase; letter-spacing:.4px; color:#3F8E91; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.ctr, th.ctr { text-align:center; }
  td.mono { font-family:ui-monospace,monospace; font-weight:600; white-space:nowrap; }
  .mono2 { font-family:ui-monospace,monospace; color:#888; font-size:9.5px; }
  td.cap { text-transform:capitalize; }
  tr.anul td { color:#b91c1c; text-decoration:line-through; }
  .vacio { text-align:center; color:#888; padding:22px; }
  .foot { margin-top:16px; font-size:10.5px; color:#666; border-top:1px dashed #bbb; padding-top:8px; }
  .actions { max-width:1050px; margin:14px auto 0; text-align:center; }
  .actions button { padding:8px 18px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; } .actions { display:none; } @page { size: A4 landscape; margin:12mm; } }
</style></head>
<body><div class="doc">
  ${membreteA4(url.origin)}
  <div class="titulo">REPORTE DE VENTAS</div>
  <div class="rango">Del ${esc(fd(f.desde))} al ${esc(fd(f.hasta))} · ${r.totales.cantidad} venta${r.totales.cantidad === 1 ? "" : "s"}</div>
  <div class="filtros">
    ${f.tipo ? `Tipo: ${f.tipo === "CREDITO" ? "Crédito" : "Contado"} · ` : ""}
    ${f.facturada ? `Facturada: ${f.facturada === "si" ? "Sí" : "No"} · ` : ""}
    ${f.cobro ? `Cobro: ${f.cobro === "cobrado" ? "Cobradas" : "Pendientes"} · ` : ""}
    ${f.cajero ? `Cajero: ${esc(f.cajero)} · ` : ""}
    ${f.codigo ? `Código: ${esc(f.codigo)} · ` : ""}
    ${f.soloAnuladas ? "Solo anuladas · " : ""}
    ${resumido ? "Resumido" : "Detallado"}
  </div>
  <div class="cards">
    <div class="card"><div class="lbl">Total vendido</div><div class="val">Gs. ${gs(r.totales.total)}</div></div>
    <div class="card"><div class="lbl">Contado</div><div class="val">Gs. ${gs(r.totales.total_contado)}</div></div>
    <div class="card"><div class="lbl">Crédito</div><div class="val">Gs. ${gs(r.totales.total_credito)}</div></div>
    <div class="card"><div class="lbl">IVA</div><div class="val">Gs. ${gs(r.totales.monto_iva)}</div></div>
    <div class="card"><div class="lbl">Facturadas</div><div class="val">${r.totales.facturadas}</div></div>
    <div class="card"><div class="lbl">Saldo pendiente</div><div class="val">Gs. ${gs(r.totales.saldo_pendiente)}</div></div>
  </div>
  ${tabla}
  <div class="foot">Reporte generado desde Zentra — Ferretería República. Documento no fiscal.</div>
</div>
<div class="actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>try{ if(new URL(location.href).searchParams.get('auto')==='1'){ setTimeout(function(){window.print();},300); } }catch(e){}</script>
</body></html>`;

    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    console.error("[/api/reportes/ventas-detalle/pdf]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el reporte.", { status: 500 });
  }
}
