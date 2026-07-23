/**
 * Importación INICIAL del catálogo: recibe los 3 reportes, los consolida y
 * crea los productos con su stock inicial.
 *
 * Se apoya en `consolidacion-productos.ts` para el cruce y el detalle de
 * conflictos; acá va todo lo que toca la base: resolver qué productos ya
 * existen, crear categorías faltantes, insertar/actualizar y dejar el
 * movimiento de inventario inicial + el historial de importación.
 */
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { registrarImportAudit } from "@/lib/excel/imports-audit-pg";
import {
  consolidar, resumir,
  type Fuente, type FilaNormalizada, type ProductoConsolidado,
  type ResumenConsolidacion,
} from "./consolidacion-productos";
import { parseReporte, type DiagnosticoParser } from "./parsers-reportes-xls";

export interface ArchivoEntrada {
  fuente: Fuente;
  filename: string;
  /** Matriz de filas cruda del .xls (sin asumir dónde está el encabezado). */
  aoa: unknown[][];
}

export interface DiagnosticoArchivo extends DiagnosticoParser {
  filename: string;
}

export interface PreviewConsolidado {
  items: ProductoConsolidado[];
  resumen: ResumenConsolidacion;
  archivos: DiagnosticoArchivo[];
}

/**
 * Consolida los archivos y marca cuáles ya existen en el ERP.
 * `archivos` puede traer 1, 2 o 3 reportes: lo que falte simplemente no aporta.
 */
export async function construirPreview(
  schemaRaw: string,
  empresaId: string,
  archivos: ArchivoEntrada[]
): Promise<PreviewConsolidado> {
  const todas: FilaNormalizada[] = [];
  const diagnosticos: DiagnosticoArchivo[] = [];

  for (const a of archivos) {
    const { filas, diag } = parseReporte(a.fuente, a.aoa);
    todas.push(...filas);
    diagnosticos.push({ ...diag, filename: a.filename });
  }

  const items = consolidar(todas);
  await marcarExistentes(schemaRaw, empresaId, items);
  return { items, resumen: resumir(items), archivos: diagnosticos };
}

/**
 * Marca los consolidados que ya existen en el ERP, con el MISMO orden de cruce:
 * código interno (sku) → código de barras → código de fábrica → descripción.
 */
export async function marcarExistentes(
  schemaRaw: string,
  empresaId: string,
  items: ProductoConsolidado[]
): Promise<void> {
  const pool = getChatPostgresPool();
  if (!pool) return;
  const t = quoteSchemaTable(schemaRaw, "productos");
  const { rows } = await pool.query<{
    id: string; sku: string | null; codigo_barras: string | null;
    codigo_fabrica: string | null; nombre: string | null;
  }>(
    `SELECT id, sku, codigo_barras, codigo_fabrica, nombre FROM ${t} WHERE empresa_id = $1::uuid`,
    [empresaId]
  );

  const up = (s: string | null) => String(s ?? "").trim().toUpperCase();
  const desc = (s: string | null) =>
    String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const porSku = new Map<string, string>();
  const porBarras = new Map<string, string>();
  const porFabrica = new Map<string, string>();
  const porNombre = new Map<string, string>();
  for (const r of rows) {
    if (r.sku) porSku.set(up(r.sku), r.id);
    if (r.codigo_barras) porBarras.set(up(r.codigo_barras), r.id);
    if (r.codigo_fabrica) porFabrica.set(up(r.codigo_fabrica), r.id);
    if (r.nombre) porNombre.set(desc(r.nombre), r.id);
  }

  for (const it of items) {
    it.match_existente_id =
      (it.codigo_interno && porSku.get(it.codigo_interno)) ||
      (it.codigo_barras && porBarras.get(it.codigo_barras)) ||
      (it.codigo_fabrica && porFabrica.get(it.codigo_fabrica)) ||
      (it.descripcion && porNombre.get(desc(it.descripcion))) ||
      null;
  }
}

