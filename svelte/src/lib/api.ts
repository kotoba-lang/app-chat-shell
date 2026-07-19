// Streaming + non-streaming API helpers.
//
// /api/chat returns SSE events; we yield decoded JSON event dicts to the
// caller (UI components consume via `for await`).
//
// /api/xrpc/* returns standard JSON.
//
// /lg/* proxies to the LangGraph Server protocol endpoints used by
// @langchain/langgraph-sdk Client and @langchain/svelte useStream.

import { Client } from "@langchain/langgraph-sdk";

export function createLangGraphClient(): Client {
  return new Client({ apiUrl: "/lg" });
}

export type ChatEvent =
  | { event: "start"; convId?: string; stage: string; message?: string }
  | { event: "node"; node: string; convId: string; iteration: number }
  | { event: "delta"; content: string }
  | { event: "tool"; tool: string; ok: boolean; summary: string }
  | { event: "final"; convId: string; finalMsgId: string; content: string;
      iterations: number; artifactsCreated: string[]; totalTokens: number }
  | { event: "error"; error: string }
  | { event: "done" };

export interface ChatTurnInput {
  text: string;
  convId?: string;
  tier?: "fast" | "balanced" | "reasoning";
  modelHint?: string;
  tools?: string[];
  maxIterations?: number;
}

export async function* streamChat(input: ChatTurnInput): AsyncGenerator<ChatEvent> {
  const resp = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
    credentials: "include",
  });
  if (!resp.body) throw new Error("no body");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const e of events) {
      const line = e.trim();
      if (!line.startsWith("data:")) continue;
      const json = line.slice(5).trim();
      if (!json) continue;
      try {
        yield JSON.parse(json) as ChatEvent;
      } catch {
        // skip malformed
      }
    }
  }
}

export interface Conversation {
  convId: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  status: string;
  agentDid?: string;
  modelHint?: string;
}

export async function listConversations(): Promise<Conversation[]> {
  const resp = await fetch("/api/xrpc/ai.etzhayyim.apps.chat.listConversations", {
    credentials: "include",
  });
  const j = await resp.json();
  return j.conversations ?? [];
}

export interface Message {
  msgId: string;
  role: string;
  content: string;
  tsMs: number;
  modelUsed?: string;
  totalTokens?: number;
  toolCallsJson?: string;
  toolCallId?: string;
}

export interface ConversationDetail {
  convId: string;
  title: string;
  agentDid: string;
  modelHint: string;
  messageCount: number;
  messages: Message[];
  artifacts: { artifactId: string; kind: string; mimeType: string;
               byteSize: number; title: string; url: string }[];
  toolInvocations: { toolName: string; msgId: string; argsJson: string;
                     resultSummary: string; durationMs: number; status: string }[];
}

export async function getConversation(convId: string): Promise<ConversationDetail> {
  const resp = await fetch(
    `/api/xrpc/ai.etzhayyim.apps.chat.getConversation?convId=${encodeURIComponent(convId)}`,
    { credentials: "include" },
  );
  return await resp.json();
}

export async function deleteConversation(convId: string, purgeNow = false): Promise<void> {
  await fetch("/api/xrpc/ai.etzhayyim.apps.chat.deleteConversation", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ convId, purgeNow }),
    credentials: "include",
  });
}
