/**
 * Reporte de VENTAS con filtros (estilo "Reporte de Venta" del sistema previo),
 * vía PG pool. Une ventas con cliente, factura autoimpresor (facturada/no) y
 * cuentas por cobrar (cobrado/pendiente para crédito).
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export interface VentaReporteRow {
  id: string;
  numero_control: string;
  fecha: string;
  tipo_venta: string;
  estado: string;
  metodo_pago: string | null;
  cliente_nombre: string | null;
  cajero: string | null;
  vendedor: string | null;
  subtotal: number;
  monto_iva: number;
  total: number;
  facturada: boolean;
  numero_factura: string | null;
  saldo_credito: number | null;
  estado_cobro: string | null;
}

export interface VentasDetalleFiltros {
  desde: string;
  hasta: string;
  /** Filtro por hora del día (HH:MM, hora de Asunción). Opcional. */
  horaDesde?: string | null;
  horaHasta?: string | null;
  clienteId: string | null;
  cajero: string | null;
  codigo: string | null;
  tipo: "" | "CONTADO" | "CREDITO";
  facturada: "" | "si" | "no";
  cobro: "" | "cobrado" | "pendiente";
  soloAnuladas: boolean;
}

export interface VentasDetalleResult {
  ventas: VentaReporteRow[];
  totales: {
    cantidad: number;
    subtotal: number;
    monto_iva: number;
    total: number;
    total_contado: number;
    total_credito: number;
    facturadas: number;
    saldo_pendiente: number;
  };
}

export async function getReporteVentasDetalle(
  schemaRaw: string,
  empresaId: string,
  f: VentasDetalleFiltros
): Promise<VentasDetalleResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tV = quoteSchemaTable(schema, "ventas");
  const tC = quoteSchemaTable(schema, "clientes");
  const tFa = quoteSchemaTable(schema, "factura_autoimpresor");
  const tCxc = quoteSchemaTable(schema, "cuentas_por_cobrar");
  const tPc = quoteSchemaTable(schema, "pedidos_caja");
  const tU = quoteSchemaTable(schema, "usuarios");

  const args: unknown[] = [empresaId, f.desde, f.hasta];
  const cond: string[] = [];
  const hd = (f.horaDesde || "").trim();
  const hh = (f.horaHasta || "").trim();
  if (/^\d{1,2}:\d{2}$/.test(hd)) { args.push(hd); cond.push(`(v.fecha AT TIME ZONE 'America/Asuncion')::time >= $${args.length}::time`); }
  if (/^\d{1,2}:\d{2}$/.test(hh)) { args.push(hh); cond.push(`(v.fecha AT TIME ZONE 'America/Asuncion')::time <= $${args.length}::time`); }
  if (f.clienteId) { args.push(f.clienteId); cond.push(`v.cliente_id = $${args.length}::uuid`); }
  if (f.tipo) { args.push(f.tipo); cond.push(`v.tipo_venta = $${args.length}`); }
  if (f.codigo) { args.push(`%${f.codigo}%`); cond.push(`v.numero_control ILIKE $${args.length}`); }
  if (f.cajero) { args.push(`%${f.cajero}%`); cond.push(`v.usuario_nombre ILIKE $${args.length}`); }
  if (f.facturada === "si") cond.push(`fa.id IS NOT NULL`);
  if (f.facturada === "no") cond.push(`fa.id IS NULL`);
  if (f.cobro === "cobrado") cond.push(`(v.tipo_venta <> 'CREDITO' OR cxc.estado = 'pagado')`);
  if (f.cobro === "pendiente") cond.push(`(v.tipo_venta = 'CREDITO' AND cxc.estado IN ('pendiente','parcial'))`);
  if (f.soloAnuladas) cond.push(`v.estado = 'anulada'`);

  const where = cond.length ? ` AND ${cond.join(" AND ")}` : "";

  const { rows } = await pool().query(
    `SELECT
        v.id::text AS id, v.numero_control, v.fecha, v.tipo_venta, v.estado, v.metodo_pago,
        v.subtotal, v.monto_iva, v.total,
        COALESCE(NULLIF(TRIM(c.empresa), ''), NULLIF(TRIM(c.nombre_contacto), ''), NULLIF(TRIM(c.nombre), '')) AS cliente_nombre,
        v.usuario_nombre AS cajero,
        COALESCE(NULLIF(TRIM(uv.nombre), ''), NULLIF(split_part(pc.armado_por_email, '@', 1), '')) AS vendedor,
        (fa.id IS NOT NULL) AS facturada,
        fa.numero_completo AS numero_factura,
        cxc.saldo AS saldo_credito,
        cxc.estado AS estado_cobro
      FROM ${tV} v
      LEFT JOIN ${tC} c ON c.id = v.cliente_id AND c.empresa_id = v.empresa_id
      LEFT JOIN ${tFa} fa ON fa.venta_id = v.id AND fa.empresa_id = v.empresa_id
      LEFT JOIN ${tCxc} cxc ON cxc.venta_id = v.id AND cxc.empresa_id = v.empresa_id
      LEFT JOIN ${tPc} pc ON pc.venta_id = v.id AND pc.empresa_id = v.empresa_id
      LEFT JOIN ${tU} uv ON uv.email = pc.armado_por_email
     WHERE v.empresa_id = $1::uuid
       AND (v.fecha AT TIME ZONE 'America/Asuncion')::date BETWEEN $2::date AND $3::date
       ${where}
     ORDER BY v.fecha DESC
     LIMIT 5000`,
    args
  );

  const ventas: VentaReporteRow[] = rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    numero_control: String(r.numero_control ?? ""),
    fecha: String(r.fecha ?? ""),
    tipo_venta: String(r.tipo_venta ?? "CONTADO"),
    estado: String(r.estado ?? ""),
    metodo_pago: (r.metodo_pago as string | null) ?? null,
    cliente_nombre: (r.cliente_nombre as string | null) ?? null,
    cajero: (r.cajero as string | null) ?? null,
    vendedor: (r.vendedor as string | null) ?? null,
    subtotal: n(r.subtotal),
    monto_iva: n(r.monto_iva),
    total: n(r.total),
    facturada: r.facturada === true,
    numero_factura: (r.numero_factura as string | null) ?? null,
    saldo_credito: r.saldo_credito == null ? null : n(r.saldo_credito),
    estado_cobro: (r.estado_cobro as string | null) ?? null,
  }));

  const totales = ventas.reduce(
    (a, v) => {
      const anulada = v.estado === "anulada";
      a.cantidad += 1;
      if (!anulada) {
        a.subtotal += v.subtotal;
        a.monto_iva += v.monto_iva;
        a.total += v.total;
        if (v.tipo_venta === "CREDITO") a.total_credito += v.total;
        else a.total_contado += v.total;
        if (v.facturada) a.facturadas += 1;
        if (v.tipo_venta === "CREDITO" && v.saldo_credito) a.saldo_pendiente += v.saldo_credito;
      }
      return a;
    },
    { cantidad: 0, subtotal: 0, monto_iva: 0, total: 0, total_contado: 0, total_credito: 0, facturadas: 0, saldo_pendiente: 0 }
  );

  return { ventas, totales };
}

