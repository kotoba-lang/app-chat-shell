// LLM 補助レイヤ (任意・上乗せ)。
//
// 役割は「自由文 → カタログ品目候補」の精度向上のみ。正規化・手数料計算・検証には
// 一切関与しない (それらは決定論的コードが担う)。バックエンド(/lg)が無い/失敗しても
// 必ず matchItems() のキーワード照合へフォールバックするため、ウィザードは単体で
// 完結して動作する。
//
// 既存 chat-shell の LangGraph プロキシ (/lg/runs/stream, assistant_id="agent_chat")
// を再利用する。新規グラフのデプロイは不要。

import { SODAI_CATALOG, matchItems, type SodaiItem, type MatchResult } from "./fee-table";

const CATALOG_FOR_PROMPT = SODAI_CATALOG.map(
  (i) => `${i.id}: ${i.name} (${i.feeYen}円)`,
).join("\n");

function buildPrompt(freeText: string): string {
  return [
    "あなたは渋谷区の粗大ごみ申請を手伝うアシスタントです。",
    "次のカタログから、ユーザーが捨てたい品目に最も合うものの id を選んでください。",
    "出力は JSON 配列のみ (例: [\"sofa2\",\"microwave\"])。該当なしは []。説明文は不要。",
    "",
    "# カタログ",
    CATALOG_FOR_PROMPT,
    "",
    "# ユーザーの入力",
    freeText,
  ].join("\n");
}

function parseIds(reply: string): string[] {
  // 返信から最初の JSON 配列を抜き出す。
  const m = reply.match(/\[[\s\S]*?\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    if (Array.isArray(arr)) return arr.filter((x): x is string => typeof x === "string");
  } catch {
    /* fallthrough */
  }
  return [];
}

async function callAgentChat(prompt: string, signal: AbortSignal): Promise<string> {
  const resp = await fetch("/lg/runs/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    signal,
    body: JSON.stringify({
      assistant_id: "agent_chat",
      input: { message: prompt, history: [] },
      config: { configurable: { tier: "fast", ephemeral: true } },
      stream_mode: "values",
    }),
  });
  if (!resp.body) throw new Error("no body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
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
        const payload = JSON.parse(line.slice(5).trim());
        if (payload?.event === "values" && typeof payload.data?.reply === "string") {
          reply = payload.data.reply;
        }
      } catch {
        /* skip malformed */
      }
    }
  }
  return reply;
}

/**
 * 自由文から品目候補を返す。LLM が使えれば候補精度を上げ、使えなければ
 * 即座にキーワード照合へフォールバックする。常に何らかの結果を返す。
 * @param timeoutMs LLM 応答待ちの上限。超過でフォールバック。
 */
export async function suggestItems(
  freeText: string,
  timeoutMs = 6000,
): Promise<MatchResult & { source: "llm" | "keyword" }> {
  const keyword = matchItems(freeText);
  // 収集対象外検知や明確なキーワード一致はそのまま採用 (LLM 不要)。
  if (keyword.nonAccepted) return { ...keyword, source: "keyword" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const reply = await callAgentChat(buildPrompt(freeText), controller.signal);
    const ids = parseIds(reply);
    const byId = new Map(SODAI_CATALOG.map((i) => [i.id, i]));
    const llmItems = ids
      .map((id) => byId.get(id))
      .filter((x): x is SodaiItem => x != null);
    if (llmItems.length > 0) {
      // LLM 候補を優先しつつキーワード候補で補完 (重複排除)。
      const seen = new Set(llmItems.map((i) => i.id));
      const merged = [...llmItems, ...keyword.candidates.filter((i) => !seen.has(i.id))];
      return { candidates: merged, source: "llm" };
    }
  } catch {
    /* fall through to keyword */
  } finally {
    clearTimeout(timer);
  }
  return { ...keyword, source: "keyword" };
}