export interface CommitCtx {
  createdBy: string | null;
  usuarioNombre: string | null;
  filenames: string[];
  /** Si un producto ya existe: actualizarlo o saltarlo. */
  actualizarExistentes: boolean;
  /** Crear las categorías que no existan todavía. */
  crearCategorias: boolean;
}

export interface CommitResultado {
  creados: number;
  actualizados: number;
  omitidos: number;
  errores: number;
  categorias_creadas: number;
  movimientos_generados: number;
  unidades_iniciales: number;
  mensajes_error: string[];
}

/**
 * Crea/actualiza los productos consolidados y registra el stock inicial.
 * Cada producto va en su propia transacción: un error puntual no tira abajo
 * toda la importación (con 5.000 productos, eso sería inmanejable).
 */
export async function commitConsolidado(
  schemaRaw: string,
  empresaId: string,
  items: ProductoConsolidado[],
  ctx: CommitCtx
): Promise<CommitResultado> {
  const pool = getChatPostgresPool();
  const out: CommitResultado = {
    creados: 0, actualizados: 0, omitidos: 0, errores: 0,
    categorias_creadas: 0, movimientos_generados: 0, unidades_iniciales: 0,
    mensajes_error: [],
  };
  if (!pool) {
    out.mensajes_error.push("Sin conexión a la base de datos.");
    return out;
  }

  const tP = quoteSchemaTable(schemaRaw, "productos");
  const tC = quoteSchemaTable(schemaRaw, "categorias_productos");
  const tM = quoteSchemaTable(schemaRaw, "movimientos_inventario");
  const referencia = `IMPORT_INICIAL:${ctx.filenames.join(" + ").slice(0, 120)}`;

  // ── Categorías ────────────────────────────────────────────────────────────
  const catsExist = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM ${tC} WHERE empresa_id = $1::uuid`, [empresaId]
  );
  const catPorNombre = new Map<string, string>();
  for (const c of catsExist.rows) catPorNombre.set(String(c.nombre).trim().toUpperCase(), c.id);

  if (ctx.crearCategorias) {
    const faltantes = new Set<string>();
    for (const it of items) {
      if (it.categoria && !catPorNombre.has(it.categoria)) faltantes.add(it.categoria);
    }
    for (const nombre of faltantes) {
      try {
        const r = await pool.query<{ id: string }>(
          `INSERT INTO ${tC} (empresa_id, nombre, activo) VALUES ($1::uuid, $2, true) RETURNING id`,
          [empresaId, nombre]
        );
        catPorNombre.set(nombre, r.rows[0].id);
        out.categorias_creadas++;
      } catch (e) {
        out.mensajes_error.push(`Categoría "${nombre}": ${(e as Error).message.slice(0, 120)}`);
      }
    }
  }

  // ── Productos ─────────────────────────────────────────────────────────────
  for (const it of items) {
    if (it.errores.length > 0) { out.omitidos++; continue; }
    if (it.match_existente_id && !ctx.actualizarExistentes) { out.omitidos++; continue; }

    const categoriaId = it.categoria ? catPorNombre.get(it.categoria) ?? null : null;
    const stock = it.stock ?? 0;
    const costo = it.costo ?? 0;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      let productoId: string;
      let stockAnterior = 0;

      if (it.match_existente_id) {
        const prev = await client.query<{ stock_actual: string | null }>(
          `SELECT stock_actual FROM ${tP} WHERE id = $1::uuid AND empresa_id = $2::uuid FOR UPDATE`,
          [it.match_existente_id, empresaId]
        );
        stockAnterior = Number(prev.rows[0]?.stock_actual ?? 0);
        // COALESCE: nunca pisamos con NULL un dato que el ERP ya tenía.
        await client.query(
          `UPDATE ${tP} SET
             nombre = $3, sku = COALESCE(NULLIF($4,''), sku),
             codigo_barras = COALESCE(NULLIF($5,''), codigo_barras),
             codigo_fabrica = COALESCE(NULLIF($6,''), codigo_fabrica),
             categoria_principal_id = COALESCE($7::uuid, categoria_principal_id),
             unidad_medida = COALESCE(NULLIF($8,''), unidad_medida),
             stock_actual = $9::numeric,
             costo_promedio = COALESCE($10::numeric, costo_promedio),
             costo_mayorista = COALESCE($11::numeric, costo_mayorista),
             precio_venta = COALESCE($12::numeric, precio_venta),
             tipo_iva = $13
           WHERE id = $1::uuid AND empresa_id = $2::uuid`,
          [it.match_existente_id, empresaId, it.descripcion, it.codigo_interno,
           it.codigo_barras, it.codigo_fabrica, categoriaId, it.unidad, stock,
           it.costo, it.costo_mayorista, it.precio_venta, it.iva]
        );
        productoId = it.match_existente_id;
        out.actualizados++;
      } else {
        const r = await client.query<{ id: string }>(
          `INSERT INTO ${tP} (
             empresa_id, nombre, sku, codigo_barras, codigo_fabrica,
             categoria_principal_id, unidad_medida, stock_actual,
             costo_promedio, costo_mayorista, precio_venta, tipo_iva,
             activo, es_vendible, controla_stock
           ) VALUES (
             $1::uuid, $2, NULLIF($3,''), NULLIF($4,''), NULLIF($5,''),
             $6::uuid, $7, $8::numeric, $9::numeric, $10::numeric, $11::numeric, $12,
             true, true, true
           ) RETURNING id`,
          [empresaId, it.descripcion, it.codigo_interno, it.codigo_barras,
           it.codigo_fabrica, categoriaId, it.unidad || "UNIDAD", stock,
           it.costo, it.costo_mayorista, it.precio_venta, it.iva]
        );
        productoId = r.rows[0].id;
        out.creados++;
      }

      // Movimiento de inventario por la diferencia de stock que introduce la
      // importación (en un alta, la diferencia es el stock inicial completo).
      const delta = stock - stockAnterior;
      if (delta !== 0) {
        await client.query(
          `INSERT INTO ${tM} (
             empresa_id, producto_id, producto_nombre, producto_sku,
             tipo, cantidad, costo_unitario, origen, referencia, fecha,
             created_by, usuario_nombre
           ) VALUES (
             $1::uuid, $2::uuid, $3, $4, $5, $6::numeric, $7::numeric,
             'inventario_inicial', $8, now(), $9::uuid, $10
           )`,
          [empresaId, productoId, it.descripcion, it.codigo_interno || null,
           delta > 0 ? "ENTRADA" : "SALIDA", Math.abs(delta), costo,
           referencia, ctx.createdBy, ctx.usuarioNombre]
        );
        out.movimientos_generados++;
        out.unidades_iniciales += Math.abs(delta);
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      out.errores++;
      if (out.mensajes_error.length < 50) {
        out.mensajes_error.push(`${it.descripcion || it.clave}: ${(e as Error).message.slice(0, 150)}`);
      }
    } finally {
      client.release();
    }
  }

  // ── Historial de importación ──────────────────────────────────────────────
  await registrarImportAudit(schemaRaw, empresaId, {
    entidad: "productos_import_inicial",
    filename: ctx.filenames.join(" + ").slice(0, 200),
    total_rows: items.length,
    inserted_count: out.creados,
    updated_count: out.actualizados,
    skipped_count: out.omitidos,
    error_count: out.errores,
    warning_count: items.filter((i) => i.conflictos.length > 0).length,
    errors_json: out.mensajes_error,
    warnings_json: items
      .filter((i) => i.conflictos.length > 0)
      .slice(0, 200)
      .map((i) => ({
        producto: i.descripcion,
        codigo_interno: i.codigo_interno,
        conflictos: i.conflictos,
      })),
    created_by: ctx.createdBy,
    usuario_nombre: ctx.usuarioNombre,
  });

  return out;
}
