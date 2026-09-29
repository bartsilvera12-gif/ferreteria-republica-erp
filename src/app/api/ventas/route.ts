import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
import { escapeIlikeToken, normalizeText, splitTokens } from "@/lib/productos/token-search";
import type { Venta, LineaVenta, TipoIvaVenta, TipoPrecioVenta } from "@/lib/ventas/types";

interface VentaRow {
  id: string;
  empresa_id: string;
  numero_control: string;
  moneda: string;
  tipo_cambio: number | string;
  subtotal: number | string;
  monto_iva: number | string;
  total: number | string;
  tipo_venta: string;
  plazo_dias: number | null;
  fecha: string;
  usuario_nombre?: string | null;
  vendedor?: string | null;
  numero_factura?: string | null;
  cliente_nombre?: string | null;
  estado?: string | null;
}

interface VentaItemRow {
  venta_id: string;
  producto_id: string;
  producto_nombre: string;
  sku: string;
  cantidad: number | string;
  precio_venta_original: number | string;
  precio_venta: number | string;
  tipo_iva: string;
  tipo_precio?: string;
  subtotal: number | string;
  monto_iva: number | string;
  total_linea: number | string;
}

function num(v: number | string): number {
  return typeof v === "number" ? v : Number(v);
}

function mapItems(rows: VentaItemRow[]): LineaVenta[] {
  return rows.map((r) => ({
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    sku: r.sku,
    cantidad: num(r.cantidad),
    precio_venta_original: num(r.precio_venta_original),
    precio_venta: num(r.precio_venta),
    tipo_iva: r.tipo_iva as TipoIvaVenta,
    tipo_precio: (r.tipo_precio === "mayorista" || r.tipo_precio === "distribuidor" || r.tipo_precio === "costo" ? r.tipo_precio : "minorista") as TipoPrecioVenta,
    subtotal: num(r.subtotal),
    monto_iva: num(r.monto_iva),
    total_linea: num(r.total_linea),
  }));
}

/** Normaliza una expresión SQL como `normalizeText` del cliente: minúsculas y sin acentos. */
function sqlNorm(expr: string): string {
  return `translate(lower(COALESCE(${expr}, '')), 'áéíóúüñàèìòù', 'aeiouunaeiou')`;
}

