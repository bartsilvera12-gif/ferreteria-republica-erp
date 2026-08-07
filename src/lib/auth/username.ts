/**
 * Utilidades de `username` para login (OBJ1). Compartidas front/back para validar
 * y normalizar SIEMPRE igual antes de comparar. Supabase Auth sigue siendo la
 * única fuente de credenciales; el username solo se resuelve a un email real.
 */

/** Normaliza: recorta y pasa a minúsculas (nunca guardar con espacios/mayúsculas). */
export function normalizeUsername(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

/**
 * Formato válido de username: empieza con letra/número y luego letras, números,
 * punto, guion o guion bajo; 2 a 32 caracteres. Igual al CHECK de la migración.
 */
export const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export function isValidUsername(u: string | null | undefined): boolean {
  const n = normalizeUsername(u);
  return USERNAME_REGEX.test(n);
}

/** Mensaje único para validación de formato (front/back). */
export const USERNAME_FORMAT_MSG =
  "El usuario debe tener entre 2 y 32 caracteres: letras, números, punto, guion o guion bajo (sin espacios).";

/** Heurística de email: si el identificador de login parece un correo válido. */
export function looksLikeEmail(s: string | null | undefined): boolean {
  const t = (s ?? "").trim();
  // Simple y estricto lo suficiente para decidir la rama (no valida MX).
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}
