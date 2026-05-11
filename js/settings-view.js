// Settings tab. Lets dispatchers tune the optimizer's knobs at runtime.
// Reads/writes via window.Settings (which talks to public.app_settings).
//
// Save flow: form -> validate -> Settings.setGroup("optimizer", value).
// On success, the Settings realtime subscription pushes the change to all
// open browser tabs and Optimizer.js picks it up on its next read.

window.SettingsView = (function () {

  let panel, form, statusEl, saveBtn, resetBtn;
  let cpdEl, sensitivityEl, topUEl, topOEl, fnsEl, yardsEl;
  let mounted = false;

  // Coverage-sensitivity presets. The UI exposes one dropdown; on save we
  // expand the chosen preset back into the two threshold fields the
  // optimizer actually reads (understaffedThreshold / overstaffedThreshold).
  // Order matters — used by the dropdown and by closest-match lookup.
  const SENSITIVITY_PRESETS = [
    { value: "very-relaxed",       understaffedThreshold: -3.5,  overstaffedThreshold: 4.5  },
    { value: "relaxed",            understaffedThreshold: -2.5,  overstaffedThreshold: 3.5  },
    { value: "balanced",           understaffedThreshold: -1.5,  overstaffedThreshold: 2.0  },
    { value: "aggressive",         understaffedThreshold: -0.5,  overstaffedThreshold: 1.0  },
    { value: "very-aggressive",    understaffedThreshold:  0.0,  overstaffedThreshold: 0.5  },
  ];
  const DEFAULT_PRESET = SENSITIVITY_PRESETS[2]; // balanced

  function presetByValue(v) {
    return SENSITIVITY_PRESETS.find(p => p.value === v) || DEFAULT_PRESET;
  }

  // Pick the preset closest to a (under, over) pair. Handles legacy saved
  // values that don't match a preset exactly.
  function presetFromThresholds(under, over) {
    let best = DEFAULT_PRESET;
    let bestScore = Infinity;
    for (const p of SENSITIVITY_PRESETS) {
      const du  = p.understaffedThreshold - under;
      const dov = p.overstaffedThreshold  - over;
      const score = du * du + dov * dov;
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // ---------- Mount ----------

  function mount() {
    if (mounted) return;
    panel    = document.getElementById("settings-view");
    form     = document.getElementById("settings-form");
    if (!panel || !form) return;

    cpdEl         = document.getElementById("setting-cpd");
    sensitivityEl = document.getElementById("setting-sensitivity");
    topUEl        = document.getElementById("setting-topu");
    topOEl   = document.getElementById("setting-topo");
    fnsEl    = document.getElementById("setting-fns");
    yardsEl  = document.getElementById("setting-yards");
    statusEl = document.getElementById("setting-status");
    saveBtn  = document.getElementById("setting-save");
    resetBtn = document.getElementById("setting-reset");

    form.addEventListener("submit", onSubmit);
    resetBtn.addEventListener("click", onReset);

    mountAddDriverForm();
    mounted = true;
  }

  // ---------- Add driver / dispatcher form ----------

  let addForm, addNameEl, addFnEl, addCompanyEl, addIrhNumEl, addIrhYardEl,
      addYardEl, addTruckEl, addSubmitEl, addResetBtn, addStatusEl;

  function mountAddDriverForm() {
    addForm     = document.getElementById("add-driver-form");
    if (!addForm) return;
    addNameEl    = document.getElementById("add-driver-name");
    addFnEl      = document.getElementById("add-driver-function");
    addCompanyEl = document.getElementById("add-driver-company");
    addIrhNumEl  = document.getElementById("add-driver-irhnum");
    addIrhYardEl = document.getElementById("add-driver-irhyard");
    addYardEl    = document.getElementById("add-driver-yard");
    addTruckEl   = document.getElementById("add-driver-truck");
    addSubmitEl  = document.getElementById("add-driver-submit");
    addResetBtn  = document.getElementById("add-driver-reset");
    addStatusEl  = document.getElementById("add-driver-status");

    addForm.addEventListener("submit", onAddDriverSubmit);
    addResetBtn.addEventListener("click", () => {
      addForm.reset();
      addCompanyEl.value = "Interstate";
      setAddStatus("");
    });
  }

  async function onAddDriverSubmit(e) {
    e.preventDefault();
    setAddStatus("");

    // Trim everything and refuse blanks even if the browser thinks the field
    // is filled (e.g. whitespace-only).
    const payload = {
      name:              addNameEl.value.trim(),
      "function":        addFnEl.value,
      "Company":         addCompanyEl.value.trim(),
      irh_driver_number: addIrhNumEl.value.trim(),
      irh_yard_number:   addIrhYardEl.value.trim(),
      yard:              addYardEl.value.trim(),
      truck:             addTruckEl.value.trim(),
      active:            true,
    };
    for (const [k, v] of Object.entries(payload)) {
      if (k === "active") continue;
      if (!v) { setAddStatus(`${k} is required.`, "error"); return; }
    }

    addSubmitEl.disabled = true;
    setAddStatus("Adding…");
    try {
      const row = await DB.insertDriver(payload);
      setAddStatus(`Added ${row.name} (#${row.irh_driver_number}).`, "ok");
      addForm.reset();
      addCompanyEl.value = "Interstate";
      addNameEl.focus();
      // Re-render the scheduler so the new driver appears on the grid
      // immediately if it's the active scene. Safe no-op otherwise.
      if (window.Scheduler?.render) {
        try { await Scheduler.render(); } catch (e) { /* surfaced elsewhere */ }
      }
    } catch (err) {
      console.error("Insert driver failed:", err);
      setAddStatus(err.message || "Couldn't insert.", "error");
    } finally {
      addSubmitEl.disabled = false;
    }
  }

  function setAddStatus(text, kind) {
    if (!addStatusEl) return;
    addStatusEl.textContent = text || "";
    addStatusEl.className = "settings-status" + (kind ? " settings-status--" + kind : "");
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
    cpdEl.value         = numberOr(values.callsPerDriverPerHour, 1.0);
    const under         = numberOr(values.understaffedThreshold, DEFAULT_PRESET.understaffedThreshold);
    const over          = numberOr(values.overstaffedThreshold,  DEFAULT_PRESET.overstaffedThreshold);
    sensitivityEl.value = presetFromThresholds(under, over).value;
    topUEl.value        = numberOr(values.topUnderstaffedCount, 5);
    topOEl.value        = numberOr(values.topOverstaffedCount, 3);
    fnsEl.value         = (values.supplyFunctions || ["LDT", "HDT"]).join(", ");
    yardsEl.value       = (values.excludeYards || ["UFP"]).join(", ");
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
    const preset = presetByValue(sensitivityEl.value);
    return {
      callsPerDriverPerHour: numberOr(cpdEl.value, 1.0),
      understaffedThreshold: preset.understaffedThreshold,
      overstaffedThreshold:  preset.overstaffedThreshold,
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
