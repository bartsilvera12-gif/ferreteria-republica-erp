import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-admin";
import { normalizeUsername, looksLikeEmail } from "@/lib/auth/username";

/**
 * Resuelve el identificador de login a un EMAIL real (SERVER-SIDE únicamente).
 * - Si parece email, se usa tal cual (rama actual, compatibilidad total).
 * - Si es username, se busca en `usuarios` (service role, schema del deployment)
 *   el email asociado. El email NUNCA se devuelve al navegador: solo se usa acá
 *   para autenticar contra Supabase Auth.
 *
 * Devuelve `null` si no se puede resolver (username inexistente). El caller debe
 * responder con el MISMO mensaje genérico que una contraseña incorrecta para no
 * revelar si el usuario existe (anti-enumeración).
 */
export async function resolveLoginEmail(identificador: string): Promise<string | null> {
  const id = (identificador ?? "").trim();
  if (!id) return null;

  if (looksLikeEmail(id)) return id.toLowerCase();

  const uname = normalizeUsername(id);
  if (!uname) return null;

  const sr = createServiceRoleClient();
  // `username` se guarda siempre normalizado (minúsculas), así que eq exacto basta.
  const { data, error } = await sr
    .from("usuarios")
    .select("email")
    .eq("username", uname)
    .limit(1);
  if (error) return null;
  const email = (data?.[0] as { email?: string | null } | undefined)?.email;
  return email ? String(email).trim().toLowerCase() : null;
}
