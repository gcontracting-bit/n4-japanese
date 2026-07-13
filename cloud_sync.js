// Japanese Learning cloud sync — N4 edition. Shared across every page of the
// N4 project. Mirrors a small set of localStorage keys to Supabase and streams
// realtime updates back in when any device writes to the cloud.
//
// IMPORTANT: The N4 and N5 sites live on the SAME GitHub Pages origin
// (gcontracting-bit.github.io), so they share one localStorage AND one Supabase
// table. Every tracked key here is therefore namespaced with an "n4_" prefix so
// N4 study progress can never overwrite N5 progress (and vice-versa).
//
// Requirements: this file must be loaded AFTER the Supabase JS CDN:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="cloud_sync.js"></script>

(function () {
  "use strict";

  var SUPABASE_URL = "https://zknkjedxudhdzphxxsfj.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InprbmtqZWR4dWRoZHpwaHh4c2ZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYyNzIxNzksImV4cCI6MjA5MTg0ODE3OX0.RgE2FZPDOmSpy1XeC7JMmTxpWgi0QbCATnvMoF3zEfQ";
  var TABLE = "learning_japanese_state";
  // N4-namespaced tracked keys (kept separate from the N5 keys in the same table).
  var TRACKED_KEYS = ["n4_kanji_scores", "n4_vocab_scores", "n4_grammar_checked", "n4_study_plan_completed", "n4_mock_attempts"];

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    console.warn("[cloud_sync] Supabase JS not loaded. Include the CDN script before cloud_sync.js.");
    return;
  }

  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Expose a tiny global API in case a page wants to hook in.
  window.CloudSync = { sb: sb, table: TABLE, trackedKeys: TRACKED_KEYS.slice() };

  // --- Monkey-patch localStorage so existing code auto-syncs ------------------
  var nativeSetItem = Storage.prototype.setItem.bind(localStorage);
  var nativeGetItem = Storage.prototype.getItem.bind(localStorage);
  var nativeRemoveItem = Storage.prototype.removeItem.bind(localStorage);

  var suppressPush = false;       // set true while applying cloud->local updates
  var pendingPushes = new Map();  // key -> stringified value
  var pushTimer = null;

  function schedulePush(key, value) {
    if (suppressPush) return;
    pendingPushes.set(key, value);
    clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPushes, 700);
  }

  async function flushPushes() {
    if (pendingPushes.size === 0) return;
    var entries = Array.from(pendingPushes.entries());
    pendingPushes.clear();
    setStatus("syncing", "Saving...");
    var payload = entries.map(function (kv) {
      var parsed;
      try { parsed = JSON.parse(kv[1]); } catch (e) { parsed = kv[1]; }
      return { key: kv[0], value: parsed };
    });
    try {
      var res = await sb.from(TABLE).upsert(payload, { onConflict: "key" });
      if (res.error) throw res.error;
      setStatus("synced", "Live");
    } catch (e) {
      console.warn("[cloud_sync] push failed:", e);
      setStatus("error", "Cloud error");
    }
  }

  localStorage.setItem = function (key, value) {
    nativeSetItem(key, value);
    if (TRACKED_KEYS.indexOf(key) !== -1) schedulePush(key, value);
  };
  localStorage.removeItem = function (key) {
    nativeRemoveItem(key);
    if (TRACKED_KEYS.indexOf(key) !== -1 && !suppressPush) {
      sb.from(TABLE).delete().eq("key", key).then(function (r) {
        if (r.error) console.warn("[cloud_sync] delete failed:", r.error);
      });
    }
  };

  // --- Per-entry merge for the score maps ------------------------------------
  // n4_vocab_scores / n4_kanji_scores are { "word|en": entry } maps. Mirroring
  // them as a single blob with last-write-wins means a stale push from one
  // tab/device can silently drop entries another device just earned. For these
  // keys we MERGE per entry instead: union the keys, and on a conflict keep
  // whichever entry shows more learning activity. A merge can therefore only
  // ADD/UPGRADE an entry, never lose one. Every other tracked key keeps the
  // original cloud-wins-on-load behavior.
  var SCORE_MAP_KEYS = ["n4_kanji_scores", "n4_vocab_scores"];

  function activityScore(e) {
    if (!e || typeof e !== "object") return -1;
    var total = (typeof e.total === "number") ? e.total : 0;
    var engaged = total > 1 || e.state === "a" || e.state === "r" ||
                  (typeof e.streak === "number" && e.streak < 0);
    return (engaged ? 1e6 : 0) + total;
  }

  function mergeScoreMap(localMap, cloudMap) {
    var out = {}, changed = false, k;
    for (k in cloudMap) out[k] = cloudMap[k];
    for (k in localMap) {
      if (!(k in cloudMap)) { out[k] = localMap[k]; changed = true; }
      else if (activityScore(localMap[k]) > activityScore(cloudMap[k])) {
        out[k] = localMap[k]; changed = true;
      }
    }
    return { value: out, changed: changed };
  }

  function isPlainObject(v) {
    return v && typeof v === "object" && !Array.isArray(v);
  }

  function reconcile(key, localVal, cloudVal) {
    if (SCORE_MAP_KEYS.indexOf(key) !== -1 && isPlainObject(localVal) && isPlainObject(cloudVal)) {
      return mergeScoreMap(localVal, cloudVal);
    }
    return { value: cloudVal, changed: false }; // cloud wins (original behavior)
  }

  function readLocalParsed(key) {
    try { var raw = nativeGetItem(key); return raw == null ? undefined : JSON.parse(raw); }
    catch (e) { return undefined; }
  }

  // --- Initial fetch: cloud wins on page load (per-key merge for score maps) --
  async function initialFetch() {
    setStatus("syncing", "Connecting...");
    try {
      var res = await sb.from(TABLE).select("*").in("key", TRACKED_KEYS);
      if (res.error) throw res.error;
      suppressPush = true;
      var cloudKeys = new Set();
      var pushAfterMerge = [];
      (res.data || []).forEach(function (row) {
        cloudKeys.add(row.key);
        var rec = reconcile(row.key, readLocalParsed(row.key), row.value);
        nativeSetItem(row.key, JSON.stringify(rec.value));
        if (rec.changed) pushAfterMerge.push([row.key, JSON.stringify(rec.value)]);
      });
      suppressPush = false;
      TRACKED_KEYS.forEach(function (k) {
        if (!cloudKeys.has(k)) {
          var v = nativeGetItem(k);
          if (v != null) schedulePush(k, v);
        }
      });
      pushAfterMerge.forEach(function (kv) { schedulePush(kv[0], kv[1]); });
      setStatus("synced", "Live");
      window.dispatchEvent(new CustomEvent("cloudsync:ready"));
    } catch (e) {
      console.warn("[cloud_sync] initial fetch failed:", e);
      setStatus("error", "Cloud error");
    }
  }

  // --- Realtime subscription -------------------------------------------------
  function subscribeRealtime() {
    sb.channel("learning_japanese_state_n4_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: TABLE }, function (payload) {
        var row = payload.new || payload.old;
        if (!row || TRACKED_KEYS.indexOf(row.key) === -1) return;
        var pushBack = null;
        suppressPush = true;
        try {
          if (payload.eventType === "DELETE") {
            nativeRemoveItem(row.key);
          } else {
            var rec = reconcile(row.key, readLocalParsed(row.key), row.value);
            nativeSetItem(row.key, JSON.stringify(rec.value));
            if (rec.changed) pushBack = JSON.stringify(rec.value);
          }
        } finally {
          suppressPush = false;
        }
        if (pushBack) schedulePush(row.key, pushBack);
        window.dispatchEvent(new CustomEvent("cloudsync:update", { detail: { key: row.key, eventType: payload.eventType } }));
        setStatus("synced", "Live • updated from another device");
        setTimeout(function () { setStatus("synced", "Live"); }, 2000);
      })
      .subscribe(function (status) {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setStatus("error", "Realtime lost");
      });
  }

  // --- Small status pill injected into every page ---------------------------
  function injectIndicator() {
    if (document.getElementById("cloudSyncIndicator")) return;
    var el = document.createElement("div");
    el.id = "cloudSyncIndicator";
    el.style.cssText = [
      "position:fixed", "top:10px", "right:10px", "z-index:99999",
      "font-family:system-ui,-apple-system,sans-serif", "font-size:12px",
      "padding:4px 10px", "border-radius:12px",
      "background:#f8fafc", "border:1px solid #e2e8f0", "color:#64748b",
      "pointer-events:none", "user-select:none",
      "box-shadow:0 1px 2px rgba(0,0,0,0.04)"
    ].join(";");
    el.textContent = "Connecting...";
    document.body.appendChild(el);
  }

  function setStatus(state, text) {
    var el = document.getElementById("cloudSyncIndicator");
    if (!el) return;
    var styles = {
      synced:  { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d" },
      syncing: { bg: "#fffbeb", border: "#fde68a", color: "#b45309" },
      error:   { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" }
    };
    var s = styles[state] || { bg: "#f8fafc", border: "#e2e8f0", color: "#64748b" };
    el.style.background = s.bg;
    el.style.borderColor = s.border;
    el.style.color = s.color;
    el.textContent = text || state;
  }

  function boot() {
    injectIndicator();
    initialFetch();
    subscribeRealtime();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
