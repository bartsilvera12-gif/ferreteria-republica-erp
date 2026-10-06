-- Casos 1+4 — validación de precio server-side.
-- Auditoría de precio manual por línea de venta: cuándo un admin aplica un
-- precio distinto al configurado, se guarda quién lo hizo. El precio configurado
-- queda en `precio_venta_original` y el aplicado en `precio_venta` (ya existentes);
-- `modo_precio` guarda 'configurado' | 'manual'.
-- Idempotente.

BEGIN;

ALTER TABLE ferreteriarepublica.ventas_items
  ADD COLUMN IF NOT EXISTS precio_modificado_por uuid,
  ADD COLUMN IF NOT EXISTS precio_modificado_por_nombre text;

COMMIT;
