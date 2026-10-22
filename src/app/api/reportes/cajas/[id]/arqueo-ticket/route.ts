import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { getDetalleCajaPg } from "@/lib/caja/reporte-pg";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { membreteTicket } from "@/lib/documentos/membrete";
import { asciiTicket } from "@/lib/text/ascii-ticket";

/**
 * GET /api/reportes/cajas/[id]/arqueo-ticket?w=58|80&auto=1
 *
 * Arqueo RESUMIDO en formato TICKET (58/80mm) para que el cajero lo imprima y
 * entregue al cerrar su jornada. NO fiscal. Reúne, por método de pago:
 * monto y cantidad de ventas, esperado, contado y diferencia; el efectivo
 * dejado en caja y lo extraído a tesorería; y los usuarios de apertura/cierre.
 */

function gs(v: number): string {
  return `Gs. ${Math.round(v || 0).toLocaleString("es-PY")}`;
}
function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function fechaHora(iso: string): string {
  try {
    return new Intl.DateTimeFormat("es-PY", {
      timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return iso; }
}
function signo(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${gs(Math.abs(n)).replace("Gs. ", "")}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const widthMm = url.searchParams.get("w") === "80" ? 80 : 58;
    const fontPx = widthMm === 58 ? 11 : 12;

    const schema = await fetchDataSchemaForEmpresaId(ctx.auth.empresa_id);
    const data = await getDetalleCajaPg(schema, ctx.auth.empresa_id, id);
    if (!data) return new NextResponse("Turno no encontrado", { status: 404 });
    const c = data.caja;

    // Esperado en caja (efectivo): apertura + ventas efectivo ± movimientos.
    // Si la caja ya cerró, usamos el esperado persistido.
    const espEfectivo = c.monto_esperado_efectivo ?? c.efectivo_esperado;
    const contEfectivo = c.monto_cierre_contado; // efectivo físico contado al cerrar
    const difEfectivo = c.diferencia; // contado - esperado (null si abierta)

    const espTarjeta = c.total_tarjeta; // esperado = lo registrado por el sistema
    const contTarjeta = c.tarjeta_contado; // contado del cierre del POS
    const difTarjeta = contTarjeta == null ? null : contTarjeta - espTarjeta;

    const espTransfer = c.total_transferencia;
    const contTransfer = c.transferencia_contado;
    const difTransfer = contTransfer == null ? null : contTransfer - espTransfer;

    // Totales de ventas por método (no incluye apertura ni movimientos).
    const totalVentasReg = c.total_efectivo + c.total_tarjeta + c.total_transferencia;
    // Total esperado a tener: efectivo esperado en caja + digital esperado.
    const totalEsperado = espEfectivo + espTarjeta + espTransfer;
    const totalDiferencia =
      (difEfectivo ?? 0) + (difTarjeta ?? 0) + (difTransfer ?? 0);

    const abierto = c.estado !== "cerrada";

    // Fila simple etiqueta/valor.
    const L = (label: string, value: string, opts?: { bold?: boolean; neg?: boolean }) =>
      `<tr class="${opts?.bold ? "b" : ""}"><td class="l">${esc(label)}</td><td class="v ${opts?.neg ? "neg" : ""}">${esc(value)}</td></tr>`;
    const difVal = (d: number | null) => (d == null ? "—" : signo(d));
    const difOpts = (d: number | null) => ({ neg: d != null && d < 0 });

    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8" />
<title>Arqueo caja ${esc(c.numero_caja)} — ${esc(fechaHora(c.fecha_apertura))}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-monospace, "Courier New", monospace; font-size: ${fontPx}px; color:#000; background:#f1f1f1; margin:0; padding:20px; }
  .paper { background:#fff; width:${widthMm}mm; margin:0 auto; padding:6mm 4mm; box-shadow:0 1px 4px rgba(0,0,0,.1); }
  .titulo { text-align:center; font-weight:800; font-size:${fontPx + 2}px; border:2px solid #000; padding:2mm; margin:0 0 2mm; letter-spacing:1px; }
  .sub { text-align:center; font-size:${fontPx - 1}px; margin-bottom:2mm; }
  .meta { font-size:${fontPx - 1}px; margin:1mm 0 2mm; }
  .meta div { display:flex; justify-content:space-between; gap:6px; }
  h3 { font-size:${fontPx - 1}px; text-transform:uppercase; letter-spacing:.5px; margin:2mm 0 1mm; border-bottom:1px solid #000; padding-bottom:.6mm; }
  hr { border:none; border-top:1px dashed #000; margin:2mm 0; }
  table { width:100%; border-collapse:collapse; }
  td { vertical-align:top; padding:.4mm 0; }
  td.l { text-align:left; padding-right:4px; }
  td.v { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.v.neg { color:#b00; }
  tr.b td { font-weight:800; border-top:1px solid #000; padding-top:1mm; }
  .foot { font-size:${fontPx - 2}px; text-align:center; margin-top:3mm; font-style:italic; }
  .actions { max-width:${widthMm}mm; margin:8mm auto 0; text-align:center; }
  .actions button { padding:8px 16px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  .actions a { margin-left:12px; font-size:13px; color:#444; }
  @media print {
    body { background:#fff; padding:0; }
    .paper { width:${widthMm === 58 ? 48 : 72}mm; box-shadow:none; padding:1mm; margin:0 auto; }
    .actions { display:none; }
    @page { margin:0; size:${widthMm}mm auto; }
  }
</style></head>
<body>
  <section class="paper">
    ${membreteTicket()}
    <div class="titulo">ARQUEO DE CAJA</div>
    <div class="sub">Caja ${esc(c.numero_caja)} · ${abierto ? "EN CURSO" : "CIERRE"}</div>
    <div class="meta">
      <div><span>Apertura</span><span>${esc(fechaHora(c.fecha_apertura))}</span></div>
      <div><span>Cierre</span><span>${c.fecha_cierre ? esc(fechaHora(c.fecha_cierre)) : "— en curso"}</span></div>
    </div>
    <hr>

    <h3>Efectivo</h3>
    <table><tbody>
      ${L("Saldo de apertura", gs(c.monto_apertura))}
      ${L(`Ventas efectivo (${c.cantidad_efectivo})`, gs(c.total_efectivo))}
      ${L("Efectivo esperado", gs(espEfectivo))}
      ${L("Efectivo contado", contEfectivo == null ? "—" : gs(contEfectivo))}
      ${L("Diferencia efectivo", difVal(difEfectivo), difOpts(difEfectivo))}
    </tbody></table>

    <h3>Tarjeta / QR</h3>
    <table><tbody>
      ${L(`Ventas tarjeta/QR (${c.cantidad_tarjeta})`, gs(c.total_tarjeta))}
      ${L("Esperado tarjeta/QR", gs(espTarjeta))}
      ${L("Contado (POS)", contTarjeta == null ? "—" : gs(contTarjeta))}
      ${L("Diferencia tarjeta/QR", difVal(difTarjeta), difOpts(difTarjeta))}
    </tbody></table>

    <h3>Transferencia</h3>
    <table><tbody>
      ${L(`Ventas transferencia (${c.cantidad_transferencia})`, gs(c.total_transferencia))}
      ${L("Esperado transferencia", gs(espTransfer))}
      ${L("Contado", contTransfer == null ? "—" : gs(contTransfer))}
      ${L("Diferencia transferencia", difVal(difTransfer), difOpts(difTransfer))}
    </tbody></table>

    <h3>Totales</h3>
    <table><tbody>
      ${L("Total ventas (registrado)", gs(totalVentasReg))}
      ${L("Total esperado", gs(totalEsperado))}
      ${L("Total diferencia", difVal(abierto ? null : totalDiferencia), difOpts(abierto ? null : totalDiferencia))}
    </tbody></table>

    <h3>Cierre de efectivo</h3>
    <table><tbody>
      ${L("Dejado en caja (sgte. jornada)", c.monto_dejado_caja == null ? "—" : gs(c.monto_dejado_caja))}
      ${L("Extraído a tesorería", c.monto_tesoreria == null ? "—" : gs(c.monto_tesoreria))}
    </tbody></table>

    <h3>Responsables</h3>
    <table><tbody>
      ${L("Apertura", c.abierta_por_nombre ?? "—")}
      ${L("Cierre", c.cerrada_por_nombre ?? "—")}
    </tbody></table>

    <div class="foot">Arqueo no fiscal — Ferretería República.</div>
  </section>
  <div class="actions">
    <button type="button" onclick="window.print()">Imprimir</button>
    <a href="?w=${widthMm === 80 ? 58 : 80}">Cambiar a ${widthMm === 80 ? 58 : 80}mm</a>
  </div>
  <script>try{ if(new URL(location.href).searchParams.get('auto')==='1'){ setTimeout(function(){window.print();},250); } }catch(e){}</script>
</body></html>`;

    return new NextResponse(asciiTicket(html), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[/api/reportes/cajas/[id]/arqueo-ticket]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el arqueo.", { status: 500 });
  }
}
