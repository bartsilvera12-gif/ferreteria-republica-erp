import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getReporteFacturas, type FacturaReporteRow } from "@/lib/reportes/server/reporte-facturas-pg";
import { membreteA4 } from "@/lib/documentos/membrete";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function gs(v: number): string {
  return Math.round(v || 0).toLocaleString("es-PY");
}
function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fechaCorta(iso: string): string {
  try {
    const s = new Intl.DateTimeFormat("es-PY", {
      timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
    return s;
  } catch { return iso; }
}
function fechaDia(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/** GET /api/reportes/facturas/pdf?desde=&hasta=&cliente_id= → HTML A4 imprimible. */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  try {
    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const url = new URL(request.url);
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
    const desde = RE_FECHA.test(url.searchParams.get("desde") ?? "") ? String(url.searchParams.get("desde")) : `${hoy.slice(0, 7)}-01`;
    const hasta = RE_FECHA.test(url.searchParams.get("hasta") ?? "") ? String(url.searchParams.get("hasta")) : hoy;
    const clienteId = url.searchParams.get("cliente_id")?.trim() || null;
    const auto = url.searchParams.get("auto") === "1";

    const r = await getReporteFacturas(schema, ctx.auth.empresa_id, { desde, hasta, clienteId });

    const filas = r.facturas
      .map((f: FacturaReporteRow) => {
        const ivaTotal = f.iva_5 + f.iva_10;
        const cliente = f.cliente_nombre?.trim() || "Consumidor Final";
        return `<tr>
          <td class="mono">${esc(f.numero_completo)}</td>
          <td>${esc(fechaCorta(f.emitida_at))}</td>
          <td>${esc(cliente)}${f.cliente_ruc ? ` <span class="ruc">${esc(f.cliente_ruc)}</span>` : ""}</td>
          <td class="cap">${f.condicion === "credito" ? "Crédito" : "Contado"}</td>
          <td class="num">${gs(f.exentas)}</td>
          <td class="num">${gs(f.gravado_5)}</td>
          <td class="num">${gs(f.gravado_10)}</td>
          <td class="num">${gs(ivaTotal)}</td>
          <td class="num tot">${gs(f.total)}</td>
        </tr>`;
      })
      .join("");

    const ivaTotalGeneral = r.totales.iva_5 + r.totales.iva_10;

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Facturas emitidas ${esc(fechaDia(desde))} a ${esc(fechaDia(hasta))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111; background:#f1f1f1; margin:0; padding:22px; }
  .doc { background:#fff; max-width:1050px; margin:0 auto; padding:26px 30px; box-shadow:0 1px 6px rgba(0,0,0,.12); }
  .titulo { text-align:center; font-weight:800; font-size:16px; letter-spacing:1.5px; border:2px solid #111; padding:7px; margin:10px 0 6px; }
  .rango { text-align:center; font-size:12px; color:#555; margin-bottom:14px; }
  table { width:100%; border-collapse:collapse; font-size:11.5px; }
  th, td { border:1px solid #dcdcdc; padding:5px 7px; text-align:left; vertical-align:top; }
  th { background:#f4f7f7; font-size:10px; text-transform:uppercase; letter-spacing:.4px; color:#3F8E91; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.mono { font-family:ui-monospace,monospace; font-weight:600; white-space:nowrap; }
  td.cap { text-transform:capitalize; }
  td.tot { font-weight:700; }
  .ruc { color:#888; font-size:10px; }
  tfoot td { border-top:2px solid #111; font-weight:800; background:#fafafa; }
  .vacio { text-align:center; color:#888; padding:24px; font-size:13px; }
  .foot { margin-top:16px; font-size:10.5px; color:#666; border-top:1px dashed #bbb; padding-top:8px; display:flex; justify-content:space-between; }
  .actions { max-width:1050px; margin:14px auto 0; text-align:center; }
  .actions button { padding:8px 18px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; } .actions { display:none; } @page { size: A4 landscape; margin:12mm; } }
</style></head>
<body><div class="doc">
  ${membreteA4()}
  <div class="titulo">FACTURAS EMITIDAS</div>
  <div class="rango">Del ${esc(fechaDia(desde))} al ${esc(fechaDia(hasta))} · ${r.totales.cantidad} factura${r.totales.cantidad === 1 ? "" : "s"}</div>
  <table>
    <thead>
      <tr>
        <th>N° Factura</th><th>Fecha</th><th>Cliente</th><th>Cond.</th>
        <th class="num">Exentas</th><th class="num">Grav. 5%</th><th class="num">Grav. 10%</th>
        <th class="num">IVA</th><th class="num">Total</th>
      </tr>
    </thead>
    <tbody>
      ${filas || `<tr><td colspan="9" class="vacio">No hay facturas emitidas en el rango seleccionado.</td></tr>`}
    </tbody>
    ${r.totales.cantidad > 0 ? `<tfoot>
      <tr>
        <td colspan="4">TOTALES (${r.totales.cantidad})</td>
        <td class="num">${gs(r.totales.exentas)}</td>
        <td class="num">${gs(r.totales.gravado_5)}</td>
        <td class="num">${gs(r.totales.gravado_10)}</td>
        <td class="num">${gs(ivaTotalGeneral)}</td>
        <td class="num">${gs(r.totales.total)}</td>
      </tr>
    </tfoot>` : ""}
  </table>
  <div class="foot">
    <span>Reporte generado desde Zentra — Ferretería República.</span>
    <span>IVA 5%: ${gs(r.totales.iva_5)} · IVA 10%: ${gs(r.totales.iva_10)}</span>
  </div>
</div>
<div class="actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>try{ if(new URL(location.href).searchParams.get('auto')==='1'){ setTimeout(function(){window.print();},300); } }catch(e){}</script>
</body></html>`;

    void auto;
    return new NextResponse(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/reportes/facturas/pdf]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el reporte.", { status: 500 });
  }
}
