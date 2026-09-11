(ns manimani.ui
  (:require [clojure.string :as str]
            [reagent.core :as r]
            [reagent.dom.client :as rdom]))

(defonce root (atom nil))
(defonce state
  (r/atom {:mode :today
           :viewer {:status :loading}
           :conversations []
           :active-conv-id nil
           :messages []
           :streaming ""
           :stream-status nil
           :tool-events []
           :composer ""
           :tier "balanced"
           :runner {:phase "idle"
                    :summary "manimaniボタンで kotoba EDN の整理と arXiv workflow を進めます。"
                    :events []
                    :steps []
                    :spinning? false}
           :busy? false}))

(def theme
  {:radius-window "22px"
   :radius-control "12px"
   :radius-pill "999px"
   :radius-bubble "18px"
   :touch "44px"
   :content-max "1180px"
   :sidebar-min "260px"
   :sidebar-max "320px"
   :accent "#0a84ff"
   :accent-hover "#2997ff"
   :danger "#ff453a"
   :text "#f5f5f7"
   :muted "#9b9ba2"})

(defn js->clj-kw [v]
  (js->clj v :keywordize-keys true))

(defn json-fetch
  ([url] (json-fetch url nil))
  ([url opts]
   (-> (js/fetch url (clj->js (merge {:credentials "include"
                                      :cache "no-store"}
                                     opts)))
       (.then (fn [resp]
                (if (.-ok resp)
                  (.json resp)
                  (throw (js/Error. (str "HTTP " (.-status resp)))))))
       (.then js->clj-kw))))

(defn xrpc-fetch
  ([method] (xrpc-fetch method {}))
  ([method body]
   (json-fetch (str "/xrpc/" method)
               {:method "POST"
                :headers {"content-type" "application/json"}
                :body (.stringify js/JSON (clj->js body))})))

