-- ============================================================================
-- Ferretería República — Auditoría de edición de presupuestos
-- ============================================================================
-- Aditiva · idempotente (re-ejecutable) · NO destructiva · schema tenant:
-- ferreteriarepublica.  NO ejecutar automáticamente: revisar antes de aplicar.
--
-- Agrega a `presupuestos` las columnas para registrar QUIÉN editó por última vez
-- (además del `updated_at` que ya existe). El código setea estas columnas al
-- editar; si la migración no está aplicada, guarda igual sin ellas (fallback).
-- ============================================================================

BEGIN;

ALTER TABLE ferreteriarepublica.presupuestos
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE ferreteriarepublica.presupuestos
  ADD COLUMN IF NOT EXISTS updated_by_nombre text;

COMMIT;

-- ============================================================================
-- ROLLBACK (pre-uso real; nadie editó presupuestos con auditoría todavía):
--   BEGIN;
--   ALTER TABLE ferreteriarepublica.presupuestos DROP COLUMN IF EXISTS updated_by;
--   ALTER TABLE ferreteriarepublica.presupuestos DROP COLUMN IF EXISTS updated_by_nombre;
--   COMMIT;
-- ============================================================================
