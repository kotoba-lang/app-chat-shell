"""sodai_browser の動作を可視化するデモ（公式サイト不要・ローカルモック）。

patchright で実際にブラウザを起動 → モックフォームへ正規化済みデータを自動入力
（各欄を緑枠でハイライト）→ 入力済み画面のスクショを保存する。
このサンドボックスは公式サイトに到達できないため、ここでは file:// のモックで
「操作中の状態」を可視化する。実サイトはユーザーの Mac で headed 実行＝その場で見える。

実行: uv run --extra browser python scripts/sodai_demo.py
"""

from __future__ import annotations

import os

import sodai_browser as sb  # 同ディレクトリ。import 時に lg/ を sys.path へ入れる

_HERE = os.path.dirname(os.path.abspath(__file__))
MOCK = "file://" + os.path.join(_HERE, "mock_form.html")
OUT = os.path.join(_HERE, "sodai_demo_filled.png")

DEMO_APP = {
    "name": "渋谷　太郎",
    "nameKana": "シブヤ　タロウ",
    "postal": "150-8010",
    "address": "渋谷区宇田川町１－１",
    "building": "ＧＦＴＤマンション１０１",
    "phone": "0312345678",
    "email": "taro@example.com",
}


def main() -> int:
    from lg_chat.sodai_fields import load_field_map

    ctrl = sb.BrowserController()
    ctrl.open(headless=True, channel=None, slow_mo=0)  # sandbox は表示なし→headless+スクショ
    try:
        print(f"▶ モックフォームを開く: {MOCK}")
        ctrl.goto(MOCK)
        print(f"▶ CAPTCHA検知: {ctrl.detect_captcha()}")
        print("▶ 自動入力（緑枠＝入力した欄）:")
        filled = ctrl.fill_fields(DEMO_APP, load_field_map(), highlight=True)
        ctrl.screenshot(OUT)
        ok = sum(1 for f in filled if f["ok"])
        print(f"▶ 完了: {ok}/{len(filled)} 欄に入力。スクショ: {OUT}")
        print("▶ ここで実サイトなら human_review で停止 → 規約同意/送信はあなたが対応")
        return 0
    finally:
        ctrl.close()


if __name__ == "__main__":
    raise SystemExit(main())