/**
 * GET /api/ventas — listado PAGINADO server-side, sin tope de filas.
 *
 * Query params (todos opcionales):
 *  - page (1..N, default 1), limit (default 25, máx 200)
 *  - q: búsqueda por tokens (AND, cualquier orden) sobre número de control,
 *    número de factura, cliente y nombre/SKU de cualquier ítem.
 *  - tipo: CONTADO | CREDITO
 *  - iva: EXENTA | 5% | 10% (al menos un ítem con ese IVA)
 *
 * Devuelve { ventas, total (filtrado), total_general }. Los ítems se traen solo
 * para las ventas de la página (`venta_id = ANY(...)`).
 * El "vendedor" se resuelve por el pedido que originó la venta (armado_por), no
 * por el cajero que la registró.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await getTenantSupabaseFromAuth(request);
    if (!ctx) return NextResponse.json(errorResponse(API_ERRORS.UNAUTHORIZED), { status: 401 });
    const empresaId = ctx.auth.empresa_id;
    const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(empresaId));
    const pool = getChatPostgresPool();
    if (!pool) throw new Error("Pool no disponible.");

    const tV = quoteSchemaTable(schema, "ventas");
    const tI = quoteSchemaTable(schema, "ventas_items");
    const tPc = quoteSchemaTable(schema, "pedidos_caja");
    const tU = quoteSchemaTable(schema, "usuarios");
    const tFa = quoteSchemaTable(schema, "factura_autoimpresor");
    const tC = quoteSchemaTable(schema, "clientes");

    const sp = new URL(request.url).searchParams;
    const page = Math.max(1, Math.floor(Number(sp.get("page")) || 1));
    const limit = Math.max(1, Math.min(200, Math.floor(Number(sp.get("limit")) || 25)));
    const tipo = sp.get("tipo");
    const iva = sp.get("iva");
    const tokens = splitTokens(normalizeText(sp.get("q") ?? ""))
      .map(escapeIlikeToken)
      .filter(Boolean);

    // Filtros sobre `v`; $1 = empresa_id.
    const params: unknown[] = [empresaId];
    const conds: string[] = [];
    if (tipo === "CONTADO" || tipo === "CREDITO") {
      params.push(tipo);
      conds.push(`v.tipo_venta = $${params.length}`);
    }
    if (iva === "EXENTA" || iva === "5%" || iva === "10%") {
      params.push(iva);
      conds.push(
        `EXISTS (SELECT 1 FROM ${tI} i WHERE i.venta_id = v.id AND i.empresa_id = v.empresa_id AND i.tipo_iva = $${params.length})`
      );
    }
    // Cada token debe aparecer en algún campo (AND entre tokens, orden libre).
    for (const tok of tokens) {
      params.push(`%${tok}%`);
      const p = `$${params.length}`;
      conds.push(`(
        ${sqlNorm("v.numero_control")} LIKE ${p}
        OR EXISTS (SELECT 1 FROM ${tFa} fa WHERE fa.venta_id = v.id AND fa.empresa_id = v.empresa_id
                   AND ${sqlNorm("fa.numero_completo")} LIKE ${p})
        OR EXISTS (SELECT 1 FROM ${tC} c WHERE c.id = v.cliente_id AND c.empresa_id = v.empresa_id
                   AND ${sqlNorm("concat_ws(' ', c.empresa, c.nombre_contacto, c.nombre)")} LIKE ${p})
        OR EXISTS (SELECT 1 FROM ${tI} i WHERE i.venta_id = v.id AND i.empresa_id = v.empresa_id
                   AND ${sqlNorm("concat_ws(' ', i.producto_nombre, i.sku)")} LIKE ${p})
      )`);
    }
    const filtro = conds.length > 0 ? conds.join(" AND ") : "TRUE";

    const countQ = await pool.query(
      `SELECT count(*)::int AS total_general,
              count(*) FILTER (WHERE ${filtro})::int AS total
         FROM ${tV} v
        WHERE v.empresa_id = $1::uuid`,
      params
    );
    const total = Number(countQ.rows[0]?.total ?? 0);
    const totalGeneral = Number(countQ.rows[0]?.total_general ?? 0);
    const offset = (page - 1) * limit;

    const ventasQ = await pool.query(
      `SELECT v.id::text AS id, v.empresa_id::text AS empresa_id, v.numero_control, v.moneda,
              v.tipo_cambio, v.subtotal, v.monto_iva, v.total, v.tipo_venta, v.plazo_dias,
              v.metodo_pago, v.fecha, v.estado, v.cliente_id::text AS cliente_id,
              v.genera_nota_remision, v.nota_remision_numero, v.usuario_nombre,
              (SELECT COALESCE(NULLIF(TRIM(u2.nombre), ''), NULLIF(split_part(pc2.armado_por_email, '@', 1), ''))
                 FROM ${tPc} pc2
                 LEFT JOIN ${tU} u2 ON u2.email = pc2.armado_por_email
                WHERE pc2.venta_id = v.id AND pc2.empresa_id = v.empresa_id
                ORDER BY pc2.created_at ASC
                LIMIT 1) AS vendedor,
              (SELECT fa.numero_completo
                 FROM ${tFa} fa
                WHERE fa.venta_id = v.id AND fa.empresa_id = v.empresa_id
                LIMIT 1) AS numero_factura,
              (SELECT COALESCE(NULLIF(TRIM(c.empresa), ''), NULLIF(TRIM(c.nombre_contacto), ''), NULLIF(TRIM(c.nombre), ''))
                 FROM ${tC} c
                WHERE c.id = v.cliente_id AND c.empresa_id = v.empresa_id
                LIMIT 1) AS cliente_nombre
         FROM ${tV} v
        WHERE v.empresa_id = $1::uuid AND ${filtro}
        ORDER BY v.fecha DESC, v.numero_control DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const ventasRows = ventasQ.rows as VentaRow[];

    const ventaIds = ventasRows.map((r) => r.id);
    const itemsRows: VentaItemRow[] = ventaIds.length === 0 ? [] : (
      await pool.query(
        `SELECT venta_id::text AS venta_id, producto_id::text AS producto_id, producto_nombre, sku,
                cantidad, precio_venta_original, precio_venta, tipo_iva, tipo_precio,
                subtotal, monto_iva, total_linea
           FROM ${tI}
          WHERE empresa_id = $1::uuid AND venta_id = ANY($2::uuid[])`,
        [empresaId, ventaIds]
      )
    ).rows as VentaItemRow[];

    const byVenta = new Map<string, VentaItemRow[]>();
    for (const row of itemsRows) {
      const list = byVenta.get(row.venta_id) ?? [];
      list.push(row);
      byVenta.set(row.venta_id, list);
    }

    const ventas: Venta[] = ventasRows.map((r) => {
      const lineRows = byVenta.get(r.id) ?? [];
      return {
        id: r.id,
        numero_control: r.numero_control,
        items: mapItems(lineRows),
        moneda: r.moneda === "USD" ? "USD" : "GS",
        tipo_cambio: num(r.tipo_cambio),
        subtotal: num(r.subtotal),
        monto_iva: num(r.monto_iva),
        total: num(r.total),
        tipo_venta: r.tipo_venta === "CREDITO" ? "CREDITO" : "CONTADO",
        plazo_dias: r.plazo_dias ?? undefined,
        metodo_pago: (r as unknown as { metodo_pago?: string }).metodo_pago === "tarjeta"
          ? "tarjeta"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "transferencia"
          ? "transferencia"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "efectivo"
          ? "efectivo"
          : (r as unknown as { metodo_pago?: string }).metodo_pago === "mixto"
          ? "mixto"
          : undefined,
        cliente_id: (r as unknown as { cliente_id?: string | null }).cliente_id ?? null,
        genera_nota_remision: (r as unknown as { genera_nota_remision?: boolean }).genera_nota_remision === true,
        nota_remision_numero: (r as unknown as { nota_remision_numero?: string | null }).nota_remision_numero ?? null,
        fecha: r.fecha,
        usuario_nombre: r.usuario_nombre ?? null,
        vendedor: r.vendedor ?? null,
        numero_factura: r.numero_factura ?? null,
        cliente_nombre: r.cliente_nombre ?? null,
        estado: r.estado ?? null,
      };
    });

    return NextResponse.json(successResponse({ ventas, total, total_general: totalGeneral, page, limit }));
  } catch (err) {
    console.error("[/api/ventas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las ventas."), { status: 500 });
  }
}
