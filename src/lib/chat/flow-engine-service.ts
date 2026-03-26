import {
  sendWhatsAppInteractiveButtons,
  sendWhatsAppText,
} from "@/lib/chat/whatsapp-send-service";
import type { SupabaseAdmin } from "@/lib/chat/types";
import { normalizeWaPhone } from "@/lib/chat/whatsapp-webhook-service";

type ConversationFlowState = {
  id: string;
  empresa_id: string;
  channel_id: string;
  contact_id: string;
  flow_code: string | null;
  flow_current_node: string | null;
  flow_status: string;
  human_taken_over: boolean;
};

export type ProcessInteractiveReplyParams = {
  conversationId: string;
  empresaId: string;
  metaButtonId: string;
  rawPayload: Record<string, unknown>;
};

export type AdvanceConversationParams = {
  conversationId: string;
  empresaId: string;
  flowCode: string;
  nextNodeCode: string;
};

export type SendCurrentNodeParams = {
  conversationId: string;
};

type FlowOption = {
  id: string;
  label: string;
  option_value: string;
  meta_button_id: string;
  next_node_code: string | null;
  sort_order: number;
};

type FlowNode = {
  id: string;
  empresa_id: string;
  flow_code: string;
  node_code: string;
  message_text: string | null;
  node_type: "buttons" | "list" | "text" | "image_input" | "human" | "end";
  is_active: boolean;
};

export type FlowEngineContext = {
  supabase: SupabaseAdmin;
};

