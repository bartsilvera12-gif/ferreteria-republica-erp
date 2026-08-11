DROP INDEX IF EXISTS ferreteriarepublica.idx_productos_marca;
ALTER TABLE ferreteriarepublica.productos
  DROP COLUMN IF EXISTS observaciones,
  DROP COLUMN IF EXISTS marca;
ALTER TABLE ferreteriarepublica.proveedores
  DROP COLUMN IF EXISTS contacto_telefono;
