/**
 * Cambio de unidad de medida de un producto con auditoría.
 *
 * Cambiar la unidad NO convierte cantidades: el stock, los movimientos de
 * inventario, las ventas y las compras ya registradas quedan tal cual (son
 * historial y no se reescriben). Lo que sí se hace es dejar constancia del
 * cambio en `producto_unidad_historial` (unidad anterior, nueva, stock al
 * momento y quién lo hizo), en la MISMA transacción que el UPDATE, para que
 * al leer el historial se sepa en qué unidad estaba expresada cada cantidad.
 *
 * Si la tabla de historial todavía no existe (migración sin aplicar), el
 * cambio se aplica igual y se deja un warning en el log: no se bloquea la
 * operación del cliente por una migración pendiente.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

export interface CambioUnidadResult {
  cambiado: boolean;
  anterior: string;
  nueva: string;
  /** false si el cambio se aplicó pero no se pudo registrar en el historial. */
  registrado: boolean;
}

export async function cambiarUnidadConHistorial(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  nuevaUnidad: string,
  usuario: { id: string | null; nombre: string | null }
): Promise<CambioUnidadResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool de base de datos no disponible.");
  const tP = quoteSchemaTable(schema, "productos");
  const tH = quoteSchemaTable(schema, "producto_unidad_historial");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(
      `SELECT nombre, unidad_medida, stock_actual FROM ${tP}
        WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
      [productoId, empresaId]
    );
    const p = cur.rows[0] as Record<string, unknown> | undefined;
    if (!p) throw new Error("Producto no encontrado.");

    const anterior = String(p.unidad_medida ?? "").trim().toUpperCase();
    if (anterior === nuevaUnidad) {
      await client.query("COMMIT");
      return { cambiado: false, anterior, nueva: nuevaUnidad, registrado: true };
    }

    await client.query(
      `UPDATE ${tP} SET unidad_medida = $3, updated_at = now()
        WHERE id = $1::uuid AND empresa_id = $2::uuid`,
      [productoId, empresaId, nuevaUnidad]
    );

    let registrado = true;
    await client.query("SAVEPOINT historial_unidad");
    try {
      await client.query(
        `INSERT INTO ${tH} (empresa_id, producto_id, producto_nombre, unidad_ant, unidad_act,
                            stock_al_cambio, usuario_id, usuario_nombre)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6::numeric,$7::uuid,$8)`,
        [empresaId, productoId, String(p.nombre ?? ""), anterior || null, nuevaUnidad,
         p.stock_actual ?? 0, usuario.id, usuario.nombre]
      );
    } catch (e) {
      // 42P01 = undefined_table: migración pendiente. Cualquier otro error sí aborta.
      if ((e as { code?: string })?.code !== "42P01") throw e;
      await client.query("ROLLBACK TO SAVEPOINT historial_unidad");
      registrado = false;
      console.warn(
        `[cambio-unidad] ${schema}.producto_unidad_historial no existe: el cambio ${anterior} -> ${nuevaUnidad} ` +
          `del producto ${productoId} se aplicó sin registro. Aplicar la migración producto_unidad_historial.`
      );
    }

    await client.query("COMMIT");
    return { cambiado: true, anterior, nueva: nuevaUnidad, registrado };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
