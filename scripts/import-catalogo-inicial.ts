/**
 * Carga inicial del catálogo desde los 3 reportes del cliente.
 *
 *   npx tsx scripts/import-catalogo-inicial.ts \
 *     --productos "<ruta RelatorioProduto.xls>" \
 *     --general   "<ruta RelatorioEstoqueGeral.xls>" \
 *     --valorizado "<ruta RelatorioEstoqueValorizado.xls>" \
 *     [--reset-history]   (borra también el historial de prueba que bloquea el borrado)
 *     [--apply]           (sin esto es DRY-RUN: no escribe nada)
 *
 * Requiere SUPABASE_DB_URL. Trabaja SOLO sobre ferreteriarepublica.
 *
 * Flujo con --apply:
 *   1) (opcional) borra ventas_items/movimientos/compras de prueba
 *   2) borra el catálogo actual (los dependientes CASCADE caen solos)
 *   3) crea categorías faltantes
 *   4) inserta los productos consolidados en lotes
 *   5) inserta un movimiento de inventario inicial por producto con stock
 *   6) registra la importación en imports_audit
 */
import * as fs from "fs";
import * as XLSX from "xlsx";
import { Pool } from "pg";
import { parseReporte } from "@/lib/imports/parsers-reportes-xls";
import { consolidar, resumir, type ProductoConsolidado } from "@/lib/imports/consolidacion-productos";

const SCHEMA = "ferreteriarepublica";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

function aoa(path: string): unknown[][] {
  const wb = XLSX.read(fs.readFileSync(path), { type: "buffer" });
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: false });
}

