import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { getDetalleCaja } from "@/lib/caja/server";
import { membreteA4 } from "@/lib/documentos/membrete";

function gs(v: number): string { return Math.round(v || 0).toLocaleString("es-PY"); }
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fechaHora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}
function hora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  } catch { return iso; }
}
const MEDIO: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", mixto: "Mixto", qr: "QR", billetera: "Billetera", saldo_favor: "Saldo a favor", otro: "Otro" };

/** GET /api/reportes/cajas/[id]/pdf — arqueo/detalle de un turno, imprimible A4. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const data = await getDetalleCaja(ctx.supabase, ctx.auth.empresa_id, id);
    if (!data) return new NextResponse("Turno no encontrado", { status: 404 });
    const c = data.caja;

    // Línea de tiempo unificada (misma lógica que la pantalla): apertura + ventas + movimientos.
    type Row = { ts: string; tipo: string; detalle: string; medio: string | null; monto: number; signo: number; tachado?: boolean };
    const timeline: Row[] = [];
    timeline.push({
      ts: c.fecha_apertura, tipo: "Apertura",
      detalle: c.abierta_por_nombre ? `Abrió ${c.abierta_por_nombre}` : "Apertura de caja",
      medio: "efectivo", monto: c.monto_apertura, signo: 1,
    });
    for (const v of data.ventas) {
      timeline.push({
        ts: v.fecha, tipo: "Venta",
        detalle: `${v.numero_control ?? "Venta"}${v.tipo_venta ? ` · ${v.tipo_venta}` : ""}`,
        medio: v.metodo_pago, monto: v.total, signo: 1, tachado: v.estado === "anulada",
      });
    }
    for (const m of data.movimientos) {
      const esEntrada = m.tipo === "ingreso" || (m.tipo === "ajuste" && m.monto >= 0);
      const tipoLabel = m.tipo === "ingreso" ? "Ingreso" : m.tipo === "egreso" ? "Egreso" : m.tipo === "retiro" ? "Retiro" : "Ajuste";
      const autor = m.usuario_nombre || m.usuario_email;
      timeline.push({
        ts: m.created_at, tipo: tipoLabel,
        detalle: autor ? `${m.concepto} · ${autor}` : m.concepto,
        medio: m.medio_pago, monto: Math.abs(m.monto), signo: esEntrada ? 1 : -1,
      });
    }
    timeline.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

    const dif = c.diferencia;
    const difTxt = dif == null ? "turno abierto" : `${dif > 0 ? "+" : ""}Gs. ${gs(dif)}`;

    const filas = timeline.map((r) => `<tr class="${r.tachado ? "anul" : ""}">
      <td class="mono">${esc(hora(r.ts))}</td>
      <td>${esc(r.tipo)}</td>
      <td>${esc(r.detalle)}${r.tachado ? ' <span class="anulbadge">(anulada)</span>' : ""}</td>
      <td>${r.medio ? esc(MEDIO[r.medio] ?? r.medio) : "—"}</td>
      <td class="num ${r.signo < 0 ? "neg" : "pos"}">${r.signo < 0 ? "−" : "+"}${gs(r.monto)}</td>
    </tr>`).join("");

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Arqueo de caja — turno ${esc(fechaHora(c.fecha_apertura))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, Arial, sans-serif; color:#111; background:#f1f1f1; margin:0; padding:22px; }
  .doc { background:#fff; max-width:900px; margin:0 auto; padding:26px 30px; box-shadow:0 1px 6px rgba(0,0,0,.12); }
  .titulo { text-align:center; font-weight:800; font-size:16px; letter-spacing:1.5px; border:2px solid #111; padding:7px; margin:10px 0 6px; }
  .sub { text-align:center; font-size:12px; color:#555; margin-bottom:6px; }
  .meta { display:flex; flex-wrap:wrap; justify-content:center; gap:6px 22px; font-size:11px; color:#666; margin-bottom:16px; }
  .meta b { color:#111; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; justify-content:center; margin-bottom:18px; }
  .card { border:1px solid #e2e7ef; border-radius:8px; padding:8px 14px; text-align:center; min-width:120px; }
  .card.hi { border-color:#4FAEB2; background:#E5F4F4; }
  .card .lbl { font-size:9.5px; text-transform:uppercase; letter-spacing:.4px; color:#3F8E91; }
  .card .val { font-size:15px; font-weight:800; color:#111; font-variant-numeric:tabular-nums; }
  .card .hint { font-size:9px; color:#888; margin-top:1px; }
  h3 { font-size:11px; text-transform:uppercase; letter-spacing:.6px; color:#3F8E91; margin:0 0 8px; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th, td { border:1px solid #dcdcdc; padding:5px 8px; text-align:left; vertical-align:top; }
  th { background:#f4f7f7; font-size:9.5px; text-transform:uppercase; letter-spacing:.4px; color:#3F8E91; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.mono { font-family:ui-monospace,monospace; white-space:nowrap; }
  td.num.neg { color:#b91c1c; } td.num.pos { color:#047857; }
  tr.anul td { color:#b91c1c; text-decoration:line-through; }
  .anulbadge { font-size:9px; color:#b91c1c; text-decoration:none; }
  .vacio { text-align:center; color:#888; padding:20px; }
  .foot { margin-top:16px; font-size:10.5px; color:#666; border-top:1px dashed #bbb; padding-top:8px; }
  .actions { max-width:900px; margin:14px auto 0; text-align:center; }
  .actions button { padding:8px 18px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; } .actions { display:none; } @page { size:A4; margin:12mm; } }
</style></head>
<body><div class="doc">
  ${membreteA4(url.origin)}
  <div class="titulo">ARQUEO DE CAJA</div>
  <div class="sub">Caja ${esc(c.numero_caja)} · ${c.estado === "cerrada" ? "Cerrada" : c.estado === "en_cierre" ? "En cierre" : "Abierta"}</div>
  <div class="meta">
    <span>Apertura: <b>${esc(fechaHora(c.fecha_apertura))}</b></span>
    <span>Cierre: <b>${c.fecha_cierre ? esc(fechaHora(c.fecha_cierre)) : "— en curso"}</b></span>
    ${c.abierta_por_nombre ? `<span>Abrió: <b>${esc(c.abierta_por_nombre)}</b></span>` : ""}
    ${c.cerrada_por_nombre ? `<span>Cerró: <b>${esc(c.cerrada_por_nombre)}</b></span>` : ""}
  </div>
  <div class="cards">
    <div class="card hi"><div class="lbl">Vendido</div><div class="val">Gs. ${gs(c.total_vendido)}</div><div class="hint">${c.cantidad_ventas} venta(s)</div></div>
    <div class="card"><div class="lbl">Efectivo</div><div class="val">Gs. ${gs(c.total_efectivo)}</div></div>
    <div class="card"><div class="lbl">Tarjeta</div><div class="val">Gs. ${gs(c.total_tarjeta)}</div></div>
    <div class="card"><div class="lbl">Transferencia</div><div class="val">Gs. ${gs(c.total_transferencia)}</div></div>
    <div class="card"><div class="lbl">Efectivo esperado</div><div class="val">Gs. ${gs(c.efectivo_esperado)}</div><div class="hint">apertura + efectivo ± movs</div></div>
    <div class="card"><div class="lbl">Contado / Diferencia</div><div class="val">${c.monto_cierre_contado == null ? "—" : `Gs. ${gs(c.monto_cierre_contado)}`}</div><div class="hint">${esc(difTxt)}</div></div>
  </div>
  <h3>Movimientos del turno</h3>
  <table>
    <thead><tr><th>Hora</th><th>Movimiento</th><th>Detalle</th><th>Método</th><th class="num">Monto</th></tr></thead>
    <tbody>${filas || `<tr><td colspan="5" class="vacio">Sin movimientos en este turno.</td></tr>`}</tbody>
  </table>
  <div class="foot">Arqueo generado desde Zentra — Ferretería República. Documento no fiscal.</div>
</div>
<div class="actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>try{ if(new URL(location.href).searchParams.get('auto')==='1'){ setTimeout(function(){window.print();},300); } }catch(e){}</script>
</body></html>`;

    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    console.error("[/api/reportes/cajas/[id]/pdf]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el arqueo.", { status: 500 });
  }
}
