<script lang="ts">
  import { signIn, signOut, shortLabel, type ViewerState } from "./auth";
  import AppLauncher from "./AppLauncher.svelte";

  let { viewer }: { viewer: ViewerState } = $props();

  let busy = $state(false);

  async function onSignIn() {
    if (busy) return;
    busy = true;
    try { await signIn(); } finally { busy = false; }
  }
  async function onSignOut() {
    if (busy) return;
    busy = true;
    try { await signOut(); } finally { busy = false; }
  }
</script>

<header class="topbar">
  <div class="traffic" aria-hidden="true">
    <span></span><span></span><span></span>
  </div>
  <div class="left">
    <AppLauncher />
    <div class="brand">etzhayyim.com</div>
  </div>
  <div class="auth">
    {#if viewer.status === "loading"}
      <span class="muted">…</span>
    {:else if viewer.status === "signed-in"}
      <span class="handle" title={viewer.viewer.did}>{shortLabel(viewer.viewer)}</span>
      <button type="button" onclick={onSignOut} disabled={busy}>Sign out</button>
    {:else if viewer.status === "error"}
      <span class="muted" title={viewer.message}>auth offline</span>
      <button type="button" onclick={onSignIn} disabled={busy}>Sign in</button>
    {:else}
      <button type="button" class="primary" onclick={onSignIn} disabled={busy}>
        Sign in
      </button>
    {/if}
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 0 max(16px, calc((100vw - var(--mani-size-content-max)) / 2));
    height: var(--mani-size-titlebar);
    background: rgba(28, 29, 33, 0.82);
    border-bottom: 1px solid var(--mani-color-hairline);
    backdrop-filter: var(--mani-blur-bar);
    flex: 0 0 auto;
  }
  .traffic {
    display: flex;
    gap: 8px;
    flex: 0 0 auto;
  }
  .traffic span {
    width: 12px;
    height: 12px;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
  }
  .traffic span:nth-child(1) { background: #ff5f57; }
  .traffic span:nth-child(2) { background: #ffbd2e; }
  .traffic span:nth-child(3) { background: #28c840; }
  .left {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .brand {
    font-weight: 600;
    letter-spacing: 0;
    color: var(--mani-color-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .auth {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .handle {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: #c8c8ce;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .muted {
    color: var(--mani-color-text-muted);
    font-size: 12px;
  }
  button {
    min-height: 36px;
    background: rgba(255, 255, 255, 0.09);
    color: var(--mani-color-text);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: var(--mani-radius-pill);
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.14);
  }
  button.primary {
    background: var(--mani-color-accent);
    border-color: var(--mani-color-accent);
    color: #fff;
  }
  button.primary:hover:not(:disabled) {
    background: var(--mani-color-accent-hover);
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  @media (max-width: 620px) {
    .topbar {
      height: 50px;
      padding: 0 12px;
    }
    .traffic { display: none; }
    .brand { max-width: 42vw; }
    .handle { max-width: 32vw; }
    button { min-height: 40px; }
  }
</style>
