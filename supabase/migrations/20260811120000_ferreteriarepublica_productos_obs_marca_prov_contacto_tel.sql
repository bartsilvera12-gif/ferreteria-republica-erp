-- Cambios rápidos 11/08: observaciones + marca en productos, teléfono del
-- contacto en proveedores. Aditivo, idempotente y reversible.

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS observaciones text,
  ADD COLUMN IF NOT EXISTS marca text;

-- Índice para filtrar/agrupar por marca (parcial: solo productos con marca).
CREATE INDEX IF NOT EXISTS idx_productos_marca
  ON ferreteriarepublica.productos (empresa_id, lower(marca))
  WHERE marca IS NOT NULL AND btrim(marca) <> '';

ALTER TABLE ferreteriarepublica.proveedores
  ADD COLUMN IF NOT EXISTS contacto_telefono text;
