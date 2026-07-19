"""渋谷区 粗大ごみ 公式フォーム — ローカル半自動入力ランナー (patchright + LangGraph)。

Genspark 型: **あなたの Mac 上の実 Chrome** をステルス操作し、自動入力できる所は
自動・**CAPTCHA / 規約同意 / 必要な遷移 / 最終送信は人間**が対応する。

なぜローカル+patchright か:
  - 公式サイトは datacenter / automation 検知でブロックするが、あなたの住宅回線・
    実ブラウザからは到達できる (普通タブで開ける、と確認済み)。
  - patchright = ステルス改造 Playwright (CDPリーク等を潰す)。検知を回避。
  - LangGraph `interrupt()` で人間ゲートを明示的に挿入し、resume で続行。

安全境界 (不変条件):
  - 送信ボタン・規約同意チェック・CAPTCHA は **自動で押さない/解かない**。
    すべて human_* ノードの interrupt() で人間に渡す。
  - 既定は入力のみ。送信は人間が実ウィンドウで行う。

使い方 (あなたの Mac で):
  cd 60-apps/etzhayyim-chat-shell/lg
  uv run --extra browser patchright install chrome   # 初回のみ (or 'chromium')
  # 1) フォーム構造の偵察 (多段か・実セレクタは何か):
  uv run --extra browser python scripts/sodai_browser.py --mode discover
  # 2) 申請内容を自動入力 (要所で停止→あなたが対応):
  uv run --extra browser python scripts/sodai_browser.py --mode prefill --application app.json

  既存の自分の Chrome に繋ぐ場合 (最強ステルス):
  # Chrome を起動: open -a "Google Chrome" --args --remote-debugging-port=9222
  uv run --extra browser python scripts/sodai_browser.py --mode prefill --cdp http://localhost:9222 --application app.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any, TypedDict

# scripts/ から直接実行されたとき lg_chat を import できるよう lg/ を sys.path へ。
_LG_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _LG_ROOT not in sys.path:
    sys.path.insert(0, _LG_ROOT)

from langgraph.checkpoint.memory import MemorySaver  # noqa: E402
from langgraph.graph import END, START, StateGraph  # noqa: E402
from langgraph.types import Command, interrupt  # noqa: E402

from lg_chat.sodai_fields import CAPTCHA_MARKERS, RECEPTION_URL, load_field_map  # noqa: E402

# 既定受付URL = shibuya actor 境界 (sodai_fields.RECEPTION_URL)。
_DEFAULT_WARD_URL = os.environ.get("SODAI_WARD_URL", RECEPTION_URL)
_NAV_TIMEOUT_MS = int(os.environ.get("SODAI_NAV_TIMEOUT_MS", "45000"))


# ── Browser controller (patchright, sync) ────────────────────────────────
# グラフ state に入れない (シリアライズ不能 & interrupt をまたいで生存させたい)。
# プロセス (CLI) が lifecycle を所有し、ノードは module-global 経由で操作する。


class BrowserController:
    def __init__(self) -> None:
        self._pw: Any = None
        self._ctx: Any = None
        self._browser: Any = None
        self._launched = False  # True=自前起動 (close で閉じる) / False=CDP接続 (閉じない)
        self.page: Any = None

    def open(
        self,
        *,
        cdp_url: str | None = None,
        profile_dir: str | None = None,
        headless: bool = False,
        channel: str | None = "chrome",
        slow_mo: int = 0,
    ) -> None:
        from patchright.sync_api import sync_playwright

        self._pw = sync_playwright().start()
        if cdp_url:
            # 既存の実 Chrome に接続 (あなたのプロファイル/セッション/IP をそのまま)。
            self._browser = self._pw.chromium.connect_over_cdp(cdp_url)
            ctx = self._browser.contexts[0] if self._browser.contexts else self._browser.new_context()
            self._ctx = ctx
            self.page = ctx.pages[0] if ctx.pages else ctx.new_page()
            self._launched = False
        else:
            # 専用プロファイルの実 Chrome をステルス起動。slow_mo で操作が目で追える。
            kwargs: dict[str, Any] = {
                "user_data_dir": profile_dir or os.path.join(_LG_ROOT, ".sodai-chrome-profile"),
                "headless": headless,
                "locale": "ja-JP",
                "slow_mo": slow_mo,
            }
            if channel:
                kwargs["channel"] = channel
            self._ctx = self._pw.chromium.launch_persistent_context(**kwargs)
            self.page = self._ctx.pages[0] if self._ctx.pages else self._ctx.new_page()
            self._launched = True

    def goto(self, url: str) -> None:
        self.page.goto(url, wait_until="domcontentloaded", timeout=_NAV_TIMEOUT_MS)
        try:
            self.page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            pass  # SPA は idle にならないことがある

    def detect_captcha(self) -> bool:
        try:
            html = self.page.content().lower()
        except Exception:
            return False
        return any(m.lower() in html for m in CAPTCHA_MARKERS)

    def discover(self) -> list[dict[str, Any]]:
        return self.page.eval_on_selector_all(
            "input, select, textarea",
            """els => els.map(e => ({
                tag: e.tagName.toLowerCase(),
                type: e.getAttribute('type') || '',
                name: e.getAttribute('name') || '',
                id: e.id || '',
                placeholder: e.getAttribute('placeholder') || '',
                ariaLabel: e.getAttribute('aria-label') || '',
                visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length),
            }))""",
        )

    def fill_fields(
        self,
        app: dict[str, Any],
        field_map: dict[str, list[str]],
        *,
        highlight: bool = True,
    ) -> list[dict[str, Any]]:
        filled: list[dict[str, Any]] = []
        for key, selectors in field_map.items():
            value = str(app.get(key) or "").strip()
            if not value:
                continue
            ok, used = False, ""
            for sel in selectors:
                try:
                    el = self.page.query_selector(sel)
                    if el and el.is_visible():
                        if highlight:
                            # 操作を目で追えるよう、対象を画面中央へ＋緑枠で点灯。
                            el.evaluate(
                                "e => { e.scrollIntoView({block:'center'});"
                                " e.style.outline='3px solid #22c55e';"
                                " e.style.transition='outline .2s'; }"
                            )
                        el.fill(value)
                        ok, used = True, sel
                        break
                except Exception:
                    continue
            mark = "✓" if ok else "✗"
            print(f"  [fill] {mark} {key} → {value}" + (f"  ({used})" if used else "  (該当欄なし)"))
            filled.append({"field": key, "selector": used, "value": value, "ok": ok})
        return filled

    def screenshot(self, path: str) -> str:
        try:
            self.page.screenshot(path=path, full_page=True)
            return path
        except Exception:
            return ""

    def close(self) -> None:
        try:
            if self._launched and self._ctx:
                self._ctx.close()
        finally:
            if self._pw:
                self._pw.stop()


# module-global. テストではフェイクに差し替えられる。
_controller: BrowserController = BrowserController()


# ── LangGraph graph (HITL via interrupt) ─────────────────────────────────


class _State(TypedDict, total=False):
    application: dict[str, Any]
    mode: str  # discover | prefill
    ward_url: str
    captcha: bool
    discovered: list[dict[str, Any]]
    filled: list[dict[str, Any]]
    screenshot_path: str
    status: str
    error: str


def _node_open(state: _State) -> dict[str, Any]:
    url = str(state.get("ward_url") or _DEFAULT_WARD_URL)
    print(f"▶ フォームを開いています: {url}")
    try:
        _controller.goto(url)
    except Exception as exc:  # noqa: BLE001
        print(f"✗ ナビゲーション失敗: {type(exc).__name__}")
        return {"status": "error", "error": f"navigation failed: {type(exc).__name__}: {exc!s}"[:300]}
    captcha = _controller.detect_captcha()
    print("▶ ページ読み込み完了" + ("（CAPTCHA検知）" if captcha else ""))
    return {"captcha": captcha, "status": "open"}


def _node_discover(state: _State) -> dict[str, Any]:
    print("▶ フォーム構造を調査中 (input/select/textarea を列挙)…")
    fields = _controller.discover()
    shot = _controller.screenshot(os.path.join(_LG_ROOT, "scripts", "sodai_discover.png"))
    print(f"▶ {len(fields)} 個の入力要素を検出。スクショ: {shot}")
    return {"discovered": fields, "screenshot_path": shot, "status": "ok"}


def _node_human_captcha(_state: _State) -> dict[str, Any]:
    interrupt({
        "type": "captcha",
        "instruction": "CAPTCHA/ロボット認証が表示されています。ブラウザで認証を完了してから続行してください（自動では解きません）。",
    })
    # resume 後: captcha は解かれた前提で続行。
    return {"captcha": False}


def _node_fill(state: _State) -> dict[str, Any]:
    if state.get("status") == "error":
        return {}
    app = state.get("application") or {}
    print("▶ 正規化済みデータを自動入力中（緑枠＝入力した欄）…")
    filled = _controller.fill_fields(app, load_field_map())
    shot = _controller.screenshot(os.path.join(_LG_ROOT, "scripts", "sodai_prefill.png"))
    return {"filled": filled, "screenshot_path": shot, "status": "filled"}


def _node_human_review(state: _State) -> dict[str, Any]:
    interrupt({
        "type": "review",
        "instruction": (
            "現在のページに自動入力しました。内容を確認し、必要な追加入力・"
            "次ステップへの遷移・規約同意・最終送信は、表示中のブラウザであなたが行ってください。"
        ),
        "filled": state.get("filled") or [],
        "screenshot": state.get("screenshot_path") or "",
    })
    return {"status": "ok"}


def _route_after_open(state: _State) -> str:
    if state.get("status") == "error":
        return END
    if (state.get("mode") or "prefill") == "discover":
        return "discover"
    if state.get("captcha"):
        return "human_captcha"
    return "fill"


def build_graph() -> StateGraph:
    g: StateGraph = StateGraph(_State)
    g.add_node("open", _node_open)
    g.add_node("discover", _node_discover)
    g.add_node("human_captcha", _node_human_captcha)
    g.add_node("fill", _node_fill)
    g.add_node("human_review", _node_human_review)

    g.add_edge(START, "open")
    g.add_conditional_edges("open", _route_after_open, {
        "discover": "discover", "human_captcha": "human_captcha", "fill": "fill", END: END,
    })
    g.add_edge("discover", END)
    g.add_edge("human_captcha", "fill")
    g.add_edge("fill", "human_review")
    g.add_edge("human_review", END)
    return g


# ── CLI (interrupt-resume loop + browser lifecycle) ──────────────────────


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="渋谷区 粗大ごみ ローカル半自動入力 (patchright+LangGraph)")
    p.add_argument("--mode", choices=["discover", "prefill"], default="prefill")
    p.add_argument("--application", help="正規化済み申請JSONのパス (prefill 時)")
    p.add_argument("--url", default=_DEFAULT_WARD_URL, help="受付フォームURL")
    p.add_argument("--cdp", help="既存Chromeに接続 (例 http://localhost:9222)")
    p.add_argument("--profile-dir", help="自前起動時の Chrome プロファイルディレクトリ")
    p.add_argument("--channel", default="chrome", help="ブラウザchannel (chrome|msedge|空でpatchright同梱)")
    p.add_argument("--headless", action="store_true", help="ヘッドレス (HITLには非推奨)")
    p.add_argument("--slow-mo", type=int, default=400,
                   help="各操作をms単位で遅延させ目で追えるようにする (既定400ms、0で無効)")
    p.add_argument("--keep-open", action="store_true", help="終了後もブラウザを閉じない")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    application: dict[str, Any] = {}
    if args.application:
        with open(args.application, encoding="utf-8") as f:
            application = json.load(f)

    print(f"▶ ブラウザ起動 (mode={args.mode}, "
          f"{'CDP接続 ' + args.cdp if args.cdp else 'channel=' + (args.channel or 'patchright同梱')}, "
          f"slow_mo={args.slow_mo}ms)")
    _controller.open(
        cdp_url=args.cdp,
        profile_dir=args.profile_dir,
        headless=args.headless,
        channel=(args.channel or None),
        slow_mo=args.slow_mo,
    )

    compiled = build_graph().compile(checkpointer=MemorySaver())
    config = {"configurable": {"thread_id": "sodai-local"}}
    state: _State = {"application": application, "mode": args.mode, "ward_url": args.url}

    try:
        result = compiled.invoke(state, config=config)
        while result.get("__interrupt__"):
            payload = result["__interrupt__"][0].value
            print("\n" + "=" * 60)
            print("⏸  人間の対応が必要です:")
            print("   " + str(payload.get("instruction", "")))
            if payload.get("filled"):
                print("   自動入力した項目:")
                for f in payload["filled"]:
                    mark = "✓" if f.get("ok") else "✗"
                    print(f"     {mark} {f.get('field')}: {f.get('value')}")
            if payload.get("screenshot"):
                print(f"   スクショ: {payload['screenshot']}")
            print("=" * 60)
            input("対応が終わったら Enter を押してください... ")
            result = compiled.invoke(Command(resume="continue"), config=config)

        print("\n結果:", json.dumps(
            {k: v for k, v in result.items()
             if k in ("status", "error", "discovered", "filled", "screenshot_path")},
            ensure_ascii=False, indent=2, default=str,
        ))
        return 0 if result.get("status") in ("ok", "filled") else 1
    finally:
        if not args.keep_open:
            _controller.close()


if __name__ == "__main__":
    raise SystemExit(main())