export function createFlowEngine(ctx: FlowEngineContext) {
  const supabase = ctx.supabase;

  async function getConversationFlowState(
    conversationId: string
  ): Promise<ConversationFlowState | null> {
    const { data, error } = await supabase
      .from("chat_conversations")
      .select(
        "id, empresa_id, channel_id, contact_id, flow_code, flow_current_node, flow_status, human_taken_over"
      )
      .eq("id", conversationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return data as ConversationFlowState;
  }

  async function insertFlowEvent(input: {
    empresaId: string;
    conversationId: string;
    flowCode?: string | null;
    nodeCode?: string | null;
    eventType: string;
    selectedOptionId?: string | null;
    metaButtonId?: string | null;
    payload?: Record<string, unknown>;
  }) {
    const { error } = await supabase.from("chat_flow_events").insert({
      empresa_id: input.empresaId,
      conversation_id: input.conversationId,
      flow_code: input.flowCode ?? null,
      node_code: input.nodeCode ?? null,
      event_type: input.eventType,
      selected_option_id: input.selectedOptionId ?? null,
      meta_button_id: input.metaButtonId ?? null,
      payload: input.payload ?? {},
    });
    if (error) {
      console.error("[flow-engine] event insert:", error.message);
    }
  }

  async function getConversationSendContext(conversationId: string): Promise<{
    conversation: ConversationFlowState;
    toDigits: string;
    phoneNumberId: string;
    token: string;
  }> {
    const conversation = await getConversationFlowState(conversationId);
    if (!conversation) throw new Error("Conversación no encontrada");

    const { data: contact, error: cErr } = await supabase
      .from("chat_contacts")
      .select("phone_number")
      .eq("id", conversation.contact_id)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);

    const { data: channel, error: chErr } = await supabase
      .from("chat_channels")
      .select("meta_phone_number_id, whatsapp_access_token, activo")
      .eq("id", conversation.channel_id)
      .maybeSingle();
    if (chErr) throw new Error(chErr.message);

    const toDigits = normalizeWaPhone((contact?.phone_number as string) ?? "");
    const phoneNumberId =
      (channel as { meta_phone_number_id?: string } | null)?.meta_phone_number_id ??
      process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
    const tokenInChannel =
      typeof (channel as { whatsapp_access_token?: string } | null)?.whatsapp_access_token ===
      "string"
        ? (channel as { whatsapp_access_token: string }).whatsapp_access_token.trim()
        : "";
    const token = tokenInChannel || process.env.WHATSAPP_TOKEN?.trim() || "";

    if (!toDigits || !phoneNumberId || !token) {
      throw new Error(
        "Faltan datos de envío (toDigits/phoneNumberId/token) para avanzar flujo"
      );
    }
    return { conversation, toDigits, phoneNumberId, token };
  }

  async function persistOutgoingMessage(input: {
    conversation: ConversationFlowState;
    content: string;
    messageType: string;
    waMessageId: string | null;
    raw: unknown;
    senderType: "system" | "human" | "ai";
    automationSource: string;
  }) {
    const ts = new Date().toISOString();
    await supabase.from("chat_messages").insert({
      empresa_id: input.conversation.empresa_id,
      conversation_id: input.conversation.id,
      wa_message_id: input.waMessageId,
      from_me: true,
      sender_type: input.senderType,
      automation_source: input.automationSource,
      message_type: input.messageType,
      content: input.content,
      raw_payload: (input.raw ?? {}) as Record<string, unknown>,
    });
    await supabase
      .from("chat_conversations")
      .update({
        last_message_at: ts,
        last_message_preview: input.content.slice(0, 280),
        updated_at: ts,
      })
      .eq("id", input.conversation.id);
  }

  async function getNode(
    empresaId: string,
    flowCode: string,
    nodeCode: string
  ): Promise<FlowNode | null> {
    const { data, error } = await supabase
      .from("chat_flow_nodes")
      .select("id, empresa_id, flow_code, node_code, message_text, node_type, is_active")
      .eq("empresa_id", empresaId)
      .eq("flow_code", flowCode)
      .eq("node_code", nodeCode)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as FlowNode | null) ?? null;
  }

  async function getNodeOptions(nodeId: string): Promise<FlowOption[]> {
    const { data, error } = await supabase
      .from("chat_flow_options")
      .select("id, label, option_value, meta_button_id, next_node_code, sort_order")
      .eq("node_id", nodeId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as FlowOption[];
  }

  async function advanceConversationToNode(
    params: AdvanceConversationParams
  ): Promise<{ ok: boolean; error?: string }> {
    const { error } = await supabase
      .from("chat_conversations")
      .update({
        flow_code: params.flowCode,
        flow_current_node: params.nextNodeCode,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.conversationId)
      .eq("empresa_id", params.empresaId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function sendCurrentFlowNode(
    params: SendCurrentNodeParams
  ): Promise<{ ok: boolean; nodeCode?: string; error?: string }> {
    const ctxSend = await getConversationSendContext(params.conversationId);
    const state = ctxSend.conversation;
    if (!state.flow_code || !state.flow_current_node) {
      return { ok: false, error: "Conversación sin flow_code o flow_current_node" };
    }

    const node = await getNode(state.empresa_id, state.flow_code, state.flow_current_node);
    if (!node) return { ok: false, error: "Nodo actual no encontrado" };

    const bodyText = node.message_text?.trim() || "Continuemos con el flujo.";
    const basePayload = {
      flow_code: state.flow_code,
      node_code: node.node_code,
      node_type: node.node_type,
    };

    if (node.node_type === "buttons") {
      const options = await getNodeOptions(node.id);
      const send = await sendWhatsAppInteractiveButtons({
        toDigits: ctxSend.toDigits,
        phoneNumberId: ctxSend.phoneNumberId,
        accessToken: ctxSend.token,
        bodyText,
        buttons: options.map((o) => ({
          id: o.meta_button_id,
          title: o.label,
        })),
      });
      if (!send.ok) return { ok: false, error: send.error };

      await persistOutgoingMessage({
        conversation: state,
        content: bodyText,
        messageType: "interactive",
        waMessageId: send.waMessageId,
        raw: send.raw,
        senderType: "system",
        automationSource: "flow_engine",
      });
      await insertFlowEvent({
        empresaId: state.empresa_id,
        conversationId: state.id,
        flowCode: state.flow_code,
        nodeCode: node.node_code,
        eventType: "node_sent",
        payload: basePayload,
      });
      return { ok: true, nodeCode: node.node_code };
    }

    const send = await sendWhatsAppText({
      toDigits: ctxSend.toDigits,
      phoneNumberId: ctxSend.phoneNumberId,
      accessToken: ctxSend.token,
      text: bodyText,
    });
    if (!send.ok) return { ok: false, error: send.error };

    await persistOutgoingMessage({
      conversation: state,
      content: bodyText,
      messageType: "text",
      waMessageId: send.waMessageId,
      raw: send.raw,
      senderType: "system",
      automationSource: "flow_engine",
    });

    if (node.node_type === "human") {
      await supabase
        .from("chat_conversations")
        .update({
          flow_status: "human",
          human_taken_over: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", state.id);
    }

    await insertFlowEvent({
      empresaId: state.empresa_id,
      conversationId: state.id,
      flowCode: state.flow_code,
      nodeCode: node.node_code,
      eventType: "node_sent",
      payload: basePayload,
    });

    return { ok: true, nodeCode: node.node_code };
  }

  async function processInteractiveReply(
    params: ProcessInteractiveReplyParams
  ): Promise<{ ok: boolean; status: string; nextNodeCode?: string; error?: string }> {
    const state = await getConversationFlowState(params.conversationId);
    if (!state || state.empresa_id !== params.empresaId) {
      return { ok: false, status: "conversation_not_found", error: "Conversación no encontrada" };
    }
    if (state.flow_status !== "bot" || state.human_taken_over) {
      await insertFlowEvent({
        empresaId: state.empresa_id,
        conversationId: state.id,
        flowCode: state.flow_code,
        nodeCode: state.flow_current_node,
        eventType: "ignored_interactive_reply",
        metaButtonId: params.metaButtonId,
        payload: { reason: "conversation_not_in_bot_mode", raw: params.rawPayload },
      });
      return { ok: true, status: "ignored_not_bot_mode" };
    }
    if (!state.flow_code || !state.flow_current_node) {
      await insertFlowEvent({
        empresaId: state.empresa_id,
        conversationId: state.id,
        eventType: "invalid_button",
        metaButtonId: params.metaButtonId,
        payload: { reason: "missing_flow_state", raw: params.rawPayload },
      });
      return { ok: true, status: "missing_flow_state" };
    }

    const currentNode = await getNode(
      state.empresa_id,
      state.flow_code,
      state.flow_current_node
    );
    if (!currentNode) {
      await insertFlowEvent({
        empresaId: state.empresa_id,
        conversationId: state.id,
        flowCode: state.flow_code,
        nodeCode: state.flow_current_node,
        eventType: "invalid_button",
        metaButtonId: params.metaButtonId,
        payload: { reason: "current_node_not_found", raw: params.rawPayload },
      });
      return { ok: true, status: "current_node_not_found" };
    }

    const options = await getNodeOptions(currentNode.id);
    const selected = options.find((o) => o.meta_button_id === params.metaButtonId);
    if (!selected) {
      await insertFlowEvent({
        empresaId: state.empresa_id,
        conversationId: state.id,
        flowCode: state.flow_code,
        nodeCode: currentNode.node_code,
        eventType: "invalid_button",
        metaButtonId: params.metaButtonId,
        payload: { reason: "option_not_found_in_node", raw: params.rawPayload },
      });
      return { ok: true, status: "invalid_button" };
    }

    await insertFlowEvent({
      empresaId: state.empresa_id,
      conversationId: state.id,
      flowCode: state.flow_code,
      nodeCode: currentNode.node_code,
      eventType: "button_selected",
      selectedOptionId: selected.id,
      metaButtonId: params.metaButtonId,
      payload: { option_value: selected.option_value, raw: params.rawPayload },
    });

    if (!selected.next_node_code) {
      await insertFlowEvent({
        empresaId: state.empresa_id,
        conversationId: state.id,
        flowCode: state.flow_code,
        nodeCode: currentNode.node_code,
        eventType: "node_advanced",
        selectedOptionId: selected.id,
        metaButtonId: params.metaButtonId,
        payload: { next_node_code: null },
      });
      return { ok: true, status: "no_next_node" };
    }

    const adv = await advanceConversationToNode({
      conversationId: state.id,
      empresaId: state.empresa_id,
      flowCode: state.flow_code,
      nextNodeCode: selected.next_node_code,
    });
    if (!adv.ok) {
      return {
        ok: false,
        status: "advance_failed",
        error: adv.error ?? "No se pudo avanzar al siguiente nodo",
      };
    }

    await insertFlowEvent({
      empresaId: state.empresa_id,
      conversationId: state.id,
      flowCode: state.flow_code,
      nodeCode: selected.next_node_code,
      eventType: "node_advanced",
      selectedOptionId: selected.id,
      metaButtonId: params.metaButtonId,
      payload: { from_node: currentNode.node_code, next_node_code: selected.next_node_code },
    });

    const sent = await sendCurrentFlowNode({ conversationId: state.id });
    if (!sent.ok) {
      return { ok: false, status: "send_next_node_failed", error: sent.error };
    }

    return { ok: true, status: "advanced", nextNodeCode: selected.next_node_code };
  }

  return {
    getConversationFlowState,
    processInteractiveReply,
    advanceConversationToNode,
    sendCurrentFlowNode,
  };
}

export async function getConversationFlowState(
  supabase: SupabaseAdmin,
  conversationId: string
) {
  return createFlowEngine({ supabase }).getConversationFlowState(conversationId);
}

export async function processInteractiveReply(
  supabase: SupabaseAdmin,
  params: ProcessInteractiveReplyParams
) {
  return createFlowEngine({ supabase }).processInteractiveReply(params);
}

export async function advanceConversationToNode(
  supabase: SupabaseAdmin,
  params: AdvanceConversationParams
) {
  return createFlowEngine({ supabase }).advanceConversationToNode(params);
}

export async function sendCurrentFlowNode(
  supabase: SupabaseAdmin,
  params: SendCurrentNodeParams
) {
  return createFlowEngine({ supabase }).sendCurrentFlowNode(params);
}
