-- ============================================================================
-- ROLLBACK de devoluciones de ventas. NO se ejecuta automaticamente.
-- Solo schema ferreteriarepublica.
--
-- GUARDA: si existe al menos UNA devolucion real (confirmada o anulada), aborta
-- y no borra nada. Para desactivar la funcionalidad sin perder datos usá el
-- feature flag DEVOLUCIONES_VENTAS_ENABLED=false (via reversion inmediata).
--
-- Uso:
--   SUPABASE_DB_URL="..." npx tsx scripts/apply-sql-file-pg.ts \
--     supabase/migrations/rollback/20260716120000_rollback_devoluciones_ventas.sql
-- ============================================================================

DO $$
DECLARE
  n_dev   bigint := 0;
  n_movi  bigint := 0;
  n_movc  bigint := 0;
BEGIN
  -- ── Guarda 1: devoluciones registradas ───────────────────────────────────
  IF to_regclass('ferreteriarepublica.devoluciones_venta') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM ferreteriarepublica.devoluciones_venta' INTO n_dev;
  END IF;

  -- ── Guarda 2: impacto ya escrito en inventario / caja ────────────────────
  IF to_regclass('ferreteriarepublica.movimientos_inventario') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM ferreteriarepublica.movimientos_inventario WHERE devolucion_id IS NOT NULL OR origen = ''devolucion_venta'''
      INTO n_movi;
  END IF;
  IF to_regclass('ferreteriarepublica.caja_movimientos') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM ferreteriarepublica.caja_movimientos WHERE devolucion_id IS NOT NULL' INTO n_movc;
  END IF;

  IF n_dev > 0 OR n_movi > 0 OR n_movc > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTADO: existen datos reales de devoluciones (devoluciones=%, mov_inventario=%, mov_caja=%). No se borra nada. Usá el feature flag DEVOLUCIONES_VENTAS_ENABLED=false para desactivar sin perder datos.',
      n_dev, n_movi, n_movc;
  END IF;

  RAISE NOTICE 'Sin devoluciones reales. Procediendo con el rollback.';
END $$;

-- ── Borrado de tablas (solo se llega aca si las guardas pasaron) ───────────
DROP TABLE IF EXISTS ferreteriarepublica.devoluciones_venta_cambios;
DROP TABLE IF EXISTS ferreteriarepublica.devoluciones_venta_items;
DROP TABLE IF EXISTS ferreteriarepublica.devoluciones_venta;

-- ── Revertir columnas de trazabilidad ─────────────────────────────────────
DROP INDEX IF EXISTS ferreteriarepublica.movimientos_inventario_devolucion_idx;
ALTER TABLE ferreteriarepublica.movimientos_inventario DROP COLUMN IF EXISTS devolucion_id;

DROP INDEX IF EXISTS ferreteriarepublica.caja_movimientos_devolucion_idx;
ALTER TABLE ferreteriarepublica.caja_movimientos DROP COLUMN IF EXISTS devolucion_id;
ALTER TABLE ferreteriarepublica.caja_movimientos DROP COLUMN IF EXISTS venta_id;

-- ── Revertir CHECKs ampliados a su definicion original ────────────────────
DO $$
BEGIN
  -- ventas.estado: solo si NINGUNA venta usa los estados nuevos.
  IF EXISTS (SELECT 1 FROM ferreteriarepublica.ventas WHERE estado IN ('parcialmente_devuelta','devuelta_total')) THEN
    RAISE EXCEPTION 'ROLLBACK ABORTADO: hay ventas con estado parcialmente_devuelta/devuelta_total.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.ventas'::regclass AND conname='ventas_estado_check') THEN
    ALTER TABLE ferreteriarepublica.ventas DROP CONSTRAINT ventas_estado_check;
  END IF;
  ALTER TABLE ferreteriarepublica.ventas ADD CONSTRAINT ventas_estado_check
    CHECK (estado IN ('pendiente','completada','anulada'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.movimientos_inventario'::regclass AND conname='movimientos_inventario_origen_check') THEN
    ALTER TABLE ferreteriarepublica.movimientos_inventario DROP CONSTRAINT movimientos_inventario_origen_check;
  END IF;
  ALTER TABLE ferreteriarepublica.movimientos_inventario ADD CONSTRAINT movimientos_inventario_origen_check
    CHECK (origen IN ('compra','venta','ajuste_manual','inventario_inicial','produccion'));
END $$;
