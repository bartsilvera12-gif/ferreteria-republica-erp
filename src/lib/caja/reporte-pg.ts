/**
 * Reporte de caja (arqueo) vía PG pool — SQL directo, sin PostgREST.
 *
 * Reemplaza el camino PostgREST (múltiples `.in(...)` que fallan con muchas
 * ventas / arrays grandes) por consultas SQL parametrizadas con `= ANY($ids)`,
 * que no dependen del largo de la URL ni del gateway.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type {
  CajasReporte,
  CajaReporteRow,
  CajaDetalle,
  CajaDetalleVenta,
  CajaDetalleMovimiento,
  EstadoCaja,
  MedioPagoCaja,
  TipoMovimientoCaja,
} from "./types";
import type { ArqueoItem } from "./denominaciones";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function estadoCaja(v: unknown): EstadoCaja {
  const s = String(v ?? "");
  return s === "cerrada" ? "cerrada" : s === "en_cierre" ? "en_cierre" : "abierta";
}
function arqueoJson(v: unknown): ArqueoItem[] | null {
  if (Array.isArray(v)) return v as ArqueoItem[];
  if (typeof v === "string") { try { const j = JSON.parse(v); return Array.isArray(j) ? j : null; } catch { return null; } }
  return null;
}

interface CajaBase {
  id: string;
  numero_caja: number;
  estado: EstadoCaja;
  abierta_por: string | null;
  cerrada_por: string | null;
  fecha_apertura: string;
  fecha_cierre: string | null;
  monto_apertura: number;
  monto_cierre_contado: number | null;
  monto_esperado_efectivo: number | null;
  diferencia: number | null;
  observacion_cierre: string | null;
  arqueo_apertura_json: ArqueoItem[] | null;
  arqueo_cierre_json: ArqueoItem[] | null;
}

const CAJA_SELECT = `
  id::text AS id, numero_caja, estado, abierta_por::text AS abierta_por, cerrada_por::text AS cerrada_por,
  fecha_apertura, fecha_cierre, monto_apertura, monto_cierre_contado, monto_esperado_efectivo,
  diferencia, observacion_cierre, arqueo_apertura_json, arqueo_cierre_json`;

function mapCajaBase(r: Record<string, unknown>): CajaBase {
  return {
    id: String(r.id),
    numero_caja: num(r.numero_caja) || 1,
    estado: estadoCaja(r.estado),
    abierta_por: (r.abierta_por as string | null) ?? null,
    cerrada_por: (r.cerrada_por as string | null) ?? null,
    fecha_apertura: String(r.fecha_apertura ?? ""),
    fecha_cierre: r.fecha_cierre ? String(r.fecha_cierre) : null,
    monto_apertura: num(r.monto_apertura),
    monto_cierre_contado: r.monto_cierre_contado == null ? null : num(r.monto_cierre_contado),
    monto_esperado_efectivo: r.monto_esperado_efectivo == null ? null : num(r.monto_esperado_efectivo),
    diferencia: r.diferencia == null ? null : num(r.diferencia),
    observacion_cierre: (r.observacion_cierre as string | null) ?? null,
    arqueo_apertura_json: arqueoJson(r.arqueo_apertura_json),
    arqueo_cierre_json: arqueoJson(r.arqueo_cierre_json),
  };
}

async function nombresUsuarios(schema: string, empresaId: string, ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const clean = [...new Set(ids.filter(Boolean))];
  if (clean.length === 0) return map;
  const tU = quoteSchemaTable(schema, "usuarios");
  const { rows } = await pool().query(
    `SELECT id::text AS id, nombre, email FROM ${tU} WHERE empresa_id = $1::uuid AND id = ANY($2::uuid[])`,
    [empresaId, clean]
  );
  for (const u of rows as Array<{ id: string; nombre: string | null; email: string | null }>) {
    map.set(String(u.id), (u.nombre?.trim() || u.email?.trim() || "—"));
  }
  return map;
}

function emptyReport(rango: { desde: string; hasta: string }): CajasReporte {
  return {
    desde: rango.desde,
    hasta: rango.hasta,
    totales: {
      cantidad_cajas: 0, cajas_abiertas: 0, cajas_cerradas: 0,
      total_vendido: 0, total_efectivo: 0, total_tarjeta: 0, total_transferencia: 0, total_credito: 0,
      total_diferencia: 0, faltantes: 0, sobrantes: 0, cajas_con_diferencia: 0,
    },
    cajas: [],
  };
}

/** Listado de turnos + totales (arqueo) por rango de fechas. */
export async function getReporteCajasPg(
  schemaRaw: string,
  empresaId: string,
  rango: { start: string; end: string; desde: string; hasta: string }
): Promise<CajasReporte> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cajas");
  const tV = quoteSchemaTable(schema, "ventas");
  const tPd = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const tM = quoteSchemaTable(schema, "caja_movimientos");
  const p = pool();

  const cajasQ = await p.query(
    `SELECT ${CAJA_SELECT} FROM ${tC}
      WHERE empresa_id = $1::uuid AND fecha_apertura >= $2 AND fecha_apertura <= $3
      ORDER BY fecha_apertura DESC`,
    [empresaId, rango.start, rango.end]
  );
  const cajas = cajasQ.rows.map(mapCajaBase);
  if (cajas.length === 0) return emptyReport(rango);
  const cajaIds = cajas.map((c) => c.id);

  // Ventas por caja: el medio de pago sale del detalle de cobro si existe
  // (soporta pagos combinados), y si no, del método de la venta.
  const vQ = await p.query(
    `SELECT v.caja_id::text AS caja_id,
        COUNT(*) FILTER (WHERE v.estado <> 'anulada') AS cantidad,
        COALESCE(SUM(v.total) FILTER (WHERE v.estado <> 'anulada'), 0) AS total_vendido,
        COALESCE(SUM(v.total) FILTER (WHERE v.estado <> 'anulada' AND v.tipo_venta = 'CREDITO'), 0) AS credito,
        COALESCE(SUM(CASE WHEN v.tipo_venta = 'CREDITO' THEN 0 WHEN pd.tiene THEN pd.efe ELSE (CASE WHEN COALESCE(v.metodo_pago,'efectivo') NOT IN ('tarjeta','transferencia') THEN v.total ELSE 0 END) END) FILTER (WHERE v.estado <> 'anulada'), 0) AS efectivo,
        COALESCE(SUM(CASE WHEN v.tipo_venta = 'CREDITO' THEN 0 WHEN pd.tiene THEN pd.tar ELSE (CASE WHEN v.metodo_pago = 'tarjeta' THEN v.total ELSE 0 END) END) FILTER (WHERE v.estado <> 'anulada'), 0) AS tarjeta,
        COALESCE(SUM(CASE WHEN v.tipo_venta = 'CREDITO' THEN 0 WHEN pd.tiene THEN pd.tra ELSE (CASE WHEN v.metodo_pago = 'transferencia' THEN v.total ELSE 0 END) END) FILTER (WHERE v.estado <> 'anulada'), 0) AS transferencia
      FROM ${tV} v
      LEFT JOIN LATERAL (
        SELECT COUNT(*) > 0 AS tiene,
          COALESCE(SUM(monto) FILTER (WHERE metodo_pago = 'efectivo'), 0) AS efe,
          COALESCE(SUM(monto) FILTER (WHERE metodo_pago = 'tarjeta'), 0) AS tar,
          COALESCE(SUM(monto) FILTER (WHERE metodo_pago = 'transferencia'), 0) AS tra
        FROM ${tPd} pd WHERE pd.venta_id = v.id AND pd.empresa_id = v.empresa_id
      ) pd ON true
      WHERE v.empresa_id = $1::uuid AND v.caja_id = ANY($2::uuid[])
      GROUP BY v.caja_id`,
    [empresaId, cajaIds]
  );
  const vAgg = new Map<string, { cantidad: number; total: number; efectivo: number; tarjeta: number; transferencia: number; credito: number }>();
  for (const r of vQ.rows as Record<string, unknown>[]) {
    vAgg.set(String(r.caja_id), {
      cantidad: num(r.cantidad), total: num(r.total_vendido),
      efectivo: num(r.efectivo), tarjeta: num(r.tarjeta), transferencia: num(r.transferencia), credito: num(r.credito),
    });
  }

  // Movimientos de efectivo por caja.
  const mQ = await p.query(
    `SELECT caja_id::text AS caja_id,
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'ingreso'), 0) AS ingresos,
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'egreso'), 0) AS egresos,
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'retiro'), 0) AS retiros,
        COALESCE(SUM(monto) FILTER (WHERE tipo = 'ajuste'), 0) AS ajustes
      FROM ${tM}
      WHERE empresa_id = $1::uuid AND caja_id = ANY($2::uuid[])
        AND anulado_at IS NULL AND COALESCE(medio_pago, 'efectivo') = 'efectivo'
      GROUP BY caja_id`,
    [empresaId, cajaIds]
  );
  const mAgg = new Map<string, { ingresos: number; egresos: number; retiros: number; ajustes: number }>();
  for (const r of mQ.rows as Record<string, unknown>[]) {
    mAgg.set(String(r.caja_id), { ingresos: num(r.ingresos), egresos: num(r.egresos), retiros: num(r.retiros), ajustes: num(r.ajustes) });
  }

  const nombreById = await nombresUsuarios(schema, empresaId, cajas.flatMap((c) => [c.abierta_por, c.cerrada_por]).filter((x): x is string => !!x));

  const filas: CajaReporteRow[] = cajas.map((c) => {
    const v = vAgg.get(c.id) ?? { cantidad: 0, total: 0, efectivo: 0, tarjeta: 0, transferencia: 0, credito: 0 };
    const m = mAgg.get(c.id) ?? { ingresos: 0, egresos: 0, retiros: 0, ajustes: 0 };
    const efectivoEsperado = c.monto_apertura + v.efectivo + m.ingresos - m.egresos - m.retiros + m.ajustes;
    return {
      id: c.id, numero_caja: c.numero_caja, estado: c.estado,
      fecha_apertura: c.fecha_apertura, fecha_cierre: c.fecha_cierre,
      abierta_por_nombre: c.abierta_por ? nombreById.get(c.abierta_por) ?? null : null,
      cerrada_por_nombre: c.cerrada_por ? nombreById.get(c.cerrada_por) ?? null : null,
      monto_apertura: c.monto_apertura,
      cantidad_ventas: v.cantidad, total_vendido: v.total,
      total_efectivo: v.efectivo, total_tarjeta: v.tarjeta, total_transferencia: v.transferencia, total_credito: v.credito,
      ingresos_efectivo: m.ingresos, egresos_efectivo: m.egresos, retiros_efectivo: m.retiros, ajustes_efectivo: m.ajustes,
      efectivo_esperado: efectivoEsperado,
      monto_esperado_efectivo: c.monto_esperado_efectivo,
      monto_cierre_contado: c.monto_cierre_contado,
      diferencia: c.diferencia,
      observacion_cierre: c.observacion_cierre,
      arqueo_apertura_json: c.arqueo_apertura_json,
      arqueo_cierre_json: c.arqueo_cierre_json,
    };
  });

  const totales = emptyReport(rango).totales;
  totales.cantidad_cajas = filas.length;
  for (const f of filas) {
    if (f.estado === "cerrada") totales.cajas_cerradas++;
    else totales.cajas_abiertas++;
    totales.total_vendido += f.total_vendido;
    totales.total_efectivo += f.total_efectivo;
    totales.total_tarjeta += f.total_tarjeta;
    totales.total_transferencia += f.total_transferencia;
    totales.total_credito += f.total_credito;
    if (f.diferencia != null && f.diferencia !== 0) {
      totales.cajas_con_diferencia++;
      totales.total_diferencia += f.diferencia;
      if (f.diferencia < 0) totales.faltantes += -f.diferencia;
      else totales.sobrantes += f.diferencia;
    }
  }

  return { desde: rango.desde, hasta: rango.hasta, totales, cajas: filas };
}

