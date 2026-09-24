-- ============================================================================
-- Ferretería República — Bitácora de auditoría de compras y órdenes de compra
-- ============================================================================
-- Aditiva · idempotente (re-ejecutable) · NO destructiva · schema tenant:
-- ferreteriarepublica.  NO ejecutar automáticamente: revisar antes de aplicar.
--
-- Registra QUIÉN / CUÁNDO / QUÉ ACCIÓN (editar | eliminar) sobre una compra o una
-- orden de compra, con datos anteriores/nuevos relevantes en `detalle` (jsonb).
-- La escritura ocurre DENTRO de la misma transacción de la edición/eliminación
-- (atómica): si esta tabla no existe, la operación FALLA (no hay fallback), por
-- eso esta migración debe aplicarse junto con el deploy. Acceso EXCLUSIVO
-- server-side vía pg Pool (rol postgres).
-- ============================================================================

BEGIN;

-- ── Tabla ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ferreteriarepublica.compra_auditoria (
  id             uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  empresa_id     uuid NOT NULL,
  tipo           text NOT NULL,   -- 'compra' | 'orden_compra'
  documento      text NOT NULL,   -- numero_control / numero_oc
  accion         text NOT NULL,   -- 'editar' | 'eliminar'
  usuario_id     uuid,
  usuario_nombre text,
  detalle        jsonb,           -- { antes: {...}, despues: {...}, resumen: {...} }
  fecha          timestamptz NOT NULL DEFAULT now()
);

-- CHECKs de dominio
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='compra_auditoria_tipo_chk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.compra_auditoria
      ADD CONSTRAINT compra_auditoria_tipo_chk CHECK (tipo IN ('compra', 'orden_compra'));
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE c.conname='compra_auditoria_accion_chk' AND n.nspname='ferreteriarepublica') THEN
    ALTER TABLE ferreteriarepublica.compra_auditoria
      ADD CONSTRAINT compra_auditoria_accion_chk CHECK (accion IN ('editar', 'eliminar'));
  END IF;
END $$;

-- Índice para consultar por documento / empresa / fecha
CREATE INDEX IF NOT EXISTS idx_compra_auditoria_empresa_tipo_doc_fecha
  ON ferreteriarepublica.compra_auditoria (empresa_id, tipo, documento, fecha);

-- ── PRIVILEGIO MÍNIMO ────────────────────────────────────────────────────────
-- Se accede EXCLUSIVAMENTE server-side vía pg Pool (rol postgres). Ningún
-- supabase.from("compra_auditoria") la toca.
REVOKE ALL ON ferreteriarepublica.compra_auditoria FROM PUBLIC;
REVOKE ALL ON ferreteriarepublica.compra_auditoria FROM anon;
REVOKE ALL ON ferreteriarepublica.compra_auditoria FROM authenticated;
REVOKE ALL ON ferreteriarepublica.compra_auditoria FROM authenticator;
REVOKE ALL ON ferreteriarepublica.compra_auditoria FROM service_role;
GRANT SELECT ON ferreteriarepublica.compra_auditoria TO service_role;

-- ── RLS + políticas (idempotentes, patrón puede_acceder_empresa) ─────────────
ALTER TABLE ferreteriarepublica.compra_auditoria ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='compra_auditoria' AND policyname='compra_auditoria_select') THEN
  CREATE POLICY "compra_auditoria_select" ON ferreteriarepublica.compra_auditoria
    FOR SELECT USING (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='ferreteriarepublica'
    AND tablename='compra_auditoria' AND policyname='compra_auditoria_insert') THEN
  CREATE POLICY "compra_auditoria_insert" ON ferreteriarepublica.compra_auditoria
    FOR INSERT WITH CHECK (ferreteriarepublica.puede_acceder_empresa(empresa_id)); END IF; END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK (pre-uso real; nadie registró auditoría de compras todavía):
--   BEGIN;
--   DROP TABLE IF EXISTS ferreteriarepublica.compra_auditoria;
--   COMMIT;
-- ============================================================================
