/**
 * Ajuste manual de stock con auditoría.
 *
 * Cuando se edita el stock de un producto (desde su ficha), en vez de
 * sobrescribir el valor en silencio, se hace en UNA transacción con lock del
 * producto: se calcula el delta contra el stock real y se registra un
 * movimiento de inventario (origen `ajuste_manual`).
 *
 *   nuevo > actual -> movimiento ENTRADA por la diferencia
 *   nuevo < actual -> movimiento SALIDA  por la diferencia
 *   nuevo = actual -> no se registra nada
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface AjusteStockResult {
  ajustado: boolean;
  anterior: number;
  nuevo: number;
  delta: number;
}

export async function ajustarStockConMovimiento(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  nuevoStock: number,
  usuario: { id: string | null; nombre: string | null },
  motivo?: string | null
): Promise<AjusteStockResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool de base de datos no disponible.");
  const tP = quoteSchemaTable(schema, "productos");
  const tMI = quoteSchemaTable(schema, "movimientos_inventario");
  const nuevo = round2(nuevoStock);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pQ = await client.query(
      `SELECT nombre, sku, stock_actual, costo_promedio
         FROM ${tP} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [productoId, empresaId]
    );
    const p = pQ.rows[0] as Record<string, unknown> | undefined;
    if (!p) throw new Error("Producto no encontrado.");

    const anterior = round2(num(p.stock_actual));
    const delta = round2(nuevo - anterior);

    // Siempre fija el nuevo valor (aunque el delta sea 0, por si otro campo del
    // producto se guardó en la misma operación).
    await client.query(
      `UPDATE ${tP} SET stock_actual = $3::numeric, updated_at = now()
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [productoId, empresaId, nuevo]
    );

    if (delta !== 0) {
      await client.query(
        `INSERT INTO ${tMI} (
           empresa_id, producto_id, producto_nombre, producto_sku, tipo, cantidad,
           costo_unitario, origen, referencia, created_by, usuario_nombre
         ) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,'ajuste_manual',$8,$9::uuid,$10)`,
        [
          empresaId, productoId, String(p.nombre ?? ""), String(p.sku ?? ""),
          delta > 0 ? "ENTRADA" : "SALIDA", Math.abs(delta), num(p.costo_promedio),
          motivo?.trim() || "Ajuste manual de stock", usuario.id, usuario.nombre,
        ]
      );
    }

    await client.query("COMMIT");
    return { ajustado: delta !== 0, anterior, nuevo, delta };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
