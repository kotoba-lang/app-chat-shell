# lg-chat — LangGraph Server for chat.etzhayyim.com

**Sprint 1 (2026-05-23)** — ephemeral-only FastAPI LangGraph server.
All sessions are stateless on the server side; history lives in browser
IndexedDB (AES-256-GCM, ADR-2605230000).

Graphs registered (`langgraph.json`): `agent_chat` (general assistant),
`sodai_submit` (渋谷区粗大ごみ公式フォーム自動入力 / browser use).

## sodai_submit graph (browser use, 2026-05-31)

`SodaiWizard.svelte` の正規化済み申請JSONを受け、Playwright で公式受付フォーム
(`sodai.tokyokankyo.or.jp`) を自動入力する。`/lg/runs/stream` を
`assistant_id="sodai_submit"` で叩く。**最終送信は人間ゲート。**

| 不変条件 | 実装 |
|---|---|
| 既定 (prefill) は送信しない | mode=`discover`/`prefill`/`submit`。submit 以外は入力＋スクショのみ |
| 送信は二重ゲート | `mode=="submit"` AND `human_approved` AND env `SODAI_ALLOW_SUBMIT=="1"` |
| CAPTCHA は突破しない | `_CAPTCHA_MARKERS` 検知で即中断 (`status="captcha"`) |
| セレクタは校正必須 | `_DEFAULT_FIELD_MAP` は当て推量。env `SODAI_FIELD_MAP`(JSON) で上書き。`mode="discover"` で実フォームの input を列挙 |

**現状 (2026-05-31): 未デプロイ・未配線・実証なし。** scaffold + テスト (9件) のみ。
回帰リスクなし (playwright は遅延 import、未導入 pod でも起動し agent_chat は無傷)。
フロント (`SodaiWizard.svelte`) からの呼び出しボタンは**撤去済み** — 下記の到達性
ブロックのため。

**到達性偵察の結論 (2026-05-31, `scripts/sodai_recon.py`):**
`sodai.tokyokankyo.or.jp` は **自動化コンテキストから接続不可**。
- WebFetch → `ECONNREFUSED`
- ユーザーの実 Chrome (Chrome MCP) → ブラウザ接続エラーページ (index/直リンク両方)
- 住民の通常ブラウザからは到達可 (バリデーション失敗のみ) ＝ **データセンタIP/proxy/bot WAF ブロック**の疑い

→ **Vultr pod (データセンタIP) はさらに弾かれやすい。pod ビルドは接続拒否の壁にほぼ確実に当たるため未着手。** 接続拒否はセレクタ校正でも多段対応でも解決しない。

**運用要件 (将来、到達性が解決した場合):** pod イメージに playwright が必要。
`pyproject.toml [browser]` extra ＋ Dockerfile に `playwright install --with-deps chromium`。
本番投入前に `mode="discover"` で疎通＋セレクタ校正。
**代替案 B (推奨度高):** サーバ pod ではなく、住民の到達可能なブラウザ内で動く
クライアント側スクリプト (ブックマークレット/拡張) にすれば接続ブロックを回避できる。

## sodai_browser — ローカル半自動入力ランナー (patchright + LangGraph, 2026-05-31)

到達性ブロックは **automation 検知**（住民の通常タブでは開ける）と確定したため、
pod ではなく **ユーザーの Mac 上の実 Chrome をステルス操作** する Genspark 型に切替。

- 実装: `scripts/sodai_browser.py`（patchright sync + LangGraph `interrupt()`）
- field-map / CAPTCHA マーカー / **shibuya actor 境界** の SSoT: `lg_chat/sodai_fields.py`
  （`sodai_submit` graph と共有 / フロントは `svelte/src/lib/sodai/ward.ts`）
- **shibuya actor 境界 (lightweight, chat.etzhayyim.com 同居)**: 区固有値を ward プロファイルに集約。
  actorDid=`did:web:etzhayyim.com:actor:shibuya` / nsidPrefix=`ai.etzhayyim.apps.shibuya`（chat 一般と分離・**宣言のみ、DID live登録は未実施**）。非公式ディスクレーマ表示。`WARD`/`RECEPTION_URL` 差替が多区化の seam
