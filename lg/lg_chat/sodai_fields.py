"""渋谷区 粗大ごみ 公式フォームの field-map / CAPTCHA マーカーの SSoT。

`graphs/sodai_submit.py` (pod 用 playwright) と `scripts/sodai_browser.py`
(ローカル patchright + HITL) の両方がここを参照する。

⚠️ セレクタは実フォーム未確認のため当て推量。`mode="discover"` で実フォームの
input を列挙し、env `SODAI_FIELD_MAP`(JSON) で正確なセレクタに上書きする。
"""

from __future__ import annotations

import json
import logging
import os

_log = logging.getLogger(__name__)

# ── shibuya actor 境界 (lightweight separation) — フロント ward.ts と対の SSoT ──
# 区固有値はここに集約。NSID/DID は chat 一般 (ai.etzhayyim.apps.chat / did:web:etzhayyim.com)
# とは分離した shibuya actor の名前空間。records/XRPC を足す際はこの prefix を使う。
WARD_CODE = "13113"
WARD_NAME = "渋谷区"
ACTOR_DID = "did:web:etzhayyim.com:actor:shibuya"
NSID_PREFIX = "ai.etzhayyim.apps.shibuya"
RECEPTION_URL = "https://sodai.tokyokankyo.or.jp/Sodai/V2Main/13113/0"

# application キー → 候補 CSS セレクタ。最初に見つかった可視要素へ入力する。
DEFAULT_FIELD_MAP: dict[str, list[str]] = {
    "name": ["input[name*='name' i]:not([name*='kana' i])", "#applicantName", "#name"],
    "nameKana": ["input[name*='kana' i]", "input[name*='furigana' i]", "#nameKana"],
    "postal": ["input[name*='zip' i]", "input[name*='post' i]", "#zipCode", "#postalCode"],
    "address": ["input[name*='addr' i]", "textarea[name*='addr' i]", "#address"],
    "building": ["input[name*='building' i]", "input[name*='tatemono' i]", "#building"],
    "phone": ["input[name*='tel' i]", "input[name*='phone' i]", "#tel", "#phone"],
    "email": ["input[type='email']", "input[name*='mail' i]", "#email"],
}

# CAPTCHA / bot 認証の検知マーカー。出たら自動操作は止め、人間に渡す (突破しない)。
CAPTCHA_MARKERS: tuple[str, ...] = (
    "recaptcha", "g-recaptcha", "hcaptcha", "h-captcha", "cf-turnstile",
    "画像認証", "ロボットではありません", "認証コードを入力",
)


def load_field_map() -> dict[str, list[str]]:
    """DEFAULT_FIELD_MAP を env SODAI_FIELD_MAP(JSON) で上書きしたものを返す。"""
    raw = os.environ.get("SODAI_FIELD_MAP", "").strip()
    if not raw:
        return {k: list(v) for k, v in DEFAULT_FIELD_MAP.items()}
    try:
        override = json.loads(raw)
        merged = {k: list(v) for k, v in DEFAULT_FIELD_MAP.items()}
        for k, v in override.items():
            merged[k] = v if isinstance(v, list) else [str(v)]
        return merged
    except (json.JSONDecodeError, TypeError):
        _log.warning("SODAI_FIELD_MAP is not valid JSON — using defaults")
        return {k: list(v) for k, v in DEFAULT_FIELD_MAP.items()}
