(ns lg-chat.graphs.agent-chat
  "lg-chat `agent_chat` graph — general-purpose assistant (clj port of
  lg_chat/graphs/agent_chat.py, ADR-2606280030).

  ReAct tool-calling loop over an OpenAI-compatible chat endpoint (Murakumo
  loopback / keiei-litellm, Gemma 4 E4B-it). httpx → babashka.http-client,
  json → cheshire, langgraph StateGraph → langgraph-clj.

  State machine (identical topology to the py):
    START → prepare → llm → route → (execute_tools → llm)* → END

  Input (from ChatPanel.svelte /lg/runs/stream body.input):
    {message, history[], conv_id?, owner_did?}
  Config.configurable: {tier, ephemeral} (ephemeral handled server-side).
  Output state keys: :reply, :tool-results, :error."
  (:require [langgraph.graph :as g]
            [cheshire.core :as json]
            [babashka.http-client :as http]
            [clojure.string :as str]
            [lg-chat.tools :as tools]))

(def default-config
  {:vllm-url "http://keiei-litellm.keiei-llm.svc.cluster.local:4000/v1"
   :vllm-model "gemma-4-E4B-it" :vllm-api-key "dummy"
   :vllm-timeout-ms 60000 :max-iterations 8 :max-history 20 :tools {}})

(defn- host-config [state] (merge default-config (or (:host-config state) {})))

(def ^:private system-prompt
  (str "You are Etzhayyim Chat, a helpful AI assistant on etzhayyim.com. "
       "You have access to tools for code execution, web search, file saving, "
       "image generation, conversation search, and report scheduling. "
       "Use tools when they would genuinely help the user. "
       "Reply in the user's language. Be concise and accurate."))

(defn- get* [state k] (or (get state k) (get state (keyword (name k)))))
(defn- take-str [s n] (let [s (str s)] (subs s 0 (min n (count s)))))

;; ── nodes ──────────────────────────────────────────────────────────────────

(defn node-prepare [state]
  (let [{:keys [max-history]} (host-config state)
        history (or (:history state) [])
        msgs (into [{:role "system" :content system-prompt}]
                   (for [h (take-last max-history history)
                         :when (and (map? h)
                                    (#{"user" "assistant" "tool"} (or (:role h) (get h "role"))))]
                     {:role (or (:role h) (get h "role"))
                      :content (take-str (or (:content h) (get h "content") "") 4000)}))
        user-text (str/trim (str (or (:message state) "")))
        msgs (if (str/blank? user-text) msgs (conj msgs {:role "user" :content user-text}))]
    {:messages msgs :iteration 0 :tool-results []}))

(defn- strip-think [s]
  (str/trim (str/replace (or s "") #"(?s)<think>.*?</think>" "")))

(defn node-llm [state]
  (if (:error state)
    {}
    (let [{:keys [vllm-url vllm-model vllm-api-key vllm-timeout-ms]} (host-config state)
          vllm-url (str/replace vllm-url #"/+$" "")
          msgs (or (:messages state) [])
          payload {:model vllm-model :messages msgs :tools tools/tool-schemas
                   :tool_choice "auto" :max_tokens 2048 :temperature 0.4}
          result (try
                   (let [r (http/post (str vllm-url "/chat/completions")
                                      {:headers {"Authorization" (str "Bearer " vllm-api-key)
                                                 "Content-Type" "application/json"}
                                       :body (json/generate-string payload)
                                       :timeout vllm-timeout-ms :throw false})]
                     (if (>= (:status r) 400)
                       {:error (str "vllm http " (:status r) ": " (take-str (:body r) 300))}
                       {:resp (json/parse-string (:body r) true)}))
                   (catch java.net.http.HttpTimeoutException _
                     {:error (str "vllm timeout after " (/ vllm-timeout-ms 1000) "s")})
                   (catch Exception exc
                     {:error (take-str (str "vllm: " (.getSimpleName (class exc)) ": " (.getMessage exc)) 200)}))]
      (if (:error result)
        {:error (:error result)}
        (let [resp (:resp result)
              choice (or (first (:choices resp)) {})
              msg (or (:message choice) {})
              tool-calls (or (:tool_calls msg) [])
              updated (conj (vec msgs) msg)]
          (if (empty? tool-calls)
            {:messages updated :reply (strip-think (str (or (:content msg) "")))}
            {:messages updated :iteration (inc (or (:iteration state) 0))}))))))

(defn node-execute-tools [state]
  (let [msgs (vec (or (:messages state) []))
        last-msg (or (last msgs) {})
        tool-calls (or (:tool_calls last-msg) [])]
    (if (empty? tool-calls)
      {}
      (let [conv-id (or (:conv_id state) "")
            owner-did (or (:owner_did state) "")
            tools-config (:tools (host-config state))
            msg-id (str "tc-" (System/currentTimeMillis))
            step (reduce
                  (fn [{:keys [results msgs*]} tc]
                    (let [fn* (or (:function tc) {})
                          name (str (or (:name fn*) ""))
                          args (try (json/parse-string (or (:arguments fn*) "{}")) (catch Exception _ {}))
                          result (tools/dispatch-tool name args :conv-id conv-id :msg-id msg-id
                                                      :owner-did owner-did :host-config tools-config)]
                      {:results (conj results {:name name :args args :result result})
                       :msgs* (conj msgs* {:role "tool"
                                           :tool_call_id (or (:id tc) (str "tc-" name))
                                           :content (take-str (json/generate-string result) 4000)})}))
                  {:results (vec (or (:tool-results state) [])) :msgs* []}
                  tool-calls)]
        {:messages (into msgs (:msgs* step)) :tool-results (:results step)}))))

(defn route-after-llm [state]
  (let [{:keys [max-iterations]} (host-config state)]
   (cond
    (:error state) g/END
    (some? (:reply state)) g/END
    (>= (or (:iteration state) 0) max-iterations) g/END
    (:tool_calls (or (last (:messages state)) {})) :execute-tools
    :else g/END)))

;; ── graph ────────────────────────────────────────────────────────────────────

(defn build []
  (-> (g/state-graph)
      (g/add-node :prepare node-prepare)
      (g/add-node :llm node-llm)
      (g/add-node :execute-tools node-execute-tools)
      (g/add-edge :prepare :llm)
      (g/add-conditional-edges :llm route-after-llm {:execute-tools :execute-tools g/END g/END})
      (g/add-edge :execute-tools :llm)
      (g/set-entry-point :prepare)
      (g/set-finish-point :llm)
      (g/compile-graph)))

(def graph (build))
