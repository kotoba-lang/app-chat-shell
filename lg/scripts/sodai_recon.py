"""Read-only feasibility probe for the 渋谷区 粗大ごみ official reception form.

NAVIGATION + DOM READ ONLY. Does NOT click, fill, accept terms, or submit.
Answers: (a) can headless Chromium reach it? (b) is it a multi-step wizard?
(c) what input/select/textarea + buttons/links exist on the landing page?

Run: cd lg && uv run --extra browser python scripts/sodai_recon.py
"""

from __future__ import annotations

import asyncio
import json
import sys

URL = sys.argv[1] if len(sys.argv) > 1 else (
    "https://sodai.tokyokankyo.or.jp/Sodai/V2Main/13113/0"
)
CAPTCHA_MARKERS = (
    "recaptcha", "g-recaptcha", "hcaptcha", "h-captcha", "cf-turnstile",
    "画像認証", "ロボットではありません", "認証コードを入力",
)
STEP_HINTS = ("次へ", "すすむ", "進む", "規約", "同意", "ステップ", "step", "申込", "品目を探す", "検索")


async def main() -> None:
    from playwright.async_api import async_playwright

    report: dict = {"url_requested": URL}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(
            locale="ja-JP",
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        )
        page = await ctx.new_page()
        try:
            resp = await page.goto(URL, timeout=30000, wait_until="domcontentloaded")
            report["http_status"] = resp.status if resp else None
            try:
                await page.wait_for_load_state("networkidle", timeout=15000)
            except Exception:  # noqa: BLE001
                report["networkidle"] = "timeout (SPA still busy)"
        except Exception as exc:  # noqa: BLE001
            report["navigation_error"] = f"{type(exc).__name__}: {exc!s}"[:300]
            await browser.close()
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return

        report["final_url"] = page.url
        report["title"] = await page.title()

        html = (await page.content())
        low = html.lower()
        report["captcha_detected"] = [m for m in CAPTCHA_MARKERS if m.lower() in low]
        report["html_len"] = len(html)

        report["fields"] = await page.eval_on_selector_all(
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
        report["buttons"] = await page.eval_on_selector_all(
            "button, a, input[type=submit], input[type=button]",
            """els => els.map(e => (e.innerText || e.value || '').trim())
                      .filter(t => t).slice(0, 60)""",
        )
        btn_text = " ".join(report["buttons"])
        report["step_hints_found"] = [h for h in STEP_HINTS if h in btn_text or h in html]
        report["headings"] = await page.eval_on_selector_all(
            "h1, h2, h3, legend",
            "els => els.map(e => e.innerText.trim()).filter(t => t).slice(0, 30)",
        )

        await page.screenshot(path="scripts/sodai_recon.png", full_page=True)
        report["screenshot"] = "scripts/sodai_recon.png"
        await browser.close()

    print(json.dumps(report, ensure_ascii=False, indent=2))


asyncio.run(main())
