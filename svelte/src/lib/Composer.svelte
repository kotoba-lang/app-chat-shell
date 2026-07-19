<script lang="ts">
  import { m } from "../paraglide/messages.js";

  let { busy, onSend }: {
    busy: boolean;
    onSend: (text: string, tier: "fast" | "balanced" | "reasoning") => Promise<void>;
  } = $props();

  let text = $state("");
  let tier = $state<"fast" | "balanced" | "reasoning">("balanced");
  let area: HTMLTextAreaElement | undefined = $state();

  function autosize() {
    if (!area) return;
    area.style.height = "auto";
    area.style.height = Math.min(area.scrollHeight, 240) + "px";
  }

  async function submit() {
    const t = text.trim();
    if (!t || busy) return;
    text = "";
    autosize();
    await onSend(t, tier);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void submit();
    }
  }
</script>

<form class="composer" onsubmit={(e) => { e.preventDefault(); void submit(); }}>
  <textarea
    bind:this={area}
    bind:value={text}
    oninput={autosize}
    onkeydown={onKeydown}
    placeholder={m.composer_placeholder()}
    rows="1"
    aria-label="Message"
    disabled={busy}
  ></textarea>
  <div class="bar">
    <div class="tier">
      <label>
        <input type="radio" bind:group={tier} value="fast" />
        {m.tier_fast()}
      </label>
      <label>
        <input type="radio" bind:group={tier} value="balanced" />
        {m.tier_balanced()}
      </label>
      <label>
        <input type="radio" bind:group={tier} value="reasoning" />
        {m.tier_reasoning()}
      </label>
    </div>
    <button type="submit" disabled={busy || !text.trim()} aria-label={m.send()}>
      {busy ? m.sending() : m.send()}
    </button>
  </div>
</form>

<style>
  .composer {
    border-top: 1px solid var(--mani-color-hairline);
    padding: 10px 16px calc(14px + env(safe-area-inset-bottom));
    background: rgba(9, 10, 12, 0.88);
    backdrop-filter: var(--mani-blur-bar);
  }
  textarea {
    width: 100%;
    min-height: var(--mani-size-touch);
    background: rgba(255, 255, 255, 0.07);
    color: var(--mani-color-text);
    border: 1px solid var(--mani-color-hairline-strong);
    border-radius: var(--mani-radius-control);
    padding: 12px;
    font-size: 14px;
    font-family: inherit;
    resize: none;
    line-height: 1.5;
    outline: none;
    max-height: 240px;
  }
  textarea:focus { border-color: rgba(10, 132, 255, 0.72); box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.16); }
  textarea:disabled { opacity: 0.6; }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 8px;
  }
  .tier {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--mani-color-text-muted);
  }
  .tier label {
    min-height: 32px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-radius: var(--mani-radius-pill);
    cursor: pointer;
  }
  .tier label:hover { background: rgba(255, 255, 255, 0.06); }
  button {
    min-height: var(--mani-size-touch);
    background: var(--mani-color-accent);
    color: #ffffff;
    border: 1px solid var(--mani-color-accent);
    border-radius: var(--mani-radius-pill);
    padding: 8px 18px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
  }
  button:hover:not(:disabled) { background: var(--mani-color-accent-hover); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (max-width: 560px) {
    .composer { padding: 8px 10px calc(10px + env(safe-area-inset-bottom)); }
    .bar { align-items: stretch; }
    .tier { flex: 1 1 auto; }
    button { flex: 0 0 auto; padding-inline: 16px; }
  }
</style>
