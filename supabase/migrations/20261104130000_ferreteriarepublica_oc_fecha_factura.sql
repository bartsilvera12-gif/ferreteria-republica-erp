-- OC: fecha de la factura del proveedor, cargable ya al emitir la orden (junto
-- con timbrado y N° de factura). Se usa como valor inicial al recibir la OC.
-- La fecha de registro de la OC sigue siendo `fecha` (automática).
-- Aditivo e idempotente.
ALTER TABLE ferreteriarepublica.ordenes_compra
  ADD COLUMN IF NOT EXISTS fecha_factura date;
