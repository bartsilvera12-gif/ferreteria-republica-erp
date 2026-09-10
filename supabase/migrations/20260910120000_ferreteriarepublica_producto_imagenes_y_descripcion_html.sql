-- ============================================================================
-- Ferretería República — Rich text de producto + Galería de imágenes
-- ============================================================================
-- Aditiva · idempotente (re-ejecutable) · NO destructiva · schema tenant:
-- ferreteriarepublica.  NO ejecutar automáticamente: revisar antes de aplicar.
--
-- Idempotencia REAL: cada columna/constraint/índice/trigger/política se
-- comprueba individualmente. Si la tabla quedó a medias en un intento previo,
-- re-ejecutar completa lo que falte (no depende del CREATE TABLE inicial).
-- ============================================================================

BEGIN;

-- ── 1) Rich text (descripcion sigue siendo texto plano derivado) ─────────────
ALTER TABLE ferreteriarepublica.productos ADD COLUMN IF NOT EXISTS descripcion_html text;

-- ── 2) UNIQUE aditivo productos(id, empresa_id) para habilitar FK compuesta ──
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='uq_productos_id_empresa' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.productos ADD CONSTRAINT uq_productos_id_empresa UNIQUE (id, empresa_id);
  END IF;
END $$;

-- ── 3) Función updated_at ESPECÍFICA (no toca set_updated_at compartida) ─────
CREATE OR REPLACE FUNCTION ferreteriarepublica.set_producto_imagenes_updated_at()
RETURNS trigger AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ── 4) Tabla (solo columnas; los constraints se agregan/garantizan aparte) ──
CREATE TABLE IF NOT EXISTS ferreteriarepublica.producto_imagenes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   uuid NOT NULL,
  producto_id  uuid NOT NULL,
  imagen_path  text,
  imagen_url   text,
  orden        integer NOT NULL DEFAULT 0,
  es_principal boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- 4a) CHECK exactamente UNA fuente (imagen_path XOR imagen_url)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='producto_imagenes_una_fuente_chk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.producto_imagenes
      ADD CONSTRAINT producto_imagenes_una_fuente_chk
      CHECK ((imagen_path IS NOT NULL) <> (imagen_url IS NOT NULL));
  END IF;
END $$;

-- 4b) CHECK orden >= 0
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='producto_imagenes_orden_chk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.producto_imagenes
      ADD CONSTRAINT producto_imagenes_orden_chk CHECK (orden >= 0);
  END IF;
END $$;

-- 4c) FK compuesta (producto_id, empresa_id) → productos(id, empresa_id)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='producto_imagenes_producto_empresa_fk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.producto_imagenes
      ADD CONSTRAINT producto_imagenes_producto_empresa_fk
      FOREIGN KEY (producto_id, empresa_id)
      REFERENCES ferreteriarepublica.productos (id, empresa_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4d) Índices (idempotentes) + una sola principal por producto
CREATE INDEX IF NOT EXISTS idx_producto_imagenes_producto
  ON ferreteriarepublica.producto_imagenes (producto_id, orden);
CREATE INDEX IF NOT EXISTS idx_producto_imagenes_empresa
  ON ferreteriarepublica.producto_imagenes (empresa_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_producto_imagenes_principal
  ON ferreteriarepublica.producto_imagenes (empresa_id, producto_id) WHERE es_principal = true;

-- 4e) Trigger updated_at
DROP TRIGGER IF EXISTS producto_imagenes_updated_at ON ferreteriarepublica.producto_imagenes;
CREATE TRIGGER producto_imagenes_updated_at
  BEFORE UPDATE ON ferreteriarepublica.producto_imagenes
  FOR EACH ROW EXECUTE FUNCTION ferreteriarepublica.set_producto_imagenes_updated_at();

