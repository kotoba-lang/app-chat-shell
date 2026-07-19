(ns lg-chat.server
  "OSS HTTP server for lg-chat (chat.etzhayyim.com) — clj port of lg_chat/server.py
  (ADR-2606280030). FastAPI → org.httpkit.server (a bb built-in). Exposes the same
  minimal LangGraph-Cloud-compatible surface:

    POST /runs          → invoke a graph synchronously
    POST /runs/stream   → stream graph supersteps as SSE (ChatPanel target)
    GET  /ok            → liveness
    GET  /health        → readiness
    GET  /health/deep   → readiness + (RW probe skipped — deprecated substrate)

  Sprint 1 ephemeral-only: config.configurable.ephemeral has no checkpointer to
  strip in langgraph-clj (graphs compile without one), so the flag is a no-op
  here — history still lives in browser IndexedDB (ADR-2605230000)."
  (:require [org.httpkit.server :as hk]
            [cheshire.core :as json]
            [clojure.string :as str]
            [langgraph.graph :as g]
            [lg-chat.graphs.agent-chat :as agent-chat]
            [lg-chat.graphs.sodai-submit :as sodai-submit]))

(def graphs {"agent_chat" agent-chat/graph
             "sodai_submit" sodai-submit/graph})

(def ^:private boot-ts (System/currentTimeMillis))

(defn resolve-graph [assistant-id]
  (get graphs (if (str/blank? assistant-id) "agent_chat" assistant-id)))

(defn- authed? [api-key req]
  (or (= "" api-key)
      (= api-key (get-in req [:headers "x-api-key"]))))

(defn- read-body [req]
  (let [b (:body req)]
    (cond
      (nil? b) {}
      (string? b) (json/parse-string b true)
      :else (json/parse-string (slurp b) true))))

(defn- json-resp
  ([m] (json-resp 200 m))
  ([status m] {:status status
               :headers {"Content-Type" "application/json"}
               :body (json/generate-string m)}))

;; bytes never appear in clj graph state, but mirror the py _sanitize contract.
(defn- sanitize [v]
  (cond
    (bytes? v) (str "<bytes:" (count v) "B>")
    (map? v) (into {} (map (fn [[k x]] [k (sanitize x)]) v))
    (sequential? v) (mapv sanitize v)
    :else v))

(defn handler-with-config [config req]
  (let [api-key (str/trim (or (:api-key config) ""))
        uri (:uri req)
        method (:request-method req)]
    (cond
      (and (= method :get) (= uri "/ok"))
      (json-resp {:ok true :graphs (vec (keys graphs)) :version "0.1.0"})

      (and (= method :get) (= uri "/health"))
      (json-resp {:ok true})

      (and (= method :get) (= uri "/health/deep"))
      (json-resp {:ok true :uptimeSec (int (/ (- (System/currentTimeMillis) boot-ts) 1000))
                  :graph true :rw_ok false :rw_roundtrip_ms nil})

      (and (= method :post) (= uri "/runs"))
      (if-not (authed? api-key req)
        (json-resp 401 {:detail "invalid x-api-key"})
        (let [body (read-body req)
              graph (resolve-graph (str (:assistant_id body)))]
          (if (nil? graph)
            (json-resp 404 {:detail (str "unknown graph: " (:assistant_id body))})
            (let [started (System/currentTimeMillis)]
              (try
                (let [input (assoc (or (:input body) {}) :host-config
                                   (get config (keyword (str (:assistant_id body))) {}))
                      result (g/invoke graph input)]
                  (json-resp {:ok true :result (sanitize result)
                              :latencyMs (int (- (System/currentTimeMillis) started))}))
                (catch Exception exc
                  (json-resp {:ok false :error (subs (str (.getMessage exc)) 0 (min 500 (count (str (.getMessage exc)))))
                              :errorType (.getSimpleName (class exc))
                              :latencyMs (int (- (System/currentTimeMillis) started))})))))))

      (and (= method :post) (= uri "/runs/stream"))
      (if-not (authed? api-key req)
        (json-resp 401 {:detail "invalid x-api-key"})
        (let [body (read-body req)
              graph (resolve-graph (str (:assistant_id body)))]
          (if (nil? graph)
            (json-resp 404 {:detail (str "unknown graph: " (:assistant_id body))})
            (hk/as-channel
             req
             {:on-open
              (fn [ch]
                (try
                  (let [input (assoc (or (:input body) {}) :host-config
                                     (get config (keyword (str (:assistant_id body))) {}))]
                   (doseq [event (g/stream graph input)]
                    (hk/send! ch {:status 200 :headers {"Content-Type" "text/event-stream"}
                                  :body (str "data: " (json/generate-string
                                                       {:event "values" :data (sanitize (:state event))}) "\n\n")}
                              false)))
                  (catch Exception exc
                    (hk/send! ch (str "data: " (json/generate-string
                                                {:event "error" :data (str (.getMessage exc))}) "\n\n") false))
                  (finally
                    (hk/send! ch "data: {\"event\": \"done\"}\n\n" false)
                    (hk/close ch))))}))))

      :else
      (json-resp 404 {:detail "not found"}))))

(defn handler [req] (handler-with-config {} req))

(defn start-with [run-server config port]
  (when-not (fn? run-server)
    (throw (ex-info "server capability not configured" {:capability :run-server})))
  (when-not (and (integer? port) (<= 1 port 65535))
    (throw (ex-info "invalid server port" {:port port})))
  (let [stop (run-server (partial handler-with-config config) {:port port})]
    (println (str "lg-chat clj server up — graphs " (vec (keys graphs)) " on :" port " (ephemeral-only)"))
    stop))

(defn start! [& _]
  (throw (ex-info "host adapter must provide server, config and port"
                  {:capability :run-server})))

(defn -main [& _]
  (throw (ex-info "host adapter required" {:capability :run-server})))
