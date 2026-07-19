# lg-chat — langgraph-clj port (ADR-2606280030)

clj/bb port of the `lg/` Python LangGraph app (`langgraph-python → langgraph-clj`).
The Python (`../lg_chat/`, `../tests/`) is **kept and unchanged** — it is the deployed
pod (`ghcr.io/etzhayyim/lg-chat`, `langgraph.json` graphs) and the `/lg` proxy target,
so this port **coexists** until the runtime is cut over. Nothing here removes or imports
the `.py`.

## What was ported

| Python | clj twin | Notes |
|---|---|---|
| `lg_chat/graphs/agent_chat.py` | `src/lg_chat/graphs/agent_chat.cljc` | StateGraph `prepare → llm → route → execute_tools → llm`; httpx→`babashka.http-client`, Murakumo loopback, `<think>` strip, iteration/history caps — 1:1 topology |
| `lg_chat/graphs/sodai_submit.py` | `src/lg_chat/graphs/sodai_submit.cljc` | `validate → drive`; validate ported 1:1; **drive degrades to `playwright_missing`** (no browser driver in bb — see deviation below) |
| `lg_chat/tools.py` (6 tools) | `src/lg_chat/tools.cljc` | code_exec/image_gen/web_search/schedule_report ported 1:1; file_save via an AWS-SigV4 signer (boto3 replacement); rag_search/web-search RW-fallback deprecated (see below) |
| `lg_chat/sodai_fields.py` | `src/lg_chat/sodai_fields.cljc` | field-map SSoT + env `SODAI_FIELD_MAP` override + CAPTCHA markers + shibuya ward constants |
| `lg_chat/server.py` | `src/lg_chat/server.cljc` | FastAPI→`org.httpkit.server`; same routes `/ok /health /health/deep /runs /runs/stream` (SSE) |
| `tests/test_smoke.py`, `tests/test_sodai_submit.py` | `tests/lg_chat/test_smoke.cljc`, `tests/lg_chat/graphs/test_sodai_submit.cljc` | `clojure.test` |

## Deviations (functionality not silently dropped)

- **sodai_submit `drive`** — the py drives a real browser via Playwright. bb ships no
  Playwright/CDP driver, so `drive` returns the SAME `status "playwright_missing"` enum
  the py emits when its browser lib is absent. Per `../CLAUDE.md` the pod graph is itself
  未デプロイ・未配線 (DC-IP/WAF-blocked); the live path is the local `scripts/sodai_browser.py`
  patchright runner (out of scope for this graph port). The discover/prefill/submit
  double-gate constants are preserved for a future browser-capable clj runtime.
- **file_save** — B2 (S3) PUT reproduced via AWS SigV4 over `babashka.http-client`. The
  credential GATE (no creds → graceful "not available") is byte-identical; the live PUT
  is unverified against B2 in the sandbox.
- **rag_search / web_search RW-fallback** — the RisingWave (psycopg) leg is NOT reproduced
  (bb has no pg driver; RisingWave is a deprecated substrate — repo rule: kotoba Datom log
  is canonical). The "falls back gracefully" contract is preserved (absent RW → graceful
  unavailable, never a crash).

## Verify

```bash
cd 60-apps/etzhayyim-chat-shell/lg/clj
bb run test          # → Ran 12 tests / 28 assertions, 0 failures
```
