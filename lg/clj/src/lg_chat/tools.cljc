(ns lg-chat.tools
  "6 tool implementations for the lg-chat agent_chat graph — clj port of
  lg_chat/tools.py (ADR-2606280030). Each tool is a plain fn returning a map;
  the graph node `execute-tools` calls them inside the superstep.

  Faithful-port notes (deviations called out, no functionality silently dropped):
   - httpx / urllib  → babashka.http-client  (code_exec, image_gen, web_search,
     schedule_report ported 1:1; same endpoints / payloads / poll loop).
   - json            → cheshire.
   - file_save: B2 (S3) PUT is reproduced via an AWS SigV4 signer over
     babashka.http-client (boto3 replacement). Credential GATE behaviour is
     byte-identical to the py (no creds → graceful 'not available'); the live
     PUT path is unverified against B2 in this sandbox.
   - rag_search / web_search RW-fallback: the RisingWave (psycopg) leg is NOT
     reproduced — bb ships no pg driver and RisingWave is a deprecated substrate
     (repo rule: kotoba Datom log is canonical). The py's 'falls back gracefully'
     contract is preserved: absent RW → graceful unavailable, never a crash."
  (:require [cheshire.core :as json]
            [babashka.http-client :as http]
            [babashka.process :as p]
            [clojure.string :as str])
  (:import [java.security MessageDigest]
           [javax.crypto Mac]
           [javax.crypto.spec SecretKeySpec]
           [java.time ZonedDateTime ZoneOffset]
           [java.time.format DateTimeFormatter]
           [java.util Base64]))

