<script lang="ts">
  // 渋谷区 粗大ごみ申請を、会話形式でガイドするウィザード。
  // - 各入力は決定論的に正規化し、変換前→変換後を必ず提示 (全角/半角/カナの取り違えを可視化)。
  // - 品目の自由文判定は LLM 補助 (失敗時はキーワード照合へ自動フォールバック)。
  // - 最終的に「正規化済みの申請内容(下書き)」を生成し、コピーして公式受付に貼れるようにする。
  import { tick } from "svelte";
  import { normalizeField, CONVENTION_LABEL } from "./sodai/normalize";
  import { APPLICANT_FIELDS } from "./sodai/fields";
  import {
    SODAI_CATALOG,
    FEE_DISCLAIMER,
    totalFee,
    matchItems,
    type SodaiItem,
    type NonAcceptedHint,
  } from "./sodai/fee-table";
  import { suggestItems } from "./sodai/llm";
  import { WARD } from "./sodai/ward";

  const MAX_ITEMS = 10; // 粗大ごみ受付センターのインターネット申込上限
  // 区固有値は ward.ts (shibuya actor 境界) から取得。
  const OFFICIAL_URL = WARD.portalUrl;
  const CENTER_TEL = WARD.centerTel;

  type Entry =
    | { role: "assistant"; text: string }
    | { role: "system"; text: string }
    | {
        role: "user";
        label: string;
        raw: string;
        normalized: string;
        changed: boolean;
        warnings: string[];
      };

  interface ItemLine {
    item: SodaiItem;
    qty: number;
  }

  type Phase = "intro" | "items" | "applicant" | "date" | "review";

  let transcript = $state<Entry[]>([]);
  let phase = $state<Phase>("intro");
  let lines = $state<ItemLine[]>([]);

  // applicant フィールド進行
  let fieldIndex = $state(0);
  const applicant: Record<string, string> = $state({});
  let preferredDate = $state("");

  // item 入力サブ状態
  let itemQuery = $state("");
  let useLLM = $state(true);
  let searching = $state(false);
  let candidates = $state<SodaiItem[]>([]);
  let nonAccepted = $state<NonAcceptedHint | null>(null);
  let searchSource = $state<"llm" | "keyword" | null>(null);
  let pendingItem = $state<SodaiItem | null>(null);
  let pendingQty = $state(1);

  // 各 applicant 入力欄の生値
  let fieldInput = $state("");

  let scroller: HTMLDivElement | undefined = $state();
  let copied = $state(false);

  const itemCount = $derived(lines.reduce((n, l) => n + l.qty, 0));
  const feeTotal = $derived(totalFee(lines));
  const currentField = $derived(APPLICANT_FIELDS[fieldIndex]);

  async function scrollBottom() {
    await tick();
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }

  function push(entry: Entry) {
    transcript = [...transcript, entry];
    void scrollBottom();
  }

  // ── intro → items ─────────────────────────────────────
  function start() {
    push({ role: "assistant", text: `${WARD.wardName}の粗大ごみ申請を始めます。まず、捨てたい品目を教えてください。` });
    push({ role: "system", text: WARD.unofficialNotice });
    push({
      role: "system",
      text: `家電リサイクル法の対象（テレビ・冷蔵庫・洗濯機・エアコン）とパソコンは粗大ごみでは収集できません。${FEE_DISCLAIMER}`,
    });
    phase = "items";
  }

  // ── 品目検索 ──────────────────────────────────────────
  async function searchItems() {
    const q = itemQuery.trim();
    if (!q || searching) return;
    searching = true;
    candidates = [];
    nonAccepted = null;
    searchSource = null;
    try {
      if (useLLM) {
        const r = await suggestItems(q);
        candidates = r.candidates;
        nonAccepted = r.nonAccepted ?? null;
        searchSource = r.source;
      } else {
        const r = matchItems(q);
        candidates = r.candidates;
        nonAccepted = r.nonAccepted ?? null;
        searchSource = "keyword";
      }
      if (!nonAccepted && candidates.length === 0) {
        candidates = SODAI_CATALOG; // 一致なし → 全カタログから選ばせる
        searchSource = "keyword";
      }
    } finally {
      searching = false;
      void scrollBottom();
    }
  }

  function chooseItem(item: SodaiItem) {
    pendingItem = item;
    pendingQty = 1;
  }

  function confirmItem() {
    if (!pendingItem) return;
    const existing = lines.find((l) => l.item.id === pendingItem!.id);
    if (existing) existing.qty += pendingQty;
    else lines = [...lines, { item: pendingItem, qty: pendingQty }];
    push({
      role: "user",
      label: "品目",
      raw: itemQuery,
      normalized: `${pendingItem.name} ×${pendingQty}（手数料目安 ¥${(pendingItem.feeYen * pendingQty).toLocaleString()}）`,
      changed: false,
      warnings: [],
    });
    // reset 品目入力
    pendingItem = null;
    itemQuery = "";
    candidates = [];
    nonAccepted = null;
    searchSource = null;
  }

  function removeLine(id: string) {
    lines = lines.filter((l) => l.item.id !== id);
  }

  function finishItems() {
    if (lines.length === 0) return;
    push({ role: "assistant", text: "品目を承りました。次に申込者の情報をうかがいます。" });
    phase = "applicant";
    fieldIndex = 0;
    fieldInput = "";
    askField();
  }

  // ── applicant フィールド進行 ──────────────────────────
  function askField() {
    const f = APPLICANT_FIELDS[fieldIndex];
    if (!f) return;
    push({
      role: "assistant",
      text: `【${f.label}${f.required ? "" : "（任意）"}】${f.prompt}　例: ${f.example}`,
    });
  }

  function submitField() {
    const f = currentField;
    if (!f) return;
    const raw = fieldInput;
    if (f.required && raw.trim() === "") return; // 必須は空送信を無視

    if (!f.required && raw.trim() === "") {
      // 任意で空 → スキップ
      applicant[f.key] = "";
      push({ role: "user", label: f.label, raw: "(未入力)", normalized: "(未入力)", changed: false, warnings: [] });
    } else {
      const r = normalizeField(raw, f.convention);
      applicant[f.key] = r.value;
      push({ role: "user", label: f.label, raw, normalized: r.value, changed: r.changed, warnings: r.warnings });
    }
    advanceField();
  }

  function advanceField() {
    fieldInput = "";
    if (fieldIndex < APPLICANT_FIELDS.length - 1) {
      fieldIndex += 1;
      askField();
    } else {
      phase = "date";
      push({
        role: "assistant",
        text: "収集希望日があれば入力してください（任意・自由記述）。実際の収集日は受付センターが確定します。",
      });
      void scrollBottom();
    }
  }

  function submitDate() {
    preferredDate = preferredDate.trim();
    push({
      role: "user",
      label: "収集希望日",
      raw: preferredDate || "(おまかせ)",
      normalized: preferredDate || "(おまかせ)",
      changed: false,
      warnings: [],
    });
    goReview();
  }

  function goReview() {
    phase = "review";
    push({
      role: "assistant",
      text:
        "以下が申請内容（下書き）です。公式フォームの文字種に合わせて正規化しました。各項目をご確認のうえ転記してください。特に住所の番地（全角／半角）は、フォームの指定に合わせて調整が必要な場合があります。",
    });
    void scrollBottom();
  }

  // ── 申請内容(下書き)テキスト生成 ──────────────────────
  const summaryText = $derived.by(() => {
    const lns = lines
      .map(
        (l, i) =>
          `  ${i + 1}. ${l.item.name} ×${l.qty} … 目安 ¥${(l.item.feeYen * l.qty).toLocaleString()}`,
      )
      .join("\n");
    const f = (key: string) => applicant[key] || "（未入力）";
    return [
      `【${WARD.wardName} 粗大ごみ 申請内容（下書き）】`,
      "",
      `■ 申込品目（合計 ${itemCount} 点 / 手数料 目安 ¥${feeTotal.toLocaleString()}）`,
      lns,
      "",
      "■ 申込者情報",
      `  氏名　　　： ${f("name")}`,
      `  フリガナ　： ${f("nameKana")}`,
      `  郵便番号　： ${f("postal")}`,
      `  住所　　　： ${f("address")}`,
      `  建物名　　： ${f("building")}`,
      `  電話番号　： ${f("phone")}`,
      `  メール　　： ${f("email")}`,
      `  収集希望日： ${preferredDate || "おまかせ"}`,
      "",
      `※ ${FEE_DISCLAIMER}`,
      "※ 住所の番地は全角に揃えています。公式フォームが半角を求める場合は番地の数字を半角にしてください。",
      `※ 申込先: ${WARD.wardName} 粗大ごみ受付センター ☎ ${CENTER_TEL}（インターネット24時間）`,
      `※ ${WARD.unofficialNotice}`,
    ].join("\n");
  });

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summaryText);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      copied = false;
    }
  }

  function restart() {
    transcript = [];
    phase = "intro";
    lines = [];
    fieldIndex = 0;
    for (const k of Object.keys(applicant)) applicant[k] = "";
    preferredDate = "";
    itemQuery = "";
    candidates = [];
    nonAccepted = null;
    pendingItem = null;
  }

  function onFieldKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitField();
    }
  }
