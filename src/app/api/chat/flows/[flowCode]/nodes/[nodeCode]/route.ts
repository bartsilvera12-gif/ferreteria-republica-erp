import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol } from "@/lib/middleware/auth";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string; nodeCode: string }> }
) {
  try {
    const auth = await getAuthWithRol();
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const params = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      node_type?: string;
      message_text?: string | null;
      save_as_field?: string | null;
      next_node_code?: string | null;
      is_active?: boolean;
      crm_action_type?: string | null;
      crm_action_config?: Record<string, unknown> | null;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.node_type === "string") patch.node_type = body.node_type.trim();
    if ("message_text" in body) patch.message_text = body.message_text ?? null;
    if ("save_as_field" in body) patch.save_as_field = body.save_as_field?.trim() || null;
    if ("next_node_code" in body) patch.next_node_code = body.next_node_code?.trim() || null;
    if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
    if ("crm_action_type" in body) patch.crm_action_type = body.crm_action_type?.trim() || null;
    if ("crm_action_config" in body) {
      patch.crm_action_config =
        typeof body.crm_action_config === "object" && body.crm_action_config
          ? body.crm_action_config
          : {};
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("chat_flow_nodes")
      .update(patch)
      .eq("empresa_id", auth.empresa_id)
      .eq("flow_code", params.flowCode)
      .eq("node_code", params.nodeCode)
      .select("id, node_code, node_type, message_text, save_as_field, next_node_code, is_active, crm_action_type, crm_action_config, created_at")
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ ok: false, error: "Nodo no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode/nodes/:nodeCode][PATCH]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
