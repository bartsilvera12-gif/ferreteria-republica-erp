import { quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";

/** Cliente pg (pool) mínimo para insertar dentro de una transacción abierta. */
interface PgClientLike {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export type CompraAuditoriaTipo = "compra" | "orden_compra";
export type CompraAuditoriaAccion = "editar" | "eliminar";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Fila mínima para el snapshot (campos opcionales con valor `unknown`, para
 * aceptar tanto `CompraRow` como `OrdenCompraRow` sin fricción de tipos).
 */
interface FilaSnapshot {
  numero_factura?: unknown;
  nro_timbrado?: unknown;
  proveedor_nombre?: unknown;
  producto_nombre?: unknown;
  cantidad?: unknown;
  costo_unitario?: unknown;
  total?: unknown;
}

/**
 * Snapshot compacto de una compra u orden (una fila por línea que comparten
 * cabecera). Captura los datos "relevantes" para la auditoría: cabecera + líneas
 * (producto/cantidad/costo/total) y el total. Acepta filas de `compras` o de
 * `ordenes_compra` (comparten esos campos).
 */
export function snapshotCompra(rows: ReadonlyArray<FilaSnapshot>): Record<string, unknown> {
  const h: FilaSnapshot = rows[0] ?? {};
  return {
    proveedor_nombre: (h.proveedor_nombre as string | null) ?? null,
    numero_factura: (h.numero_factura as string | null) ?? null,
    nro_timbrado: (h.nro_timbrado as string | null) ?? null,
    lineas: rows.map((r) => ({
      producto_nombre: (r.producto_nombre as string | null) ?? null,
      cantidad: num(r.cantidad),
      costo_unitario: num(r.costo_unitario),
      total: num(r.total),
    })),
    total: rows.reduce((s, r) => s + num(r.total), 0),
  };
}

/**
 * Inserta una fila de bitácora en `compra_auditoria` usando el cliente pg de una
 * transacción YA abierta (para que sea atómico con la edición/eliminación). NO
 * abre ni cierra la transacción; NO tiene fallback: si falla, la transacción del
 * llamador debe hacer ROLLBACK.
 */
export async function registrarCompraAuditoria(
  client: PgClientLike,
  schema: string,
  data: {
    empresaId: string;
    tipo: CompraAuditoriaTipo;
    documento: string;
    accion: CompraAuditoriaAccion;
    usuario: { id: string | null; nombre: string | null };
    detalle: unknown;
  }
): Promise<void> {
  const t = quoteSchemaTable(schema, "compra_auditoria");
  await client.query(
    `INSERT INTO ${t} (empresa_id, tipo, documento, accion, usuario_id, usuario_nombre, detalle)
     VALUES ($1::uuid, $2, $3, $4, $5::uuid, $6, $7::jsonb)`,
    [data.empresaId, data.tipo, data.documento, data.accion, data.usuario.id, data.usuario.nombre,
     JSON.stringify(data.detalle ?? {})]
  );
}
