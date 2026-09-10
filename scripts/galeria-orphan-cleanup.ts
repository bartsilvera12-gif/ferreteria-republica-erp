/**
 * Reconciliación de objetos huérfanos de la galería de producto.
 *
 * Un huérfano = objeto en el bucket privado `productos-imagenes` bajo
 * {empresa_id}/{producto_id}/ que NO está referenciado por ninguna fila de
 * ferreteriarepublica.producto_imagenes.imagen_path.
 *
 * NUNCA borra un objeto referenciado por una fila. Por defecto es DRY-RUN
 * (solo reporta). Con `--delete` borra los huérfanos del producto indicado.
 *
 * Uso:
 *   tsx scripts/galeria-orphan-cleanup.ts --empresa <uuid> --producto <uuid>
 *   tsx scripts/galeria-orphan-cleanup.ts --empresa <uuid> --producto <uuid> --delete
 *
 * No hay cron: es una herramienta administrativa a demanda.
 */
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { getChatPostgresPool, quoteSchemaTable } from "@/lib/supabase/chat-pg-pool";
import { assertAllowedChatDataSchema } from "@/lib/supabase/chat-data-schema";
import { fetchDataSchemaForEmpresaId } from "@/lib/supabase/empresa-data-schema";
import { PRODUCTOS_IMAGENES_BUCKET } from "@/lib/inventario/imagen-storage";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const empresaId = arg("empresa");
  const productoId = arg("producto");
  const doDelete = process.argv.includes("--delete");
  if (!empresaId || !productoId) {
    console.error("Faltan --empresa <uuid> y --producto <uuid>.");
    process.exit(1);
  }

  const supabase = createServiceRoleClient();
  const pool = getChatPostgresPool();
  if (!pool) throw new Error("Pool de Postgres no disponible.");
  const schema = assertAllowedChatDataSchema(await fetchDataSchemaForEmpresaId(empresaId));
  const tImg = quoteSchemaTable(schema, "producto_imagenes");
  const tProd = quoteSchemaTable(schema, "productos");

  // 1) Referenciados en BD: producto_imagenes.imagen_path (galería).
  const { rows } = await pool.query(
    `SELECT imagen_path FROM ${tImg} WHERE empresa_id=$1::uuid AND producto_id=$2::uuid AND imagen_path IS NOT NULL`,
    [empresaId, productoId]
  );
  const referenciados = new Set(
    (rows as Array<{ imagen_path: string }>).map((r) => r.imagen_path)
  );

  // 1b) Referenciado LEGACY: productos.imagen_path (espejo de la principal).
  //     Así nunca borramos principal.{ext} u otro objeto aún referenciado por
  //     el campo legacy, aunque no esté (todavía) en producto_imagenes.
  const { rows: legacy } = await pool.query(
    `SELECT imagen_path FROM ${tProd} WHERE empresa_id=$1::uuid AND id=$2::uuid AND imagen_path IS NOT NULL`,
    [empresaId, productoId]
  );
  for (const r of legacy as Array<{ imagen_path: string }>) referenciados.add(r.imagen_path);

  // 2) Objetos en el bucket bajo {empresa}/{producto}/.
  const prefix = `${empresaId}/${productoId}`;
  const { data: objetos, error } = await supabase.storage
    .from(PRODUCTOS_IMAGENES_BUCKET)
    .list(prefix, { limit: 1000 });
  if (error) throw new Error(`No se pudo listar el storage: ${error.message}`);

  const huerfanos: string[] = [];
  for (const o of objetos ?? []) {
    const full = `${prefix}/${o.name}`;
    if (!referenciados.has(full)) huerfanos.push(full);
  }

  console.log(JSON.stringify({
    empresa_id: empresaId,
    producto_id: productoId,
    objetos_en_storage: (objetos ?? []).length,
    referenciados_en_bd: referenciados.size,
    huerfanos: huerfanos.length,
    lista_huerfanos: huerfanos,
    modo: doDelete ? "DELETE" : "DRY-RUN",
  }, null, 2));

  if (doDelete && huerfanos.length > 0) {
    // Doble chequeo: nunca borrar algo referenciado (por si cambió entre pasos).
    const seguros = huerfanos.filter((p) => !referenciados.has(p));
    const { error: delErr } = await supabase.storage
      .from(PRODUCTOS_IMAGENES_BUCKET)
      .remove(seguros);
    if (delErr) throw new Error(`Fallo al borrar huérfanos: ${delErr.message}`);
    console.log(`Borrados ${seguros.length} objetos huérfanos.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
