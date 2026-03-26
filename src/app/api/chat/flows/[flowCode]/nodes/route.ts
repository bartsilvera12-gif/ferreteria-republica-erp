import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getAuthWithRol } from "@/lib/middleware/auth";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ flowCode: string }> }
) {
  try {
    const auth = await getAuthWithRol();
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const params = await context.params;
    const flowCode = params.flowCode;
    const supabase = getSupabaseAdmin();

    const { data: nodes, error: nErr } = await supabase
      .from("chat_flow_nodes")
      .select(
        "id, node_code, node_type, message_text, save_as_field, next_node_code, is_active, crm_action_type, crm_action_config, created_at"
      )
      .eq("empresa_id", auth.empresa_id)
      .eq("flow_code", flowCode)
      .order("node_code", { ascending: true });
    if (nErr) return NextResponse.json({ ok: false, error: nErr.message }, { status: 400 });

    const ids = (nodes ?? []).map((n) => n.id as string);
    let options: Array<Record<string, unknown>> = [];
    if (ids.length) {
      const { data: opts } = await supabase
        .from("chat_flow_options")
        .select("id, node_id, label, option_value, meta_button_id, next_node_code, sort_order")
        .in("node_id", ids)
        .order("sort_order", { ascending: true });
      options = (opts ?? []) as Array<Record<string, unknown>>;
    }

    const byNode = new Map<string, Array<Record<string, unknown>>>();
    for (const o of options) {
      const nodeId = o.node_id as string;
      const list = byNode.get(nodeId) ?? [];
      list.push(o);
      byNode.set(nodeId, list);
    }

    return NextResponse.json({
      ok: true,
      items: (nodes ?? []).map((n) => ({
        ...n,
        options: byNode.get(n.id as string) ?? [],
      })),
    });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode/nodes][GET]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ flowCode: string }> }
) {
  try {
    const auth = await getAuthWithRol();
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }
    const params = await context.params;
    const flowCode = params.flowCode;
    const body = (await request.json().catch(() => ({}))) as {
      node_code?: string;
      node_type?: string;
      message_text?: string;
      save_as_field?: string | null;
      next_node_code?: string | null;
      is_active?: boolean;
      crm_action_type?: string | null;
      crm_action_config?: Record<string, unknown> | null;
    };
    const nodeCode = (body.node_code ?? "").trim();
    const nodeType = (body.node_type ?? "").trim();
    if (!nodeCode || !nodeType) {
      return NextResponse.json({ ok: false, error: "node_code y node_type requeridos" }, { status: 400 });
    }
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("chat_flow_nodes")
      .insert({
        empresa_id: auth.empresa_id,
        flow_code: flowCode,
        node_code: nodeCode,
        node_type: nodeType,
        message_text: body.message_text ?? null,
        save_as_field: body.save_as_field?.trim() || null,
        next_node_code: body.next_node_code?.trim() || null,
        is_active: body.is_active !== false,
        crm_action_type: body.crm_action_type?.trim() || null,
        crm_action_config:
          typeof body.crm_action_config === "object" && body.crm_action_config
            ? body.crm_action_config
            : {},
      })
      .select("id, node_code, node_type, message_text, save_as_field, next_node_code, is_active, crm_action_type, crm_action_config, created_at")
      .single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, item: data });
  } catch (e) {
    console.error("[api/chat/flows/:flowCode/nodes][POST]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
