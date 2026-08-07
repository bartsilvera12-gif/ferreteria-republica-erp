import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import { esRolAdminEmpresa } from "@/lib/modulos/resolve-effective-modules";

/**
 * Crea SOLO la cuenta de Auth (Supabase). Endpoint legacy; el alta real de
 * usuarios del ERP es POST /api/empresas/usuarios/nuevo. Requiere sesión de un
 * administrador. El service role nunca se loguea ni se devuelve al navegador.
 */
export async function POST(req: Request) {
  try {
    // Autorización: solo un administrador autenticado puede crear cuentas.
    const authR = await getServiceAuthUsuario(req);
    if (!authR.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    if (!authR.catalogUsuario || !esRolAdminEmpresa(authR.catalogUsuario.rol)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email y password son requeridos" },
        { status: 400 }
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json(
        { error: "Variables de entorno no configuradas" },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: data.user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
