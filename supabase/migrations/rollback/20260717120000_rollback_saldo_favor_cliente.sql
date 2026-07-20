-- ============================================================================
-- ROLLBACK del saldo a favor. NO se ejecuta automáticamente.
-- GUARDA: aborta si existe algún movimiento de crédito real o alguna venta
-- pagada con saldo a favor. Solo schema ferreteriarepublica.
-- ============================================================================

DO $$
DECLARE
  n_cred bigint := 0;
  n_pag  bigint := 0;
  n_dev  bigint := 0;
BEGIN
  IF to_regclass('ferreteriarepublica.creditos_cliente') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM ferreteriarepublica.creditos_cliente' INTO n_cred;
  END IF;
  EXECUTE 'SELECT count(*) FROM ferreteriarepublica.ventas_pagos_detalle WHERE metodo_pago = ''saldo_favor''' INTO n_pag;
  EXECUTE 'SELECT count(*) FROM ferreteriarepublica.devoluciones_venta WHERE resolucion = ''saldo_favor''' INTO n_dev;

  IF n_cred > 0 OR n_pag > 0 OR n_dev > 0 THEN
    RAISE EXCEPTION
      'ROLLBACK ABORTADO: hay datos reales de saldo a favor (movimientos=%, pagos=%, devoluciones=%). No se borra nada.',
      n_cred, n_pag, n_dev;
  END IF;
  RAISE NOTICE 'Sin datos de saldo a favor. Procediendo.';
END $$;

DROP TABLE IF EXISTS ferreteriarepublica.creditos_cliente;

DROP INDEX IF EXISTS ferreteriarepublica.caja_movimientos_credito_idx;
ALTER TABLE ferreteriarepublica.caja_movimientos DROP COLUMN IF EXISTS credito_cliente_id;

-- Revertir los CHECK a su definición previa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.devoluciones_venta'::regclass AND conname='devoluciones_venta_resolucion_check') THEN
    ALTER TABLE ferreteriarepublica.devoluciones_venta DROP CONSTRAINT devoluciones_venta_resolucion_check;
  END IF;
  ALTER TABLE ferreteriarepublica.devoluciones_venta ADD CONSTRAINT devoluciones_venta_resolucion_check
    CHECK (resolucion IN ('reembolso','cambio'));

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.ventas_pagos_detalle'::regclass AND conname='ventas_pagos_detalle_metodo_pago_check') THEN
    ALTER TABLE ferreteriarepublica.ventas_pagos_detalle DROP CONSTRAINT ventas_pagos_detalle_metodo_pago_check;
  END IF;
  ALTER TABLE ferreteriarepublica.ventas_pagos_detalle ADD CONSTRAINT ventas_pagos_detalle_metodo_pago_check
    CHECK (metodo_pago IN ('efectivo','transferencia','tarjeta','qr','billetera','otro'));

  IF EXISTS (SELECT 1 FROM ferreteriarepublica.ventas WHERE metodo_pago IN ('saldo_favor','mixto')) THEN
    RAISE EXCEPTION 'ROLLBACK ABORTADO: hay ventas con metodo_pago saldo_favor/mixto.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.ventas'::regclass AND conname='ventas_metodo_pago_chk') THEN
    ALTER TABLE ferreteriarepublica.ventas DROP CONSTRAINT ventas_metodo_pago_chk;
  END IF;
  ALTER TABLE ferreteriarepublica.ventas ADD CONSTRAINT ventas_metodo_pago_chk
    CHECK (metodo_pago IS NULL OR metodo_pago IN ('efectivo','tarjeta','transferencia'));
END $$;