(defn- rstrip-slash [s] (str/replace (or s "") #"/+$" ""))

(def default-config
  {:comfyui-url "" :rw-url "" :web-search-provider "brave" :web-search-key ""
   :b2-s3-endpoint "https://s3.us-west-004.backblazeb2.com"
   :b2-access-key "" :b2-secret-key "" :b2-bucket "etzhayyim-chat-artifacts"
   :b2-prefix "chat" :dispatcher-url "" :internal-secret ""})

(defn- config [host-config k]
  (get (merge default-config (or host-config {})) k))

;; ── OpenAI-compatible tool schemas (verbatim from the py) ──────────────────
(def tool-schemas
  [{:type "function"
    :function {:name "code_exec"
               :description (str "Execute Python 3 code in an isolated subprocess. "
                                 "Returns stdout, stderr, and exit code. "
                                 "No network access; timeout 30 s.")
               :parameters {:type "object" :required ["code"]
                            :properties {:code {:type "string"}
                                         :timeoutSec {:type "integer" :default 15 :maximum 30}}}}}
   {:type "function"
    :function {:name "image_gen"
               :description (str "Generate an image with ComfyUI (SDXL). "
                                 "Returns a CDN URL when successful. "
                                 "Disabled when no ComfyUI endpoint is configured.")
               :parameters {:type "object" :required ["prompt"]
                            :properties {:prompt {:type "string" :maxLength 2000}
                                         :negativePrompt {:type "string"}
                                         :width {:type "integer" :default 1024}
                                         :height {:type "integer" :default 1024}
                                         :steps {:type "integer" :default 4}
                                         :seed {:type "integer"}}}}}
   {:type "function"
    :function {:name "file_save"
               :description (str "Save text or binary content to B2 storage. "
                                 "Returns a download URL. "
                                 "Disabled when B2 credentials are absent.")
               :parameters {:type "object" :required ["filename" "content"]
                            :properties {:filename {:type "string" :maxLength 256}
                                         :content {:type "string"}
                                         :encoding {:type "string" :enum ["utf-8" "base64"] :default "utf-8"}
                                         :mimeType {:type "string" :default "text/plain"}
                                         :title {:type "string"}}}}}
   {:type "function"
    :function {:name "rag_search"
               :description (str "Search previous conversation history stored in RisingWave. "
                                 "Returns matching message snippets. "
                                 "Falls back gracefully if RW is unavailable.")
               :parameters {:type "object" :required ["query"]
                            :properties {:query {:type "string" :maxLength 500}
                                         :topK {:type "integer" :default 6 :maximum 20}
                                         :convId {:type "string"}}}}}
   {:type "function"
    :function {:name "web_search"
               :description (str "Search the public web via Brave Search. "
                                 "Returns {title, url, snippet} hits. "
                                 "Falls back to RisingWave vector search when no API key is set.")
               :parameters {:type "object" :required ["query"]
                            :properties {:query {:type "string" :maxLength 500}
                                         :topK {:type "integer" :default 6 :maximum 20}
                                         :lang {:type "string" :default "ja"}}}}}
   {:type "function"
    :function {:name "schedule_report"
               :description (str "Schedule a deep-research report. "
                                 "Returns immediately with a runId; the result will be posted back "
                                 "to this conversation when the report is ready. "
                                 "Requires BPMN dispatcher to be configured.")
               :parameters {:type "object" :required ["title" "prompt"]
                            :properties {:title {:type "string" :maxLength 256}
                                         :prompt {:type "string" :maxLength 4000}
                                         :deliverChannel {:type "string"
                                                          :enum ["chat" "email" "pds-record"]
                                                          :default "chat"}
                                         :deliverAt {:type "string" :format "datetime"}}}}}])

;; ── helpers ────────────────────────────────────────────────────────────────
(defn- now-ms [] (System/currentTimeMillis))
(defn- arg [args k] (get args k (get args (keyword k))))
(defn- as-str [v] (if (nil? v) "" (str v)))
(defn- as-int [v d] (try (int (Long/parseLong (str/trim (str v)))) (catch Exception _ (int d))))
(defn- clampi [v lo hi] (max lo (min v hi)))
(defn- take-str [s n] (subs s 0 (min n (count s))))

;; ── tool: code_exec ────────────────────────────────────────────────────────
(defn tool-code-exec [args]
  (let [code (as-str (arg args "code"))
        timeout-sec (min (as-int (arg args "timeoutSec") 15) 30)]
    (if (str/blank? code)
      {:ok false :error "code is required"}
      (let [started (now-ms)
            td (str (java.nio.file.Files/createTempDirectory
                     "lg-chat-exec-" (make-array java.nio.file.attribute.FileAttribute 0)))
            script (str td "/exec.py")]
        (spit script code)
        (try
          (let [proc (deref (p/process {:dir td :out :string :err :string
                                        :env {"PATH" "/usr/local/bin:/usr/bin:/bin" "HOME" td "TMPDIR" td}
                                        :timeout (* timeout-sec 1000)}
                                       "python3" "-I" script)
                             (* timeout-sec 1000) ::timeout)]
            (if (= proc ::timeout)
              {:ok false :error (str "timeout after " timeout-sec "s")}
              {:ok (= 0 (:exit proc))
               :stdout (take-str (or (:out proc) "") 8000)
               :stderr (take-str (or (:err proc) "") 2000)
               :exitCode (:exit proc)
               :durationMs (int (- (now-ms) started))}))
          (catch Exception e
            (let [msg (.getMessage e)]
              (if (and msg (str/includes? (str/lower-case msg) "timeout"))
                {:ok false :error (str "timeout after " timeout-sec "s")}
                {:ok false :error (take-str (str "code_exec: " msg) 200)}))))))))

;; ── tool: image_gen (ComfyUI) ───────────────────────────────────────────────
(defn tool-image-gen [args & {:keys [conv-id owner-did host-config]}]
  (let [comfyui-url (rstrip-slash (config host-config :comfyui-url))]
   (if (= "" comfyui-url)
    {:ok false :error "image_gen is not available — no ComfyUI endpoint configured (COMFYUI_URL)"}
    (let [prompt (str/trim (as-str (arg args "prompt")))]
      (if (str/blank? prompt)
        {:ok false :error "prompt is required"}
        (let [width (clampi (as-int (arg args "width") 1024) 256 1536)
              height (clampi (as-int (arg args "height") 1024) 256 1536)
              steps (clampi (as-int (arg args "steps") 4) 2 30)
              seed (let [s (arg args "seed")] (if (nil? s) (bit-and (now-ms) 0x7FFFFFFF) (as-int s 0)))
              neg (let [n (as-str (arg args "negativePrompt"))] (if (= "" n) "nsfw, lowres, blurry" n))
              workflow {:ckpt {:class_type "CheckpointLoaderSimple" :inputs {:ckpt_name "v1-5-pruned-emaonly.safetensors"}}
                        :latent {:class_type "EmptyLatentImage" :inputs {:width width :height height :batch_size 1}}
                        :pos {:class_type "CLIPTextEncode" :inputs {:text prompt :clip ["ckpt" 1]}}
                        :neg {:class_type "CLIPTextEncode" :inputs {:text neg :clip ["ckpt" 1]}}
                        :ks {:class_type "KSampler" :inputs {:seed seed :steps steps :cfg 7.0
                                                             :sampler_name "euler_ancestral" :scheduler "normal" :denoise 1.0
                                                             :model ["ckpt" 0] :positive ["pos" 0] :negative ["neg" 0]
                                                             :latent_image ["latent" 0]}}
                        :vae {:class_type "VAEDecode" :inputs {:samples ["ks" 0] :vae ["ckpt" 2]}}
                        :save {:class_type "SaveImage" :inputs {:filename_prefix "etzhayyim_chat" :images ["vae" 0]}}}
              ua "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/129.0.0.0"
              headers {"User-Agent" ua "Accept" "application/json" "Content-Type" "application/json"}
              started (now-ms)
              prompt-id (try
                          (let [r (http/post (str comfyui-url "/prompt")
                                             {:headers headers :body (json/generate-string {:prompt workflow})
                                              :timeout 15000 :throw false})
                                resp (json/parse-string (:body r) true)]
                            (:prompt_id resp))
                          (catch Exception e (str "ERR:" (take-str (str (.getMessage e)) 200))))]
          (cond
            (nil? prompt-id) {:ok false :error "comfy no prompt_id"}
            (str/starts-with? (str prompt-id) "ERR:") {:ok false :error (str "comfy /prompt: " (subs (str prompt-id) 4))}
            :else
            (let [deadline (+ (now-ms) 120000)
                  entry (loop [delay 1500]
                          (let [rec (try
                                      (let [r2 (http/get (str comfyui-url "/history/" prompt-id)
                                                         {:headers headers :timeout 10000 :throw false})
                                            hist (json/parse-string (:body r2) true)]
                                        (get hist (keyword (str prompt-id))))
                                      (catch Exception _ nil))]
                            (cond
                              (get-in rec [:status :completed]) rec
                              (> (now-ms) deadline) nil
                              :else (do (Thread/sleep delay) (recur (min (int (* delay 1.4)) 4000))))))]
              (if (nil? entry)
                {:ok false :error "comfy timeout after 120s" :promptId prompt-id}
                (let [images (->> (vals (or (:outputs entry) {}))
                                  (filter #(and (map? %) (contains? % :images)))
                                  (mapcat #(or (:images %) []))
                                  vec)]
                  (if (empty? images)
                    {:ok false :error "comfy returned no images" :promptId prompt-id}
                    (let [img (first images)
                          enc (fn [s] (java.net.URLEncoder/encode (or s "") "UTF-8"))
                          qs (str "filename=" (enc (:filename img))
                                  "&subfolder=" (enc (:subfolder img))
                                  "&type=" (enc (or (:type img) "output")))]
                      {:ok true :imageUrl (str comfyui-url "/view?" qs)
                       :width width :height height :seed seed :promptId prompt-id
                       :durationMs (int (- (now-ms) started))}))))))))))))

;; ── AWS SigV4 (boto3 replacement for B2 S3 PUT) ──────────────────────────────
(defn- hmac-sha256 [^bytes key ^String data]
  (let [mac (Mac/getInstance "HmacSHA256")]
    (.init mac (SecretKeySpec. key "HmacSHA256"))
    (.doFinal mac (.getBytes data "UTF-8"))))

(defn- sha256-hex [^bytes b]
  (let [d (.digest (MessageDigest/getInstance "SHA-256") b)]
    (apply str (map #(format "%02x" (bit-and % 0xff)) d))))

(defn- hex [^bytes b] (apply str (map #(format "%02x" (bit-and % 0xff)) b)))

(defn- sigv4-put [endpoint access-key secret-key region bucket key ^bytes blob content-type]
  (let [host (-> endpoint (str/replace #"^https?://" ""))
        url (str endpoint "/" bucket "/" key)
        now (ZonedDateTime/now ZoneOffset/UTC)
        amz-date (.format now (DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'"))
        date-stamp (.format now (DateTimeFormatter/ofPattern "yyyyMMdd"))
        payload-hash (sha256-hex blob)
        canon-uri (str "/" bucket "/" key)
        signed-headers "content-type;host;x-amz-content-sha256;x-amz-date"
        canon-headers (str "content-type:" content-type "\n"
                           "host:" host "\n"
                           "x-amz-content-sha256:" payload-hash "\n"
                           "x-amz-date:" amz-date "\n")
        canon-req (str "PUT\n" canon-uri "\n\n" canon-headers "\n" signed-headers "\n" payload-hash)
        scope (str date-stamp "/" region "/s3/aws4_request")
        string-to-sign (str "AWS4-HMAC-SHA256\n" amz-date "\n" scope "\n"
                            (sha256-hex (.getBytes canon-req "UTF-8")))
        k-date (hmac-sha256 (.getBytes (str "AWS4" secret-key) "UTF-8") date-stamp)
        k-region (hmac-sha256 k-date region)
        k-service (hmac-sha256 k-region "s3")
        k-signing (hmac-sha256 k-service "aws4_request")
        signature (hex (hmac-sha256 k-signing string-to-sign))
        auth (str "AWS4-HMAC-SHA256 Credential=" access-key "/" scope
                  ", SignedHeaders=" signed-headers ", Signature=" signature)]
    (http/put url {:headers {"Authorization" auth "x-amz-date" amz-date
                             "x-amz-content-sha256" payload-hash "Content-Type" content-type
                             "Host" host}
                   :body blob :timeout 30000 :throw false})))

;; ── tool: file_save (B2) ─────────────────────────────────────────────────────
(defn tool-file-save [args & {:keys [conv-id owner-did host-config]}]
  (let [{:keys [b2-s3-endpoint b2-access-key b2-secret-key b2-bucket b2-prefix]}
        (merge default-config (or host-config {}))]
   (if (or (= "" b2-access-key) (= "" b2-secret-key))
    {:ok false :error "file_save is not available — B2 credentials not configured"}
    (let [filename (str/trim (as-str (arg args "filename")))
          content (as-str (arg args "content"))]
      (if (or (str/blank? filename) (str/blank? content))
        {:ok false :error "filename and content are required"}
        (let [encoding (str/lower-case (let [e (as-str (arg args "encoding"))] (if (= "" e) "utf-8" e)))
              mime (let [m (as-str (arg args "mimeType"))] (if (= "" m) "text/plain" m))
              blob (try
                     (if (= encoding "base64")
                       (.decode (Base64/getDecoder) content)
                       (.getBytes content "UTF-8"))
                     (catch Exception e {::err (str "invalid base64: " (.getMessage e))}))]
          (if (map? blob)
            {:ok false :error (::err blob)}
            (let [sha (take-str (sha256-hex blob) 12)
                  safe (-> filename (str/replace "/" "_") (str/replace ".." "_") (take-str 128))
                  owner (let [o (as-str owner-did)] (if (= "" o) "anon" (str/replace o ":" "_")))
                  cid (let [c (as-str conv-id)] (if (= "" c) "nocid" c))
                  key (str b2-prefix "/" owner "/" cid "/" sha "-" safe)]
              (try
                (let [r (sigv4-put b2-s3-endpoint b2-access-key b2-secret-key "us-west-004"
                                   b2-bucket key blob mime)]
                  (if (>= (:status r) 400)
                    {:ok false :error (take-str (str "B2 PUT failed: http " (:status r)) 200)}
                    {:ok true :filename filename :mimeType mime :byteSize (count blob)
                     :b2Key key :cdnUrl (str "https://cdn.etzhayyim.com/" key)}))
                (catch Exception e
                  {:ok false :error (take-str (str "B2 PUT failed: " (.getMessage e)) 200)}))))))))))

;; ── tool: rag_search ─────────────────────────────────────────────────────────
(defn tool-rag-search [args & {:keys [owner-did host-config]}]
  (let [query (as-str (arg args "query"))
        rw-url (config host-config :rw-url)]
    (cond
      (str/blank? query) {:ok false :error "query is required"}
      (= "" rw-url) {:ok false :error "rag_search unavailable — RW_URL not configured" :hits []}
      ;; RisingWave (psycopg) leg not ported — deprecated substrate, no bb pg driver.
      :else {:ok false :error "rag_search: RisingWave backend not available in clj runtime" :hits []})))

;; ── tool: web_search (Brave) ─────────────────────────────────────────────────
(defn tool-web-search [args & {:keys [host-config]}]
  (let [query (as-str (arg args "query"))
        top-k (min (as-int (arg args "topK") 6) 20)
        web-search-key (config host-config :web-search-key)
        web-search-provider (config host-config :web-search-provider)]
    (if (str/blank? query)
      {:ok false :error "query is required"}
      (let [brave (when (and (not= "" web-search-key) (= web-search-provider "brave"))
                    (try
                      (let [url (str "https://api.search.brave.com/res/v1/web/search?q="
                                     (java.net.URLEncoder/encode query "UTF-8") "&count=" top-k)
                            r (http/get url {:headers {"Accept" "application/json"
                                                       "X-Subscription-Token" web-search-key}
                                             :timeout 15000 :throw false})]
                        (when (< (:status r) 400)
                          (let [data (json/parse-string (:body r) true)
                                results (or (get-in data [:web :results]) [])]
                            {:ok true :query query
                             :hits (vec (for [h (take top-k results)]
                                          {:title (or (:title h) "") :url (or (:url h) "")
                                           :snippet (take-str (or (:description h) "") 500)}))
                             :provider "brave"})))
                      (catch Exception _ nil)))]
        (or brave
            ;; RisingWave ILIKE fallback not ported (deprecated substrate).
            {:ok false :error "web_search: no provider available" :hits []})))))

;; ── tool: schedule_report ────────────────────────────────────────────────────
(defn tool-schedule-report [args & {:keys [conv-id msg-id owner-did host-config]}]
  (let [dispatcher-url (rstrip-slash (config host-config :dispatcher-url))
        internal-secret (config host-config :internal-secret)]
   (if (= "" dispatcher-url)
    {:ok false :error "schedule_report unavailable — BPMN_DISPATCHER_INTERNAL_URL not configured"}
    (let [title (str/trim (as-str (arg args "title")))
          prompt (str/trim (as-str (arg args "prompt")))]
      (if (or (str/blank? title) (str/blank? prompt))
        {:ok false :error "title and prompt are required"}
        (let [body {:convId (as-str conv-id) :msgId (as-str msg-id) :ownerDid (as-str owner-did)
                    :title title :prompt prompt
                    :deliverAt (as-str (arg args "deliverAt"))
                    :deliverChannel (let [c (as-str (arg args "deliverChannel"))] (if (= "" c) "chat" c))}
              body-json (json/generate-string body)
              headers (cond-> {"Content-Type" "application/json"}
                        (not= "" internal-secret)
                        (assoc "x-internal-trust" (hex (hmac-sha256 (.getBytes internal-secret "UTF-8") body-json))))
              url (str dispatcher-url "/xrpc/ai.etzhayyim.apps.chat.scheduleReport")]
          (try
            (let [r (http/post url {:headers headers :body body-json :timeout 30000 :throw false})
                  resp (json/parse-string (:body r) true)]
              {:ok (boolean (:ok resp)) :runId (or (:runId resp) "") :scheduledAt (or (:scheduledAt resp) "")})
            (catch Exception e
              {:ok false :error (take-str (str "schedule_report dispatcher: " (.getMessage e)) 200)}))))))))

;; ── dispatcher ───────────────────────────────────────────────────────────────
(defn dispatch-tool [name args & {:keys [conv-id msg-id owner-did host-config]
                                  :or {conv-id "" msg-id "" owner-did "" host-config {}}}]
  (case name
    "code_exec"       (tool-code-exec args)
    "image_gen"       (tool-image-gen args :conv-id conv-id :owner-did owner-did :host-config host-config)
    "file_save"       (tool-file-save args :conv-id conv-id :owner-did owner-did :host-config host-config)
    "rag_search"      (tool-rag-search args :owner-did owner-did :host-config host-config)
    "web_search"      (tool-web-search args :host-config host-config)
    "schedule_report" (tool-schedule-report args :conv-id conv-id :msg-id msg-id :owner-did owner-did :host-config host-config)
    {:ok false :error (str "unknown tool: " (pr-str name))}))
