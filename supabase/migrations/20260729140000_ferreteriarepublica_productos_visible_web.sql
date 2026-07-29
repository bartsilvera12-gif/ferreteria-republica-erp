-- Visibilidad en el sitio web público por producto. Aditivo e idempotente.
-- Default true: los productos existentes siguen visibles; el cliente oculta los
-- que no quiere mostrar en la web sin afectar ventas/compras internas.
ALTER TABLE ferreteriarepublica.productos
  ADD COLUMN IF NOT EXISTS visible_web boolean NOT NULL DEFAULT true;

-- Índice parcial para el catálogo público (filtra por empresa + vendible + visible).
CREATE INDEX IF NOT EXISTS idx_productos_visible_web
  ON ferreteriarepublica.productos (empresa_id)
  WHERE visible_web = true AND es_vendible = true;