</script>

<div class="wizard">
  <div class="transcript" bind:this={scroller}>
    {#if transcript.length === 0}
      <div class="hero">
        <div class="badge">{WARD.wardName} 粗大ごみ申請</div>
        <h1>大文字・小文字・全角で弾かれない申請フォーム</h1>
        <p>
          会話形式で項目を入力すると、フリガナ・電話番号・住所などを
          <strong>公式受付フォームの文字種に合わせて自動で正規化</strong>します。
          変換前→変換後をその場で確認できるので、なぜ弾かれていたかも分かります。
        </p>
        <p class="fine">{FEE_DISCLAIMER}</p>
        <p class="fine unofficial">⚠️ {WARD.unofficialNotice}</p>
        <button class="primary big" onclick={start}>申請を始める</button>
      </div>
    {/if}

    {#each transcript as entry}
      {#if entry.role === "assistant"}
        <div class="bubble assistant">{entry.text}</div>
      {:else if entry.role === "system"}
        <div class="bubble system">ℹ️ {entry.text}</div>
      {:else}
        <div class="bubble user">
          <div class="u-label">{entry.label}</div>
          {#if entry.changed}
            <div class="diff">
              <span class="before">{entry.raw}</span>
              <span class="arrow">→</span>
              <span class="after">{entry.normalized}</span>
            </div>
            <div class="conv-note">✓ 公式フォーム向けに正規化しました</div>
          {:else}
            <div class="after solo">{entry.normalized}</div>
          {/if}
          {#each entry.warnings as w}
            <div class="warn">⚠️ {w}</div>
          {/each}
        </div>
      {/if}
    {/each}

    {#if phase === "review"}
      <div class="summary-card">
        <pre>{summaryText}</pre>
        <div class="summary-actions">
          <button class="primary" onclick={copySummary}>{copied ? "コピーしました ✓" : "申請内容をコピー"}</button>
          <a class="link-btn" href={OFFICIAL_URL} target="_blank" rel="noopener noreferrer">公式受付を開く</a>
          <button class="ghost" onclick={restart}>最初からやり直す</button>
        </div>
        <p class="fine">コピーした内容を渋谷区 粗大ごみ受付センターのインターネット受付に転記して申し込めます。住所の番地は全角／半角どちらをフォームが求めるか、入力欄の指定に合わせてご確認ください。</p>
      </div>
    {/if}
  </div>

  <!-- 入力エリア (phase で切り替え) -->
  <div class="dock">
    {#if phase === "items"}
      {#if pendingItem}
        <div class="qty-row">
          <span class="qty-name">{pendingItem.name}</span>
          <label>数量
            <input type="number" min="1" max="10" bind:value={pendingQty} />
          </label>
          <button class="primary" onclick={confirmItem}>追加する</button>
          <button class="ghost" onclick={() => (pendingItem = null)}>戻る</button>
        </div>
      {:else}
        <div class="search-row">
          <input
            type="text"
            placeholder="例: 二人がけのソファー / 電子レンジ / 自転車"
            bind:value={itemQuery}
            onkeydown={(e) => e.key === "Enter" && searchItems()}
          />
          <button class="primary" onclick={searchItems} disabled={searching}>
            {searching ? "判定中…" : "品目を探す"}
          </button>
        </div>
        <label class="llm-toggle">
          <input type="checkbox" bind:checked={useLLM} /> AIで品目を判定する（オフでもキーワード検索で動作）
        </label>

        {#if nonAccepted}
          <div class="non-accepted">
            🚫 <strong>{nonAccepted.label}</strong> — {nonAccepted.guidance}
          </div>
        {/if}

        {#if candidates.length > 0}
          <div class="candidates">
            {#if searchSource}<span class="src">候補（{searchSource === "llm" ? "AI判定" : "キーワード"}）:</span>{/if}
            {#each candidates as c}
              <button class="chip" onclick={() => chooseItem(c)}>
                {c.name}<span class="chip-fee">¥{c.feeYen.toLocaleString()}</span>
              </button>
            {/each}
          </div>
        {/if}

        {#if lines.length > 0}
          <div class="cart">
            <div class="cart-head">申込リスト（{itemCount}点 / 目安 ¥{feeTotal.toLocaleString()}）</div>
            {#each lines as l}
              <div class="cart-line">
                <span>{l.item.name} ×{l.qty}</span>
                <span class="cart-fee">¥{(l.item.feeYen * l.qty).toLocaleString()}</span>
                <button class="x" onclick={() => removeLine(l.item.id)} aria-label="削除">×</button>
              </div>
            {/each}
            <button class="primary next" onclick={finishItems} disabled={itemCount > MAX_ITEMS}>
              申込者情報の入力へ進む
            </button>
            {#if itemCount > MAX_ITEMS}
              <div class="warn">インターネット受付は合計{MAX_ITEMS}点までです。点数を減らすか電話({CENTER_TEL})でお申し込みください。</div>
            {/if}
          </div>
        {/if}
      {/if}
    {:else if phase === "applicant" && currentField}
      <div class="field-row">
        <span class="field-conv">{CONVENTION_LABEL[currentField.convention]}</span>
        <input
          type="text"
          placeholder={currentField.placeholder}
          bind:value={fieldInput}
          onkeydown={onFieldKeydown}
        />
        <button class="primary" onclick={submitField}>確定</button>
        {#if !currentField.required}
          <button class="ghost" onclick={submitField}>スキップ</button>
        {/if}
      </div>
    {:else if phase === "date"}
      <div class="field-row">
        <input type="text" placeholder="例: 来週の土曜以降 / 6月10日希望（任意）" bind:value={preferredDate} onkeydown={(e) => e.key === "Enter" && submitDate()} />
        <button class="primary" onclick={submitDate}>確定</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .wizard { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .transcript { flex: 1; overflow-y: auto; padding: 24px 16px; }

  .hero { max-width: 640px; margin: 6% auto 0; text-align: center; color: #c7cad2; }
  .badge {
    display: inline-block; background: #1d2230; border: 1px solid #2f3445;
    color: #8fb0ff; border-radius: 999px; padding: 4px 14px; font-size: 12px; margin-bottom: 16px;
  }
  .hero h1 { font-size: 24px; color: #f1f2f5; margin: 0 0 14px; font-weight: 650; line-height: 1.4; }
  .hero p { font-size: 14px; line-height: 1.7; margin: 0 0 12px; }
  .hero strong { color: #e6e7e9; }
  .fine { font-size: 12px; color: #8a8e99; line-height: 1.6; }
  .fine.unofficial { color: #e8b86a; margin-top: 10px; }

  .bubble { max-width: 680px; margin: 0 0 12px; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.6; }
  .bubble.assistant { background: #1d2230; border: 1px solid #2a3044; color: #e6e7e9; }
  .bubble.system { background: #15243a; border: 1px solid #24405f; color: #a9c4e8; font-size: 13px; }
  .bubble.user { background: #1a2b1f; border: 1px solid #2c4a34; color: #e6e7e9; margin-left: auto; max-width: 520px; }

  .u-label { font-size: 11px; color: #7fae8c; margin-bottom: 4px; font-weight: 600; }
  .diff { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  .before { color: #d98a8a; text-decoration: line-through; opacity: 0.8; }
  .arrow { color: #8a8e99; }
  .after { color: #9be3ab; font-weight: 600; }
  .after.solo { font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: #e6e7e9; }
  .conv-note { font-size: 11px; color: #7fae8c; margin-top: 4px; }
  .warn { font-size: 12px; color: #e8b86a; margin-top: 6px; line-height: 1.5; }

  .summary-card { max-width: 700px; background: #12151c; border: 1px solid #2a3044; border-radius: 12px; padding: 16px; margin-top: 8px; }
  .summary-card pre { white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: #dfe2e8; margin: 0 0 14px; line-height: 1.6; }
  .summary-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

  .dock { flex: 0 0 auto; border-top: 1px solid #232735; padding: 12px 16px; background: #12141a; }
  .search-row, .field-row, .qty-row { display: flex; gap: 8px; align-items: center; }
  .qty-name { font-size: 14px; color: #e6e7e9; flex: 1; }
  .field-conv { font-size: 11px; color: #8fb0ff; background: #1a2235; border: 1px solid #2a3658; border-radius: 6px; padding: 3px 8px; white-space: nowrap; }

  input[type="text"], input[type="number"] {
    background: #1b1f2a; border: 1px solid #2e3343; border-radius: 8px; color: #e6e7e9;
    padding: 9px 12px; font-size: 14px; font-family: inherit;
  }
  input[type="text"] { flex: 1; min-width: 0; }
  input[type="number"] { width: 64px; }
  label { font-size: 13px; color: #b9bcc4; display: flex; align-items: center; gap: 6px; }

  .llm-toggle { margin-top: 8px; font-size: 12px; color: #8a8e99; }

  .candidates { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; align-items: center; }
  .src { font-size: 11px; color: #8a8e99; margin-right: 4px; }
  .chip { background: #1d2230; border: 1px solid #2f3445; border-radius: 999px; color: #d7dae2; padding: 6px 12px; font-size: 13px; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
  .chip:hover { background: #252b3c; border-color: #3a4258; }
  .chip-fee { color: #8fb0ff; font-size: 11px; }

  .non-accepted { margin-top: 10px; background: #2a1618; border: 1px solid #5a2a2e; color: #f0b8bc; border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.6; }

  .cart { margin-top: 12px; background: #161922; border: 1px solid #232735; border-radius: 10px; padding: 10px 12px; }
  .cart-head { font-size: 12px; color: #b9bcc4; margin-bottom: 8px; font-weight: 600; }
  .cart-line { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #e6e7e9; padding: 3px 0; }
  .cart-line > span:first-child { flex: 1; }
  .cart-fee { color: #8fb0ff; }
  .x { background: none; border: none; color: #d98a8a; font-size: 16px; cursor: pointer; line-height: 1; padding: 0 4px; }
  .next { margin-top: 10px; width: 100%; }

  button.primary { background: #3b6cf6; border: 1px solid #3b6cf6; color: #fff; border-radius: 8px; padding: 9px 16px; font-size: 14px; cursor: pointer; font-family: inherit; }
  button.primary:hover:not(:disabled) { background: #4978ff; }
  button.primary:disabled { opacity: 0.45; cursor: default; }
  button.primary.big { font-size: 15px; padding: 11px 28px; margin-top: 8px; }
  button.ghost { background: #232735; border: 1px solid #2e3343; color: #c7cad2; border-radius: 8px; padding: 9px 14px; font-size: 13px; cursor: pointer; font-family: inherit; }
  button.ghost:hover { background: #2a3044; }
  .link-btn { background: #1d2230; border: 1px solid #2f3445; color: #8fb0ff; border-radius: 8px; padding: 9px 14px; font-size: 13px; text-decoration: none; }
  .link-btn:hover { background: #252b3c; }
</style>
