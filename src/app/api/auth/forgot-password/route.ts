import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveLoginEmail } from "@/lib/auth/resolve-login-email";
import { rateLimit, clientIpFromRequest } from "@/lib/auth/rate-limit";
import { publicBaseUrl } from "@/lib/auth/public-base-url";

/** Respuesta única: no revela si la cuenta existe (anti-enumeración). */
const GENERIC_OK = {
  ok: true,
  message: "Si existe una cuenta asociada, recibirás un enlace para restablecer tu contraseña.",
};

/**
 * POST /api/auth/forgot-password — acepta USERNAME o EMAIL.
 * Resuelve la cuenta SERVER-SIDE y dispara el email oficial de Supabase Auth
 * (resetPasswordForEmail). Siempre responde lo mismo, exista o no la cuenta.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { identificador?: unknown };
    const identificador = typeof body.identificador === "string" ? body.identificador : "";
    if (!identificador.trim()) {
      // No revelar; igual respondemos genérico (pero sin mandar nada).
      return NextResponse.json(GENERIC_OK);
    }

    // Rate limit best-effort por IP + identificador.
    const ip = clientIpFromRequest(req);
    const rl = rateLimit(`forgot:${ip}:${identificador.trim().toLowerCase()}`, 5, 10 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { ok: false, error: "Demasiadas solicitudes. Esperá unos minutos e intentá de nuevo." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !anon) {
      // No filtrar config; responder genérico.
      return NextResponse.json(GENERIC_OK);
    }

    const email = await resolveLoginEmail(identificador);
    if (email) {
      const redirectTo = `${publicBaseUrl(req)}/auth/callback?next=/reset-password`;
      const cookieStore = await cookies();
      // Server client con cookies: guarda el verifier PKCE para el callback.
      const supabase = createServerClient(url, anon, {
        cookies: {
          getAll() {
            return cookieStore.getAll().map((c) => ({ name: c.name, value: c.value }));
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          },
        },
      });
      // No await del resultado para no revelar tiempos; pero sí lo esperamos para
      // que el verifier cookie se persista. Errores se ignoran (respuesta genérica).
      await supabase.auth.resetPasswordForEmail(email, { redirectTo }).catch(() => {});
    }

    return NextResponse.json(GENERIC_OK);
  } catch {
    // Nunca revelar; responder genérico igual.
    return NextResponse.json(GENERIC_OK);
  }
}
