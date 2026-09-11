(ns lg-chat.sodai-fields
  "渋谷区 粗大ごみ 公式フォームの field-map / CAPTCHA マーカーの SSoT。

  Faithful clj port of lg_chat/sodai_fields.py (ADR-2606280030). Both the
  sodai_submit graph and the local browser runner share these constants. The
  CSS selectors are guesses (実フォーム未確認); mode=\"discover\" enumerates the
  real form, env SODAI_FIELD_MAP (JSON) overrides them."
  (:require [cheshire.core :as json]))

;; ── shibuya actor 境界 (lightweight separation) — フロント ward.ts と対の SSoT ──
(def ward-code "13113")
(def ward-name "渋谷区")
(def actor-did "did:web:etzhayyim.com:actor:shibuya")
(def nsid-prefix "ai.etzhayyim.apps.shibuya")
(def reception-url "https://sodai.tokyokankyo.or.jp/Sodai/V2Main/13113/0")

;; application キー → 候補 CSS セレクタ。最初に見つかった可視要素へ入力する。
(def default-field-map
  {"name"     ["input[name*='name' i]:not([name*='kana' i])" "#applicantName" "#name"]
   "nameKana" ["input[name*='kana' i]" "input[name*='furigana' i]" "#nameKana"]
   "postal"   ["input[name*='zip' i]" "input[name*='post' i]" "#zipCode" "#postalCode"]
   "address"  ["input[name*='addr' i]" "textarea[name*='addr' i]" "#address"]
   "building" ["input[name*='building' i]" "input[name*='tatemono' i]" "#building"]
   "phone"    ["input[name*='tel' i]" "input[name*='phone' i]" "#tel" "#phone"]
   "email"    ["input[type='email']" "input[name*='mail' i]" "#email"]})

;; CAPTCHA / bot 認証の検知マーカー。出たら自動操作は止め、人間に渡す (突破しない)。
(def captcha-markers
  ["recaptcha" "g-recaptcha" "hcaptcha" "h-captcha" "cf-turnstile"
   "画像認証" "ロボットではありません" "認証コードを入力"])

(defn load-field-map
  "default-field-mapをhost supplied JSONで上書きしたものを返す。"
  ([] (load-field-map nil))
  ([raw]
  (let [raw (some-> raw (.trim))]
    (if (or (nil? raw) (= "" raw))
      default-field-map
      (try
        (let [override (json/parse-string raw)]
          (reduce-kv (fn [m k v]
                       (assoc m k (if (sequential? v) (vec v) [(str v)])))
                     default-field-map
                     override))
        (catch Exception _
          default-field-map))))))
