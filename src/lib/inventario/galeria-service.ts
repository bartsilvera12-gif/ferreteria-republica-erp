/**
 * Lógica de negocio COMPARTIDA de la galería de imágenes de producto.
 * La usan tanto el endpoint LEGACY (`/api/productos/[id]/imagen`) como los
 * endpoints nuevos (`/api/productos/[id]/imagenes/*`), para no tener dos fuentes
 * de verdad.
 *
 * Orquesta Storage (no transaccional con Postgres) y BD (transaccional) con el
 * orden correcto:
 *  - ALTA: upload a Storage → inserción BD. Si la BD falla, se intenta borrar el
 *    objeto recién subido; si ese cleanup falla → huérfano (nunca referencia rota).
 *  - BORRADO: transacción BD (quitar fila + promover + sync) → luego borrar objeto.
 *    Si el borrado de Storage falla → se registra huérfano; NO se revierte la BD.
 */
import { randomUUID } from "crypto";
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import { ALLOWED_IMAGE_MIME, MAX_IMAGE_BYTES } from "@/lib/inventario/imagen-storage";
import {
  buildGaleriaImagenPath,
  uploadGaleriaObjeto,
  removeGaleriaObjeto,
  ensureProductosImagenesBucket,
} from "@/lib/inventario/galeria-imagen-storage";
import {
  insertGaleriaImagenConLimitePg,
  deleteImagenAndPromotePg,
  legacyReplacePrincipalPg,
  getGaleriaImagenPg,
  listGaleriaPg,
  type GaleriaImagenRow,
} from "@/lib/inventario/server/galeria-pg";

export type GaleriaCtx = { empresaId: string; schema: string; supabase: AppSupabaseClient };

export class GaleriaLimiteError extends Error {}
export class GaleriaValidacionError extends Error {}

/** Máximo de imágenes por producto: MAX_PRODUCT_IMAGES (env), default 8, rango [1,20]. */
export function getMaxProductImages(): number {
  const raw = Number(process.env.MAX_PRODUCT_IMAGES);
  if (!Number.isFinite(raw) || raw < 1 || raw > 20) return 8;
  return Math.floor(raw);
}

/** Valida MIME (jpg/png/webp) y tamaño (5 MB). Lanza GaleriaValidacionError. */
export function validarArchivo(file: File): void {
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    throw new GaleriaValidacionError("Formato no permitido. Usá JPG, PNG o WebP.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new GaleriaValidacionError("Imagen demasiado grande (máx. 5 MB).");
  }
}

function logOrfano(ctx: GaleriaCtx, productoId: string, path: string, motivo: string): void {
  // Estrategia auditable mínima + script de reconciliación (galeria-orphan-cleanup.ts).
  console.error("[galeria][orphan]", JSON.stringify({
    empresa_id: ctx.empresaId, producto_id: productoId, path, motivo, ts: new Date().toISOString(),
  }));
}

/** Agrega una imagen NUEVA a la galería (respeta el límite). */
export async function agregarImagen(
  ctx: GaleriaCtx,
  productoId: string,
  file: File
): Promise<GaleriaImagenRow> {
  validarArchivo(file);
  const max = getMaxProductImages();
  try { await ensureProductosImagenesBucket(ctx.supabase); } catch { /* non-fatal */ }

  const imagenId = randomUUID();
  const path = buildGaleriaImagenPath(ctx.empresaId, productoId, imagenId, file.type);
  const buf = Buffer.from(await file.arrayBuffer());

  // 1) Storage primero.
  const up = await uploadGaleriaObjeto(ctx.supabase, path, buf, file.type);
  if (!up.ok) throw new Error(`No se pudo subir la imagen: ${up.error ?? "storage"}`);

  // 2) BD ATÓMICA (lock del producto + count + insert): seguro ante concurrencia.
  //    Si falla o excede el límite, cleanup best-effort del objeto recién subido.
  let res: { over: true } | { over: false; row: GaleriaImagenRow };
  try {
    res = await insertGaleriaImagenConLimitePg(
      ctx.schema, ctx.empresaId, productoId, imagenId, { imagen_path: path, imagen_url: null }, max
    );
  } catch (e) {
    const rm = await removeGaleriaObjeto(ctx.supabase, path);
    if (!rm.ok) logOrfano(ctx, productoId, path, "insert-BD-fallo-y-cleanup-fallo");
    throw e;
  }
  if (res.over) {
    const rm = await removeGaleriaObjeto(ctx.supabase, path);
    if (!rm.ok) logOrfano(ctx, productoId, path, "limite-excedido-y-cleanup-fallo");
    throw new GaleriaLimiteError(`Máximo ${max} imágenes por producto.`);
  }
  return res.row;
}

/** LEGACY POST: reemplaza la imagen principal (conserva secundarias). */
export async function reemplazarPrincipal(
  ctx: GaleriaCtx,
  productoId: string,
  file: File
): Promise<GaleriaImagenRow> {
  validarArchivo(file);
  try { await ensureProductosImagenesBucket(ctx.supabase); } catch { /* non-fatal */ }

  const imagenId = randomUUID();
  const path = buildGaleriaImagenPath(ctx.empresaId, productoId, imagenId, file.type);
  const buf = Buffer.from(await file.arrayBuffer());

  const up = await uploadGaleriaObjeto(ctx.supabase, path, buf, file.type);
  if (!up.ok) throw new Error(`No se pudo subir la imagen: ${up.error ?? "storage"}`);

  let result: { oldPrincipal: GaleriaImagenRow | null; newRow: GaleriaImagenRow };
  try {
    result = await legacyReplacePrincipalPg(ctx.schema, ctx.empresaId, productoId, imagenId, {
      imagen_path: path,
      imagen_url: null,
    });
  } catch (e) {
    const rm = await removeGaleriaObjeto(ctx.supabase, path);
    if (!rm.ok) logOrfano(ctx, productoId, path, "legacy-replace-BD-fallo-y-cleanup-fallo");
    throw e;
  }

  // Tras COMMIT: borrar el objeto de la anterior principal (solo si era path propio).
  if (result.oldPrincipal?.imagen_path) {
    const rm = await removeGaleriaObjeto(ctx.supabase, result.oldPrincipal.imagen_path);
    if (!rm.ok) logOrfano(ctx, productoId, result.oldPrincipal.imagen_path, "borrado-anterior-principal-fallo");
  }
  return result.newRow;
}

/** Borra una imagen de la galería (promueve principal si corresponde). */
export async function borrarImagen(
  ctx: GaleriaCtx,
  productoId: string,
  imagenId: string
): Promise<boolean> {
  const deleted = await deleteImagenAndPromotePg(ctx.schema, ctx.empresaId, productoId, imagenId);
  if (!deleted) return false; // no existía / no pertenece
  // Tras COMMIT: borrar el objeto (solo si era path privado propio).
  if (deleted.imagen_path) {
    const rm = await removeGaleriaObjeto(ctx.supabase, deleted.imagen_path);
    if (!rm.ok) logOrfano(ctx, productoId, deleted.imagen_path, "borrado-objeto-fallo");
  }
  return true;
}

/** LEGACY DELETE: borra la principal (promueve la siguiente). */
export async function borrarPrincipalLegacy(ctx: GaleriaCtx, productoId: string): Promise<boolean> {
  const rows = await listGaleriaPg(ctx.schema, ctx.empresaId, productoId);
  const principal = rows.find((r) => r.es_principal);
  if (!principal) return false;
  return borrarImagen(ctx, productoId, principal.id);
}

/** Reexport para el proxy público / validaciones. */
export { getGaleriaImagenPg };
