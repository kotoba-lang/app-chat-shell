<script lang="ts">
  import { onMount } from "svelte";
  import Sidebar from "./lib/Sidebar.svelte";
  import ChatPanel from "./lib/ChatPanel.svelte";
  import SodaiWizard from "./lib/SodaiWizard.svelte";
  import Header from "./lib/Header.svelte";
  import { listConversations, type Conversation } from "./lib/api";
  import { whoami, type ViewerState } from "./lib/auth";
  import { initLocalIdentity } from "./lib/signal-store";

  type Mode = "chat" | "sodai";
  let mode = $state<Mode>("chat");

  let conversations = $state<Conversation[]>([]);
  let activeConvId = $state<string>("");
  let viewerState = $state<ViewerState>({ status: "loading" });

  async function refreshConversations() {
    try {
      conversations = await listConversations();
    } catch (e) {
      console.error("[chat-shell] listConversations failed", e);
      conversations = [];
    }
  }

  function onSelectConv(convId: string) {
    activeConvId = convId;
  }

  function onNewConv() {
    activeConvId = "";
  }

  function onConversationUpdated() {
    refreshConversations();
  }

  onMount(async () => {
    // Resolve the viewer first so the chat-agent can attribute the
    // anonymous-vs-signed-in conversation list correctly. whoami()
    // never throws — it returns ViewerState directly.
    viewerState = await whoami();
    if (viewerState.status === "signed-in") {
      // Ensure a local Signal identity exists for ephemeral encryption.
      // generateIdentity() is idempotent (hasIdentity check inside).
      void initLocalIdentity(viewerState.viewer.did);
    }
    refreshConversations();
  });
</script>

<Header viewer={viewerState} />
<nav class="modetabs">
  <button class:active={mode === "chat"} onclick={() => (mode = "chat")}>チャット</button>
  <button class:active={mode === "sodai"} onclick={() => (mode = "sodai")}>粗大ごみ申請</button>
</nav>
{#if mode === "chat"}
  <div class="window">
  <div class="shell">
    <aside class="sidebar">
      <Sidebar
        {conversations}
        {activeConvId}
        onSelect={onSelectConv}
        onNew={onNewConv}
        onRefresh={refreshConversations}
      />
    </aside>
    <main class="main">
      <ChatPanel
        bind:convId={activeConvId}
        did={viewerState.status === "signed-in" ? viewerState.viewer.did : ""}
        onTurnComplete={onConversationUpdated}
      />
    </main>
  </div>
  </div>
{:else}
  <main class="main sodai-main">
    <SodaiWizard />
  </main>
{/if}

<style>
  :global(html, body) {
    margin: 0;
    padding: 0;
    height: 100%;
    background:
      radial-gradient(circle at 20% 0%, rgba(80, 113, 143, 0.18), transparent 30%),
      linear-gradient(180deg, var(--mani-color-page-top) 0%, var(--mani-color-page-bottom) 100%);
    color: var(--mani-color-text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans",
                 "Noto Sans JP", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  :global(*) { box-sizing: border-box; }
  :global(#app) {
    height: 100%;
    display: flex;
    flex-direction: column;
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  }
  .modetabs {
    display: flex;
    gap: 6px;
    padding: 8px max(16px, calc((100vw - var(--mani-size-content-max)) / 2)) 10px;
    background: rgba(22, 23, 26, 0.78);
    border-bottom: 1px solid var(--mani-color-hairline);
    backdrop-filter: var(--mani-blur-bar);
    flex: 0 0 auto;
  }
  .modetabs button {
    min-height: 36px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--mani-radius-pill);
    color: var(--mani-color-text-muted);
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .modetabs button:hover { color: var(--mani-color-text); background: rgba(255, 255, 255, 0.06); }
  .modetabs button.active {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }
  .window {
    width: min(100%, var(--mani-size-content-max));
    min-height: 0;
    margin: 0 auto 16px;
    flex: 1 1 auto;
    display: flex;
    padding: 0 12px;
  }
  .shell {
    display: grid;
    grid-template-columns: minmax(var(--mani-size-sidebar-min), var(--mani-size-sidebar-max)) minmax(0, 1fr);
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: var(--mani-radius-window);
    background: var(--mani-color-surface);
    box-shadow: var(--mani-shadow-window);
  }
  .sodai-main { flex: 1 1 auto; min-height: 0; }
  .sidebar {
    background: var(--mani-color-surface-raised);
    border-right: 1px solid var(--mani-color-hairline);
    overflow-y: auto;
  }
  .main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--mani-color-surface-chat);
  }
  @media (max-width: 860px) {
    .window {
      margin-bottom: 0;
      padding: 0;
    }
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1fr) auto;
      border-radius: 0;
      border-left: 0;
      border-right: 0;
    }
    .sidebar {
      grid-row: 2;
      border-right: 0;
      border-top: 1px solid var(--mani-color-hairline);
      max-height: 168px;
      overflow: hidden;
    }
    .main { grid-row: 1; }
  }
  @media (max-width: 520px) {
    .modetabs {
      padding: 8px 10px;
      overflow-x: auto;
    }
    .modetabs button {
      flex: 0 0 auto;
      min-height: var(--mani-size-touch);
    }
  }
</style>
