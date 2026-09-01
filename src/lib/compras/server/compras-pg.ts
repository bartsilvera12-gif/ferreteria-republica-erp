/**
 * PG directo para Compras. Mismo patron que productos-pg / proveedores-pg:
 * pool singleton + queries parametrizadas + identifier escape.
 *
 * insertCompra realiza la operacion en transaccion:
 *   1) inserta compra con numero_control generado por secuencia local
 *   2) inserta movimiento ENTRADA (origen=compra) con audit
 *   3) actualiza producto.precio_venta + costo_promedio + stock_actual
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";

function pool() {
  const p = getChatPostgresPool();
  if (!p) throw new Error("Pool no disponible.");
  return p;
}

export interface CompraRow {
  id: string;
  empresa_id: string;
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: string | number;
  moneda: string;
  tipo_cambio: string | number;
  costo_unitario_original: string | number;
  costo_unitario: string | number;
  iva_tipo: string;
  subtotal: string | number;
  monto_iva: string | number;
  total: string | number;
  precio_venta: string | number;
  margen_venta: string | number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  numero_control: string;
  estado: string;
  fecha: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

const COLS = `
  id, empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
  cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
  iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
  tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
  created_at, updated_at, created_by, usuario_nombre
`;

export interface InsertCompraInput {
  proveedor_id: string;
  proveedor_nombre: string;
  producto_id: string;
  producto_nombre: string;
  cantidad: number;
  moneda: string;
  tipo_cambio: number;
  costo_unitario_original: number;
  costo_unitario: number;
  iva_tipo: string;
  subtotal: number;
  monto_iva: number;
  total: number;
  precio_venta: number;
  margen_venta: number | null;
  tipo_pago: string;
  plazo_dias: number | null;
  nro_timbrado: string;
  created_by: string | null;
  usuario_nombre: string | null;
}

export interface ListComprasFilters {
  /** Texto libre: N.o de control, proveedor, producto o timbrado. */
  q?: string | null;
  tipoPago?: "contado" | "credito" | null;
  /** YYYY-MM-DD inclusive. */
  desde?: string | null;
  /** YYYY-MM-DD inclusive (se compara contra el dia completo). */
  hasta?: string | null;
  /** 1-based. */
  page?: number;
  /** Filas por pagina. `null` = sin paginar (export a Excel). */
  pageSize?: number | null;
}

export interface ListComprasResult {
  rows: CompraRow[];
  /** Total de filas que cumplen el filtro, ignorando la paginacion. */
  total: number;
  page: number;
  pageSize: number | null;
}

/** Escapa comodines para que el texto del usuario sea literal dentro de ILIKE. */
function escapeLikePattern(raw: string): string {
  return raw.replace(/([\\%_])/g, "\\$1");
}

/**
 * Si el usuario escribe solo digitos ("95") arma el numero_control canonico
 * COMP-000095 para poder priorizar la coincidencia exacta sobre COMP-000950.
 */
function numeroControlExacto(q: string): string | null {
  const soloDigitos = q.trim().replace(/^COMP-/i, "");
  if (!/^\d{1,6}$/.test(soloDigitos)) return null;
  return `COMP-${soloDigitos.padStart(6, "0")}`;
}

const PAGE_SIZE_MAX = 200;

/**
 * Lista compras con busqueda, filtros y paginacion resueltos en Postgres.
 *
 * Antes se traian las ultimas 500 filas y se filtraba en el navegador, con lo
 * cual cualquier compra mas vieja que esas 500 era invisible tanto en el
 * listado como en el export a Excel.
 */
export async function listCompras(
  schemaRaw: string,
  empresaId: string,
  filters: ListComprasFilters = {}
): Promise<ListComprasResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const t = quoteSchemaTable(schema, "compras");

  const qRaw = filters.q?.trim() ?? "";
  const q = qRaw ? `%${escapeLikePattern(qRaw)}%` : null;
  const exacto = qRaw ? numeroControlExacto(qRaw) : null;
  const tipoPago = filters.tipoPago ?? null;
  const desde = filters.desde?.trim() || null;
  const hasta = filters.hasta?.trim() || null;

  const pageSize =
    filters.pageSize === null || filters.pageSize === undefined
      ? null
      : Math.min(Math.max(1, Math.floor(filters.pageSize)), PAGE_SIZE_MAX);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const offset = pageSize === null ? 0 : (page - 1) * pageSize;

  const where = `
    WHERE empresa_id = $1::uuid
      AND ($2::text IS NULL OR (
            numero_control ILIKE $2 ESCAPE '\\'
         OR proveedor_nombre ILIKE $2 ESCAPE '\\'
         OR producto_nombre ILIKE $2 ESCAPE '\\'
         OR nro_timbrado ILIKE $2 ESCAPE '\\'
          ))
      AND ($3::text IS NULL OR tipo_pago = $3)
      AND ($4::date IS NULL OR fecha >= $4::date)
      AND ($5::date IS NULL OR fecha < ($5::date + INTERVAL '1 day'))
  `;

  /**
   * COUNT(*) OVER() devuelve el total sin paginar en la misma ida a la base.
   * La coincidencia exacta de numero_control va primero para que buscar "95"
   * muestre COMP-000095 arriba de COMP-000950.
   */
  const sql = `
    SELECT ${COLS}, COUNT(*) OVER() AS total_filtrado
    FROM ${t}
    ${where}
    ORDER BY ($6::text IS NOT NULL AND numero_control = $6) DESC, fecha DESC, numero_control DESC
    ${pageSize === null ? "" : "LIMIT $7 OFFSET $8"}
  `;

  const params: unknown[] = [empresaId, q, tipoPago, desde, hasta, exacto];
  if (pageSize !== null) params.push(pageSize, offset);

  const { rows } = await pool().query<CompraRow & { total_filtrado: string }>(sql, params);

  const total = rows.length > 0 ? Number(rows[0].total_filtrado) : 0;
  const limpias = rows.map((r) => {
    const copia: Partial<CompraRow & { total_filtrado: string }> = { ...r };
    delete copia.total_filtrado;
    return copia as CompraRow;
  });

  return { rows: limpias, total, page, pageSize };
}

