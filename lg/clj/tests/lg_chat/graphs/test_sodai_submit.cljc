(ns lg-chat.graphs.test-sodai-submit
  "Smoke tests for sodai_submit graph — no network, no browser driver required.
  clj port of lg/tests/test_sodai_submit.py (ADR-2606280030). Verifies the graph
  compiles, mode validation, the field-map override SSoT, and the browser-missing
  degradation (status enum preserved)."
  (:require [clojure.test :refer [deftest is]]
            [lg-chat.graphs.sodai-submit :as ss]
            [lg-chat.sodai-fields :as sf]))

(def app
  {:items [{:name "ソファー（2人以上用）" :qty 1}]
   :name "渋谷　太郎" :nameKana "シブヤ　タロウ"
   :postal "150-8010" :address "渋谷区宇田川町１－１"
   :building "" :phone "0312345678" :email "" :preferredDate ""})

(deftest test-graph-compiles
  (let [graph ss/graph
        node-names (set (keys (get-in graph [:graph :nodes])))]
    (is (some? graph))
    (is (clojure.set/subset? #{:validate :drive} node-names))))

(deftest test-field-map-default
  (let [fm (sf/load-field-map)]
    (is (= (get sf/default-field-map "name") (get fm "name")))
    (is (contains? fm "phone"))))

(deftest test-validate-rejects-bad-mode
  (let [out (ss/node-validate {:mode "wreck-it" :application app})]
    (is (= "error" (:status out)))))

(deftest test-validate-defaults-to-prefill
  (let [out (ss/node-validate {:application app})]
    (is (= "prefill" (:mode out)))
    (is (false? (:submitted out)))))

(deftest test-drive-degrades-when-browser-missing
  ;; The clj runtime has no Playwright/CDP driver → same status enum the py
  ;; emits when its browser lib is absent.
  (let [out (ss/node-drive {:mode "prefill" :application app})]
    (is (= "playwright_missing" (:status out)))
    (is (clojure.string/includes? (clojure.string/lower-case (:error out)) "playwright"))))

(deftest test-validate-error-short-circuits-drive
  (let [out (ss/node-drive {:status "error" :error "bad"})]
    (is (= {} out))))
