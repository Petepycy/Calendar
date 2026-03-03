import { api } from "@/lib/api";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: string;
  needsConfirmation?: boolean;
  requiresLogin?: boolean;
  draft?: Record<string, unknown> | null;
}

export async function sendChatMessage(content: string, threadId: string): Promise<ChatMessage> {
  const { data } = await api.post<{
    reply: string;
    needs_confirmation: boolean;
    draft: Record<string, unknown> | null;
  }>("/api/chat", { message: content, thread_id: threadId });

  return {
    id: crypto.randomUUID(),
    role: "agent",
    content: data.reply,
    timestamp: new Date().toISOString(),
    needsConfirmation: data.needs_confirmation,
    draft: data.draft,
  };
}

export function getOrCreateAnonymousId(): string {
  const key = "calendarai_anon_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export async function sendPublicChatMessage(
  content: string,
  threadId: string,
  anonymousId: string,
  tenantSlug: string,
): Promise<ChatMessage> {
  const { data } = await api.post<{
    reply: string;
    needs_confirmation: boolean;
    draft: Record<string, unknown> | null;
    requires_login: boolean;
  }>("/api/chat/public", {
    message: content,
    thread_id: threadId,
    anonymous_id: anonymousId,
    tenant_slug: tenantSlug,
  });

  return {
    id: crypto.randomUUID(),
    role: "agent",
    content: data.reply,
    timestamp: new Date().toISOString(),
    needsConfirmation: data.needs_confirmation,
    requiresLogin: data.requires_login,
    draft: data.draft,
  };
}

export async function confirmBooking(threadId: string, decision: "approve" | "reject"): Promise<ChatMessage> {
  const { data } = await api.post<{ reply: string }>("/api/chat/confirm", {
    thread_id: threadId,
    decision,
  });

  return {
    id: crypto.randomUUID(),
    role: "agent",
    content: data.reply,
    timestamp: new Date().toISOString(),
  };
}
