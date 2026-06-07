/**
 * Detalle de cobro de ventas (conciliación bancaria) vía pool raw-PG.
 *
 * Se inserta DESPUÉS de crear la venta (en la ruta API), best-effort: si falla,
 * la venta NO se rompe. No toca la transacción de venta ni la explosión de
 * recetas. Acceso por pool (no PostgREST) → sin dependencia del schema cache.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export type MetodoPagoDetalle = "efectivo" | "transferencia" | "tarjeta" | "qr" | "billetera" | "otro";

export interface PagoDetalleInput {
  metodo_pago: MetodoPagoDetalle;
  entidad_bancaria_id: string | null;
  entidad_nombre_snapshot: string | null;
  monto: number;
  referencia: string | null;
  fecha_acreditacion: string | null; // YYYY-MM-DD o null
  observacion: string | null;
}

export interface EntidadBancariaRow {
  id: string;
  nombre: string;
  tipo: string | null;
  orden: number;
}

/** Lista las entidades activas de la empresa (para el selector de cobro). */
export async function listEntidadesBancarias(
  schemaRaw: string,
  empresaId: string
): Promise<EntidadBancariaRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "entidades_bancarias");
  const { rows } = await pool().query<EntidadBancariaRow>(
    `SELECT id, nombre, tipo, orden FROM ${t}
      WHERE empresa_id=$1::uuid AND activo=true ORDER BY orden ASC, nombre ASC`,
    [empresaId]
  );
  return rows;
}

/**
 * Inserta 1 detalle de cobro para una venta. Devuelve el id, o null si falla
 * (best-effort: el caller ignora el error para no romper la venta).
 */
export async function insertVentaPagoDetalle(
  schemaRaw: string,
  empresaId: string,
  ventaId: string,
  d: PagoDetalleInput
): Promise<string | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "ventas_pagos_detalle");
  const { rows } = await pool().query<{ id: string }>(
    `INSERT INTO ${t} (
        empresa_id, venta_id, metodo_pago, entidad_bancaria_id, entidad_nombre_snapshot,
        monto, referencia, fecha_acreditacion, observacion
     ) VALUES (
        $1::uuid, $2::uuid, $3, $4::uuid, $5,
        $6::numeric, $7, $8::date, $9
     ) RETURNING id`,
    [
      empresaId, ventaId, d.metodo_pago,
      d.entidad_bancaria_id, d.entidad_nombre_snapshot,
      d.monto, d.referencia, d.fecha_acreditacion, d.observacion,
    ]
  );
  return rows[0]?.id ?? null;
}
