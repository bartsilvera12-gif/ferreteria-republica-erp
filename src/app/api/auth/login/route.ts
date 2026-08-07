import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveLoginEmail } from "@/lib/auth/resolve-login-email";
import { rateLimit, clientIpFromRequest } from "@/lib/auth/rate-limit";

/** Mismo mensaje para credenciales inválidas, usuario inexistente o baneado. */
const GENERIC = "Usuario/email o contraseña incorrectos.";

/**
 * POST /api/auth/login — login por USERNAME o EMAIL.
 * - El username se resuelve a email SERVER-SIDE (nunca se devuelve al navegador).
 * - La autenticación final es contra Supabase Auth (única fuente de credenciales).
 * - La sesión se persiste en cookies vía @supabase/ssr (mismo patrón SSR del repo).
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      identificador?: unknown;
      password?: unknown;
    };
    const identificador = typeof body.identificador === "string" ? body.identificador : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!identificador.trim() || !password) {
      return NextResponse.json({ error: GENERIC }, { status: 400 });
    }

    // Rate limit best-effort por IP + identificador (anti fuerza bruta).
    const ip = clientIpFromRequest(req);
    const rl = rateLimit(`login:${ip}:${identificador.trim().toLowerCase()}`, 10, 5 * 60_000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos. Esperá unos minutos y volvé a probar." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
    if (!url || !anon) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    // Resolver a email real (username → email, o email tal cual). Nunca se expone.
    const email = await resolveLoginEmail(identificador);
    if (!email) {
      // Username/email inexistente: mismo error genérico (anti-enumeración).
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }

    const cookieStore = await cookies();
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

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      // Password incorrecta, email no confirmado, usuario baneado (inactivo): genérico.
      return NextResponse.json({ error: GENERIC }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: GENERIC }, { status: 500 });
  }
}
