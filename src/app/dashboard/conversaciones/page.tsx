import { Suspense } from "react";
import { getCurrentUserDisplayNameServer } from "@/lib/auth/get-current-user-display-name-server";
import { getChatDataSchemaForCurrentUser } from "@/lib/chat/empresa-chat-schema-server";
import { getConversacionesInboxBootstrap } from "@/lib/chat/chat-ops-actions";
import type { OmnicanalOperatorRole } from "@/lib/chat/omnicanal-supervision-read";
import { ConversacionesClient, type ConversacionesInitialOperationalPresence } from "./ConversacionesClient";

export default async function ConversacionesInboxPage() {
  let chatDataSchema = "zentra_erp";
  try {
    chatDataSchema = await getChatDataSchemaForCurrentUser();
  } catch (e) {
    console.error("[dashboard/conversaciones] getChatDataSchemaForCurrentUser", e);
  }

  const [agentDisplayName, bootstrap] = await Promise.all([
    getCurrentUserDisplayNameServer().catch((e) => {
      console.error("[dashboard/conversaciones] getCurrentUserDisplayNameServer", e);
      return "Usuario";
    }),
    getConversacionesInboxBootstrap().catch((e) => {
      console.error("[dashboard/conversaciones] getConversacionesInboxBootstrap", e);
      return null;
    }),
  ]);

  let initialOperationalPresence: ConversacionesInitialOperationalPresence | undefined;
  let initialOmnicanalRole: OmnicanalOperatorRole | null = null;
  if (bootstrap) {
    initialOmnicanalRole = bootstrap.omnicanal_role;
    const presence = bootstrap.presence;
    initialOperationalPresence = presence.in_queues
      ? { in_queues: true, status: presence.status, status_changed_at: presence.status_changed_at ?? null }
      : { in_queues: false, status: null };
  }

  return (
    <Suspense fallback={<div className="p-6 text-slate-400 text-sm animate-pulse">Cargando conversaciones…</div>}>
      <ConversacionesClient
        mode="inbox"
        chatDataSchema={chatDataSchema}
        agentDisplayName={agentDisplayName}
        initialOperationalPresence={initialOperationalPresence}
        initialOmnicanalRole={initialOmnicanalRole}
      />
    </Suspense>
  );
}
