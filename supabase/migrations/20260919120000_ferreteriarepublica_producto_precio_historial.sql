-- ============================================================================
-- Ferretería República — Historial de variación de precios (cambios MANUALES)
-- ============================================================================
-- Aditiva · idempotente (re-ejecutable) · NO destructiva · schema tenant:
-- ferreteriarepublica.  NO ejecutar automáticamente: revisar antes de aplicar.
--
-- Registra los cambios de costo/precio de venta hechos MANUALMENTE desde la
-- edición de producto (PATCH /api/productos/[id]). El reporte de variación de
-- precios combina estos registros (origen='manual') con los derivados de las
-- compras (origen='compras', que se calculan por LAG sobre `compras` y NO se
-- guardan acá). Acceso EXCLUSIVO server-side vía pg Pool (rol postgres).
-- ============================================================================

BEGIN;

-- ── 1) UNIQUE aditivo productos(id, empresa_id) para la FK compuesta ─────────
--     (ya lo crea la migración de producto_imagenes; se garantiza igual acá).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='uq_productos_id_empresa' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.productos ADD CONSTRAINT uq_productos_id_empresa UNIQUE (id, empresa_id);
  END IF;
END $$;

-- ── 2) Tabla ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferreteriarepublica.producto_precio_historial (
  id              uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id      uuid NOT NULL,
  producto_id     uuid NOT NULL,
  producto_nombre text NOT NULL DEFAULT '',
  fecha           timestamptz NOT NULL DEFAULT now(),
  costo_ant       numeric NOT NULL DEFAULT 0,
  costo_act       numeric NOT NULL DEFAULT 0,
  precio_ant      numeric NOT NULL DEFAULT 0,
  precio_act      numeric NOT NULL DEFAULT 0,
  origen          text NOT NULL DEFAULT 'manual',
  usuario_nombre  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 2a) CHECK origen permitido
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='producto_precio_historial_origen_chk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.producto_precio_historial
      ADD CONSTRAINT producto_precio_historial_origen_chk CHECK (origen IN ('manual', 'compras'));
  END IF;
END $$;

-- 2b) FK compuesta (producto_id, empresa_id) → productos(id, empresa_id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='producto_precio_historial_producto_empresa_fk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.producto_precio_historial
      ADD CONSTRAINT producto_precio_historial_producto_empresa_fk
      FOREIGN KEY (producto_id, empresa_id)
      REFERENCES ferreteriarepublica.productos (id, empresa_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2c) Índice para el reporte (rango por empresa/producto/fecha)
CREATE INDEX IF NOT EXISTS idx_producto_precio_historial_empresa_prod_fecha
  ON ferreteriarepublica.producto_precio_historial (empresa_id, producto_id, fecha);

-- ── 3) PRIVILEGIO MÍNIMO ─────────────────────────────────────────────────────
-- Se accede EXCLUSIVAMENTE server-side vía pg Pool (rol postgres): el PATCH la
-- inserta y el reporte la lee, ambos por Pool. Ningún supabase.from(...) la toca.
--   anon / authenticated / authenticator / PUBLIC : SIN acceso.
--   service_role : SOLO SELECT (conservador; hoy no la usa).
--   postgres (owner / pg Pool) : acceso administrativo normal.
REVOKE ALL ON ferreteriarepublica.producto_precio_historial FROM PUBLIC;
REVOKE ALL ON ferreteriarepublica.producto_precio_historial FROM anon;
REVOKE ALL ON ferreteriarepublica.producto_precio_historial FROM authenticated;
REVOKE ALL ON ferreteriarepublica.producto_precio_historial FROM authenticator;
REVOKE ALL ON ferreteriarepublica.producto_precio_historial FROM service_role;
GRANT SELECT ON ferreteriarepublica.producto_precio_historial TO service_role;

-- ── 4) RLS + políticas (idempotentes, patrón puede_acceder_empresa) ──────────
ALTER TABLE ferreteriarepublica.producto_precio_historial ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='producto_precio_historial' AND policyname='producto_precio_historial_select') THEN
  CREATE POLICY "producto_precio_historial_select" ON ferreteriarepublica.producto_precio_historial
    FOR SELECT USING (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='producto_precio_historial' AND policyname='producto_precio_historial_insert') THEN
  CREATE POLICY "producto_precio_historial_insert" ON ferreteriarepublica.producto_precio_historial
    FOR INSERT WITH CHECK (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (pre-uso real; nadie registró variaciones manuales todavía):
--   BEGIN;
--   DROP TABLE IF EXISTS ferreteriarepublica.producto_precio_historial;
--   COMMIT;
--   (No toca productos ni compras; el reporte vuelve a mostrar solo Compras.)
-- ============================================================================
