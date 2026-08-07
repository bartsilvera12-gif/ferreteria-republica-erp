import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /auth/callback — callback de Supabase Auth (recuperación de contraseña y
 * otros flujos PKCE). Intercambia el `code` por una sesión (cookies) y redirige
 * a `next` (por defecto /reset-password). No expone tokens al cliente.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") || "/reset-password";
  // Solo rutas internas (evita open-redirect).
  const next = nextParam.startsWith("/") ? nextParam : "/reset-password";

  const base = url.origin;

  if (!code) {
    return NextResponse.redirect(`${base}/forgot-password?error=1`);
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!supaUrl || !anon) {
    return NextResponse.redirect(`${base}/forgot-password?error=1`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(supaUrl, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${base}/forgot-password?error=1`);
  }

  return NextResponse.redirect(`${base}${next}`);
}
