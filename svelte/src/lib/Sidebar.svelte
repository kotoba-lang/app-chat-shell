<script lang="ts">
  import type { Conversation } from "./api";
  import { deleteConversation } from "./api";
  import { m } from "../paraglide/messages.js";
  import LanguageSwitcher from "./LanguageSwitcher.svelte";

  let {
    conversations,
    activeConvId,
    onSelect,
    onNew,
    onRefresh,
  }: {
    conversations: Conversation[];
    activeConvId: string;
    onSelect: (convId: string) => void;
    onNew: () => void;
    onRefresh: () => void;
  } = $props();

  async function handleDelete(convId: string, e: Event) {
    e.stopPropagation();
    if (!confirm(m.confirm_delete())) return;
    await deleteConversation(convId, false);
    onRefresh();
    if (activeConvId === convId) onNew();
  }
</script>

<div class="sidebar-inner">
  <button class="new" onclick={onNew} aria-label={m.new_chat()}>{m.new_chat()}</button>
  <ul class="convs">
    {#each conversations as c (c.convId)}
      <li
        class:active={c.convId === activeConvId}
        onclick={() => onSelect(c.convId)}
        onkeydown={(e) => { if (e.key === "Enter") onSelect(c.convId); }}
        role="button"
        tabindex="0"
      >
        <div class="title">{c.title || m.untitled()}</div>
        <div class="meta">{m.msg_count_label({ count: String(c.messageCount) })} · {c.lastMessageAt?.slice(0, 10) ?? ""}</div>
        <button class="del" onclick={(e) => handleDelete(c.convId, e)} aria-label="delete">×</button>
      </li>
    {/each}
    {#if conversations.length === 0}
      <li class="empty">{m.no_conversations()}</li>
    {/if}
  </ul>
  <div class="brand">
    <div>etzhayyim.com</div>
    <div class="sub">{m.brand_subtitle()}</div>
  </div>
  <LanguageSwitcher />
</div>

<style>
  .sidebar-inner {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 14px 12px;
  }
  .new {
    min-height: var(--mani-size-touch);
    background: rgba(10, 132, 255, 0.18);
    color: var(--mani-color-text);
    border: 1px solid rgba(10, 132, 255, 0.28);
    border-radius: var(--mani-radius-control);
    padding: 10px 12px;
    cursor: pointer;
    text-align: left;
    margin-bottom: 10px;
    font-size: 14px;
    font-weight: 700;
  }
  .new:hover { background: rgba(10, 132, 255, 0.25); }
  .convs {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
    overflow-y: auto;
  }
  .convs li {
    position: relative;
    min-height: 58px;
    padding: 10px 42px 10px 12px;
    border-radius: var(--mani-radius-control);
    cursor: pointer;
    margin-bottom: 4px;
    border: 1px solid transparent;
  }
  .convs li:hover { background: rgba(255, 255, 255, 0.07); }
  .convs li.active {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.1);
  }
  .convs li.empty {
    color: var(--mani-color-text-muted);
    font-size: 13px;
    text-align: center;
    padding: 16px 0;
    cursor: default;
  }
  .convs li.empty:hover { background: transparent; }
  .title {
    font-size: 13px;
    font-weight: 650;
    color: var(--mani-color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-size: 11px;
    color: var(--mani-color-text-muted);
    margin-top: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .del {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 30px;
    height: 30px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: var(--mani-radius-pill);
    color: var(--mani-color-text-muted);
    cursor: pointer;
    font-size: 16px;
    padding: 0;
    line-height: 1;
  }
  .del:hover { color: var(--mani-color-danger); background: rgba(255, 69, 58, 0.12); }
  .brand {
    padding: 12px 6px 4px;
    font-size: 11px;
    color: var(--mani-color-text-muted);
    border-top: 1px solid var(--mani-color-hairline);
  }
  .sub { margin-top: 2px; font-size: 10px; }
  @media (max-width: 860px) {
    .sidebar-inner {
      padding: 10px 10px calc(10px + env(safe-area-inset-bottom));
      gap: 8px;
    }
    .new {
      margin: 0;
      flex: 0 0 auto;
    }
    .convs {
      display: flex;
      gap: 8px;
      overflow-x: auto;
      overflow-y: hidden;
      flex: 0 0 auto;
      padding-bottom: 2px;
    }
    .convs li {
      flex: 0 0 min(72vw, 280px);
      margin: 0;
    }
    .brand {
      display: none;
    }
  }
</style>
