import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { createFlowEngine } from "@/lib/chat/flow-engine-service";
import { getAuthWithRol } from "@/lib/middleware/auth";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase no configurado");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * Endpoint temporal de prueba para disparar el nodo inicial del flujo.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthWithRol();
    if (!auth?.empresa_id) {
      return NextResponse.json({ ok: false, error: "No autenticado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      conversation_id?: string;
      flow_code?: string;
      node_code?: string;
    };
    const conversationId = body.conversation_id?.trim();
    if (!conversationId) {
      return NextResponse.json(
        { ok: false, error: "Se requiere conversation_id" },
        { status: 400 }
      );
    }

    const flowCode = body.flow_code?.trim() || "sorteo_default";
    const nodeCode = body.node_code?.trim() || "inicio";

    const supabase = getSupabaseAdmin();
    const { error: upErr } = await supabase
      .from("chat_conversations")
      .update({
        flow_code: flowCode,
        flow_current_node: nodeCode,
        flow_status: "bot",
        human_taken_over: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversationId)
      .eq("empresa_id", auth.empresa_id);

    if (upErr) {
      return NextResponse.json({ ok: false, error: upErr.message }, { status: 400 });
    }

    const engine = createFlowEngine({ supabase });
    const sent = await engine.sendCurrentFlowNode({ conversationId });
    if (!sent.ok) {
      return NextResponse.json({ ok: false, error: sent.error }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      conversation_id: conversationId,
      flow_code: flowCode,
      node_code: sent.nodeCode ?? nodeCode,
    });
  } catch (e) {
    console.error("[api/chat/flow/test-start]", e);
    return NextResponse.json({ ok: false, error: "Error interno" }, { status: 500 });
  }
}
