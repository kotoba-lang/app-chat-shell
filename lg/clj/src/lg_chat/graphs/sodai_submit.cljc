(ns lg-chat.graphs.sodai-submit
  "lg-chat `sodai_submit` graph — 渋谷区 粗大ごみ 公式フォーム自動入力 (browser use).
  clj port of lg_chat/graphs/sodai_submit.py (ADR-2606280030).

  State machine (identical topology to the py):
    START → validate → drive → END

  Safety invariants (carried verbatim from the py):
    1. 最終送信 (irreversible) は二重ゲート: mode==\"submit\" AND human_approved
       AND env SODAI_ALLOW_SUBMIT==\"1\" のすべてが揃ったときのみ送信。
    2. CAPTCHA / bot 認証を検知したら即中断 (突破しない)。
    3. フォームのセレクタは calibration 必須 (sodai-fields/load-field-map, env override).

  PORT DEVIATION (noted, functionality not silently dropped): the py `drive`
  node drives a real browser via Playwright (async). bb ships no Playwright/CDP
  driver, so `drive` here returns the SAME `status \"playwright_missing\"` enum
  the py emits when its browser lib is absent — and, per lg/CLAUDE.md, the pod
  sodai_submit graph is itself 未デプロイ・未配線 (DC-IP/WAF-blocked from the
  reception host). The validate node (mode validation + defaults) is ported 1:1;
  the discover/prefill/submit double-gate logic lives inside the browser leg and
  is preserved as documented constants for the future browser-capable runtime
  (scripts/sodai_browser.py — local patchright runner — stays the live path)."
  (:require [langgraph.graph :as g]
            [lg-chat.sodai-fields :as sf]))

(def default-config {:ward-url sf/reception-url :nav-timeout-ms 30000 :allow-submit? false})
(defn- host-config [state] (merge default-config (or (:host-config state) {})))

;; ── nodes ──────────────────────────────────────────────────────────────────

(defn node-validate [state]
  (let [mode (clojure.string/lower-case (str (or (:mode state) "prefill")))
        app (or (:application state) {})]
    (cond
      (not (#{"discover" "prefill" "submit"} mode))
      {:status "error" :error (str "unknown mode: " mode)}

      (and (not= mode "discover") (not (map? app)))
      {:status "error" :error "application must be an object"}

      :else
      {:mode mode :submitted false :captcha-detected false})))

(defn node-drive [state]
  (if (= "error" (:status state))
    {}
    ;; No Playwright/CDP browser in the bb runtime — degrade exactly as the py
    ;; does when its browser lib is missing (status enum preserved).
    (let [{:keys [ward-url nav-timeout-ms allow-submit?]} (host-config state)]
     {:status "playwright_missing"
     :error (str "playwright (browser driver) がこの clj runtime に未導入です。"
                 "ブラウザ対応のローカルランナー (scripts/sodai_browser.py, patchright) "
                 "を使うか、ブラウザ対応の lg-chat イメージを deploy してください。"
                 " ward-url=" (str (or (:ward_url state) ward-url))
                 " allow-submit=" allow-submit?
                 " nav-timeout-ms=" nav-timeout-ms)})))

;; ── graph ────────────────────────────────────────────────────────────────────

(defn build []
  (-> (g/state-graph)
      (g/add-node :validate node-validate)
      (g/add-node :drive node-drive)
      (g/add-edge :validate :drive)
      (g/set-entry-point :validate)
      (g/set-finish-point :drive)
      (g/compile-graph)))

(def graph (build))
