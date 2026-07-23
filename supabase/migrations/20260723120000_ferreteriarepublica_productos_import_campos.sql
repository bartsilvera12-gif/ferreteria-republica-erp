-- ============================================================================
-- Campos necesarios para la importación consolidada de productos.
-- ADITIVA E IDEMPOTENTE. Solo schema ferreteriarepublica.
--
-- El catálogo del cliente viene de 3 reportes que aportan datos que el ERP no
-- tenía dónde guardar:
--   codigo_fabrica  : código del fabricante (los 3 reportes lo traen; es la
--                     principal llave de cruce entre archivos).
--   costo_mayorista : precio de COSTO mayorista (distinto de precio_mayorista,
--                     que es un precio de VENTA).
--   tipo_iva        : IVA del producto (99,9% al 10%).
-- ============================================================================

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS codigo_fabrica text;

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS costo_mayorista numeric;

ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS tipo_iva text NOT NULL DEFAULT '10%';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = t.relnamespace
    WHERE ns.nspname = 'ferreteriarepublica'
      AND t.relname = 'productos'
      AND c.conname = 'productos_tipo_iva_check'
  ) THEN
    ALTER TABLE ferreteriarepublica.productos
      ADD CONSTRAINT productos_tipo_iva_check CHECK (tipo_iva IN ('10%', '5%', 'EXENTA'));
  END IF;
END $$;

-- Índice para el cruce por código de fábrica durante la importación.
CREATE INDEX IF NOT EXISTS productos_codigo_fabrica_idx
  ON ferreteriarepublica.productos (empresa_id, codigo_fabrica)
  WHERE codigo_fabrica IS NOT NULL;
