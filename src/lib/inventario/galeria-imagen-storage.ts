/**
 * Storage helpers para la GALERÍA de imágenes de producto (múltiples).
 *
 * Reutiliza el bucket PRIVADO existente `productos-imagenes` (no modifica
 * imagen-storage.ts). Diferencia clave con el legacy: cada imagen usa un path
 * ÚNICO por imagen_id, NUNCA `principal.{ext}` (que podría sobrescribir una
 * imagen que ahora es secundaria):
 *
 *   {empresa_id}/{producto_id}/{imagen_id}.{ext}
 */
import type { AppSupabaseClient } from "@/lib/supabase/schema";
import {
  PRODUCTOS_IMAGENES_BUCKET,
  ALLOWED_IMAGE_EXT,
  ensureProductosImagenesBucket,
} from "@/lib/inventario/imagen-storage";

export { PRODUCTOS_IMAGENES_BUCKET, ensureProductosImagenesBucket };

/** Path único por imagen (nunca `principal.{ext}`). */
export function buildGaleriaImagenPath(
  empresaId: string,
  productoId: string,
  imagenId: string,
  mime: string
): string {
  const ext = ALLOWED_IMAGE_EXT[mime] ?? "bin";
  return `${empresaId}/${productoId}/${imagenId}.${ext}`;
}

/** Sube el archivo al bucket privado. upsert:false (paths únicos por imagen_id). */
export async function uploadGaleriaObjeto(
  supabase: AppSupabaseClient,
  path: string,
  buf: Buffer,
  mime: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage
    .from(PRODUCTOS_IMAGENES_BUCKET)
    .upload(path, buf, { contentType: mime, upsert: false });
  return { ok: !error, error: error?.message };
}

/** Elimina un objeto del bucket. Devuelve ok=false si falla (posible huérfano). */
export async function removeGaleriaObjeto(
  supabase: AppSupabaseClient,
  path: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage
    .from(PRODUCTOS_IMAGENES_BUCKET)
    .remove([path]);
  return { ok: !error, error: error?.message };
}

/** Descarga bytes de un objeto privado (para el proxy público /imagen-producto). */
export async function downloadGaleriaObjeto(
  supabase: AppSupabaseClient,
  path: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const { data, error } = await supabase.storage
    .from(PRODUCTOS_IMAGENES_BUCKET)
    .download(path);
  if (error || !data) return null;
  const buffer = Buffer.from(await data.arrayBuffer());
  const ext = path.split(".").pop()?.toLowerCase();
  const contentType =
    data.type ||
    (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  return { buffer, contentType };
}

/** URL firmada temporal para PREVIEW admin (no se expone imagen_path al browser). */
export async function signGaleriaPreview(
  supabase: AppSupabaseClient,
  path: string,
  ttlSeconds = 3600
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(PRODUCTOS_IMAGENES_BUCKET)
      .createSignedUrl(path, ttlSeconds);
    return error ? null : data?.signedUrl ?? null;
  } catch {
    return null;
  }
}
