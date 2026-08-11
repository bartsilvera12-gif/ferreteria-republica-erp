-- Nota de crédito AUTOIMPRESOR (timbrado + impresión), espejo de factura_autoimpresor.
-- No toca SIFEN. Numeración independiente de la factura. Aditivo y reversible.

-- 1) Numeración/timbrado propios de la NC en la config del autoimpresor.
ALTER TABLE ferreteriarepublica.empresa_autoimpresor_config
  ADD COLUMN IF NOT EXISTS nc_timbrado_numero text,
  ADD COLUMN IF NOT EXISTS nc_timbrado_inicio_vigencia date,
  ADD COLUMN IF NOT EXISTS nc_timbrado_fin_vigencia date,
  ADD COLUMN IF NOT EXISTS nc_establecimiento_codigo text,
  ADD COLUMN IF NOT EXISTS nc_punto_expedicion_codigo text,
  ADD COLUMN IF NOT EXISTS nc_numero_actual integer,
  ADD COLUMN IF NOT EXISTS nc_numero_inicial integer,
  ADD COLUMN IF NOT EXISTS nc_numero_final integer;

-- 2) Tabla de notas de crédito autoimpresor (espejo de factura_autoimpresor).
CREATE TABLE IF NOT EXISTS ferreteriarepublica.nota_credito_autoimpresor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL,
  -- Origen
  factura_autoimpresor_id uuid,
  venta_id uuid,
  devolucion_id uuid,
  -- Numeración fiscal propia de la NC
  numero_secuencia integer NOT NULL,
  numero_completo text NOT NULL,
  establecimiento_codigo text NOT NULL,
  punto_expedicion_codigo text NOT NULL,
  timbrado_numero text NOT NULL,
  timbrado_inicio_vigencia date,
  timbrado_fin_vigencia date,
  -- Referencia impresa al comprobante origen
  factura_numero_completo text,
  factura_timbrado_numero text,
  factura_fecha date,
  -- Datos del documento
  motivo text,
  condicion text NOT NULL DEFAULT 'contado',
  alcance text NOT NULL DEFAULT 'total',   -- 'total' | 'parcial'
  gravado_10 numeric NOT NULL DEFAULT 0,
  iva_10 numeric NOT NULL DEFAULT 0,
  gravado_5 numeric NOT NULL DEFAULT 0,
  iva_5 numeric NOT NULL DEFAULT 0,
  exentas numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  items jsonb,                              -- snapshot de ítems acreditados
  -- Auditoría
  created_by uuid,
  usuario_nombre text,
  emitida_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nc_autoimpresor_empresa
  ON ferreteriarepublica.nota_credito_autoimpresor (empresa_id);
CREATE INDEX IF NOT EXISTS idx_nc_autoimpresor_venta
  ON ferreteriarepublica.nota_credito_autoimpresor (empresa_id, venta_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nc_autoimpresor_numero
  ON ferreteriarepublica.nota_credito_autoimpresor (empresa_id, numero_completo);

-- 3) Semilla de numeración NC en MODO PRUEBA (mismos datos que la factura de prueba).
--    Cuando llegue el timbrado real de NC, se reemplaza por la config de gestión.
UPDATE ferreteriarepublica.empresa_autoimpresor_config c
SET nc_timbrado_numero          = COALESCE(c.nc_timbrado_numero, c.timbrado_numero),
    nc_timbrado_inicio_vigencia = COALESCE(c.nc_timbrado_inicio_vigencia, c.timbrado_inicio_vigencia),
    nc_timbrado_fin_vigencia    = COALESCE(c.nc_timbrado_fin_vigencia, c.timbrado_fin_vigencia),
    nc_establecimiento_codigo   = COALESCE(c.nc_establecimiento_codigo, c.establecimiento_codigo),
    nc_punto_expedicion_codigo  = COALESCE(c.nc_punto_expedicion_codigo, c.punto_expedicion_codigo),
    nc_numero_actual            = COALESCE(c.nc_numero_actual, 1),
    nc_numero_inicial           = COALESCE(c.nc_numero_inicial, 1),
    nc_numero_final             = COALESCE(c.nc_numero_final, 9999999)
WHERE c.timbrado_numero IS NOT NULL;
