-- ============================================================================
-- Ferretería República — Historial de cambios de unidad de medida
-- ============================================================================
-- Aditiva · idempotente (re-ejecutable) · NO destructiva · schema tenant:
-- ferreteriarepublica.
--
-- Cambiar la unidad de un producto desde su ficha NO convierte cantidades: el
-- stock, los movimientos, ventas y compras quedan como estaban. Esta tabla deja
-- constancia de cada cambio (unidad anterior/nueva, stock al momento, usuario)
-- para saber en qué unidad estaba expresada cada cantidad del historial.
-- La escribe PATCH /api/productos/[id] vía pg Pool (rol postgres).
-- Si no se aplica, el cambio de unidad funciona igual pero sin registro.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ferreteriarepublica.producto_unidad_historial (
  id              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  producto_id     uuid NOT NULL,
  producto_nombre text NOT NULL DEFAULT '',
  fecha           timestamptz NOT NULL DEFAULT now(),
  unidad_ant      text,
  unidad_act      text NOT NULL,
  stock_al_cambio numeric NOT NULL DEFAULT 0,
  usuario_id      uuid,
  usuario_nombre  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- UNIQUE productos(id, empresa_id) para la FK compuesta (ya existe; se garantiza).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='uq_productos_id_empresa' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.productos ADD CONSTRAINT uq_productos_id_empresa UNIQUE (id, empresa_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='producto_unidad_historial_producto_empresa_fk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.producto_unidad_historial
      ADD CONSTRAINT producto_unidad_historial_producto_empresa_fk
      FOREIGN KEY (producto_id, empresa_id)
      REFERENCES ferreteriarepublica.productos (id, empresa_id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_producto_unidad_historial_empresa_prod_fecha
  ON ferreteriarepublica.producto_unidad_historial (empresa_id, producto_id, fecha);

-- Privilegio mínimo: solo server-side (pg Pool).
REVOKE ALL ON ferreteriarepublica.producto_unidad_historial FROM PUBLIC;
REVOKE ALL ON ferreteriarepublica.producto_unidad_historial FROM anon;
REVOKE ALL ON ferreteriarepublica.producto_unidad_historial FROM authenticated;
REVOKE ALL ON ferreteriarepublica.producto_unidad_historial FROM authenticator;
REVOKE ALL ON ferreteriarepublica.producto_unidad_historial FROM service_role;
GRANT SELECT ON ferreteriarepublica.producto_unidad_historial TO service_role;

ALTER TABLE ferreteriarepublica.producto_unidad_historial ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='producto_unidad_historial' AND policyname='producto_unidad_historial_select') THEN
  CREATE POLICY "producto_unidad_historial_select" ON ferreteriarepublica.producto_unidad_historial
    FOR SELECT USING (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;

COMMIT;
