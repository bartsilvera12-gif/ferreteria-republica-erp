-- Rollback de username en usuarios (OBJ1). Reversible y seguro.
DROP INDEX IF EXISTS ferreteriarepublica.usuarios_username_lower_uidx;

ALTER TABLE ferreteriarepublica.usuarios
  DROP CONSTRAINT IF EXISTS usuarios_username_format_chk;

ALTER TABLE ferreteriarepublica.usuarios
  DROP COLUMN IF EXISTS username;