async function main() {
  const fProd = arg("productos");
  const fGen = arg("general");
  const fVal = arg("valorizado");
  const apply = has("apply");
  const resetHistory = has("reset-history");

  if (!fProd && !fGen && !fVal) {
    console.error("Faltan archivos. Ver cabecera del script para el uso.");
    process.exit(1);
  }
  const url = process.env.SUPABASE_DB_URL;
  if (!url) { console.error("Falta SUPABASE_DB_URL"); process.exit(1); }

  console.log(`Modo: ${apply ? "APLICAR (escribe en la BD)" : "DRY-RUN (no escribe)"}`);

  // ── Parseo + consolidación ──
  const filas = [];
  if (fProd) { const r = parseReporte("productos", aoa(fProd)); console.log(`Productos: ${r.diag.filas_datos} filas, cols=${JSON.stringify(r.diag.columnas)}, faltan=${r.diag.columnas_faltantes}`); filas.push(...r.filas); }
  if (fGen)  { const r = parseReporte("stock_general", aoa(fGen)); console.log(`Stock General: ${r.diag.filas_datos} filas, cols=${JSON.stringify(r.diag.columnas)}, faltan=${r.diag.columnas_faltantes}`); filas.push(...r.filas); }
  if (fVal)  { const r = parseReporte("stock_valorizado", aoa(fVal)); console.log(`Stock Valorizado: ${r.diag.filas_datos} filas, cols=${JSON.stringify(r.diag.columnas)}, faltan=${r.diag.columnas_faltantes}`); filas.push(...r.filas); }

  const items = consolidar(filas).filter((i) => i.errores.length === 0);
  const res = resumir(consolidar(filas));
  console.log("\nConsolidado:", JSON.stringify(res, null, 2));
  console.log(`Productos a cargar (sin errores): ${items.length}`);

  if (!apply) {
    console.log("\nDRY-RUN: no se escribió nada. Agregá --apply para ejecutar.");
    return;
  }

  const pool = new Pool({ connectionString: url });
  const t = (name: string) => `"${SCHEMA}"."${name}"`;
  try {
    const empresa = (await pool.query(`SELECT id FROM ${t("empresas")} ORDER BY created_at LIMIT 1`)).rows[0]?.id
      ?? (await pool.query(`SELECT DISTINCT empresa_id AS id FROM ${t("productos")} LIMIT 1`)).rows[0]?.id;
    if (!empresa) throw new Error("No se pudo determinar empresa_id.");
    console.log("empresa_id:", empresa);

    // ── 1) Historial de prueba (opcional) ──
    if (resetHistory) {
      const a = await pool.query(`DELETE FROM ${t("ventas_items")} WHERE empresa_id=$1`, [empresa]);
      const b = await pool.query(`DELETE FROM ${t("movimientos_inventario")} WHERE empresa_id=$1`, [empresa]);
      const c = await pool.query(`DELETE FROM ${t("compras")} WHERE empresa_id=$1`, [empresa]);
      console.log(`Historial borrado -> ventas_items:${a.rowCount} movimientos:${b.rowCount} compras:${c.rowCount}`);
    }

    // ── 2) Catálogo actual ──
    const del = await pool.query(`DELETE FROM ${t("productos")} WHERE empresa_id=$1`, [empresa]);
    console.log(`Productos borrados: ${del.rowCount}`);

    // ── 3) Categorías ──
    const catRows = (await pool.query(`SELECT id, upper(trim(nombre)) AS n FROM ${t("categorias_productos")} WHERE empresa_id=$1`, [empresa])).rows;
    const catMap = new Map<string, string>(catRows.map((r) => [r.n, r.id]));
    const catNuevas = [...new Set(items.map((i) => i.categoria).filter(Boolean))].filter((c) => !catMap.has(c));
    for (const nombre of catNuevas) {
      const r = await pool.query(`INSERT INTO ${t("categorias_productos")} (empresa_id, nombre, activo) VALUES ($1,$2,true) RETURNING id`, [empresa, nombre]);
      catMap.set(nombre, r.rows[0].id);
    }
    console.log(`Categorías creadas: ${catNuevas.length}`);

    // ── 4) Inserción de productos en lotes ──
    const LOTE = 500;
    let creados = 0, movs = 0;
    for (let off = 0; off < items.length; off += LOTE) {
      const lote = items.slice(off, off + LOTE);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const it of lote) {
          const catId = it.categoria ? catMap.get(it.categoria) ?? null : null;
          const stock = it.stock ?? 0;
          const ins = await client.query(
            `INSERT INTO ${t("productos")} (
               empresa_id, nombre, sku, codigo_barras, codigo_fabrica,
               categoria_principal_id, unidad_medida, stock_actual,
               costo_promedio, costo_mayorista, precio_venta, tipo_iva,
               activo, es_vendible, controla_stock
             ) VALUES ($1,$2,NULLIF($3,''),NULLIF($4,''),NULLIF($5,''),$6,$7,$8,$9,$10,$11,$12,true,true,true)
             RETURNING id`,
            [empresa, it.descripcion, it.codigo_interno, it.codigo_barras, it.codigo_fabrica,
             catId, it.unidad || "UNIDAD", stock, it.costo, it.costo_mayorista, it.precio_venta, it.iva]
          );
          creados++;
          if (stock !== 0) {
            await client.query(
              `INSERT INTO ${t("movimientos_inventario")} (
                 empresa_id, producto_id, producto_nombre, producto_sku,
                 tipo, cantidad, costo_unitario, origen, referencia, fecha
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,'inventario_inicial','IMPORT_INICIAL_CATALOGO',now())`,
              [empresa, ins.rows[0].id, it.descripcion, it.codigo_interno || null,
               stock > 0 ? "ENTRADA" : "SALIDA", Math.abs(stock), it.costo ?? 0]
            );
            movs++;
          }
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(`Lote ${off}-${off + LOTE} FALLÓ:`, (e as Error).message);
        throw e;
      } finally {
        client.release();
      }
      process.stdout.write(`\r  insertados ${creados}/${items.length}`);
    }
    console.log(`\nProductos creados: ${creados}  · movimientos de stock inicial: ${movs}`);

    // ── 5) Historial de importación ──
    await pool.query(
      `INSERT INTO ${t("imports_audit")} (empresa_id, entidad, filename, total_rows, inserted_count, updated_count, skipped_count, error_count, warning_count, errors_json, warnings_json, usuario_nombre)
       VALUES ($1,'productos_import_inicial',$2,$3,$4,0,0,0,$5,'[]'::jsonb,'[]'::jsonb,'carga inicial (script)')`,
      [empresa, [fProd, fGen, fVal].filter(Boolean).map((p) => p!.split(/[\\/]/).pop()).join(" + "),
       items.length, creados, res.con_conflictos]
    );
    console.log("Historial de importación registrado.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
