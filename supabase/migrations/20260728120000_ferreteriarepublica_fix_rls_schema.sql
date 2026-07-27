-- ============================================================================
-- Corrige las políticas RLS de ferreteriarepublica que, por un error al clonar
-- el schema, llaman a `reservacaacupe.puede_acceder_empresa(...)` (schema
-- EQUIVOCADO) en vez de `ferreteriarepublica.puede_acceder_empresa(...)`.
--
-- Efecto del bug: cualquier acceso desde el navegador con el JWT del usuario
-- (que sí pasa por RLS) fallaba — lecturas vacías y errores al insertar, p. ej.
-- "new row violates row-level security policy for table gastos". Las rutas API
-- usan service-role (bypass RLS) y por eso no se notaba en todos lados.
--
-- IDEMPOTENTE: recrea cada política reemplazando el prefijo de schema. Al
-- correr de nuevo no encuentra referencias a reservacaacupe y no hace nada.
-- Solo toca el schema ferreteriarepublica.
-- ============================================================================

DO $$
DECLARE
  r RECORD;
  new_qual  text;
  new_check text;
  roles_csv text;
  stmt      text;
BEGIN
  FOR r IN
    SELECT policyname, tablename, cmd, permissive, roles, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'ferreteriarepublica'
      AND (COALESCE(qual, '')       LIKE '%reservacaacupe.%'
        OR COALESCE(with_check, '') LIKE '%reservacaacupe.%')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON ferreteriarepublica.%I', r.policyname, r.tablename);

    new_qual  := replace(COALESCE(r.qual, ''),       'reservacaacupe.', 'ferreteriarepublica.');
    new_check := replace(COALESCE(r.with_check, ''),  'reservacaacupe.', 'ferreteriarepublica.');

    -- Lista de roles: PUBLIC va sin comillas; el resto con quote_ident.
    SELECT string_agg(CASE WHEN rn = 'public' THEN 'public' ELSE quote_ident(rn) END, ', ')
      INTO roles_csv
      FROM unnest(r.roles) AS rn;

    stmt := format('CREATE POLICY %I ON ferreteriarepublica.%I AS %s FOR %s TO %s',
                   r.policyname, r.tablename,
                   CASE WHEN r.permissive = 'PERMISSIVE' THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
                   r.cmd,
                   COALESCE(roles_csv, 'public'));

    IF r.qual IS NOT NULL THEN
      stmt := stmt || format(' USING (%s)', new_qual);
    END IF;
    IF r.with_check IS NOT NULL THEN
      stmt := stmt || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE stmt;
  END LOOP;
END $$;
