/**
 * Capa server-side PG directo para la GALERÍA de imágenes de producto.
 *
 * Usa el MISMO pg Pool (`getChatPostgresPool`) y patrón transaccional real
 * (BEGIN/COMMIT/ROLLBACK) que `productos-pg.ts`. Todas las operaciones que
 * cambian la principal o borran/promueven corren en UNA transacción atómica, y
 * sincronizan el espejo legacy `productos.imagen_path/imagen_url` dentro de la
 * misma transacción. Los cambios de Storage se hacen FUERA de la transacción
 * (Postgres y Storage no comparten ACID) — ver galeria-service.ts.
 *
 * Todos los valores van por placeholders $N; el schema/tabla se citan escapados.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import type { Pool, PoolClient } from "pg";

export type GaleriaImagenRow = {
  id: string;
  imagen_path: string | null;
  imagen_url: string | null;
  orden: number;
  es_principal: boolean;
};

export type FuenteImagen = { imagen_path: string | null; imagen_url: string | null };

function pool(): Pool {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool de Postgres no disponible.");
  return p;
}
function tImg(schema: string): string {
  return quoteSchemaTable(schema, "producto_imagenes");
}
function tProd(schema: string): string {
  return quoteSchemaTable(schema, "productos");
}

const SELECT_COLS = "id, imagen_path, imagen_url, orden, es_principal";

/** Sincroniza productos.imagen_path/imagen_url con la principal actual (o null). */
async function syncLegacy(
  client: PoolClient,
  tImgT: string,
  tProdT: string,
  empresaId: string,
  productoId: string
): Promise<void> {
  const { rows } = await client.query(
    `SELECT imagen_path, imagen_url FROM ${tImgT}
      WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND es_principal=true LIMIT 1`,
    [empresaId, productoId]
  );
  const pr = rows[0] as FuenteImagen | undefined;
  await client.query(
    `UPDATE ${tProdT} SET imagen_path=$3, imagen_url=$4, updated_at=now()
      WHERE empresa_id=$1::uuid AND id=$2::uuid`,
    [empresaId, productoId, pr?.imagen_path ?? null, pr?.imagen_url ?? null]
  );
}

// ── Lecturas ───────────────────────────────────────────────────────────────

export async function listGaleriaPg(
  schemaRaw: string,
  empresaId: string,
  productoId: string
): Promise<GaleriaImagenRow[]> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { rows } = await pool().query(
    `SELECT ${SELECT_COLS} FROM ${tImg(schema)}
      WHERE empresa_id=$1::uuid AND producto_id=$2::uuid
      ORDER BY es_principal DESC, orden ASC, id ASC`,
    [empresaId, productoId]
  );
  return rows as GaleriaImagenRow[];
}

export async function getGaleriaImagenPg(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  imagenId: string
): Promise<GaleriaImagenRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { rows } = await pool().query(
    `SELECT ${SELECT_COLS} FROM ${tImg(schema)}
      WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND id=$3::uuid`,
    [empresaId, productoId, imagenId]
  );
  return (rows[0] as GaleriaImagenRow) ?? null;
}

export async function countGaleriaPg(
  schemaRaw: string,
  empresaId: string,
  productoId: string
): Promise<number> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const { rows } = await pool().query(
    `SELECT count(*)::int AS n FROM ${tImg(schema)}
      WHERE empresa_id=$1::uuid AND producto_id=$2::uuid`,
    [empresaId, productoId]
  );
  return (rows[0]?.n as number) ?? 0;
}

// ── Mutaciones transaccionales ───────────────────────────────────────────────

