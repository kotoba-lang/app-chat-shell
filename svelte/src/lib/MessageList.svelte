<script lang="ts">
  import type { Message } from "./api";
  import { m } from "../paraglide/messages.js";

  let { messages, streamingDelta, streamStatus, toolEvents }: {
    messages: Message[];
    streamingDelta: string;
    streamStatus: string;
    toolEvents: { tool: string; ok: boolean; summary: string }[];
  } = $props();
</script>

<div class="thread">
  {#each messages as msg (msg.msgId)}
    <div class="row" class:user={msg.role === "user"} class:assistant={msg.role === "assistant"} class:system={msg.role === "system" || msg.role === "tool"}>
      <div class="bubble">
        {#if msg.role === "user"}
          <div class="badge user-badge">{m.role_user()}</div>
        {:else if msg.role === "assistant"}
          <div class="badge etzhayyim-badge">{m.role_assistant()}</div>
        {:else}
          <div class="badge sys-badge">{msg.role}</div>
        {/if}
        <div class="content">{msg.content}</div>
        {#if msg.totalTokens}
          <div class="meta">{msg.totalTokens} {m.label_tokens()}{msg.modelUsed ? ` · ${msg.modelUsed}` : ""}</div>
        {/if}
      </div>
    </div>
  {/each}
  {#if streamingDelta || streamStatus}
    <div class="row assistant">
      <div class="bubble">
        <div class="badge etzhayyim-badge">{m.role_assistant()}</div>
        {#if streamingDelta}
          <div class="content">{streamingDelta}<span class="cursor">▍</span></div>
        {:else}
          <div class="thinking">
            <span class="dot"></span>
            <span>{streamStatus}</span>
          </div>
        {/if}
        {#if toolEvents.length > 0}
          <div class="tools">
            {#each toolEvents as ev (ev.tool + ev.summary)}
              <div class="tool" class:fail={!ev.ok}>
                <code>{ev.tool}</code>
                <span class:ok={ev.ok} class:err={!ev.ok}>{ev.ok ? "✓" : "✗"}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .thread {
    max-width: 760px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .row { display: flex; }
  .row.user { justify-content: flex-end; }
  .row.assistant, .row.system { justify-content: flex-start; }
  .bubble {
    max-width: 85%;
    background: var(--mani-color-assistant);
    border: 1px solid rgba(10, 132, 255, 0.22);
    border-radius: var(--mani-radius-bubble);
    padding: 12px 14px;
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .row.user .bubble {
    background: var(--mani-color-user);
    border-color: rgba(52, 199, 89, 0.24);
  }
  .row.system .bubble {
    background: rgba(255, 255, 255, 0.06);
    color: var(--mani-color-text-muted);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 12.5px;
  }
  .badge {
    font-size: 11px;
    color: var(--mani-color-text-muted);
    margin-bottom: 4px;
  }
  .etzhayyim-badge { color: var(--mani-color-accent); }
  .user-badge { color: #b9f6c9; }
  .sys-badge { color: var(--mani-color-danger); }
  .content { color: var(--mani-color-text); }
  .thinking {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--mani-color-text-muted);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: var(--mani-color-accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .meta { font-size: 11px; color: var(--mani-color-text-muted); margin-top: 6px; }
  .cursor {
    display: inline-block;
    margin-left: 2px;
    color: var(--mani-color-accent);
    animation: blink 1s steps(2) infinite;
  }
  @keyframes blink { 50% { opacity: 0; } }
  @keyframes pulse {
    0%, 100% { opacity: 0.35; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1); }
  }
  .tools {
    margin-top: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tool {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--mani-color-hairline);
    border-radius: 8px;
    padding: 2px 8px;
    font-size: 11px;
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .tool.fail { border-color: rgba(255, 69, 58, 0.35); }
  .tool .ok { color: #9ece6a; }
  .tool .err { color: var(--mani-color-danger); }
  @media (max-width: 560px) {
    .thread { gap: 12px; }
    .bubble {
      max-width: 92%;
      padding: 11px 12px;
      font-size: 14px;
    }
  }
</style>