-- ── 5) PRIVILEGIO MÍNIMO ─────────────────────────────────────────────────────
-- Verificado en el código: la tabla se accede EXCLUSIVAMENTE server-side vía el
-- pg Pool (rol postgres). Ningún componente cliente / Supabase JS hace
-- from("producto_imagenes"). Por lo tanto authenticated/anon NO necesitan acceso
-- directo. Como el schema tiene ALTER DEFAULT PRIVILEGES que otorga DML a
-- authenticated en tablas nuevas, hacemos REVOKE explícito. RLS queda habilitado
-- como defensa adicional. postgres (pg Pool) es superusuario; service_role para
-- storage/APIs.
REVOKE ALL ON ferreteriarepublica.producto_imagenes FROM anon;
REVOKE ALL ON ferreteriarepublica.producto_imagenes FROM authenticated;
GRANT ALL ON ferreteriarepublica.producto_imagenes TO service_role;

-- ── 6) RLS + políticas (cada una idempotente, patrón puede_acceder_empresa) ──
ALTER TABLE ferreteriarepublica.producto_imagenes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='producto_imagenes' AND policyname='producto_imagenes_select') THEN
  CREATE POLICY "producto_imagenes_select" ON ferreteriarepublica.producto_imagenes
    FOR SELECT USING (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='producto_imagenes' AND policyname='producto_imagenes_insert') THEN
  CREATE POLICY "producto_imagenes_insert" ON ferreteriarepublica.producto_imagenes
    FOR INSERT WITH CHECK (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='producto_imagenes' AND policyname='producto_imagenes_update') THEN
  CREATE POLICY "producto_imagenes_update" ON ferreteriarepublica.producto_imagenes
    FOR UPDATE USING (ferreteriarepublica.puede_acceder_empresa(empresa_id))
    WITH CHECK (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='producto_imagenes' AND policyname='producto_imagenes_delete') THEN
  CREATE POLICY "producto_imagenes_delete" ON ferreteriarepublica.producto_imagenes
    FOR DELETE USING (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;

-- ── 7) BACKFILL idempotente ─────────────────────────────────────────────────
-- 1 fila principal por producto legacy sin galería. NOT EXISTS por empresa_id +
-- producto_id. Prioriza imagen_path; soporta imagen_url legacy. No mueve archivos.
INSERT INTO ferreteriarepublica.producto_imagenes
  (empresa_id, producto_id, imagen_path, imagen_url, orden, es_principal)
SELECT p.empresa_id, p.id,
       CASE WHEN p.imagen_path IS NOT NULL THEN p.imagen_path END,
       CASE WHEN p.imagen_path IS NULL AND p.imagen_url IS NOT NULL THEN p.imagen_url END,
       0, true
FROM ferreteriarepublica.productos p
WHERE (p.imagen_path IS NOT NULL OR p.imagen_url IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM ferreteriarepublica.producto_imagenes gi
                  WHERE gi.empresa_id = p.empresa_id AND gi.producto_id = p.id);

COMMIT;

-- ============================================================================
-- ROLLBACK
-- ----------------------------------------------------------------------------
-- PRE-DEPLOY / ANTES DE USO REAL (ningún cliente cargó galerías ni rich text):
--   rollback COMPLETO y seguro:
--     BEGIN;
--     DROP TABLE IF EXISTS ferreteriarepublica.producto_imagenes;
--     DROP FUNCTION IF EXISTS ferreteriarepublica.set_producto_imagenes_updated_at();
--     ALTER TABLE ferreteriarepublica.productos DROP CONSTRAINT IF EXISTS uq_productos_id_empresa;
--     ALTER TABLE ferreteriarepublica.productos DROP COLUMN IF EXISTS descripcion_html;
--     COMMIT;
--   (productos.imagen_path/imagen_url intactos; no se movieron archivos.)
--
-- POST-USO REAL (ya hay galerías/rich text cargados):  ⚠ DESTRUCTIVO.
--   NO dropear producto_imagenes ni descripcion_html sin EXPORTAR/MIGRAR antes:
--   los campos legacy (imagen_path/imagen_url) solo conservan la PRINCIPAL — NO
--   las secundarias ni el rich text (descripcion_html). Se perderían datos.
--   Revertir en ese estado requiere un plan de export/migración explícito.
-- ============================================================================