/** Inserta una imagen nueva. Si es la primera del producto: principal + sync legacy. */
export async function insertGaleriaImagenPg(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  imagenId: string,
  fuente: FuenteImagen
): Promise<GaleriaImagenRow> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tImgT = tImg(schema);
  const tProdT = tProd(schema);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: mx } = await client.query(
      `SELECT COALESCE(MAX(orden)+1, 0) AS n FROM ${tImgT}
        WHERE empresa_id=$1::uuid AND producto_id=$2::uuid`,
      [empresaId, productoId]
    );
    const { rows: cnt } = await client.query(
      `SELECT count(*)::int AS n FROM ${tImgT}
        WHERE empresa_id=$1::uuid AND producto_id=$2::uuid`,
      [empresaId, productoId]
    );
    const esPrincipal = ((cnt[0]?.n as number) ?? 0) === 0;
    const { rows: ins } = await client.query(
      `INSERT INTO ${tImgT} (id, empresa_id, producto_id, imagen_path, imagen_url, orden, es_principal)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)
       RETURNING ${SELECT_COLS}`,
      [imagenId, empresaId, productoId, fuente.imagen_path, fuente.imagen_url, (mx[0]?.n as number) ?? 0, esPrincipal]
    );
    if (esPrincipal) await syncLegacy(client, tImgT, tProdT, empresaId, productoId);
    await client.query("COMMIT");
    return ins[0] as GaleriaImagenRow;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Inserta una imagen respetando el LÍMITE de forma segura ante concurrencia:
 * bloquea la fila del producto (FOR UPDATE) y cuenta + inserta en la MISMA
 * transacción, así dos uploads simultáneos del mismo producto se serializan
 * (no pueden ambos ver count=7 y terminar en 9). Devuelve { over:true } si ya
 * está en el límite (el caller borra el objeto recién subido). Si es la primera
 * imagen, la marca principal y sincroniza el espejo legacy.
 */
export async function insertGaleriaImagenConLimitePg(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  imagenId: string,
  fuente: FuenteImagen,
  max: number
): Promise<{ over: true } | { over: false; row: GaleriaImagenRow }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tImgT = tImg(schema);
  const tProdT = tProd(schema);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    // Lock del producto: serializa uploads concurrentes del MISMO producto.
    const { rows: lock } = await client.query(
      `SELECT id FROM ${tProdT} WHERE empresa_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
      [empresaId, productoId]
    );
    if (lock.length === 0) {
      await client.query("ROLLBACK");
      throw new Error("Producto no encontrado.");
    }
    const { rows: cnt } = await client.query(
      `SELECT count(*)::int AS n FROM ${tImgT} WHERE empresa_id=$1::uuid AND producto_id=$2::uuid`,
      [empresaId, productoId]
    );
    const total = (cnt[0]?.n as number) ?? 0;
    if (total >= max) {
      await client.query("ROLLBACK");
      return { over: true };
    }
    const { rows: mx } = await client.query(
      `SELECT COALESCE(MAX(orden)+1, 0) AS n FROM ${tImgT} WHERE empresa_id=$1::uuid AND producto_id=$2::uuid`,
      [empresaId, productoId]
    );
    const esPrincipal = total === 0;
    const { rows: ins } = await client.query(
      `INSERT INTO ${tImgT} (id, empresa_id, producto_id, imagen_path, imagen_url, orden, es_principal)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7)
       RETURNING ${SELECT_COLS}`,
      [imagenId, empresaId, productoId, fuente.imagen_path, fuente.imagen_url, (mx[0]?.n as number) ?? 0, esPrincipal]
    );
    if (esPrincipal) await syncLegacy(client, tImgT, tProdT, empresaId, productoId);
    await client.query("COMMIT");
    return { over: false, row: ins[0] as GaleriaImagenRow };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Marca una imagen como principal (atómico). Devuelve false si no pertenece. */
export async function setPrincipalPg(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  imagenId: string
): Promise<boolean> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tImgT = tImg(schema);
  const tProdT = tProd(schema);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: ex } = await client.query(
      `SELECT id FROM ${tImgT} WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND id=$3::uuid`,
      [empresaId, productoId, imagenId]
    );
    if (ex.length === 0) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `UPDATE ${tImgT} SET es_principal=false
        WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND es_principal=true`,
      [empresaId, productoId]
    );
    await client.query(
      `UPDATE ${tImgT} SET es_principal=true
        WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND id=$3::uuid`,
      [empresaId, productoId, imagenId]
    );
    await syncLegacy(client, tImgT, tProdT, empresaId, productoId);
    await client.query("COMMIT");
    return true;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Borra una imagen y, si era la principal, promueve la siguiente por orden.
 * Sincroniza legacy. Devuelve la fila borrada (para que el caller elimine el
 * objeto de Storage DESPUÉS del COMMIT), o null si no existía.
 */
export async function deleteImagenAndPromotePg(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  imagenId: string
): Promise<GaleriaImagenRow | null> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tImgT = tImg(schema);
  const tProdT = tProd(schema);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT ${SELECT_COLS} FROM ${tImgT}
        WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND id=$3::uuid`,
      [empresaId, productoId, imagenId]
    );
    const row = rows[0] as GaleriaImagenRow | undefined;
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `DELETE FROM ${tImgT} WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND id=$3::uuid`,
      [empresaId, productoId, imagenId]
    );
    if (row.es_principal) {
      await client.query(
        `UPDATE ${tImgT} SET es_principal=true
          WHERE id = (
            SELECT id FROM ${tImgT}
             WHERE empresa_id=$1::uuid AND producto_id=$2::uuid
             ORDER BY orden ASC, id ASC LIMIT 1
          )`,
        [empresaId, productoId]
      );
    }
    await syncLegacy(client, tImgT, tProdT, empresaId, productoId);
    await client.query("COMMIT");
    return row;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Reemplaza la principal (semántica del endpoint legacy). Inserta la nueva como
 * principal, retira la anterior principal (fila) y sincroniza legacy. Devuelve
 * { oldPrincipal, newRow } para borrar el objeto de la anterior tras el COMMIT.
 * Las secundarias existentes se conservan.
 */