/** Detalle de UN turno: cabecera + ventas + movimientos. */
export async function getDetalleCajaPg(
  schemaRaw: string,
  empresaId: string,
  cajaId: string
): Promise<CajaDetalle | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "cajas");
  const tV = quoteSchemaTable(schema, "ventas");
  const tPd = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const tM = quoteSchemaTable(schema, "caja_movimientos");
  const p = pool();

  const cQ = await p.query(`SELECT ${CAJA_SELECT} FROM ${tC} WHERE empresa_id = $1::uuid AND id = $2::uuid LIMIT 1`, [empresaId, cajaId]);
  if (cQ.rows.length === 0) return null;
  const c = mapCajaBase(cQ.rows[0]);

  // Ventas del turno + medio efectivo del detalle (para el arqueo).
  const vQ = await p.query(
    `SELECT v.id::text AS id, v.numero_control, v.fecha, v.metodo_pago, v.tipo_venta, v.total, v.estado,
        COALESCE(pd.efe, CASE WHEN COALESCE(v.metodo_pago,'efectivo') NOT IN ('tarjeta','transferencia') THEN v.total ELSE 0 END) AS efectivo_arqueo,
        COALESCE(pd.tar, CASE WHEN v.metodo_pago='tarjeta' THEN v.total ELSE 0 END) AS tarjeta_arqueo,
        COALESCE(pd.tra, CASE WHEN v.metodo_pago='transferencia' THEN v.total ELSE 0 END) AS transferencia_arqueo
      FROM ${tV} v
      LEFT JOIN LATERAL (
        SELECT COUNT(*) > 0 AS tiene,
          SUM(monto) FILTER (WHERE metodo_pago='efectivo') AS efe,
          SUM(monto) FILTER (WHERE metodo_pago='tarjeta') AS tar,
          SUM(monto) FILTER (WHERE metodo_pago='transferencia') AS tra
        FROM ${tPd} pd WHERE pd.venta_id = v.id AND pd.empresa_id = v.empresa_id
      ) pd ON pd.tiene
      WHERE v.empresa_id = $1::uuid AND v.caja_id = $2::uuid
      ORDER BY v.fecha ASC`,
    [empresaId, cajaId]
  );

  const ventas: CajaDetalleVenta[] = vQ.rows.map((r: Record<string, unknown>) => ({
    id: String(r.id),
    numero_control: (r.numero_control as string | null) ?? null,
    fecha: String(r.fecha ?? ""),
    metodo_pago: ((r.metodo_pago as string | null) ?? "efectivo") as MedioPagoCaja,
    tipo_venta: (r.tipo_venta as string | null) ?? null,
    total: num(r.total),
    estado: (r.estado as string | null) ?? null,
  }));

  let totalEfectivo = 0, totalTarjeta = 0, totalTransferencia = 0, totalCredito = 0, totalVendido = 0, cantidadVentas = 0;
  for (const r of vQ.rows as Record<string, unknown>[]) {
    if (String(r.estado) === "anulada") continue;
    cantidadVentas++;
    totalVendido += num(r.total);
    // Ventas a CRÉDITO: no ingresan a caja ahora (cobranza posterior). No suman
    // al efectivo esperado del arqueo. (#1)
    if (String(r.tipo_venta) === "CREDITO") { totalCredito += num(r.total); continue; }
    totalEfectivo += num(r.efectivo_arqueo);
    totalTarjeta += num(r.tarjeta_arqueo);
    totalTransferencia += num(r.transferencia_arqueo);
  }

  const mQ = await p.query(
    `SELECT id::text AS id, caja_id::text AS caja_id, tipo, concepto, monto, medio_pago,
        usuario_id::text AS usuario_id, usuario_email, observacion, created_at
      FROM ${tM}
      WHERE empresa_id = $1::uuid AND caja_id = $2::uuid AND anulado_at IS NULL
      ORDER BY created_at ASC`,
    [empresaId, cajaId]
  );

  let ingresosEf = 0, egresosEf = 0, retirosEf = 0, ajustesEf = 0;
  for (const m of mQ.rows as Record<string, unknown>[]) {
    if ((String(m.medio_pago ?? "efectivo")) !== "efectivo") continue;
    const monto = num(m.monto);
    const tipo = String(m.tipo);
    if (tipo === "ingreso") ingresosEf += monto;
    else if (tipo === "egreso") egresosEf += monto;
    else if (tipo === "retiro") retirosEf += monto;
    else if (tipo === "ajuste") ajustesEf += monto;
  }
  const efectivoEsperado = c.monto_apertura + totalEfectivo + ingresosEf - egresosEf - retirosEf + ajustesEf;

  const userIds = [
    c.abierta_por, c.cerrada_por,
    ...mQ.rows.map((m: Record<string, unknown>) => (m.usuario_id ? String(m.usuario_id) : null)),
  ].filter((x): x is string => !!x);
  const nombreById = await nombresUsuarios(schema, empresaId, userIds);

  const movimientos: CajaDetalleMovimiento[] = mQ.rows.map((m: Record<string, unknown>) => ({
    id: String(m.id),
    caja_id: String(m.caja_id),
    tipo: String(m.tipo) as TipoMovimientoCaja,
    concepto: String(m.concepto ?? ""),
    monto: num(m.monto),
    medio_pago: (String(m.medio_pago ?? "efectivo")) as MedioPagoCaja,
    usuario_id: (m.usuario_id as string | null) ?? null,
    observacion: (m.observacion as string | null) ?? null,
    created_at: String(m.created_at ?? ""),
    usuario_email: (m.usuario_email as string | null) ?? null,
    usuario_nombre: m.usuario_id ? nombreById.get(String(m.usuario_id)) ?? null : null,
  }));

  const row: CajaReporteRow = {
    id: c.id, numero_caja: c.numero_caja, estado: c.estado,
    fecha_apertura: c.fecha_apertura, fecha_cierre: c.fecha_cierre,
    abierta_por_nombre: c.abierta_por ? nombreById.get(c.abierta_por) ?? null : null,
    cerrada_por_nombre: c.cerrada_por ? nombreById.get(c.cerrada_por) ?? null : null,
    monto_apertura: c.monto_apertura,
    cantidad_ventas: cantidadVentas, total_vendido: totalVendido,
    total_efectivo: totalEfectivo, total_tarjeta: totalTarjeta, total_transferencia: totalTransferencia, total_credito: totalCredito,
    ingresos_efectivo: ingresosEf, egresos_efectivo: egresosEf, retiros_efectivo: retirosEf, ajustes_efectivo: ajustesEf,
    efectivo_esperado: efectivoEsperado,
    monto_esperado_efectivo: c.monto_esperado_efectivo,
    monto_cierre_contado: c.monto_cierre_contado,
    diferencia: c.diferencia,
    observacion_cierre: c.observacion_cierre,
    arqueo_apertura_json: c.arqueo_apertura_json,
    arqueo_cierre_json: c.arqueo_cierre_json,
  };

  return { caja: row, ventas, movimientos };
}