- ブラウザは **patchright**（ステルス改造 Playwright、CDPリーク等を除去）。実 Chrome 起動 or 既存 Chrome に `--remote-debugging-port` で CDP 接続。
- グラフ: `open → (discover | fill) → human_*(interrupt) → END`。ブラウザは graph state に入れず module-global (`_controller`) でプロセスが lifecycle を所有 → interrupt をまたいで生存。
- **安全境界（不変）**: 送信ボタン・規約同意・CAPTCHA は自動で押さない/解かない。すべて `human_captcha` / `human_review` の `interrupt()` で人間に渡す。既定は入力のみ。

```bash
cd 60-apps/etzhayyim-chat-shell/lg
uv run --extra browser patchright install chrome   # 初回 (or chromium)
# 偵察 (多段か・実セレクタ列挙):
uv run --extra browser python scripts/sodai_browser.py --mode discover
# 自動入力 (要所で停止→人間):
uv run --extra browser python scripts/sodai_browser.py --mode prefill --application scripts/app.example.json
# 既存Chromeに接続 (最強ステルス):
#   open -a "Google Chrome" --args --remote-debugging-port=9222
uv run --extra browser python scripts/sodai_browser.py --mode prefill --cdp http://localhost:9222 --application scripts/app.example.json
```

テスト 14件合格（うち `SODAI_BROWSER_E2E=1` で patchright 実起動→mockフォーム discover/fill を実証）。
**未検証は実 gov サイトのみ**（このサンドボックスは当該ホストにDNS到達不可。ユーザーの Mac で `--mode discover` から要疎通確認＋セレクタ校正）。

---
**pod 版 `sodai_submit` は据え置き**（未デプロイ・データセンタIPブロックのため非推奨）。
**正規化＋下書き生成ウィザードは本番ライブ**（最も確実な既定経路）。ローカルランナーは
その上の「自動入力アシスト」レイヤ。

## Why this exists

Protocol mismatch identified 2026-05-23:
- `ChatPanel.svelte` POSTs to `/lg/runs/stream` (LangGraph Server SSE format)
- CF Worker proxies `/lg/*` → `chat-agent.etzhayyim.com` (CF Tunnel)
- The deployed pod (`mitama-chat-pool/chat-agent`) only served `/api/chat`
  (old aiohttp format) — no `/runs/stream` endpoint

This module is a **standalone OSS reimplementation** of the LangGraph Server
Cloud API surface (same pattern as `lg_shinshi/server.py`) with 6 tools
ported from the archived `kotodama.primitives.chat` module.

## Layout

```
lg/
├── langgraph.json          # graph manifest (agent_chat only, no crons)
├── pyproject.toml          # fastapi + uvicorn + langgraph + httpx + psycopg
├── Dockerfile              # FROM python:3.11-slim, no kotodama dep
├── lg_chat/
│   ├── __init__.py
│   ├── tools.py            # 6 tools: code_exec, image_gen, file_save,
│   │                       #          rag_search, web_search, schedule_report
│   ├── server.py           # FastAPI: POST /runs, POST /runs/stream, GET /ok /health
│   └── graphs/
│       ├── __init__.py
│       └── agent_chat.py   # ReAct loop (prepare → llm → route → tools | END)
└── tests/
    └── test_smoke.py       # 4 smoke tests (no network/LLM key required)
```

## Topology (live as of 2026-05-25)

```
ChatPanel.svelte  →  POST /lg/runs/stream
  CF Worker (chat.etzhayyim.com CF Worker)
    /lg/*  →  CF Tunnel chat-agent.etzhayyim.com (cedba8e6, remote_config v7)
                  lg-chat pod (mitama-udf, image 0.1.2-amd64)
                    FastAPI server.py
                      agent_chat GRAPH (LangGraph)
                        keiei-litellm (Gemma 4 E4B-it, model=gemma-4-E4B-it)
                          tools (code_exec / web_search / ...)
```

## Phase status

