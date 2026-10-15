-- Precios por NIVEL en cada presentación (opción C del reclamo de precios).
-- Cada presentación puede tener su propio precio mayorista y distribuidor.
-- El `precio_venta` existente se mantiene como el precio MINORISTA de la presentación (override).
-- Si un nivel no está cargado en la presentación, el precio se calcula como
-- precio del producto para ese nivel × cantidad_base (resuelto en código).
-- Idempotente.

BEGIN;

ALTER TABLE ferreteriarepublica.producto_presentaciones
  ADD COLUMN IF NOT EXISTS precio_mayorista numeric,
  ADD COLUMN IF NOT EXISTS precio_distribuidor numeric;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'producto_presentaciones_precio_mayorista_check'
  ) THEN
    ALTER TABLE ferreteriarepublica.producto_presentaciones
      ADD CONSTRAINT producto_presentaciones_precio_mayorista_check
      CHECK (precio_mayorista IS NULL OR precio_mayorista >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'producto_presentaciones_precio_distribuidor_check'
  ) THEN
    ALTER TABLE ferreteriarepublica.producto_presentaciones
      ADD CONSTRAINT producto_presentaciones_precio_distribuidor_check
      CHECK (precio_distribuidor IS NULL OR precio_distribuidor >= 0);
  END IF;
END $$;

COMMIT;
