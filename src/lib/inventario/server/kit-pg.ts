/**
 * Productos KIT (#14) — vía PG pool.
 *
 * Un KIT es un producto con una RECETA activa (modo_receta 'preparado_al_vender',
 * el default). Al venderlo, el motor de ventas explota la receta y descuenta el
 * stock de cada COMPONENTE (receta_items), sin tocar el stock propio del kit
 * (ese comportamiento ya existe en create-venta-pg). El kit conserva su propio
 * precio de venta y aparece como una sola línea en el ticket.
 *
 * Este módulo solo administra la receta + sus ítems (los componentes). No cambia
 * flags del producto: con receta activa y modo default, la venta ya explota.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}
function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export interface KitComponente {
  producto_id: string;
  nombre: string;
  sku: string | null;
  unidad_medida: string | null;
  stock_actual: number;
  cantidad: number;
}

export interface KitInfo {
  es_kit: boolean;
  receta_id: string | null;
  componentes: KitComponente[];
}

/** Devuelve los componentes del kit (receta activa) de un producto. */
export async function getKit(schemaRaw: string, empresaId: string, productoId: string): Promise<KitInfo> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tR = quoteSchemaTable(schema, "recetas");
  const tI = quoteSchemaTable(schema, "receta_items");
  const tP = quoteSchemaTable(schema, "productos");

  const rQ = await pool().query(
    `SELECT id::text AS id FROM ${tR}
      WHERE empresa_id = $1::uuid AND producto_id = $2::uuid AND activa = true
      ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
    [empresaId, productoId]
  );
  if (rQ.rows.length === 0) return { es_kit: false, receta_id: null, componentes: [] };
  const recetaId = String((rQ.rows[0] as { id: string }).id);

  const iQ = await pool().query(
    `SELECT i.insumo_producto_id::text AS producto_id, i.cantidad, i.unidad_medida,
            p.nombre, p.sku, p.stock_actual
       FROM ${tI} i
       JOIN ${tP} p ON p.id = i.insumo_producto_id AND p.empresa_id = $1::uuid
      WHERE i.receta_id = $2::uuid AND i.empresa_id = $1::uuid
      ORDER BY i.orden ASC NULLS LAST, p.nombre ASC`,
    [empresaId, recetaId]
  );
  const componentes: KitComponente[] = (iQ.rows as Record<string, unknown>[]).map((r) => ({
    producto_id: String(r.producto_id),
    nombre: String(r.nombre ?? ""),
    sku: (r.sku as string | null) ?? null,
    unidad_medida: (r.unidad_medida as string | null) ?? null,
    stock_actual: num(r.stock_actual),
    cantidad: num(r.cantidad),
  }));
  return { es_kit: true, receta_id: recetaId, componentes };
}

export interface KitComponenteInput {
  producto_id: string;
  cantidad: number;
  unidad_medida: string | null;
}

/**
 * Define/actualiza los componentes de un producto KIT. Si `componentes` viene
 * vacío, desactiva la receta (el producto deja de ser kit). Transaccional.
 */
export async function saveKit(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  componentes: KitComponenteInput[],
  usuarioId: string | null
): Promise<KitInfo> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tR = quoteSchemaTable(schema, "recetas");
  const tI = quoteSchemaTable(schema, "receta_items");
  const tP = quoteSchemaTable(schema, "productos");

  // Validar/normalizar componentes: cantidad > 0 y sin auto-referencia ni duplicados.
  const vistos = new Set<string>();
  const limpios: KitComponenteInput[] = [];
  for (const c of componentes) {
    const pid = String(c.producto_id ?? "").trim();
    const cant = num(c.cantidad);
    if (!pid || pid === productoId || cant <= 0 || vistos.has(pid)) continue;
    vistos.add(pid);
    limpios.push({ producto_id: pid, cantidad: cant, unidad_medida: c.unidad_medida ?? null });
  }

  const client = await pool().connect();
  try {
    await client.query("BEGIN");

    // Nombre/unidad del producto (para nombrar la receta y su rendimiento).
    const pQ = await client.query(
      `SELECT nombre, unidad_medida FROM ${tP} WHERE id = $1::uuid AND empresa_id = $2::uuid LIMIT 1`,
      [productoId, empresaId]
    );
    if (pQ.rows.length === 0) throw new Error("Producto no encontrado.");
    const prodNombre = String((pQ.rows[0] as Record<string, unknown>).nombre ?? "KIT");
    const prodUnidad = ((pQ.rows[0] as Record<string, unknown>).unidad_medida as string | null) ?? "UNIDAD";

    // Buscar receta existente (activa o no) del producto.
    const exQ = await client.query(
      `SELECT id::text AS id FROM ${tR}
        WHERE empresa_id = $1::uuid AND producto_id = $2::uuid
        ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [empresaId, productoId]
    );
    let recetaId: string | null = exQ.rows.length ? String((exQ.rows[0] as { id: string }).id) : null;

    if (limpios.length === 0) {
      // Sin componentes → deja de ser kit (desactiva la receta si existía).
      if (recetaId) {
        await client.query(`UPDATE ${tR} SET activa = false, updated_at = now() WHERE id = $1::uuid AND empresa_id = $2::uuid`, [recetaId, empresaId]);
      }
      await client.query("COMMIT");
      return { es_kit: false, receta_id: null, componentes: [] };
    }

    if (recetaId) {
      await client.query(
        `UPDATE ${tR} SET activa = true, nombre = $3, rendimiento_cantidad = 1, rendimiento_unidad = $4, updated_at = now()
          WHERE id = $1::uuid AND empresa_id = $2::uuid`,
        [recetaId, empresaId, `${prodNombre} (KIT)`, prodUnidad]
      );
    } else {
      const insR = await client.query(
        `INSERT INTO ${tR} (empresa_id, producto_id, nombre, rendimiento_cantidad, rendimiento_unidad, activa, created_by)
         VALUES ($1::uuid, $2::uuid, $3, 1, $4, true, $5::uuid)
         RETURNING id::text AS id`,
        [empresaId, productoId, `${prodNombre} (KIT)`, prodUnidad, usuarioId]
      );
      recetaId = String((insR.rows[0] as { id: string }).id);
    }

    // Reemplazar los ítems (componentes).
    await client.query(`DELETE FROM ${tI} WHERE receta_id = $1::uuid AND empresa_id = $2::uuid`, [recetaId, empresaId]);
    let orden = 0;
    for (const c of limpios) {
      await client.query(
        `INSERT INTO ${tI} (empresa_id, receta_id, insumo_producto_id, cantidad, unidad_medida, merma_pct, orden)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::numeric, $5, 0, $6::int)`,
        [empresaId, recetaId, c.producto_id, c.cantidad, c.unidad_medida, orden++]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return await getKit(schemaRaw, empresaId, productoId);
}