| Phase | Status | Scope |
|---|---|---|
| **Sprint 1** scaffold (server + graph + 6 tools) | ✅ 2026-05-23 | All files in this dir |
| **Sprint 1** Helm chart `lg-chat-pool` | ✅ 2026-05-23 | `50-infra/vultr/lg-chat-pool/` |
| **Sprint 1** Docker image build + push | ✅ 2026-05-25 | `ghcr.io/etzhayyim/lg-chat:0.1.2-amd64` |
| **Sprint 1** `helm install lg-chat-pool` | ✅ 2026-05-25 | mitama-udf namespace (revision 4) |
| **Sprint 1** CF Tunnel update | ✅ 2026-05-25 | `chat-agent.etzhayyim.com` → `lg-chat.mitama-udf.svc:8000` (remote config v7) |
| **Sprint 1** Smoke test in prod (curl /ok) | ✅ 2026-05-25 | HTTP 200, SSE reply verified |
| **Sprint 2** RW checkpointer (Pro-tier threads) | ⏳ | `_RwAsyncPostgresSaver`, ADR-2605082100 |
| **Sprint 2** Per-tool UI (code blocks, image previews, chips) | ⏳ | `MessageList.svelte` |
| **Sprint 3** ComfyUI image_gen (enable when COMFYUI_URL set) | ⏳ | SD 1.5 checkpoint + Helm value |

## Open work

| # | Item | Status |
|---|---|---|
| 1 | `kubectl scale deployment chat-agent --replicas=0 -n mitama-udf` after 48h green | ⏳ gated on operator OK |
| 2 | Sprint 2: wire `_RwAsyncPostgresSaver` checkpointer for Pro-tier persistent threads | ⏳ |

## Deployment notes (2026-05-25)

- **Image**: `ghcr.io/etzhayyim/lg-chat:0.1.2-amd64` (fixes: `response_model=None`, keiei-litellm URL, model name case)
- **Model name**: `gemma-4-E4B-it` — keiei-litellm model IDs are case-sensitive (`E4B` not `e4b`)
- **CF Tunnel remote config v7**: `chat-agent.etzhayyim.com` is first ingress rule in tunnel `cedba8e6`; cloudflared must be restarted to pick up remote config changes
- **DNS CNAME**: `chat-agent.etzhayyim.com` → `cedba8e6-8210-4de2-9859-ccf5f80b0cce.cfargotunnel.com` (proxied)

## Prerequisite secrets (mitama-udf namespace)

All secrets are `optional: true` — missing secret = tool disabled, not crash.

| Secret name | Key | Tool |
|---|---|---|
| `keiei-llm-api-key` | `MURAKUMO_API_KEY` | LLM (required for replies) |
| `brave-search-key` | `WEB_SEARCH_KEY` | web_search |
| `b2-creds` | `B2_S3_ENDPOINT`, `B2_ACCESS_KEY_ID`, `B2_SECRET_ACCESS_KEY` | file_save |
| `mitama-udf-pool-rw` | `RW_URL` | rag_search |
| `bpmn-dispatcher-auth` | `internal-secret` | schedule_report |

## Key differences from lg-shinshi

| | lg-shinshi | lg-chat |
|---|---|---|
| kotodama dep | Yes (primitives reuse) | **No** — standalone |
| Checkpointer | `_RwAsyncPostgresSaver` (Sprint 2 ready) | None (Sprint 1 ephemeral) |
| LangGraph Server | Yes (platform binary) | **FastAPI OSS reimpl** (no license) |
| LLM | keiei-litellm Gemma 4 E4B-it | keiei-litellm Gemma 4 E4B-it |
| Tool loop | N/A (scene/render pipelines) | ReAct (prepare → llm → route → tools) |
| History storage | RW checkpointer | Browser IndexedDB (ADR-2605230000) |

## Architecture note (Sprint 1 — ephemeral)

`config.configurable.ephemeral: true` in the request body causes
`graph.with_config({"checkpointer": None})` on the server side.
History is NOT persisted server-side. The browser sends the full
`history` array with each request (see `ChatPanel.svelte:send()`).

Sprint 2 will wire `_RwAsyncPostgresSaver` (same pattern as lg-shinshi
checkpointer.py) for Pro-tier persistent threads.