/** Genera proximo COMP-XXXXXX leyendo el maximo existente. */
async function nextNumeroControl(
  client: import("pg").PoolClient,
  schema: string,
  empresaId: string
): Promise<string> {
  const t = quoteSchemaTable(schema, "compras");
  const { rows } = await client.query<{ maxn: number | null }>(
    `SELECT COALESCE(MAX(
       CASE WHEN numero_control ~ '^COMP-[0-9]+$'
            THEN (substring(numero_control from 6))::int
            ELSE 0 END
     ), 0) AS maxn
     FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );
  const next = Number(rows[0]?.maxn ?? 0) + 1;
  return `COMP-${String(next).padStart(6, "0")}`;
}

export interface CompraResult {
  compra: CompraRow;
  movimiento_id: string | null;
  movimiento_warning: string | null;
}

export async function insertCompraConImpacto(
  schemaRaw: string,
  empresaId: string,
  d: InsertCompraInput
): Promise<CompraResult> {
  const schema = assertAllowedChatDataSchema(schemaRaw);
  const tC = quoteSchemaTable(schema, "compras");
  const tM = quoteSchemaTable(schema, "movimientos_inventario");
  const tP = quoteSchemaTable(schema, "productos");

  const client = await pool().connect();
  let movimientoId: string | null = null;
  let movimientoWarning: string | null = null;
  try {
    await client.query("BEGIN");

    const numero = await nextNumeroControl(client, schema, empresaId);

    const { rows: compraRows } = await client.query<CompraRow>(
      `INSERT INTO ${tC} (
         empresa_id, proveedor_id, proveedor_nombre, producto_id, producto_nombre,
         cantidad, moneda, tipo_cambio, costo_unitario_original, costo_unitario,
         iva_tipo, subtotal, monto_iva, total, precio_venta, margen_venta,
         tipo_pago, plazo_dias, nro_timbrado, numero_control, estado, fecha,
         created_by, usuario_nombre
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4::uuid, $5,
         $6::numeric, $7, $8::numeric, $9::numeric, $10::numeric,
         $11, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric,
         $17, $18::integer, $19, $20, 'registrada', now(),
         $21::uuid, $22
       )
       RETURNING ${COLS}`,
      [
        empresaId,
        d.proveedor_id,
        d.proveedor_nombre,
        d.producto_id,
        d.producto_nombre,
        d.cantidad,
        d.moneda,
        d.tipo_cambio,
        d.costo_unitario_original,
        d.costo_unitario,
        d.iva_tipo,
        d.subtotal,
        d.monto_iva,
        d.total,
        d.precio_venta,
        d.margen_venta,
        d.tipo_pago,
        d.plazo_dias,
        d.nro_timbrado,
        numero,
        d.created_by,
        d.usuario_nombre,
      ]
    );
    const compra = compraRows[0];

    // Movimiento ENTRADA (origen=compra). Best-effort: si falla, la compra
    // queda registrada pero anunciamos warning.
    try {
      const { rows: movRows } = await client.query<{ id: string }>(
        `INSERT INTO ${tM} (
           empresa_id, producto_id, producto_nombre, producto_sku,
           tipo, cantidad, costo_unitario, origen, referencia, fecha,
           created_by, usuario_nombre
         )
         SELECT $1::uuid, $2::uuid, $3, COALESCE(p.sku, ''),
                'ENTRADA', $4::numeric, $5::numeric, 'compra', $6, now(),
                $7::uuid, $8
         FROM ${tP} p WHERE p.id = $2::uuid
         RETURNING id`,
        [
          empresaId,
          d.producto_id,
          d.producto_nombre,
          d.cantidad,
          d.costo_unitario,
          numero,
          d.created_by,
          d.usuario_nombre,
        ]
      );
      movimientoId = movRows[0]?.id ?? null;
    } catch (movErr) {
      const msg = movErr instanceof Error ? movErr.message : String(movErr);
      console.error("[compras-pg] movimiento ENTRADA fallo", {
        schema, empresaId, numero, message: msg,
        code: (movErr as { code?: string })?.code,
        detail: (movErr as { detail?: string })?.detail,
      });
      movimientoWarning =
        "La compra se guardó pero no se pudo registrar el movimiento de entrada en inventario.";
    }

    // Actualizar producto: stock + costo_promedio + precio_venta
    await client.query(
      `UPDATE ${tP}
          SET stock_actual = stock_actual + $1::numeric,
              costo_promedio = $2::numeric,
              precio_venta = $3::numeric,
              updated_at = now()
        WHERE id = $4::uuid AND empresa_id = $5::uuid`,
      [d.cantidad, d.costo_unitario, d.precio_venta, d.producto_id, empresaId]
    );

    await client.query("COMMIT");
    return { compra, movimiento_id: movimientoId, movimiento_warning: movimientoWarning };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => null);
    throw err;
  } finally {
    client.release();
  }
}
