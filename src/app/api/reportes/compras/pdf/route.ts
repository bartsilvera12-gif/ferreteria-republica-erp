import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { membreteA4 } from "@/lib/documentos/membrete";

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
// Paraguay = UTC-3 fijo (usar INTERVAL; el string '-03:00' invierte el signo en Postgres).
const PY = "AT TIME ZONE INTERVAL '-3 hours'";
const MAX_COMPRAS_PRODUCTOS = 400;

function gs(v: number): string { return Math.round(v || 0).toLocaleString("es-PY"); }
function esc(v: unknown): string { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function fh(iso: string): string { try { return new Intl.DateTimeFormat("es-PY", { timeZone: "America/Asuncion", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso)); } catch { return iso; } }
function fd(s: string): string { const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; }
const n = (v: unknown): number => { const x = typeof v === "number" ? v : Number(v ?? 0); return Number.isFinite(x) ? x : 0; };

/** GET /api/reportes/compras/pdf — reporte de compras imprimible A4. */
export async function GET(request: NextRequest) {
  const ctx = await getTenantSupabaseFromAuth(request);
  if (!ctx) return new NextResponse("No autorizado", { status: 401 });
  try {
    const empresaId = ctx.auth.empresa_id;
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(empresaId));
    const pool = getChatPostgresPool();
    if (!pool) throw new Error("Pool no disponible.");
    const tC = quoteSchemaTable(schema, "compras");

    const sp = new URL(request.url).searchParams;
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Asuncion" }).format(new Date());
    const desde = RE_FECHA.test(sp.get("desde") ?? "") ? String(sp.get("desde")) : `${hoy.slice(0, 7)}-01`;
    const hasta = RE_FECHA.test(sp.get("hasta") ?? "") ? String(sp.get("hasta")) : hoy;
    const proveedor = (sp.get("proveedor") ?? "").trim();
    const tipoRaw = (sp.get("tipo") ?? "").toLowerCase();
    const tipo = tipoRaw === "contado" || tipoRaw === "credito" ? tipoRaw : "";
    const resumido = sp.get("resumido") === "1";
    const conProductos = !resumido && sp.get("productos") === "1";

    const args: unknown[] = [empresaId, desde, hasta];
    const cond: string[] = [];
    if (proveedor) { args.push(`%${proveedor}%`); cond.push(`proveedor_nombre ILIKE $${args.length}`); }
    if (tipo) { args.push(tipo); cond.push(`tipo_pago = $${args.length}`); }
    const extra = cond.length ? ` AND ${cond.join(" AND ")}` : "";

    const { rows } = await pool.query(
      `SELECT numero_control, min(fecha) AS fecha, max(proveedor_nombre) AS proveedor_nombre,
              max(numero_factura) AS numero_factura, max(tipo_pago) AS tipo_pago, max(estado) AS estado,
              count(*) AS items, sum(subtotal) AS subtotal, sum(monto_iva) AS monto_iva, sum(total) AS total
         FROM ${tC}
        WHERE empresa_id = $1::uuid AND (fecha ${PY})::date BETWEEN $2::date AND $3::date ${extra}
        GROUP BY numero_control
        ORDER BY min(fecha) DESC
        LIMIT 5000`,
      args
    );

    const compras = rows.map((r: Record<string, unknown>) => ({
      numero_control: String(r.numero_control ?? ""),
      fecha: String(r.fecha ?? ""),
      proveedor_nombre: (r.proveedor_nombre as string | null) ?? "—",
      numero_factura: (r.numero_factura as string | null) ?? null,
      tipo_pago: r.tipo_pago === "credito" ? "credito" : "contado",
      items: n(r.items), subtotal: n(r.subtotal), monto_iva: n(r.monto_iva), total: n(r.total),
    }));

    // Productos por compra (solo detallado y bajo el tope).
    const itemsPorCompra = new Map<string, Array<{ producto_nombre: string; cantidad: number; costo_unitario: number; total: number }>>();
    const truncado = conProductos && compras.length > MAX_COMPRAS_PRODUCTOS;
    if (conProductos && !truncado && compras.length > 0) {
      const nums = compras.map((c) => c.numero_control);
      const iq = await pool.query(
        `SELECT numero_control, producto_nombre, cantidad, costo_unitario, total
           FROM ${tC} WHERE empresa_id = $1::uuid AND numero_control = ANY($2::text[])
          ORDER BY numero_control, producto_nombre`,
        [empresaId, nums]
      );
      for (const r of iq.rows as Record<string, unknown>[]) {
        const k = String(r.numero_control);
        const arr = itemsPorCompra.get(k) ?? [];
        arr.push({ producto_nombre: String(r.producto_nombre ?? ""), cantidad: n(r.cantidad), costo_unitario: n(r.costo_unitario), total: n(r.total) });
        itemsPorCompra.set(k, arr);
      }
    }

    const tot = compras.reduce((a, c) => {
      a.total += c.total; a.iva += c.monto_iva; a.subtotal += c.subtotal;
      if (c.tipo_pago === "credito") a.credito += c.total; else a.contado += c.total;
      return a;
    }, { total: 0, iva: 0, subtotal: 0, contado: 0, credito: 0 });

    const COLS = 6;
    const filas = compras.map((c) => {
      const fila = `<tr>
        <td class="mono">${esc(c.numero_control)}</td>
        <td>${esc(fh(c.fecha))}</td>
        <td>${esc(c.proveedor_nombre)}</td>
        <td class="mono2">${esc(c.numero_factura ?? "—")}</td>
        <td class="cap">${c.tipo_pago === "credito" ? "Crédito" : "Contado"}</td>
        <td class="num">${gs(c.total)}</td>
      </tr>`;
      if (!conProductos || truncado) return fila;
      const its = itemsPorCompra.get(c.numero_control) ?? [];
      if (its.length === 0) return fila;
      const lis = its.map((it) => `<div class="pl"><span class="pn">${esc(it.producto_nombre)}</span><span class="pc">×${it.cantidad.toLocaleString("es-PY")}</span><span class="pt">Gs. ${gs(it.total)}</span></div>`).join("");
      return `${fila}<tr class="prods"><td colspan="${COLS}"><div class="plist">${lis}</div></td></tr>`;
    }).join("");

    const tabla = resumido ? "" : `<table>
      <thead><tr><th>N° Compra</th><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Pago</th><th class="num">Total</th></tr></thead>
      <tbody>${filas || `<tr><td colspan="${COLS}" class="vacio">Sin compras para los filtros seleccionados.</td></tr>`}</tbody>
    </table>${truncado ? `<div class="nota">El detalle de productos se omitió porque supera ${MAX_COMPRAS_PRODUCTOS} compras. Acotá el rango o el proveedor.</div>` : ""}`;

    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8" />
<title>Reporte de compras ${esc(fd(desde))} a ${esc(fd(hasta))}</title>
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
  td.mono { font-family:ui-monospace,monospace; font-weight:600; white-space:nowrap; }
  .mono2 { font-family:ui-monospace,monospace; color:#666; font-size:10px; }
  td.cap { text-transform:capitalize; }
  tr.prods td { background:#fafcfc; padding:4px 7px 8px 22px; }
  .plist { display:flex; flex-wrap:wrap; gap:4px 14px; }
  .pl { font-size:10px; color:#444; white-space:nowrap; }
  .pl .pc { color:#3F8E91; font-weight:700; margin:0 4px; }
  .pl .pt { color:#666; font-variant-numeric:tabular-nums; }
  .nota { margin-top:8px; font-size:10px; color:#a15c00; background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; padding:6px 10px; }
  .vacio { text-align:center; color:#888; padding:22px; }
  .foot { margin-top:16px; font-size:10.5px; color:#666; border-top:1px dashed #bbb; padding-top:8px; }
  .actions { max-width:1050px; margin:14px auto 0; text-align:center; }
  .actions button { padding:8px 18px; font-size:13px; cursor:pointer; border:1px solid #333; background:#fff; border-radius:6px; }
  @media print { body { background:#fff; padding:0; } .doc { box-shadow:none; max-width:none; } .actions { display:none; } @page { size: A4 landscape; margin:12mm; } }
</style></head>
<body><div class="doc">
  ${membreteA4()}
  <div class="titulo">REPORTE DE COMPRAS</div>
  <div class="rango">Del ${esc(fd(desde))} al ${esc(fd(hasta))} · ${compras.length} compra${compras.length === 1 ? "" : "s"}</div>
  <div class="filtros">
    ${proveedor ? `Proveedor: ${esc(proveedor)} · ` : ""}
    ${tipo ? `Pago: ${tipo === "credito" ? "Crédito" : "Contado"} · ` : ""}
    ${resumido ? "Resumido" : conProductos ? "Detallado con productos" : "Detallado"}
  </div>
  <div class="cards">
    <div class="card"><div class="lbl">Total comprado</div><div class="val">Gs. ${gs(tot.total)}</div></div>
    <div class="card"><div class="lbl">Contado</div><div class="val">Gs. ${gs(tot.contado)}</div></div>
    <div class="card"><div class="lbl">Crédito</div><div class="val">Gs. ${gs(tot.credito)}</div></div>
    <div class="card"><div class="lbl">IVA</div><div class="val">Gs. ${gs(tot.iva)}</div></div>
    <div class="card"><div class="lbl">Compras</div><div class="val">${compras.length}</div></div>
  </div>
  ${tabla}
  <div class="foot">Reporte generado desde Zentra — Ferretería República. Documento no fiscal.</div>
</div>
<div class="actions"><button type="button" onclick="window.print()">Imprimir / Guardar PDF</button></div>
<script>try{ if(new URL(location.href).searchParams.get('auto')==='1'){ setTimeout(function(){window.print();},300); } }catch(e){}</script>
</body></html>`;

    return new NextResponse(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) {
    console.error("[/api/reportes/compras/pdf]", err instanceof Error ? err.message : err);
    return new NextResponse("No se pudo generar el reporte de compras.", { status: 500 });
  }
}
