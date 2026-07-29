/**
 * Reporte de FACTURAS EMITIDAS (autoimpresor) vía PG pool.
 *
 * Fuente: factura_autoimpresor (numeración fiscal + desglose de IVA) unida a
 * ventas (numero_control, cliente) y clientes (nombre/RUC). Filtra por rango de
 * fechas (fecha de emisión, en hora de Asunción) y opcionalmente por cliente.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface FacturaReporteRow {
  venta_id: string;
  numero_completo: string;
  numero_control: string;
  condicion: string;
  emitida_at: string;
  timbrado_numero: string;
  cliente_nombre: string | null;
  cliente_ruc: string | null;
  exentas: number;
  gravado_5: number;
  iva_5: number;
  gravado_10: number;
  iva_10: number;
  total: number;
}

export interface FacturasReporteResult {
  desde: string;
  hasta: string;
  cliente_id: string | null;
  facturas: FacturaReporteRow[];
  totales: {
    cantidad: number;
    exentas: number;
    gravado_5: number;
    iva_5: number;
    gravado_10: number;
    iva_10: number;
    total: number;
  };
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

/**
 * @param desde YYYY-MM-DD (inclusive, hora Asunción)
 * @param hasta YYYY-MM-DD (inclusive, hora Asunción)
 * @param clienteId filtra por cliente; null = todos (incluye Consumidor Final)
 */
export async function getReporteFacturas(
  schemaRaw: string,
  empresaId: string,
  params: { desde: string; hasta: string; clienteId: string | null }
): Promise<FacturasReporteResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tFa = quoteSchemaTable(schema, "factura_autoimpresor");
  const tV = quoteSchemaTable(schema, "ventas");
  const tC = quoteSchemaTable(schema, "clientes");

  const args: unknown[] = [empresaId, params.desde, params.hasta];
  let filtroCliente = "";
  if (params.clienteId) {
    args.push(params.clienteId);
    filtroCliente = ` AND v.cliente_id = $${args.length}::uuid`;
  }

  const { rows } = await pool().query(
    `SELECT
        fa.venta_id::text AS venta_id,
        fa.numero_completo,
        fa.condicion,
        fa.emitida_at,
        fa.timbrado_numero,
        fa.exentas, fa.gravado_5, fa.iva_5, fa.gravado_10, fa.iva_10, fa.total,
        v.numero_control,
        v.cliente_id,
        COALESCE(NULLIF(TRIM(c.empresa), ''), NULLIF(TRIM(c.nombre_contacto), ''), NULLIF(TRIM(c.nombre), '')) AS cliente_nombre,
        c.ruc AS cliente_ruc
      FROM ${tFa} fa
      JOIN ${tV} v ON v.id = fa.venta_id AND v.empresa_id = fa.empresa_id
      LEFT JOIN ${tC} c ON c.id = v.cliente_id AND c.empresa_id = fa.empresa_id
     WHERE fa.empresa_id = $1::uuid
       AND (fa.emitida_at AT TIME ZONE 'America/Asuncion')::date BETWEEN $2::date AND $3::date
       ${filtroCliente}
     ORDER BY fa.emitida_at DESC`,
    args
  );

  const facturas: FacturaReporteRow[] = rows.map((r: Record<string, unknown>) => ({
    venta_id: String(r.venta_id),
    numero_completo: String(r.numero_completo ?? ""),
    numero_control: String(r.numero_control ?? ""),
    condicion: String(r.condicion ?? "contado"),
    emitida_at: String(r.emitida_at ?? ""),
    timbrado_numero: String(r.timbrado_numero ?? ""),
    cliente_nombre: (r.cliente_nombre as string | null) ?? null,
    cliente_ruc: (r.cliente_ruc as string | null) ?? null,
    exentas: n(r.exentas),
    gravado_5: n(r.gravado_5),
    iva_5: n(r.iva_5),
    gravado_10: n(r.gravado_10),
    iva_10: n(r.iva_10),
    total: n(r.total),
  }));

  const totales = facturas.reduce(
    (a, f) => ({
      cantidad: a.cantidad + 1,
      exentas: a.exentas + f.exentas,
      gravado_5: a.gravado_5 + f.gravado_5,
      iva_5: a.iva_5 + f.iva_5,
      gravado_10: a.gravado_10 + f.gravado_10,
      iva_10: a.iva_10 + f.iva_10,
      total: a.total + f.total,
    }),
    { cantidad: 0, exentas: 0, gravado_5: 0, iva_5: 0, gravado_10: 0, iva_10: 0, total: 0 }
  );

  return { desde: params.desde, hasta: params.hasta, cliente_id: params.clienteId, facturas, totales };
}
