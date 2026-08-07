import { createClient } from "@supabase/supabase-js";
import { supabaseServiceRoleClientOptions } from "@/lib/supabase/schema";
import { NextResponse } from "next/server";
import { getServiceAuthUsuario } from "@/lib/auth/get-service-auth-usuario";
import { esRolAdminEmpresa } from "@/lib/modulos/resolve-effective-modules";

/**
 * Reset administrativo de contraseña. Un administrador establece manualmente una
 * contraseña nueva para un usuario de SU empresa. Supabase Auth sigue siendo la
 * única fuente de credenciales; el service role nunca llega al navegador.
 * Autorización: sesión válida + rol admin + mismo tenant (o super_admin).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { password } = body;

    if (!password || typeof password !== "string" || password.length < 6) {
      return NextResponse.json(
        { error: "La contraseña debe tener al menos 6 caracteres" },
        { status: 400 }
      );
    }

    // Autorización.
    const authR = await getServiceAuthUsuario(req);
    if (!authR.ok) {
      return NextResponse.json({ error: "No autenticado" }, { status: 401 });
    }
    const solicitante = authR.catalogUsuario;
    if (!solicitante || !esRolAdminEmpresa(solicitante.rol)) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }
    const esSuperAdmin = (solicitante.rol ?? "").trim().toLowerCase() === "super_admin";

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: "Config no disponible" }, { status: 500 });
    }

    const supabase = createClient(url, key, { ...supabaseServiceRoleClientOptions });

    const { data: usuario, error: errGet } = await supabase
      .from("usuarios")
      .select("id, email, empresa_id, auth_user_id")
      .eq("id", id)
      .single();

    if (errGet || !usuario) {
      return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
    }

    // Tenant: salvo super_admin, solo puede tocar usuarios de su misma empresa.
    if (!esSuperAdmin && usuario.empresa_id !== solicitante.empresa_id) {
      return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
    }

    // Preferir auth_user_id; fallback legacy por email solo si falta.
    let authUserId = usuario.auth_user_id as string | null;
    if (!authUserId && usuario.email) {
      const target = String(usuario.email).trim().toLowerCase();
      let page = 1;
      while (true) {
        const { data } = await supabase.auth.admin.listUsers({ page, perPage: 500 });
        const users = data?.users ?? [];
        const found = users.find((u) => (u.email ?? "").toLowerCase() === target);
        if (found) { authUserId = found.id; break; }
        if (users.length < 500) break;
        page++;
      }
    }

    if (!authUserId) {
      return NextResponse.json(
        { error: "No se encontró la cuenta de autenticación del usuario." },
        { status: 404 }
      );
    }

    const { error: errAuth } = await supabase.auth.admin.updateUserById(authUserId, {
      password,
    });
    if (errAuth) {
      return NextResponse.json({ error: errAuth.message }, { status: 400 });
    }

    // Si el usuario no tenía auth_user_id guardado, lo persistimos (self-heal).
    if (!usuario.auth_user_id) {
      await supabase.from("usuarios").update({ auth_user_id: authUserId }).eq("id", id);
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
