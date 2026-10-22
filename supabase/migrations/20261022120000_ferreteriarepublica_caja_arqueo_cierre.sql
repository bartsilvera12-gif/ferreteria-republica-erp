-- Ticket de arqueo: datos adicionales del cierre de caja.
-- - tarjeta_contado / transferencia_contado: lo "contado" del POS/banco por método
--   (hoy iba como texto en observacion_cierre). Permite esperado vs contado y diferencia por método.
-- - monto_dejado_caja: efectivo que el cajero deja para la próxima jornada.
-- - monto_tesoreria: efectivo extraído a tesorería (= monto_cierre_contado - monto_dejado_caja).
-- Idempotente. Todas nullable (los cierres viejos quedan sin estos datos).

BEGIN;

ALTER TABLE ferreteriarepublica.cajas
  ADD COLUMN IF NOT EXISTS tarjeta_contado numeric,
  ADD COLUMN IF NOT EXISTS transferencia_contado numeric,
  ADD COLUMN IF NOT EXISTS monto_dejado_caja numeric,
  ADD COLUMN IF NOT EXISTS monto_tesoreria numeric;

COMMIT;
