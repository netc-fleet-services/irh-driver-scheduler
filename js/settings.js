// Shared, editable runtime settings stored in `public.app_settings`.
// One row per key; `value` is JSONB. Today the only key is "optimizer".
//
// Resolution order at read time:
//   loaded value -> APP_CONFIG default -> hardcoded fallback.
//
// Other modules read via Settings.get("optimizer", "callsPerDriverPerHour"),
// which is identical to APP_CONFIG.optimizer.callsPerDriverPerHour after
// load(). Optimizer.js uses this so admins can tweak thresholds at runtime
// without redeploying.

window.Settings = (function () {

  // In-memory cache. Keyed by setting group ("optimizer", ...).
  const cache = new Map();
  const listeners = new Set();
  let loaded = false;
  let loadPromise = null;
  let realtimeChannel = null;

  function defaultsFor(key) {
    const cfg = window.APP_CONFIG || {};
    if (key === "optimizer") return { ...(cfg.optimizer || {}) };
    return {};
  }

  // ---------- Load ----------

  async function load() {
    if (loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const { data, error } = await window.sb
          .from("app_settings")
          .select("key, value");
        if (error) throw error;
        for (const r of data || []) cache.set(r.key, r.value || {});
      } catch (err) {
        console.warn("Settings load failed; using config defaults.", err);
      }
      loaded = true;
      subscribeRealtime();
      notify();
    })();
    return loadPromise;
  }

  // Subscribe so changes from other tabs/users update local cache.
  function subscribeRealtime() {
    if (realtimeChannel || !window.sb?.channel) return;
    try {
      realtimeChannel = window.sb
        .channel("app_settings_changes")
        .on("postgres_changes",
          { event: "*", schema: "public", table: "app_settings" },
          (payload) => {
            const row = payload.new || payload.old;
            if (!row?.key) return;
            if (payload.eventType === "DELETE") cache.delete(row.key);
            else cache.set(row.key, row.value || {});
            notify();
          })
        .subscribe();
    } catch (err) {
      console.warn("Settings realtime subscribe failed:", err);
    }
  }

  // ---------- Read ----------

  // Get the merged setting group: defaults from APP_CONFIG overlaid by the
  // saved row.
  function getGroup(key) {
    return { ...defaultsFor(key), ...(cache.get(key) || {}) };
  }

  // Get a single field, falling back to APP_CONFIG, then to the supplied
  // hardcoded default.
  function get(key, field, fallback) {
    const group = getGroup(key);
    if (group[field] === undefined || group[field] === null) return fallback;
    return group[field];
  }

  // ---------- Write ----------

  // Upsert a full group. Returns the merged value as it now lives in cache.
  async function setGroup(key, value) {
    const merged = { ...defaultsFor(key), ...value };
    const { error } = await window.sb
      .from("app_settings")
      .upsert({ key, value: merged }, { onConflict: "key" });
    if (error) throw error;
    cache.set(key, merged);
    notify();
    return merged;
  }

  // ---------- Change subscription (in-page) ----------

  // Local listeners. Useful for re-rendering the Coverage panel when a save
  // happens in the Settings tab without a full page reload.
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notify() {
    for (const fn of listeners) {
      try { fn(); } catch (err) { console.error("Settings listener error:", err); }
    }
  }

  return {
    load,
    getGroup,
    get,
    setGroup,
    onChange,
  };
})();
