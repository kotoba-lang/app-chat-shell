<script lang="ts">
  import { tick } from "svelte";
  import MessageList from "./MessageList.svelte";
  import Composer from "./Composer.svelte";
  import type { Message } from "./api";
  import {
    initLocalIdentity,
    loadTurns,
    storeTurn,
    type Turn,
  } from "./signal-store";
  import { m } from "../paraglide/messages.js";

  let { convId = $bindable<string>(""), did = "", onTurnComplete }: {
    convId: string;
    did?: string;
    onTurnComplete?: () => void;
  } = $props();

  let localTurns = $state<Turn[]>([]);
  let streamingDelta = $state("");
  let isLoading = $state(false);
  let panel: HTMLDivElement | undefined = $state();
  let activeToolEvents = $state<{ tool: string; ok: boolean; summary: string }[]>([]);

  // Reload local encrypted history when convId changes.
  $effect(() => {
    const id = convId;
    const d = did;
    if (id && d) void reloadTurns(id, d);
    else localTurns = [];
  });

  $effect(() => {
    void localTurns;
    void streamingDelta;
    scrollBottom();
  });

  async function reloadTurns(id: string, d: string) {
    localTurns = await loadTurns(d, id);
  }

  const messages = $derived<Message[]>(
    localTurns.map((t, i) => ({
      msgId: `local-${i}`,
      role: t.role === "user" ? "user" : "assistant",
      content: t.content,
      tsMs: t.tsMs,
    })),
  );

  const streamStatus = $derived(
    !isLoading ? "" :
    localTurns.length === 0 && !streamingDelta ? "接続しています" :
    "回答を生成しています"
  );

  async function send(text: string, tier: "fast" | "balanced" | "reasoning") {
    if (!text.trim() || isLoading || !did) return;

    if (!convId) convId = `ephemeral-${Date.now()}`;

    await initLocalIdentity(did);
    await storeTurn(did, convId, "user", text);
    const history = await loadTurns(did, convId);
    // Optimistic: show user turn immediately.
    localTurns = history;
    await tick();
    scrollBottom();

    const historyPayload = history.slice(0, -1).map((t) => ({
      role: t.role,
      content: t.content,
    }));

    isLoading = true;
    streamingDelta = "";
    activeToolEvents = [];
    let reply = "";

    try {
      const resp = await fetch("/lg/runs/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assistant_id: "agent_chat",
          input: { message: text, history: historyPayload },
          config: { configurable: { tier, ephemeral: true } },
          stream_mode: "values",
        }),
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
          try {
            const payload = JSON.parse(line.slice(5).trim()) as {
              event: string;
              data: { reply?: string; error?: string; tool_results?: { name: string; result: { ok?: boolean } }[] } | string;
            };
            if (payload.event === "values" && typeof payload.data === "object") {
              const state = payload.data as {
                reply?: string;
                tool_results?: { name: string; result: { ok?: boolean; error?: string } }[];
              };
              if (state.reply) {
                reply = state.reply;
                streamingDelta = reply;
              }
              if (state.tool_results?.length) {
                activeToolEvents = state.tool_results.map((t) => ({
                  tool: t.name,
                  ok: t.result?.ok !== false,
                  summary: t.result?.error != null ? `Error: ${t.result.error}` : "done",
                }));
              }
            } else if (payload.event === "error") {
              reply = typeof payload.data === "string"
                ? `エラーが発生しました: ${payload.data}`
                : "エラーが発生しました。もう一度お試しください。";
              streamingDelta = reply;
            }
          } catch {
            // skip malformed event
          }
        }
      }
    } finally {
      isLoading = false;
      streamingDelta = "";
    }

    if (reply) {
      await storeTurn(did, convId, "assistant", reply);
      localTurns = await loadTurns(did, convId);
    }
    onTurnComplete?.();
  }

  function scrollBottom() {
    if (panel) panel.scrollTop = panel.scrollHeight;
  }
</script>

<div class="panel" bind:this={panel}>
  {#if messages.length === 0 && !streamingDelta}
    <div class="empty">
      <h1>{m.app_title()}</h1>
      <p>{m.intro_caption()}</p>
      <div class="capsules">
        <span>{m.capability_code()}</span>
        <span>{m.capability_image()}</span>
        <span>{m.capability_file()}</span>
        <span>{m.capability_history()}</span>
        <span>{m.capability_web()}</span>
      </div>
    </div>
  {:else}
    <MessageList {messages} {streamingDelta} {streamStatus} toolEvents={activeToolEvents} />
  {/if}
</div>
<Composer busy={isLoading} onSend={send} />

<style>
  .panel {
    flex: 1;
    overflow-y: auto;
    padding: 24px 16px 16px;
    scroll-behavior: smooth;
  }
  .empty {
    max-width: 720px;
    margin: 12% auto 0;
    text-align: center;
    color: var(--mani-color-text-muted);
  }
  .empty h1 {
    font-size: 28px;
    margin-bottom: 12px;
    color: var(--mani-color-text);
    font-weight: 600;
  }
  .empty p { font-size: 14px; line-height: 1.6; }
  .capsules {
    margin-top: 18px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .capsules span {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--mani-color-hairline);
    border-radius: var(--mani-radius-pill);
    padding: 4px 12px;
    font-size: 12px;
    color: var(--mani-color-text-muted);
  }
  @media (max-width: 560px) {
    .panel { padding: 16px 10px 12px; }
    .empty { margin-top: 18%; }
    .empty h1 { font-size: 24px; }
  }
</style>
