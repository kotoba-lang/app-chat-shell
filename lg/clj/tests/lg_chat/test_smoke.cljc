(ns lg-chat.test-smoke
  "Smoke tests — graphs compile and tools dispatch without network/LLM key.
  clj port of lg/tests/test_smoke.py (ADR-2606280030)."
  (:require [clojure.test :refer [deftest is testing]]
            [lg-chat.graphs.agent-chat :as agent-chat]
            [lg-chat.tools :as tools]
            [lg-chat.server :as server]))

(deftest test-graph-compiles
  (let [graph agent-chat/graph
        node-names (set (keys (get-in graph [:graph :nodes])))]
    (is (some? graph))
    (is (contains? node-names :prepare))
    (is (contains? node-names :llm))
    (is (contains? node-names :execute-tools))))

(deftest test-tools-import
  (is (= 6 (count tools/tool-schemas)))
  (let [names (set (map #(get-in % [:function :name]) tools/tool-schemas))]
    (is (= #{"code_exec" "image_gen" "file_save" "rag_search" "web_search" "schedule_report"} names)))
  (let [result (tools/dispatch-tool "__unknown__" {})]
    (is (false? (:ok result)))))

(deftest test-code-exec-tool
  (let [result (tools/tool-code-exec {"code" "print('hello from lg-chat')"})]
    (is (true? (:ok result)))
    (is (clojure.string/includes? (:stdout result) "hello from lg-chat"))))

(deftest test-code-exec-timeout
  (let [result (tools/tool-code-exec {"code" "import time; time.sleep(100)" "timeoutSec" 2})]
    (is (false? (:ok result)))
    (is (clojure.string/includes? (:error result) "timeout"))))

(deftest test-tool-gates-without-creds
  (testing "tools gracefully report unavailability when their backend creds are absent"
    (is (false? (:ok (tools/tool-image-gen {"prompt" "x"}))))
    (is (false? (:ok (tools/tool-rag-search {"query" "x"}))))
    (is (false? (:ok (tools/tool-schedule-report {"title" "t" "prompt" "p"}))))))

(deftest test-server-resolves-graphs
  (is (some? (server/resolve-graph "agent_chat")))
  (is (some? (server/resolve-graph "sodai_submit")))
  (is (some? (server/resolve-graph "")))            ; empty → agent_chat default
  (is (nil? (server/resolve-graph "nope"))))

(deftest test-explicit-host-config
  (testing "secret-bound handler rejects a mismatched API key"
    (is (= 401 (:status (server/handler-with-config
                         {:api-key "secret"}
                         {:request-method :post :uri "/runs"
                          :headers {"x-api-key" "wrong"} :body "{}"})))))
  (testing "server capability and port are validated before invocation"
    (is (thrown-with-msg? Exception #"server capability not configured"
                          (server/start-with nil {} 8000)))
    (is (thrown-with-msg? Exception #"invalid server port"
                          (server/start-with (fn [& _]) {} 0))))
  (testing "tool credentials are explicit and absent by default"
    (is (false? (:ok (tools/tool-file-save {"filename" "x" "content" "y"}))))
    (is (false? (:ok (tools/tool-web-search {"query" "x"}))))))