(defn short-label [viewer]
  (let [did (:did viewer)
        handle (:handle viewer)]
    (cond
      (and handle (not= handle did)) handle
      (string? did)
      (if-let [[_ host user] (re-find #"^did:web:([^:]+):user:([^:]+)" did)]
        (str host "/" user)
        did)
      :else "")))

(defn now-ms [] (.now js/Date))

(defn set-state! [& kvs]
  (swap! state #(apply assoc % kvs)))

(defn load-viewer! []
  (-> (json-fetch "/api/auth/whoami")
      (.then (fn [body]
               (if (:anon body)
                 (set-state! :viewer {:status :anon})
                 (set-state! :viewer {:status :signed-in
                                      :viewer {:did (:did body)
                                               :accountDid (:accountDid body)
                                               :activeDid (:activeDid body)
                                               :handle (:handle body)}}))))
      (.catch (fn [err]
                (set-state! :viewer {:status :error :message (.-message err)})))))

(defn load-conversations! []
  (-> (xrpc-fetch "ai.etzhayyim.apps.chat.listConversations")
      (.then (fn [body]
               (set-state! :conversations (vec (:conversations body)))))
      (.catch (fn [_] (set-state! :conversations [])))))

(defn load-conversation! [conv-id]
  (when (seq conv-id)
    (set-state! :active-conv-id conv-id :messages [] :streaming "")
    (-> (xrpc-fetch "ai.etzhayyim.apps.chat.getConversation" {:convId conv-id})
        (.then (fn [body]
                 (set-state! :messages (vec (:messages body)))))
        (.catch (fn [err]
                  (set-state! :messages [{:msgId "load-error"
                                          :role "system"
                                          :content (str "conversation load failed: " (.-message err))
                                          :tsMs (now-ms)}]))))))

(defn sign-in! []
  (-> (json-fetch (str "/api/auth/signin-url?redirectUrl="
                       (js/encodeURIComponent (.-href js/location))))
      (.then (fn [body] (set! (.-href js/location) (:url body))))))

(defn sign-out! []
  (-> (js/fetch "/api/auth/signout"
                (clj->js {:method "POST" :credentials "include"}))
      (.then (fn [_] (.reload js/location)))))

(defn add-message! [role content]
  (let [msg {:msgId (str (name role) "-" (now-ms))
             :role (name role)
             :content content
             :tsMs (now-ms)}]
    (swap! state update :messages conj msg)))

(defn parse-sse-chunk [buffer chunk]
  (let [next-buffer (str buffer chunk)
        parts (str/split next-buffer #"\n\n")
        complete (butlast parts)
        tail (last parts)]
    {:events complete :tail tail}))

(defn event-json [event-text]
  (some->> (str/split-lines event-text)
           (filter #(str/starts-with? (str/trim %) "data:"))
           first
           (#(subs % 5))
           str/trim
           not-empty
           (.parse js/JSON)
           js->clj-kw))

(defn apply-stream-event! [payload]
  (let [{:keys [event data]} payload]
    (cond
      (= event "values")
      (when (map? data)
        (when-let [reply (:reply data)]
          (set-state! :streaming reply :stream-status nil))
        (when-let [tool-results (:tool_results data)]
          (set-state! :tool-events
                      (mapv (fn [t]
                              {:tool (:name t)
                               :ok (not= false (get-in t [:result :ok]))
                               :summary (or (get-in t [:result :error]) "done")})
                            tool-results))))

      (= event "error")
      (set-state! :streaming (if (string? data)
                               (str "エラーが発生しました: " data)
                               "エラーが発生しました。もう一度お試しください。")
                  :stream-status nil))))

(defn stream-reply! [text tier]
  (let [history (->> (:messages @state)
                     (map #(select-keys % [:role :content]))
                     vec)]
    (set-state! :busy? true :streaming "" :stream-status "接続しています" :tool-events [])
    (-> (js/fetch "/lg/runs/stream"
                  (clj->js {:method "POST"
                            :headers {"content-type" "application/json"}
                            :credentials "include"
                            :body (.stringify js/JSON
                                              (clj->js {:assistant_id "agent_chat"
                                                        :input {:message text :history history}
                                                        :config {:configurable {:tier tier
                                                                                :ephemeral true}}
                                                        :stream_mode "values"}))}))
        (.then (fn [resp]
                 (if-let [body (.-body resp)]
                   (let [reader (.getReader body)
                         decoder (js/TextDecoder.)
                         buffer (atom "")]
                     (letfn [(pump []
                               (-> (.read reader)
                                   (.then (fn [result]
                                            (if (.-done result)
                                              (let [reply (:streaming @state)]
                                                (set-state! :busy? false
                                                            :streaming ""
                                                            :stream-status nil)
                                                (when (seq reply)
                                                  (add-message! :assistant reply)
                                                  (load-conversations!)))
                                              (let [decoded (.decode decoder (.-value result) (clj->js {:stream true}))
                                                    parsed (parse-sse-chunk @buffer decoded)]
                                                (reset! buffer (:tail parsed))
                                                (doseq [event (:events parsed)]
                                                  (when-let [payload (event-json event)]
                                                    (apply-stream-event! payload)))
                                                (pump)))))))]
                       (pump)))
                   (throw (js/Error. "no response body")))))
        (.catch (fn [err]
                  (set-state! :busy? false
                              :stream-status nil
                              :streaming "")
                  (add-message! :system (str "send failed: " (.-message err))))))))

(defn submit! []
  (let [{:keys [composer tier busy?]} @state
        text (str/trim composer)]
    (when (and (seq text) (not busy?))
      (set-state! :composer "")
      (when-not (:active-conv-id @state)
        (set-state! :active-conv-id (str "ephemeral-" (now-ms))))
      (add-message! :user text)
      (stream-reply! text tier))))

(def terminal-phases #{"done" "awaiting-approval" "error" "cancelled"})

(defn set-runner! [runner]
  (swap! state update :runner merge runner))

(defn runner-status! [run-id remaining]
  (-> (json-fetch (str "/api/manimani"
                       (when run-id
                         (str "?runId=" (js/encodeURIComponent run-id)))))
      (.then (fn [body]
               (let [phase (or (:phase body) "unknown")
                     terminal? (contains? terminal-phases phase)]
                 (set-runner! {:run-id (:runId body)
                               :phase phase
                               :summary (or (:summary body) "runner status updated")
                               :events (vec (or (:events body) []))
                               :steps (vec (or (:steps body) []))
                               :updated-at (:updatedAt body)
                               :raw (:raw body)
                               :spinning? (not terminal?)})
                 (when (and (pos? remaining) (not terminal?))
                   (js/setTimeout #(runner-status! (or (:runId body) run-id) (dec remaining)) 1800)))))
      (.catch (fn [err]
                (set-runner! {:phase "error"
                              :summary (str "runner status failed: " (.-message err))
                              :spinning? false})))))

(defn start-manimani! []
  (set-runner! {:phase "starting"
                :summary "manimaniくんが回り始めました。Kotoba EDN と arXiv workflow を確認しています。"
                :events []
                :spinning? true})
  (add-message! :user "manimani")
  (add-message! :assistant "Kotoba EDN を見ながら、未処理・承認待ち・arXiv workflow の順に進めます。")
  (-> (json-fetch "/api/manimani" {:method "POST"})
      (.then (fn [body]
               (set-runner! {:run-id (:runId body)
                             :phase (or (:phase body) "starting")
                             :summary (or (:summary body) "started")
                             :steps (vec (or (:steps body) []))
                             :log-path (:logPath body)
                             :spinning? false})
               (js/setTimeout #(runner-status! (:runId body) 30) 900)))
      (.catch (fn [err]
                (set-runner! {:phase "error"
                              :summary (str "manimani start failed: " (.-message err))
                              :spinning? false})))))

(def manimani-character
  {:name "manimaniくん"
   :role "予定と会話をつないで、牛のままマニ車を回して進める小さなルーティング係"
   :tone "slow, gentle, earnest"})

(def suggestions
  [{:id "triage-projects" :kind "inbox" :title "未処理: facts/projects.edn points to missing anchors" :detail "manimani storage"}
   {:id "triage-people" :kind "inbox" :title "未処理: facts/people.edn points to missing anchors" :detail "manimani storage"}
   {:id "triage-orgs" :kind "inbox" :title "未処理: facts/orgs.edn points to missing anchors" :detail "manimani storage"}
   {:id "decisions" :kind "inbox" :title "未処理: facts/decisions.edn has 1 records" :detail "manimani storage"}
   {:id "curation" :kind "inbox" :title "未処理: facts/curation-queue.edn points to pending review" :detail "manimani storage"}
   {:id "kotoba" :kind "project" :title "Kotoba arXiv 投稿 workflow を進める" :detail "cs.CL 投稿 session を manimani agent loop で再開できます"}])

(def agenda
  [{:time "09:00" :title "Kotoba arXiv 投稿 workflow ..." :detail "cs.CL 投稿 session を manimani ..." :duration "30m"}
   {:time "10:00" :title "未処理: facts/projects.edn p..." :detail "manimani storage" :duration "15m"}
   {:time "11:00" :title "承認待ちの agent session" :detail "agent loop handoff" :duration "25m"}])

(def nav-items
  [{:id :today :icon "◆" :label "Today"}
   {:id :calendar :icon "□" :label "Calendar"}
   {:id :queue :icon "●" :label "Inbox"}
   {:id :agents :icon "◇" :label "Agents"}
   {:id :keys :icon "⌘" :label "Keys"}
   {:id :logs :icon "≡" :label "Log"}
   {:id :stats :icon "▦" :label "Stats"}])

(defn manimani-kun
  ([] [manimani-kun :md])
  ([size]
   (let [class (case size :sm "mascot sm" :lg "mascot lg" "mascot")
         stroke (case size :sm 3.2 2.8)]
     [:svg {:class class :view-box "0 0 128 144" :role "img" :aria-label (:name manimani-character)}
      [:title (:name manimani-character)]
      [:desc (:role manimani-character)]
      [:defs
       [:radialGradient {:id (str "mm-body-" (name size)) :cx "45%" :cy "28%" :r "78%"}
        [:stop {:offset "0%" :stop-color "#fffefc"}]
        [:stop {:offset "78%" :stop-color "#f8ede3"}]
        [:stop {:offset "100%" :stop-color "#e8d2c2"}]]
       [:radialGradient {:id (str "mm-wheel-" (name size)) :cx "50%" :cy "50%" :r "65%"}
        [:stop {:offset "0%" :stop-color "#18b7a8"}]
        [:stop {:offset "100%" :stop-color "#0b4a58"}]]]
      [:ellipse {:cx 64 :cy 132 :rx 28 :ry 5.5 :fill "#6b4d43" :opacity "0.10"}]
      [:circle {:cx 64 :cy 76 :r 43 :fill "none" :stroke "#14b8a6" :stroke-width 5 :opacity "0.22"}]
      [:circle {:cx 64 :cy 76 :r 33 :fill "none" :stroke "#14b8a6" :stroke-width 3.5 :opacity "0.18"}]
      [:path {:d "M64 33 V119" :fill "none" :stroke "#14b8a6" :stroke-width 3.8 :stroke-linecap "round" :opacity "0.36"}]
      [:path {:d "M21 76 H107" :fill "none" :stroke "#14b8a6" :stroke-width 3.8 :stroke-linecap "round" :opacity "0.36"}]
      [:path {:d "M34 46 L94 106" :fill "none" :stroke "#14b8a6" :stroke-width 3.8 :stroke-linecap "round" :opacity "0.32"}]
      [:path {:d "M94 46 L34 106" :fill "none" :stroke "#14b8a6" :stroke-width 3.8 :stroke-linecap "round" :opacity "0.32"}]
      [:circle {:cx 64 :cy 76 :r 8.5 :fill (str "url(#mm-wheel-" (name size) ")") :opacity "0.28"}]
      [:path {:d "M45 43 C47 31 51 24 56 22 C60 26 60 34 56 43" :fill "#fff7ea" :stroke "#6b4d43" :stroke-width stroke :stroke-linecap "round" :stroke-linejoin "round"}]
      [:path {:d "M83 43 C81 31 77 24 72 22 C68 26 68 34 72 43" :fill "#fff7ea" :stroke "#6b4d43" :stroke-width stroke :stroke-linecap "round" :stroke-linejoin "round"}]
      [:path {:d "M36 54 C24 41 23 31 30 24 C40 19 51 29 55 45" :fill "#fff7ea" :stroke "#6b4d43" :stroke-width stroke :stroke-linecap "round" :stroke-linejoin "round"}]
      [:path {:d "M92 54 C104 41 105 31 98 24 C88 19 77 29 73 45" :fill "#fff7ea" :stroke "#6b4d43" :stroke-width stroke :stroke-linecap "round" :stroke-linejoin "round"}]
      [:ellipse {:cx 64 :cy 77 :rx 38 :ry 39 :fill (str "url(#mm-body-" (name size) ")") :stroke "#6b4d43" :stroke-width stroke}]
      [:ellipse {:cx 64 :cy 89 :rx 22 :ry 16 :fill "#6b4d43" :opacity "0.12"}]
      [:ellipse {:cx 64 :cy 91 :rx 18 :ry 13 :fill "#f2c9c1" :stroke "#6b4d43" :stroke-width 1.6}]
      [:circle {:cx 56 :cy 77 :r 3.6 :fill "#3f2f2a"}]
      [:circle {:cx 72 :cy 77 :r 3.6 :fill "#3f2f2a"}]
      [:circle {:cx 51 :cy 80 :r 1.5 :fill "#ffffff" :opacity "0.6"}]
      [:circle {:cx 77 :cy 80 :r 1.5 :fill "#ffffff" :opacity "0.6"}]
      [:path {:d "M58 84 Q64 89 70 84" :fill "none" :stroke "#3f2f2a" :stroke-width 2.3 :stroke-linecap "round"}]
      [:path {:d "M52 65 C47 61 44 56 45 49" :fill "none" :stroke "#6b4d43" :stroke-width 3 :stroke-linecap "round"}]
      [:path {:d "M76 65 C81 61 84 56 83 49" :fill "none" :stroke "#6b4d43" :stroke-width 3 :stroke-linecap "round"}]
      [:path {:d "M34 77 C24 71 21 64 23 57" :fill "none" :stroke "#6b4d43" :stroke-width 5.5 :stroke-linecap "round" :opacity "0.9"}]
      [:path {:d "M94 77 C104 71 107 64 105 57" :fill "none" :stroke "#6b4d43" :stroke-width 5.5 :stroke-linecap "round" :opacity "0.9"}]
      [:circle {:cx 35 :cy 61 :r 2.2 :fill "#14b8a6"}]
      [:circle {:cx 93 :cy 61 :r 2.2 :fill "#14b8a6"}]
      [:circle {:cx 35 :cy 92 :r 2.2 :fill "#14b8a6"}]
      [:circle {:cx 93 :cy 92 :r 2.2 :fill "#14b8a6"}]
      [:circle {:cx 64 :cy 76 :r 3.2 :fill "#14b8a6"}]])))

(defn css []
  (let [{:keys [radius-window radius-control radius-pill radius-bubble touch
                content-max accent accent-hover danger text muted]} theme]
    (str
     ":root{color-scheme:dark;--radius-window:" radius-window ";--radius-control:" radius-control
     ";--radius-pill:" radius-pill ";--radius-bubble:" radius-bubble ";--touch:" touch
     ";--content-max:" content-max
     ";--accent:" accent ";--accent-hover:" accent-hover ";--danger:" danger
     ";--text:" text ";--muted:" muted ";}"
     "*{box-sizing:border-box}html,body,#app{margin:0;height:100%;}"
     "body{overflow:hidden;background:#000;color:var(--text);font:14px/1.45 -apple-system,BlinkMacSystemFont,'SF Pro Display','SF Pro Text','Hiragino Sans','Noto Sans JP',sans-serif;-webkit-font-smoothing:antialiased;}"
     "button,input,textarea{font:inherit}button{cursor:pointer}.app{height:100%;padding:20px 20px calc(20px + env(safe-area-inset-bottom));background:#000;display:grid;place-items:center;}"
     ".mac-window{width:min(100%,1360px);height:min(860px,calc(100vh - 40px));min-height:620px;border:1px solid rgba(255,255,255,.22);border-radius:28px;background:#050505;box-shadow:0 30px 90px rgba(0,0,0,.72);overflow:hidden;display:grid;grid-template-rows:52px minmax(0,1fr);}"
     ".titlebar{display:flex;align-items:center;gap:18px;padding:0 18px;border-bottom:1px solid rgba(255,255,255,.16);background:#050505}.traffic{display:flex;gap:12px}.traffic span{width:28px;height:28px;border-radius:50%;background:#242426}.window-title{font-size:24px;font-weight:800;color:#545459;letter-spacing:-.01em}.auth{margin-left:auto;display:flex;align-items:center;gap:8px}.auth button{min-height:32px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:#1c1c1e;color:#f5f5f7;padding:0 12px}.auth .primary{background:var(--accent);border-color:var(--accent)}.handle,.muted{color:var(--muted);font-size:12px}"
     ".workspace{height:100%;min-height:0;overflow:hidden;display:grid;grid-template-columns:112px minmax(0,1fr);padding:130px 12px 0 36px}.rail{width:112px;min-height:0;border-right:1px solid rgba(255,255,255,.24);background:#18181b;display:flex;flex-direction:column;align-items:center;padding:30px 0 18px;gap:12px}.nav-btn{width:80px;height:80px;border:0;border-radius:12px;background:transparent;color:#a1a1aa;font-size:28px;display:grid;place-items:center}.nav-btn.active{background:#13213a;color:var(--accent)}.nav-btn:hover{background:rgba(255,255,255,.08);color:#f5f5f7}.mascot{width:42px;height:48px;display:block}.mascot.sm{width:48px;height:54px}.mascot.lg{width:64px;height:72px}"
     ".hig-shell{min-width:0;min-height:0;height:100%;display:grid;grid-template-columns:minmax(420px,1.08fr) minmax(360px,.72fr);border:1px solid rgba(255,255,255,.28);border-radius:10px 10px 0 0;background:#1f1f22;overflow:hidden}.today-pane,.chat-pane{min-width:0;min-height:0;display:flex;flex-direction:column}.today-pane{border-right:1px solid rgba(255,255,255,.28);background:#202023}.pane-head{height:172px;display:flex;align-items:center;gap:26px;padding:28px 48px;border-bottom:1px solid rgba(255,255,255,.22);background:#202023}.pane-head h1{margin:0;font-size:40px;line-height:1;font-weight:800;letter-spacing:-.03em}.pane-head p{margin:12px 0 0;color:#a1a1aa;font-size:20px;line-height:1.45;font-weight:600}.suggestions{min-height:0;flex:1;overflow:auto;padding:24px 26px 18px}.suggestion{width:100%;min-height:132px;margin:0 0 18px;padding:26px 26px;border:1px solid rgba(255,255,255,.22);border-radius:10px;background:#030303;color:#f5f5f7;text-align:left;display:grid;gap:14px;overflow:hidden}.suggestion:hover{border-color:rgba(10,132,255,.7);background:#070b10}.suggestion-top{display:flex;gap:26px;align-items:baseline;min-width:0}.kind{color:var(--accent);font-size:20px}.suggestion-title{min-width:0;font-size:22px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.suggestion-detail{color:#9b9ba2;font-size:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.agenda-title{margin:18px 0 12px;color:#9b9ba2;font-size:15px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}.agenda-row{height:54px;border:1px solid rgba(255,255,255,.18);border-radius:7px;background:#050505;display:grid;grid-template-columns:72px minmax(0,1fr) 46px;align-items:center;gap:14px;padding:0 14px;margin-bottom:8px;color:#d8d8dc}.agenda-time{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#c9c9cf}.agenda-copy{min-width:0}.agenda-copy strong,.agenda-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.agenda-copy span{color:#8e8e93;font-size:13px}.agenda-duration{text-align:right;color:#9b9ba2;font-size:13px}"
     ".chat-head{height:130px;display:flex;align-items:center;gap:22px;padding:22px 58px;border-bottom:1px solid rgba(255,255,255,.22);background:#202023}.chat-head strong{font-size:28px}.chat-head span{display:block;color:#9b9ba2;font-size:18px}.thread-wrap{min-height:0;flex:1;overflow:auto;padding:40px 42px}.thread{max-width:760px;margin:0 auto;display:flex;flex-direction:column;gap:22px}.row{display:flex}.row.user{justify-content:flex-end}.bubble{max-width:min(420px,84%);white-space:pre-wrap;overflow-wrap:anywhere;border-radius:26px;padding:24px 32px;border:1px solid rgba(10,132,255,.45);background:#02060a;color:#f5f5f7;font-size:24px;line-height:1.65}.row.user .bubble{background:#032b12;border-color:rgba(52,199,89,.42);font-size:15px;line-height:1.5}.row.system .bubble{background:#111;border-color:rgba(255,255,255,.18);color:#a1a1aa;font-size:14px}.badge{font-size:20px;font-weight:800;margin-bottom:12px}.row.user .badge{font-size:13px}.assistant-badge{color:#f5f5f7}.user-badge{color:#d7ffe1}.cursor{color:var(--accent);animation:blink 1s steps(2) infinite}@keyframes blink{50%{opacity:0}}"
     ".manimani-action{margin-left:auto;display:flex;align-items:center;gap:12px}.wheel{width:42px;height:42px;border-radius:50%;border:1px solid rgba(20,184,166,.45);background:radial-gradient(circle,#fff8f3 0 23%,#6b4d43 24% 27%,transparent 28%),conic-gradient(from 0deg,#14b8a6,#0a84ff,#f1caca,#14b8a6);box-shadow:0 0 24px rgba(20,184,166,.18)}.wheel.spinning{animation:mani-wheel 1.1s linear infinite}@keyframes mani-wheel{to{transform:rotate(360deg)}}.mani-btn{min-height:44px;border:0;border-radius:14px;background:var(--accent);color:#fff;font-weight:800;padding:0 16px}.mani-btn:disabled{opacity:.72}.runner-panel{margin-top:18px;border:1px solid rgba(20,184,166,.28);border-radius:18px;background:rgba(20,184,166,.08);padding:14px 16px}.runner-top{display:flex;align-items:center;gap:10px}.runner-phase{border-radius:999px;background:rgba(10,132,255,.18);color:#8ecbff;padding:4px 9px;font-size:12px;font-weight:800}.runner-summary{margin-top:10px;color:#d8f7f2;font-size:14px;line-height:1.5}.runner-events{margin:10px 0 0;padding:0;list-style:none;display:grid;gap:6px}.runner-events li{display:grid;grid-template-columns:72px minmax(0,1fr);gap:8px;color:#a1d8d0;font-size:12px}.runner-events b{color:#f5f5f7}.runner-id{margin-top:8px;color:#7f8c8d;font:11px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
     ".composer{border-top:1px solid rgba(255,255,255,.22);padding:26px 34px;background:#1b1b1d}.composer-shell{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;border:1px solid rgba(255,255,255,.24);border-radius:28px;background:#050505;padding:10px 12px 10px 18px}textarea{width:100%;min-height:48px;max-height:160px;resize:none;border:0;background:transparent;color:#f5f5f7;padding:12px 0;outline:none}.send{min-height:48px;border:0;border-radius:10px;background:var(--accent);color:white;font-weight:800;padding:0 22px}.send:disabled{opacity:.45}.tier{display:none}"
     ".empty-note{margin:auto;color:#9b9ba2}.placeholder{display:grid;place-items:center;height:100%;color:#9b9ba2}"
     "@media(max-width:980px){.app{padding:0}.mac-window{width:100%;height:100%;min-height:0;border-radius:0;border:0}.titlebar{height:48px}.traffic,.window-title{display:none}.workspace{grid-template-columns:1fr;padding:0}.rail{position:fixed;z-index:3;left:0;right:0;bottom:0;width:auto;height:72px;border-right:0;border-top:1px solid rgba(255,255,255,.2);flex-direction:row;justify-content:center;padding:8px env(safe-area-inset-right) calc(8px + env(safe-area-inset-bottom)) env(safe-area-inset-left);gap:4px}.rail .mascot{display:none}.nav-btn{width:54px;height:54px;font-size:18px}.hig-shell{height:100%;border:0;border-radius:0;grid-template-columns:1fr;grid-template-rows:minmax(38%,auto) minmax(0,1fr);padding-bottom:72px}.today-pane{border-right:0;border-bottom:1px solid rgba(255,255,255,.22)}.pane-head{height:auto;padding:18px 18px}.pane-head h1{font-size:28px}.pane-head p{font-size:14px}.suggestions{padding:14px;display:flex;gap:10px;overflow-x:auto}.suggestion{flex:0 0 min(82vw,360px);min-height:110px;margin:0;padding:18px}.suggestion-title{font-size:16px}.kind,.suggestion-detail{font-size:14px}.agenda-title,.agenda-row{display:none}.chat-head{height:auto;padding:12px 18px}.chat-head strong{font-size:19px}.chat-head span{font-size:13px}.manimani-action{gap:8px}.wheel{width:34px;height:34px}.mani-btn{min-height:38px;padding:0 12px}.thread-wrap{padding:18px 14px}.bubble{font-size:16px;padding:14px 16px;border-radius:20px}.badge{font-size:13px;margin-bottom:6px}.composer{padding:10px 12px}.composer-shell{border-radius:18px}.send{min-height:42px}}"
     "@media(max-width:560px){.hig-shell{grid-template-rows:auto minmax(0,1fr)}.today-pane{max-height:292px}.chat-head .mascot{width:42px;height:48px}.thread{gap:12px}.bubble{max-width:92%}}")))

(defn topbar []
  (let [{:keys [viewer]} @state]
    [:header.titlebar
     [:div.traffic {:aria-hidden true} [:span] [:span] [:span]]
     [:div.window-title "manimani — 対応キュー (HIG)"]
     [:div.auth
      (case (:status viewer)
        :loading [:span.muted "..."]
        :signed-in [:span.auth-inline
                    [:span.handle {:title (get-in viewer [:viewer :did])}
                     (short-label (:viewer viewer))]
                    [:button {:type "button" :on-click sign-out!} "Sign out"]]
        :error [:span.auth-inline
                [:span.muted {:title (:message viewer)} "auth offline"]
                [:button {:type "button" :on-click sign-in!} "Sign in"]]
        [:button.primary {:type "button" :on-click sign-in!} "Sign in"])]]))

(defn nav-rail []
  (let [{:keys [mode]} @state]
    [:aside.rail
     [manimani-kun :sm]
     (for [{:keys [id icon label]} nav-items]
       ^{:key (name id)}
       [:button.nav-btn {:type "button"
                         :class (when (= mode id) "active")
                         :title label
                         :aria-label label
                         :on-click #(set-state! :mode id)}
        icon])]))

(defn suggestion-card [s]
  [:button.suggestion {:type "button"
                       :on-click #(do
                                    (set-state! :mode :today)
                                    (add-message! :user (:title s))
                                    (add-message! :assistant "了解です。この提案を起点に、必要な確認と次の action を順番に出します。"))}
   [:div.suggestion-top
    [:span.kind (:kind s)]
    [:span.suggestion-title (:title s)]]
   [:div.suggestion-detail (:detail s)]])

(defn agenda-row [a]
  [:div.agenda-row
   [:div.agenda-time (:time a)]
   [:div.agenda-copy
    [:strong (:title a)]
    [:span (:detail a)]]
   [:div.agenda-duration (:duration a)]])

(defn today-pane []
  [:section.today-pane
   [:div.pane-head
    [manimani-kun :sm]
    [:div
     [:h1 "Today"]
     [:p (:role manimani-character)]]]
   [:div.suggestions
    (for [s suggestions]
      ^{:key (:id s)} [suggestion-card s])
    [:div.agenda-title "Calendar"]
    (for [a agenda]
      ^{:key (str "agenda-" (:time a))} [agenda-row a])]])

(defn message-row [msg]
  (let [role (keyword (:role msg))
        assistant? (= role :assistant)
        user? (= role :user)]
    [:div.row {:class (cond user? "user" assistant? "assistant" :else "system")}
     [:div.bubble
      [:div.badge {:class (cond user? "user-badge" assistant? "assistant-badge" :else nil)}
       (cond user? "You" assistant? "manimaniくん" :else (:role msg))]
      [:div.content (:content msg)]]]))

(defn thread []
  (let [{:keys [messages streaming stream-status tool-events]} @state]
    [:div.thread-wrap
     (if (and (empty? messages) (str/blank? streaming))
       [:div.thread
        [message-row {:msgId "hello"
                      :role "assistant"
                      :content "今日は、未処理のもの・承認待ち・進行中の agent session から順に提案します。ここで指示してくれれば進めます。"}]]
       [:div.thread
        (for [m messages] ^{:key (:msgId m)} [message-row m])
        (when (or (seq streaming) stream-status)
          [:div.row.assistant
           [:div.bubble
            [:div.badge.assistant-badge "manimaniくん"]
            (if (seq streaming)
              [:div.content streaming [:span.cursor "▍"]]
              [:div.content.muted stream-status])
            (when (seq tool-events)
              [:div.capsules
               (for [ev tool-events]
                 ^{:key (str (:tool ev) (:summary ev))}
                 [:span (:tool ev)])])]])])]))

(defn composer []
  (let [{:keys [composer tier busy?]} @state]
    [:form.composer {:on-submit (fn [e] (.preventDefault e) (submit!))}
     [:div.composer-shell
      [:textarea {:value composer
                  :rows 1
                  :placeholder "Ask what to handle today, or type arXiv to continue Kotoba submission"
                  :disabled busy?
                  :aria-label "Message"
                  :on-change #(set-state! :composer (.. % -target -value))
                  :on-key-down (fn [e]
                                 (when (and (= "Enter" (.-key e))
                                            (not (.-shiftKey e))
                                            (not (.-isComposing e)))
                                   (.preventDefault e)
                                   (submit!)))}]
      [:button.send {:type "submit" :disabled (or busy? (str/blank? composer))}
       (if busy? "Sending" "Send")]]]))

(defn runner-panel []
  (let [{:keys [phase summary events run-id spinning? updated-at steps]} (:runner @state)]
    [:div.runner-panel
     [:div.runner-top
      [:div {:class (str "wheel" (when spinning? " spinning")) :aria-hidden true}]
      [:span.runner-phase (or phase "idle")]
      (when updated-at [:span.muted updated-at])]
     [:div.runner-summary summary]
     (when (seq steps)
       [:div.runner-summary
        (for [{:keys [name ok? output error]} steps]
          ^{:key name}
          [:div {:style {:margin-top "8px"}}
           [:b name]
           (str " · " (if ok? "ok" "ng"))
           (when (seq (str output))
             [:div {:style {:white-space "pre-wrap" :font-family "ui-monospace, SFMono-Regular, Menlo, monospace" :font-size "11px" :color "#a1d8d0"}}
              (subs (str output) 0 (min 360 (count (str output))))])
           (when (seq (str error))
             [:div {:style {:color "#ff907f" :font-size "11px"}} (subs (str error) 0 (min 200 (count (str error))))])])])
     (when (seq events)
       [:ul.runner-events
        (for [[idx ev] (map-indexed vector (take-last 5 events))]
          ^{:key (str idx (:phase ev) (:note ev))}
          [:li
           [:b (:phase ev)]
           [:span (:note ev)]])])
     (when run-id [:div.runner-id run-id])]))

(defn chat-pane []
  [:section.chat-pane
   [:header.chat-head
    [manimani-kun]
    [:div
     [:strong (:name manimani-character)]
     [:span (:tone manimani-character)]]
    [:div.manimani-action
     [:div {:class (str "wheel" (when (get-in @state [:runner :spinning?]) " spinning"))
            :aria-hidden true}]
     [:button.mani-btn {:type "button"
                        :disabled (get-in @state [:runner :spinning?])
                        :on-click start-manimani!}
      (if (get-in @state [:runner :spinning?]) "Working" "manimani")]]]
   [thread]
   [:div {:style {:padding "0 42px 18px"}} [runner-panel]]
   [composer]])

(defn placeholder-view [title body]
  [:div.hig-shell
   [:section.today-pane
    [:div.pane-head
     [manimani-kun :sm]
     [:div
      [:h1 title]
      [:p body]]]
    [:div.placeholder "この面もCLJS/Hiccup/Reagentで続けて移せます。"]]
   [chat-pane]])

(defn app []
  (let [{:keys [mode]} @state]
    [:div.app
     [:style (css)]
     [:div.mac-window
      [topbar]
      [:div.workspace
       [nav-rail]
       (case mode
         :today [:main.hig-shell [today-pane] [chat-pane]]
         :calendar [placeholder-view "Calendar" "manimaniくんの時間割"]
         :queue [placeholder-view "Inbox" "未処理キューと返信判断"]
         :agents [placeholder-view "Agents" "承認待ち・進行中 session"]
         :keys [placeholder-view "Keys" "human-approved secret custody"]
         :logs [placeholder-view "Log" "agent loop の実行履歴"]
         :stats [placeholder-view "Stats" "処理数とコスト"]
         [:main.hig-shell [today-pane] [chat-pane]])]]]))

(defn mount! []
  (when-let [el (.getElementById js/document "app")]
    (let [r (or @root (rdom/create-root el))]
      (reset! root r)
      (rdom/render r [app]))))

(defn init! []
  (mount!)
  (load-viewer!)
  (load-conversations!))
