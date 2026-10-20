# app-chat-shell（CAPTCHA 非突破）— itonami（dapp）上の分散型設計

状態: 第 1 スライス実装（2026-10-20）。正本はこの文書。
追跡: Linear JUN-128（親 JUN-116）。

## 位置づけ

app-chat-shell はチャット面 + **渋谷区 粗大ごみ 公式フォームの操作**
（lg-chat の sodai_submit graph / sodai_fields）。フォームの field-map と
CAPTCHA マーカーの SSoT が `sodai_fields.cljk`。

## このスライス: CAPTCHA・境界判定コア

| 層 | 実体 | 状態 |
|---|---|---|
| 判定コア guest | `aiueos/chat_captcha.cljk` — **captcha-handoff（検知したら自動停止・人間へ、突破しない）** / fields-complete（**7 キー**: name / nameKana / postal / address / building / phone / email）/ ward-consistent（**渋谷区 13113** の境界）/ override-take（**壊れた上書きは既定へ fail-safe**） | **実装済み・実測** |
| 記述子 | `aiueos/chat-captcha.edn` | **実装済み** |
| parity | `lg/clj/tests/chat/captcha_parity_test.cljk` — 正本（sodai_fields.cljk）の CAPTCHA 非突破・ward・field キー・fail-safe と一致 | **実装済み・実測** |

実測: `amu test aiueos/chat_captcha.cljk` → **15/15**（jvm-kir / js / wasm）。
parity → 2 tests / 15 assertions / 0 failures。

## 正本の正確な規則（guest はこれに追従 —— 明文の設計意図つき）

- **CAPTCHA / bot 認証の検知マーカー**（recaptcha / hcaptcha / cf-turnstile /
  画像認証 / ロボットではありません / 認証コードを入力）が出たら
  **「自動操作は止め、人間に渡す（突破しない）」** —— guest の
  captcha-handoff がこの規則を fail closed で固定。
- **ward 境界**: ward-code `13113`（渋谷区）、actor-did
  `did:web:etzhayyim.com:actor:shibuya`、受付 URL も ward に閉じる。
- **field-map 7 キー**（候補 CSS セレクタ列 → 最初に見つかった可視要素へ入力）。
- `SODAI_FIELD_MAP`（JSON）で上書き可。**壊れた JSON は catch して既定のまま**
  （fail-safe — 壊れた設定で走らせない）。CSS セレクタは「実フォーム未確認の
  推測」で mode=discover が実物を列挙する（host 側の探索）。

## 未実装境界

- フォーム提出の実操作（Playwright / browser runner = host）と
  sodai_submit graph（LangGraph）の進行判定。
- CAPTCHA マーカーの DOM 検知そのもの（判定は guest、検知は host）。
- mon（DNA）化、aiueos session 載せ（fleet 共通）。
