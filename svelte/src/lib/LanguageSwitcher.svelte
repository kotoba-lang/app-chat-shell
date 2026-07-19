<script lang="ts">
  import { locales, getLocale, setLocale, baseLocale } from "../paraglide/runtime.js";
  import { m } from "../paraglide/messages.js";

  const labels: Record<string, string> = {
    "ja": "日本語",
    "en": "English",
    "zh-CN": "中文",
    "ko": "한국어",
  };

  type Locale = (typeof locales)[number];
  let current = $state<Locale>((getLocale() || baseLocale) as Locale);

  function pick(loc: Locale) {
    current = loc;
    setLocale(loc);
  }
</script>

<div class="lang">
  <span class="label">{m.language_label()}</span>
  <select bind:value={current} onchange={() => pick(current)} aria-label="language">
    {#each locales as loc (loc)}
      <option value={loc}>{labels[loc] ?? loc}</option>
    {/each}
  </select>
</div>

<style>
  .lang {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 4px 0;
    font-size: 11px;
    color: #6b6f7c;
  }
  select {
    background: #161922;
    color: #e6e7e9;
    border: 1px solid #2f3445;
    border-radius: 6px;
    padding: 4px 6px;
    font-size: 11px;
    cursor: pointer;
  }
  select:hover { border-color: #3a405a; }
</style>
