-- Username corto para login (OBJ1). Aditivo, idempotente y reversible.
-- Supabase Auth sigue siendo la única fuente de credenciales; `username` es solo
-- un identificador de conveniencia que se resuelve SERVER-SIDE a email para
-- autenticar. Alcance de unicidad: TODO el schema (el login no conoce la empresa
-- al momento de resolver, y este deployment usa un único schema = data_schema).

-- 1) Columna nullable (compatible con las 11 filas existentes, que quedan NULL).
ALTER TABLE ferreteriarepublica.usuarios
  ADD COLUMN IF NOT EXISTS username text;

-- 2) Formato normalizado: minúsculas, sin espacios, charset acotado, 2..32.
--    NULL permitido (usuarios sin username entran por email, sin romper nada).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'usuarios_username_format_chk'
      AND conrelid = 'ferreteriarepublica.usuarios'::regclass
  ) THEN
    ALTER TABLE ferreteriarepublica.usuarios
      ADD CONSTRAINT usuarios_username_format_chk
      CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{1,31}$');
  END IF;
END $$;

-- 3) Unicidad case-insensitive a nivel schema (parcial: solo filas con username).
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_username_lower_uidx
  ON ferreteriarepublica.usuarios (lower(username))
  WHERE username IS NOT NULL;

-- 4) Backfill seguro: sugerir la parte anterior al @ del email SOLO cuando el
--    candidato normalizado es único en el conjunto y no colisiona con uno ya
--    asignado. Los conflictos quedan NULL (el admin los define manualmente).
WITH cand AS (
  SELECT id,
         regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g') AS uname
  FROM ferreteriarepublica.usuarios
  WHERE email IS NOT NULL
    AND (username IS NULL OR username = '')
),
valid AS (
  SELECT id, uname
  FROM cand
  WHERE uname ~ '^[a-z0-9][a-z0-9._-]{1,31}$'
),
uniq AS (
  SELECT uname FROM valid GROUP BY uname HAVING count(*) = 1
)
UPDATE ferreteriarepublica.usuarios u
SET username = v.uname
FROM valid v
JOIN uniq q ON q.uname = v.uname
WHERE u.id = v.id
  AND u.username IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM ferreteriarepublica.usuarios x
    WHERE lower(x.username) = v.uname AND x.id <> u.id
  );
