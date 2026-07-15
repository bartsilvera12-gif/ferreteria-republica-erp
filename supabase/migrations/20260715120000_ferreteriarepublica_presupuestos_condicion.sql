-- Agrega la condición de venta (contado / crédito) a los presupuestos.
-- Aditiva e idempotente. Solo schema ferreteriarepublica.
ALTER TABLE ferreteriarepublica.presupuestos
  ADD COLUMN IF NOT EXISTS condicion text NOT NULL DEFAULT 'contado';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'ferreteriarepublica.presupuestos'::regclass
      AND conname = 'presupuestos_condicion_check'
  ) THEN
    ALTER TABLE ferreteriarepublica.presupuestos
      ADD CONSTRAINT presupuestos_condicion_check
      CHECK (condicion IN ('contado', 'credito'));
  END IF;
END $$;