export async function legacyReplacePrincipalPg(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  newImagenId: string,
  fuente: FuenteImagen
): Promise<{ oldPrincipal: GaleriaImagenRow | null; newRow: GaleriaImagenRow }> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tImgT = tImg(schema);
  const tProdT = tProd(schema);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows: oldRows } = await client.query(
      `SELECT ${SELECT_COLS} FROM ${tImgT}
        WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND es_principal=true LIMIT 1`,
      [empresaId, productoId]
    );
    const oldPrincipal = (oldRows[0] as GaleriaImagenRow) ?? null;
    if (oldPrincipal) {
      await client.query(
        `DELETE FROM ${tImgT} WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND id=$3::uuid`,
        [empresaId, productoId, oldPrincipal.id]
      );
    }
    const { rows: ins } = await client.query(
      `INSERT INTO ${tImgT} (id, empresa_id, producto_id, imagen_path, imagen_url, orden, es_principal)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, 0, true)
       RETURNING ${SELECT_COLS}`,
      [newImagenId, empresaId, productoId, fuente.imagen_path, fuente.imagen_url]
    );
    await syncLegacy(client, tImgT, tProdT, empresaId, productoId);
    await client.query("COMMIT");
    return { oldPrincipal, newRow: ins[0] as GaleriaImagenRow };
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Reordena la galería. `orderedIds` debe ser una permutación EXACTA de las
 * imágenes del producto (sin duplicados, sin IDs ajenos). Devuelve false si no
 * valida. Transaccional.
 */
export async function reorderGaleriaPg(
  schemaRaw: string,
  empresaId: string,
  productoId: string,
  orderedIds: string[]
): Promise<boolean> {
  if (new Set(orderedIds).size !== orderedIds.length) return false; // duplicados
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tImgT = tImg(schema);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT id FROM ${tImgT} WHERE empresa_id=$1::uuid AND producto_id=$2::uuid`,
      [empresaId, productoId]
    );
    const existentes = new Set((rows as Array<{ id: string }>).map((r) => r.id));
    const coherente =
      orderedIds.length === existentes.size && orderedIds.every((id) => existentes.has(id));
    if (!coherente) {
      await client.query("ROLLBACK");
      return false;
    }
    for (let i = 0; i < orderedIds.length; i++) {
      await client.query(
        `UPDATE ${tImgT} SET orden=$4 WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND id=$3::uuid`,
        [empresaId, productoId, orderedIds[i], i]
      );
    }
    await client.query("COMMIT");
    return true;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* noop */ }
    throw e;
  } finally {
    client.release();
  }
}
