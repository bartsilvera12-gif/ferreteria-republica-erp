-- Rollback NC autoimpresor.
DROP TABLE IF EXISTS ferreteriarepublica.nota_credito_autoimpresor;

ALTER TABLE ferreteriarepublica.empresa_autoimpresor_config
  DROP COLUMN IF EXISTS nc_timbrado_numero,
  DROP COLUMN IF EXISTS nc_timbrado_inicio_vigencia,
  DROP COLUMN IF EXISTS nc_timbrado_fin_vigencia,
  DROP COLUMN IF EXISTS nc_establecimiento_codigo,
  DROP COLUMN IF EXISTS nc_punto_expedicion_codigo,
  DROP COLUMN IF EXISTS nc_numero_actual,
  DROP COLUMN IF EXISTS nc_numero_inicial,
  DROP COLUMN IF EXISTS nc_numero_final;
