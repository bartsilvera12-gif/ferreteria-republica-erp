-- Pago a proveedores (#17): registra pagos contra compras a crédito.
-- La DEUDA se deriva de `compras` (tipo_pago='credito') agrupada por numero_control;
-- el saldo = total de la compra − suma de pagos no anulados. Aditivo y reversible.

CREATE TABLE IF NOT EXISTS ferreteriarepublica.pagos_proveedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  -- Proveedor y compra a la que se aplica el pago.
  proveedor_id uuid,
  proveedor_nombre text,
  numero_control text NOT NULL,          -- identifica la compra (factura) en `compras`
  numero_factura text,
  -- Importe y forma.
  monto numeric NOT NULL CHECK (monto > 0),
  medio_pago text NOT NULL DEFAULT 'efectivo',  -- 'efectivo' | 'transferencia' | 'tarjeta' | 'otro'
  fecha timestamptz NOT NULL DEFAULT now(),
  -- Integración con caja: si el pago es en efectivo, se registra un egreso en la
  -- caja abierta y se linkea el movimiento acá (para poder anular en cascada).
  caja_id uuid,
  movimiento_caja_id uuid,
  -- Auditoría + baja reversible (soft delete, igual que caja_movimientos).
  usuario_id uuid,
  usuario_nombre text,
  observacion text,
  anulado_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_empresa
  ON ferreteriarepublica.pagos_proveedor (empresa_id);
CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_control
  ON ferreteriarepublica.pagos_proveedor (empresa_id, numero_control)
  WHERE anulado_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pagos_proveedor_prov
  ON ferreteriarepublica.pagos_proveedor (empresa_id, proveedor_id)
  WHERE anulado_at IS NULL;