export interface VentaItemRow {
  producto_nombre: string;
  cantidad: number;
  precio_venta: number;
  total_linea: number;
}

/** Ítems (productos) de una venta puntual — para expandir en el reporte. */
export async function getItemsDeVenta(
  schemaRaw: string,
  empresaId: string,
  ventaId: string
): Promise<VentaItemRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tI = quoteSchemaTable(schema, "ventas_items");
  const { rows } = await pool().query(
    `SELECT producto_nombre, cantidad, precio_venta, total_linea
       FROM ${tI}
      WHERE venta_id = $1::uuid AND empresa_id = $2::uuid
      ORDER BY created_at ASC, producto_nombre ASC`,
    [ventaId, empresaId]
  );
  return rows.map((r: Record<string, unknown>) => ({
    producto_nombre: String(r.producto_nombre ?? ""),
    cantidad: n(r.cantidad),
    precio_venta: n(r.precio_venta),
    total_linea: n(r.total_linea),
  }));
}

/** Ítems de un conjunto de ventas, agrupados por venta_id (para el PDF detallado). */
export async function getItemsDeVentas(
  schemaRaw: string,
  empresaId: string,
  ventaIds: string[]
): Promise<Map<string, VentaItemRow[]>> {
  const out = new Map<string, VentaItemRow[]>();
  if (ventaIds.length === 0) return out;
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tI = quoteSchemaTable(schema, "ventas_items");
  const { rows } = await pool().query(
    `SELECT venta_id::text AS venta_id, producto_nombre, cantidad, precio_venta, total_linea
       FROM ${tI}
      WHERE empresa_id = $1::uuid AND venta_id = ANY($2::uuid[])
      ORDER BY created_at ASC, producto_nombre ASC`,
    [empresaId, ventaIds]
  );
  for (const r of rows as Record<string, unknown>[]) {
    const vid = String(r.venta_id);
    const arr = out.get(vid) ?? [];
    arr.push({
      producto_nombre: String(r.producto_nombre ?? ""),
      cantidad: n(r.cantidad),
      precio_venta: n(r.precio_venta),
      total_linea: n(r.total_linea),
    });
    out.set(vid, arr);
  }
  return out;
}
