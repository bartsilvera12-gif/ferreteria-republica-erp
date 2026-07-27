-- OC: permitir capturar timbrado, N° de factura y comprobante ya en la creación
-- de la orden de compra (antes solo se cargaban al recibir). Aditivo e idempotente.
ALTER TABLE ferreteriarepublica.ordenes_compra
  ADD COLUMN IF NOT EXISTS nro_timbrado text,
  ADD COLUMN IF NOT EXISTS numero_factura text,
  ADD COLUMN IF NOT EXISTS comprobante_url text,
  ADD COLUMN IF NOT EXISTS comprobante_storage_path text,
  ADD COLUMN IF NOT EXISTS comprobante_nombre text,
  ADD COLUMN IF NOT EXISTS comprobante_mime_type text;
