;; run_tests.clj — lg-chat clj test runner (repo rule: .clj, not .sh).
;; Usage: from 60-apps/etzhayyim-chat-shell/lg/clj/ run `bb run test`
;;        or `bb tests/run_tests.clj`.
(require '[clojure.test :as t]
         '[org.httpkit.server :as httpkit]
         '[lg-chat.server :as server]
         'lg-chat.test-smoke
         'lg-chat.graphs.test-sodai-submit)

(defn- env [k d]
  (let [v (System/getenv k)] (if (or (nil? v) (= "" v)) d v)))

(defn host-config []
  {:api-key (env "LG_API_KEY" "")
   :agent_chat {:vllm-url (env "VLLM_URL" "http://keiei-litellm.keiei-llm.svc.cluster.local:4000/v1")
                :vllm-model (env "MURAKUMO_DEFAULT_MODEL" "gemma-4-E4B-it")
                :vllm-api-key (env "LLM_API_KEY" "dummy")
                :vllm-timeout-ms (* 1000 (Long/parseLong (env "VLLM_TIMEOUT_SEC" "60")))
                :max-iterations (Long/parseLong (env "CHAT_MAX_ITERATIONS" "8"))
                :max-history (Long/parseLong (env "CHAT_MAX_HISTORY" "20"))
                :tools {:comfyui-url (env "COMFYUI_URL" "")
                        :rw-url (env "RW_URL" "")
                        :web-search-provider (env "WEB_SEARCH_PROVIDER" "brave")
                        :web-search-key (env "WEB_SEARCH_KEY" "")
                        :b2-s3-endpoint (env "B2_S3_ENDPOINT" "https://s3.us-west-004.backblazeb2.com")
                        :b2-access-key (env "B2_ACCESS_KEY_ID" (env "B2_APPLICATION_KEY_ID" ""))
                        :b2-secret-key (env "B2_SECRET_ACCESS_KEY" (env "B2_APPLICATION_KEY" ""))
                        :b2-bucket (env "CHAT_B2_BUCKET" "etzhayyim-chat-artifacts")
                        :b2-prefix (env "CHAT_B2_PREFIX" "chat")
                        :dispatcher-url (env "BPMN_DISPATCHER_INTERNAL_URL" "")
                        :internal-secret (env "CHAT_INTERNAL_SECRET" "")}}
   :sodai_submit {:ward-url (env "SODAI_WARD_URL" "")
                  :nav-timeout-ms (Long/parseLong (env "SODAI_NAV_TIMEOUT_MS" "30000"))
                  :allow-submit? (= "1" (env "SODAI_ALLOW_SUBMIT" "0"))}})

(defn serve! []
  (server/start-with httpkit/run-server (host-config)
                     (Long/parseLong (env "PORT" "8000"))))

(let [{:keys [fail error] :as summary}
      (t/run-tests 'lg-chat.test-smoke
                   'lg-chat.graphs.test-sodai-submit)]
  (println summary)
  (System/exit (if (zero? (+ (or fail 0) (or error 0))) 0 1)))
