-- ============================================================================
-- Saldo a favor (crédito) del cliente. ADITIVA E IDEMPOTENTE.
-- Solo schema ferreteriarepublica.
--
-- Modelo: LIBRO MAYOR de movimientos (no un campo "saldo" mutable), para que
-- todo movimiento quede auditado y el saldo sea siempre SUM(monto).
--   monto > 0  -> suma saldo  (devolución que genera crédito, ajuste a favor)
--   monto < 0  -> consume     (pago de una venta, retiro en efectivo)
-- ============================================================================

CREATE TABLE IF NOT EXISTS ferreteriarepublica.creditos_cliente (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id         uuid NOT NULL,
  cliente_id         uuid NOT NULL REFERENCES ferreteriarepublica.clientes(id),
  tipo               text NOT NULL,
  -- Con signo: positivo acredita, negativo consume. El saldo es SUM(monto).
  monto              numeric NOT NULL,
  devolucion_id      uuid,
  venta_id           uuid,
  caja_movimiento_id uuid,
  motivo             text,
  created_by         uuid,
  usuario_nombre     text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.creditos_cliente'::regclass AND conname='creditos_cliente_tipo_check') THEN
    ALTER TABLE ferreteriarepublica.creditos_cliente ADD CONSTRAINT creditos_cliente_tipo_check
      CHECK (tipo IN ('devolucion','consumo_venta','retiro_efectivo','ajuste','reverso'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.creditos_cliente'::regclass AND conname='creditos_cliente_monto_check') THEN
    ALTER TABLE ferreteriarepublica.creditos_cliente ADD CONSTRAINT creditos_cliente_monto_check
      CHECK (monto <> 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS creditos_cliente_cliente_idx
  ON ferreteriarepublica.creditos_cliente (empresa_id, cliente_id, created_at DESC);
CREATE INDEX IF NOT EXISTS creditos_cliente_devolucion_idx
  ON ferreteriarepublica.creditos_cliente (empresa_id, devolucion_id);
CREATE INDEX IF NOT EXISTS creditos_cliente_venta_idx
  ON ferreteriarepublica.creditos_cliente (empresa_id, venta_id);

-- ── Resolución de devolución: se agrega 'saldo_favor' ───────────────────────
-- 'cambio' se MANTIENE: ya hay devoluciones históricas con ese valor.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.devoluciones_venta'::regclass AND conname='devoluciones_venta_resolucion_check') THEN
    ALTER TABLE ferreteriarepublica.devoluciones_venta DROP CONSTRAINT devoluciones_venta_resolucion_check;
  END IF;
  ALTER TABLE ferreteriarepublica.devoluciones_venta ADD CONSTRAINT devoluciones_venta_resolucion_check
    CHECK (resolucion IN ('reembolso','cambio','saldo_favor'));
END $$;

-- ── Método de pago: se agrega 'saldo_favor' ────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.ventas_pagos_detalle'::regclass AND conname='ventas_pagos_detalle_metodo_pago_check') THEN
    ALTER TABLE ferreteriarepublica.ventas_pagos_detalle DROP CONSTRAINT ventas_pagos_detalle_metodo_pago_check;
  END IF;
  ALTER TABLE ferreteriarepublica.ventas_pagos_detalle ADD CONSTRAINT ventas_pagos_detalle_metodo_pago_check
    CHECK (metodo_pago IN ('efectivo','transferencia','tarjeta','qr','billetera','saldo_favor','otro'));

  -- ventas.metodo_pago: método PRINCIPAL de la venta. Se agrega 'saldo_favor'
  -- y 'mixto' (cuando se combinan varios medios).
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='ferreteriarepublica.ventas'::regclass AND conname='ventas_metodo_pago_chk') THEN
    ALTER TABLE ferreteriarepublica.ventas DROP CONSTRAINT ventas_metodo_pago_chk;
  END IF;
  ALTER TABLE ferreteriarepublica.ventas ADD CONSTRAINT ventas_metodo_pago_chk
    CHECK (metodo_pago IS NULL OR metodo_pago IN ('efectivo','tarjeta','transferencia','saldo_favor','mixto'));
END $$;

-- ── Trazabilidad del crédito en caja ───────────────────────────────────────
ALTER TABLE ferreteriarepublica.caja_movimientos
  ADD COLUMN IF NOT EXISTS credito_cliente_id uuid;
