-- ============================================================================
-- Permite el origen 'edicion_compra' en movimientos_inventario.
-- ADITIVA E IDEMPOTENTE. Solo schema ferreteriarepublica.
--
-- Al corregir una compra ya registrada, el ajuste de stock NO reescribe el
-- movimiento original: se registra un movimiento NUEVO con origen
-- 'edicion_compra' que documenta la corrección (queda el rastro).
-- ============================================================================

DO $$
BEGIN
  ALTER TABLE ferreteriarepublica.movimientos_inventario
    DROP CONSTRAINT IF EXISTS movimientos_inventario_origen_check;

  ALTER TABLE ferreteriarepublica.movimientos_inventario
    ADD CONSTRAINT movimientos_inventario_origen_check
    CHECK (origen = ANY (ARRAY[
      'compra', 'venta', 'ajuste_manual', 'inventario_inicial',
      'produccion', 'devolucion_venta', 'edicion_compra'
    ]));
END $$;
