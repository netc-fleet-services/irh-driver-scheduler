// Shift / off-day editor modal.
// Open with ShiftModal.open({ driver, isoDate, entry? }).
// On save or delete, dispatches a `schedule-changed` event on document so
// the scheduler can re-render. Realtime (Phase 8) will also rely on this hook.

window.ShiftModal = (function () {

  // ---------- DOM refs ----------
  let modal, form, titleEl, contextEl, errorEl, deleteBtn, saveBtn,
      shiftFields, offFields, startEl, endEl, reasonEl, notesEl, midnightHintEl,
      typeRadios;

  let current = null;   // { driver, isoDate, entry } — what we're editing

  // ---------- Mount ----------

  function mount() {
    modal           = document.getElementById("shift-modal");
    form            = document.getElementById("shift-modal-form");
    titleEl         = document.getElementById("shift-modal-title");
    contextEl       = document.getElementById("shift-modal-context");
    errorEl         = document.getElementById("entry-error");
    deleteBtn       = document.getElementById("entry-delete");
    saveBtn         = document.getElementById("entry-save");
    shiftFields     = document.getElementById("shift-fields");
    offFields       = document.getElementById("off-fields");
    startEl         = document.getElementById("shift-start");
    endEl           = document.getElementById("shift-end");
    reasonEl        = document.getElementById("off-reason");
    notesEl         = document.getElementById("entry-notes");
    midnightHintEl  = document.getElementById("midnight-hint");
    typeRadios      = form.querySelectorAll('input[name="entry-type"]');

    populateTimeSelects();

    // Type toggle
    typeRadios.forEach(r => r.addEventListener("change", onTypeChange));

    // Times
    [startEl, endEl].forEach(el => el.addEventListener("change", updateMidnightHint));

    // Close handlers
    modal.querySelectorAll("[data-modal-close]").forEach(el => {
      el.addEventListener("click", close);
    });
    document.addEventListener("keydown", (e) => {
      if (!modal.hidden && e.key === "Escape") close();
    });

    // Save / delete
    form.addEventListener("submit", onSave);
    deleteBtn.addEventListener("click", onDelete);
  }

  // ---------- Time options (00:00, 00:30, ..., 23:30) ----------

  function populateTimeSelects() {
    const step = APP_CONFIG.timeStepMinutes || 30;
    const opts = [];
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += step) {
        const value = `${pad2(h)}:${pad2(m)}`;
        const label = Utils.formatTime12(value);
        opts.push(`<option value="${value}">${label}</option>`);
      }
    }
    startEl.innerHTML = opts.join("");
    endEl.innerHTML   = opts.join("");
  }

  function pad2(n) { return String(n).padStart(2, "0"); }

  // ---------- Open / close ----------

  function open({ driver, isoDate, entry }) {
    current = { driver, isoDate, entry: entry || null };
    clearError();

    titleEl.textContent = entry ? "Edit entry" : "Add entry";
    contextEl.innerHTML =
      `<strong>${escapeHtml(driver.name)}</strong> ` +
      `<span class="muted">#${escapeHtml(driver.irh_driver_number || driver.id)} ` +
      `· ${escapeHtml(driver.function || "—")}</span><br>` +
      `<span class="muted">${escapeHtml(formatDate(isoDate))}</span>`;

    // Default values
    const isOff = entry?.entry_type === "off";
    setRadio(isOff ? "off" : "shift");

    if (entry?.entry_type === "shift") {
      startEl.value = (entry.start_time || "08:00").slice(0, 5);
      endEl.value   = (entry.end_time   || "17:00").slice(0, 5);
    } else {
      startEl.value = "08:00";
      endEl.value   = "17:00";
    }
    reasonEl.value = entry?.off_reason || "unavailable";
    notesEl.value  = entry?.notes || "";

    deleteBtn.hidden = !entry;
    onTypeChange();
    updateMidnightHint();

    modal.hidden = false;
    setTimeout(() => (isOff ? reasonEl : startEl).focus(), 0);
  }

  function close() {
    modal.hidden = true;
    current = null;
    clearError();
  }

  // ---------- Type toggle ----------

  function getSelectedType() {
    for (const r of typeRadios) if (r.checked) return r.value;
    return "shift";
  }

  function setRadio(value) {
    for (const r of typeRadios) r.checked = (r.value === value);
  }

  function onTypeChange() {
    const type = getSelectedType();
    shiftFields.hidden = (type !== "shift");
    offFields.hidden   = (type !== "off");
  }

  function updateMidnightHint() {
    if (getSelectedType() !== "shift") {
      midnightHintEl.hidden = true;
      return;
    }
    midnightHintEl.hidden = !(endEl.value <= startEl.value);
  }

  // ---------- Save ----------

  async function onSave(e) {
    e.preventDefault();
    if (!current) return;

    const type = getSelectedType();
    const user = Auth.getUser();

    const base = {
      driver_id:     current.driver.id,
      schedule_date: current.isoDate,
      entry_type:    type,
      notes:         notesEl.value.trim() || null,
      created_by:    user?.id || null,
    };
    if (current.entry?.id) base.id = current.entry.id;

    if (type === "shift") {
      if (startEl.value === endEl.value) {
        return showError("Start and end times can't be the same.");
      }
      base.start_time = startEl.value;
      base.end_time   = endEl.value;
      base.off_reason = null;
    } else {
      base.start_time = null;
      base.end_time   = null;
      base.off_reason = reasonEl.value;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    try {
      await DB.upsertEntry(base);
      document.dispatchEvent(new CustomEvent("schedule-changed"));
      close();
    } catch (err) {
      showError(err.message || "Save failed.");
      console.error(err);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    }
  }

  // ---------- Delete ----------

  async function onDelete() {
    if (!current?.entry) return;
    if (!confirm("Delete this entry?")) return;

    deleteBtn.disabled = true;
    deleteBtn.textContent = "Deleting…";

    try {
      await DB.deleteEntry(current.entry.id);
      document.dispatchEvent(new CustomEvent("schedule-changed"));
      close();
    } catch (err) {
      showError(err.message || "Delete failed.");
      console.error(err);
    } finally {
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete";
    }
  }

  // ---------- Helpers ----------

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function formatDate(iso) {
    const d = Utils.fromIsoDate(iso);
    return d.toLocaleDateString(undefined, {
      weekday: "long",
      month:   "long",
      day:     "numeric",
      year:    "numeric",
    });
  }

  const escapeHtml = Utils.escapeHtml;

  return { mount, open, close };
})();
