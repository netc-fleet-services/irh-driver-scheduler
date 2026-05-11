// Settings tab. Lets dispatchers tune the optimizer's knobs at runtime.
// Reads/writes via window.Settings (which talks to public.app_settings).
//
// Save flow: form -> validate -> Settings.setGroup("optimizer", value).
// On success, the Settings realtime subscription pushes the change to all
// open browser tabs and Optimizer.js picks it up on its next read.

window.SettingsView = (function () {

  let panel, form, statusEl, saveBtn, resetBtn;
  let cpdEl, underEl, overEl, topUEl, topOEl, fnsEl, yardsEl;
  let mounted = false;

  // ---------- Mount ----------

  function mount() {
    if (mounted) return;
    panel    = document.getElementById("settings-view");
    form     = document.getElementById("settings-form");
    if (!panel || !form) return;

    cpdEl    = document.getElementById("setting-cpd");
    underEl  = document.getElementById("setting-under");
    overEl   = document.getElementById("setting-over");
    topUEl   = document.getElementById("setting-topu");
    topOEl   = document.getElementById("setting-topo");
    fnsEl    = document.getElementById("setting-fns");
    yardsEl  = document.getElementById("setting-yards");
    statusEl = document.getElementById("setting-status");
    saveBtn  = document.getElementById("setting-save");
    resetBtn = document.getElementById("setting-reset");

    form.addEventListener("submit", onSubmit);
    resetBtn.addEventListener("click", onReset);
    mounted = true;
  }

  // ---------- Open / close ----------

  async function open() {
    if (!panel) return;
    panel.hidden = false;
    if (window.Settings?.load) await Settings.load();
    populateForm(Settings.getGroup("optimizer"));
    setStatus("");
  }

  function close() {
    if (panel) panel.hidden = true;
  }

  // ---------- Form helpers ----------

  function populateForm(values) {
    cpdEl.value   = numberOr(values.callsPerDriverPerHour, 1.0);
    underEl.value = numberOr(values.understaffedThreshold, -1.0);
    overEl.value  = numberOr(values.overstaffedThreshold, 2.0);
    topUEl.value  = numberOr(values.topUnderstaffedCount, 5);
    topOEl.value  = numberOr(values.topOverstaffedCount, 3);
    fnsEl.value   = (values.supplyFunctions || ["LDT", "HDT"]).join(", ");
    yardsEl.value = (values.excludeYards || ["UFP"]).join(", ");
  }

  function numberOr(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseList(s) {
    return String(s || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean);
  }

  function readForm() {
    return {
      callsPerDriverPerHour: numberOr(cpdEl.value, 1.0),
      understaffedThreshold: numberOr(underEl.value, -1.0),
      overstaffedThreshold:  numberOr(overEl.value, 2.0),
      topUnderstaffedCount:  Math.max(0, Math.round(numberOr(topUEl.value, 5))),
      topOverstaffedCount:   Math.max(0, Math.round(numberOr(topOEl.value, 3))),
      supplyFunctions:       parseList(fnsEl.value),
      excludeYards:          parseList(yardsEl.value),
    };
  }

  function validate(v) {
    if (v.callsPerDriverPerHour <= 0)   return "Calls per driver per hour must be > 0.";
    if (v.understaffedThreshold > 0)    return "Understaffed cutoff must be ≤ 0 (negative gap means short).";
    if (v.overstaffedThreshold < 0)     return "Overstaffed cutoff must be ≥ 0 (positive gap means surplus).";
    if (!v.supplyFunctions.length)      return "At least one supply function is required.";
    return null;
  }

  // ---------- Submit ----------

  async function onSubmit(e) {
    e.preventDefault();
    const value = readForm();
    const err = validate(value);
    if (err) { setStatus(err, "error"); return; }

    saveBtn.disabled = true;
    setStatus("Saving…");
    try {
      await Settings.setGroup("optimizer", value);
      setStatus("Saved. Coverage panel will update on next paint.", "ok");
      // Refresh the schedule so the Coverage panel reflects new thresholds
      // immediately. Safe even if scheduler is not the active scene; it's a
      // pure recompute against cached data.
      if (window.Scheduler?.render) {
        try { await Scheduler.render(); } catch (e) { /* nothing surfaced here */ }
      }
    } catch (err) {
      console.error("Save settings failed:", err);
      setStatus(err.message || "Couldn't save.", "error");
    } finally {
      saveBtn.disabled = false;
    }
  }

  function onReset() {
    const defaults = (window.APP_CONFIG && window.APP_CONFIG.optimizer) || {};
    populateForm(defaults);
    setStatus("Reverted to config defaults — click Save to persist.");
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = "settings-status" + (kind ? " settings-status--" + kind : "");
  }

  return { mount, open, close };
})();
