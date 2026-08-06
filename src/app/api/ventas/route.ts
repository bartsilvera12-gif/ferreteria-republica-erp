import { NextRequest, NextResponse } from "next/server";
import { getTenantSupabaseFromAuth } from "@/lib/supabase/tenant-api";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { successResponse, errorResponse } from "@/lib/api/response";
import { API_ERRORS } from "@/lib/api/errors";
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

/**
 * GET /api/ventas — listado vía PG pool. Trae las 500 ventas más recientes y
 * SUS ítems con `venta_id = ANY(...)` (antes se traían todos los ventas_items y
 * topaban en 1000 filas de PostgREST → las ventas recientes quedaban sin líneas).
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

    const ventasQ = await pool.query(
      `SELECT v.id::text AS id, v.empresa_id::text AS empresa_id, v.numero_control, v.moneda,
              v.tipo_cambio, v.subtotal, v.monto_iva, v.total, v.tipo_venta, v.plazo_dias,
              v.metodo_pago, v.fecha, v.cliente_id::text AS cliente_id,
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
                LIMIT 1) AS numero_factura
         FROM ${tV} v
        WHERE v.empresa_id = $1::uuid
        ORDER BY v.fecha DESC
        LIMIT 5000`,
      [empresaId]
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
      };
    });

    return NextResponse.json(successResponse({ ventas }));
  } catch (err) {
    console.error("[/api/ventas GET]", err instanceof Error ? err.message : err);
    return NextResponse.json(errorResponse("No se pudieron cargar las ventas."), { status: 500 });
  }
}
