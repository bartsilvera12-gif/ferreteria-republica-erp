"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  fetchChatChannels,
  fetchChatConversations,
  markConversationRead,
  type InboxConversation,
} from "@/lib/chat/actions";
import { supabase } from "@/lib/supabase";

type ChatMessage = {
  id: string;
  from_me: boolean;
  message_type: string;
  content: string | null;
  created_at: string;
};

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-PY", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function mapRowToMessage(row: Record<string, unknown>): ChatMessage {
  return {
    id: row.id as string,
    from_me: Boolean(row.from_me),
    message_type: String(row.message_type ?? "text"),
    content: (row.content as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

export default function ConversacionesPage() {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [sending, setSending] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [hasActiveChannel, setHasActiveChannel] = useState<boolean | null>(null);

  const messagesScrollRef = useRef<HTMLDivElement>(null);
  /** Si el usuario está cerca del final, los mensajes nuevos hacen scroll; si subió a leer historial, no. */
  const stickBottomRef = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);
  const loadConversationsRef = useRef<(opts?: { silent?: boolean }) => Promise<void>>(async () => {});

  const loadConversations = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    try {
      const rows = await fetchChatConversations();
      setConversations(rows);
      setListError(null);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Error al cargar conversaciones");
    } finally {
      if (!silent) setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    if (!silent) setLoadingMsg(true);
    try {
      const { data, error: err } = await supabase
        .from("chat_messages")
        .select("id, from_me, message_type, content, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (err) throw new Error(err.message);
      setMessages((data ?? []) as ChatMessage[]);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "Error al cargar mensajes");
    } finally {
      if (!silent) setLoadingMsg(false);
    }
  }, []);

  loadConversationsRef.current = loadConversations;

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    fetchChatChannels()
      .then((ch) => setHasActiveChannel(ch.some((c) => c.activo)))
      .catch(() => setHasActiveChannel(null));
  }, []);

  /** Lista: actualizar con Realtime (sin polling). */
  useEffect(() => {
    const channel = supabase
      .channel("conversaciones-inbox-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_conversations" },
        () => {
          void loadConversationsRef.current?.({ silent: true });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  /** Mensajes del hilo abierto: INSERT en tiempo real. */
  useEffect(() => {
    if (!selectedId) return;

    const channel = supabase
      .channel(`conversaciones-msg-${selectedId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${selectedId}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          if (!row?.id) return;
          const msg = mapRowToMessage(row);
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId]);

  const onMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const threshold = 100;
    stickBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
  }, []);

  useLayoutEffect(() => {
    if (!selectedId || messages.length === 0) return;
    const last = messages[messages.length - 1]?.id;
    const prev = lastMessageIdRef.current;
    lastMessageIdRef.current = last;

    if (last === prev) return;

    const el = messagesScrollRef.current;
    if (!el) return;
    if (!stickBottomRef.current && prev !== null) return;

    el.scrollTop = el.scrollHeight;
  }, [messages, selectedId]);

  const handleSelect = useCallback(async (id: string) => {
    stickBottomRef.current = true;
    lastMessageIdRef.current = null;
    setSelectedId(id);
    await loadMessages(id);
    try {
      await markConversationRead(id);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c))
      );
    } catch {
      /* no bloquear UI */
    }
  }, [loadMessages]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !input.trim() || sending) return;
    setSending(true);
    setSendError(null);
    stickBottomRef.current = true;
    try {
      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ conversation_id: selectedId, message: input.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        meta?: unknown;
      };
      if (!res.ok) {
        const base =
          typeof json.error === "string"
            ? json.error
            : res.status === 401
              ? "Sesión expirada o no autenticado"
              : `Error al enviar (HTTP ${res.status})`;
        throw new Error(base);
      }
      setInput("");
      setSendError(null);
      await loadMessages(selectedId, { silent: true });
      await loadConversations({ silent: true });
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Error al enviar");
    } finally {
      setSending(false);
    }
  }

  const selected = conversations.find((c) => c.id === selectedId);
  const requestedConversationId = searchParams?.get("conversationId") ?? null;

  useEffect(() => {
    if (!requestedConversationId || !conversations.length) return;
    if (selectedId === requestedConversationId) return;
    const exists = conversations.some((c) => c.id === requestedConversationId);
    if (!exists) return;
    void handleSelect(requestedConversationId);
  }, [requestedConversationId, conversations, selectedId, handleSelect]);

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-[480px] gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Conversaciones</h1>
          <p className="text-sm text-slate-500">WhatsApp · bandeja de entrada</p>
        </div>
        <Link
          href="/dashboard/conversaciones/configuracion"
          className="shrink-0 text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Configurar canal WhatsApp
        </Link>
        <Link
          href="/dashboard/conversaciones/flujos"
          className="shrink-0 text-sm font-medium text-[#0EA5E9] hover:underline px-3 py-2 rounded-lg border border-sky-200 bg-sky-50"
        >
          Gestionar flujos
        </Link>
      </div>

      {hasActiveChannel === false && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <span>No hay un canal WhatsApp activo para tu empresa. Los mensajes no se registrarán hasta configurarlo.</span>
          <Link href="/dashboard/conversaciones/configuracion" className="font-semibold text-amber-800 hover:underline">
            Ir a configuración →
          </Link>
        </div>
      )}

      {listError && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-lg px-4 py-2">
          {listError}
        </div>
      )}

      <div className="flex flex-1 min-h-0 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
        {/* Lista */}
        <div className="w-full max-w-[340px] border-r border-slate-200 flex flex-col bg-slate-50/80">
          <div className="p-3 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Chats
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingList ? (
              <div className="p-6 text-sm text-slate-400 text-center animate-pulse">Cargando…</div>
            ) : conversations.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 text-center space-y-2">
                <p>No hay conversaciones aún</p>
                <Link
                  href="/dashboard/conversaciones/configuracion"
                  className="inline-block text-[#0EA5E9] hover:underline text-xs"
                >
                  Configurar número de WhatsApp
                </Link>
              </div>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleSelect(c.id)}
                  className={`w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-white transition-colors ${
                    selectedId === c.id ? "bg-white border-l-4 border-l-[#0EA5E9]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-slate-800 truncate">
                      {c.contact.name || c.contact.phone_number}
                    </span>
                    {c.unread_count > 0 && (
                      <span className="shrink-0 bg-[#0EA5E9] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {c.last_message_preview || "—"}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Panel mensajes */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedId ? (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Seleccioná una conversación
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-200 bg-white flex flex-wrap items-center gap-2">
                <div className="font-semibold text-slate-800">
                  {selected?.contact.name || selected?.contact.phone_number}
                </div>
                <span className="text-xs text-slate-400 font-mono">
                  {selected?.contact.phone_number}
                </span>
                {selected?.contact.cliente_id && (
                  <Link
                    href={`/clientes/${selected.contact.cliente_id}`}
                    className="text-xs text-[#0EA5E9] hover:underline"
                  >
                    Ver cliente
                  </Link>
                )}
                {selected?.contact.crm_prospecto_id && (
                  <Link
                    href={`/crm/${selected.contact.crm_prospecto_id}`}
                    className="text-xs text-violet-600 hover:underline"
                  >
                    Ver prospecto CRM
                  </Link>
                )}
              </div>

              <div
                ref={messagesScrollRef}
                onScroll={onMessagesScroll}
                className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50 min-h-0"
              >
                {loadingMsg ? (
                  <div className="text-center text-slate-400 text-sm py-8">Cargando mensajes…</div>
                ) : (
                  messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${
                          m.from_me
                            ? "bg-[#0EA5E9] text-white rounded-br-md"
                            : "bg-white border border-slate-200 text-slate-800 rounded-bl-md shadow-sm"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <p
                          className={`text-[10px] mt-1 ${m.from_me ? "text-sky-100" : "text-slate-400"}`}
                        >
                          {formatTime(m.created_at)}
                          {m.message_type !== "text" && ` · ${m.message_type}`}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <form
                onSubmit={handleSend}
                className="p-3 border-t border-slate-200 bg-white flex flex-col gap-2"
              >
                {sendError && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {sendError}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0EA5E9]/30 focus:border-[#0EA5E9] outline-none"
                    placeholder="Escribí un mensaje…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    disabled={sending || !input.trim()}
                    className="bg-[#0EA5E9] hover:bg-[#0284C7] disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium"
                  >
                    {sending ? "…" : "Enviar"}
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
