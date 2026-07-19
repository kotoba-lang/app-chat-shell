"""Tests for the local patchright+LangGraph HITL runner (scripts/sodai_browser.py).

- Graph machinery (discover / prefill-HITL / captcha) is tested with a FAKE
  controller — no real browser, fully deterministic, verifies interrupt/resume
  and that we never auto-submit.
- A gated real-patchright smoke (SODAI_BROWSER_E2E=1) proves the engine actually
  launches + fills, against an in-memory mock form (no gov site, headless).
"""

import os

import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command

import scripts.sodai_browser as sb


class FakeController:
    def __init__(self, captcha: bool = False) -> None:
        self._captcha = captcha
        self.filled_called = False

    def goto(self, url: str) -> None:
        pass

    def detect_captcha(self) -> bool:
        return self._captcha

    def discover(self) -> list[dict]:
        return [{"tag": "input", "name": "applicantName", "type": "text"}]

    def fill_fields(self, app: dict, field_map: dict) -> list[dict]:
        self.filled_called = True
        return [{"field": "name", "selector": "#name", "value": app.get("name", ""), "ok": True}]

    def screenshot(self, path: str) -> str:
        return path

    def close(self) -> None:
        pass


def _compiled():
    return sb.build_graph().compile(checkpointer=MemorySaver())


def test_discover_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sb, "_controller", FakeController())
    g = _compiled()
    r = g.invoke({"application": {}, "mode": "discover", "ward_url": "http://x"},
                 config={"configurable": {"thread_id": "t1"}})
    assert r["status"] == "ok"
    assert r["discovered"] and r["discovered"][0]["name"] == "applicantName"
    assert "__interrupt__" not in r  # discover never needs a human


def test_prefill_pauses_for_human_then_completes_without_submit(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeController()
    monkeypatch.setattr(sb, "_controller", fake)
    g = _compiled()
    cfg = {"configurable": {"thread_id": "t2"}}

    r = g.invoke({"application": {"name": "渋谷　太郎"}, "mode": "prefill", "ward_url": "http://x"}, config=cfg)
    assert fake.filled_called
    assert r.get("__interrupt__"), "should pause for human review"
    payload = r["__interrupt__"][0].value
    assert payload["type"] == "review"
    assert payload["filled"]  # human is shown what was filled

    # resume = human finished review; graph completes WITHOUT auto-submitting
    r2 = g.invoke(Command(resume="continue"), config=cfg)
    assert r2["status"] == "ok"
    assert "__interrupt__" not in r2


def test_captcha_is_handed_to_human_first(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeController(captcha=True)
    monkeypatch.setattr(sb, "_controller", fake)
    g = _compiled()
    cfg = {"configurable": {"thread_id": "t3"}}

    r = g.invoke({"application": {"name": "x"}, "mode": "prefill", "ward_url": "http://x"}, config=cfg)
    assert r["__interrupt__"][0].value["type"] == "captcha"  # human solves CAPTCHA, not us

    r2 = g.invoke(Command(resume="continue"), config=cfg)  # → fill → review gate
    assert r2["__interrupt__"][0].value["type"] == "review"

    r3 = g.invoke(Command(resume="continue"), config=cfg)
    assert r3["status"] == "ok"


def test_navigation_error_ends_gracefully(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeController()
    monkeypatch.setattr(fake, "goto", lambda url: (_ for _ in ()).throw(RuntimeError("boom")))
    monkeypatch.setattr(sb, "_controller", fake)
    g = _compiled()
    r = g.invoke({"application": {}, "mode": "prefill", "ward_url": "http://x"},
                 config={"configurable": {"thread_id": "t4"}})
    assert r["status"] == "error"
    assert "__interrupt__" not in r


@pytest.mark.skipif(os.environ.get("SODAI_BROWSER_E2E") != "1",
                    reason="set SODAI_BROWSER_E2E=1 to run the real patchright engine smoke")
def test_patchright_engine_smoke() -> None:
    """Real patchright launch + discover + fill against an in-memory mock form."""
    from lg_chat.sodai_fields import load_field_map

    ctrl = sb.BrowserController()
    ctrl.open(headless=True, channel=None)  # patchright-bundled chromium
    try:
        ctrl.page.set_content(
            "<form>"
            "<input name='applicantName'><input name='nameKana'>"
            "<input name='zipCode'><input name='address'>"
            "<input name='tel'><input type='email'>"
            "</form>"
        )
        fields = ctrl.discover()
        assert any(f["name"] == "applicantName" for f in fields)

        filled = ctrl.fill_fields(
            {"name": "渋谷　太郎", "nameKana": "シブヤ　タロウ", "postal": "150-8010",
             "address": "渋谷区宇田川町１－１", "phone": "0312345678", "email": "a@b.jp"},
            load_field_map(),
        )
        ok_fields = {f["field"] for f in filled if f["ok"]}
        assert {"name", "phone", "email"} <= ok_fields

        # confirm the value really landed in the DOM
        assert ctrl.page.eval_on_selector("input[name='tel']", "e => e.value") == "0312345678"
    finally:
        ctrl.close()
