-- Presentaciones de venta en los ítems de presupuesto (Caja, Paquete, Unidad...).
-- Mismo snapshot que ya guarda ventas_items: si la presentación cambia después,
-- el presupuesto histórico sigue mostrando lo que se cotizó.
-- Aditiva e idempotente. Solo schema ferreteriarepublica.

ALTER TABLE ferreteriarepublica.presupuesto_items
  ADD COLUMN IF NOT EXISTS presentacion_id uuid,
  ADD COLUMN IF NOT EXISTS presentacion_nombre text,
  ADD COLUMN IF NOT EXISTS presentacion_cantidad_base numeric;

COMMENT ON COLUMN ferreteriarepublica.presupuesto_items.presentacion_cantidad_base IS
  'Unidades base que representa una presentación. cantidad * cantidad_base = unidades de stock al convertir en pedido.';

-- PostgREST cachea el esquema: sin esto las columnas nuevas no se ven hasta reiniciar.
NOTIFY pgrst, 'reload schema';
