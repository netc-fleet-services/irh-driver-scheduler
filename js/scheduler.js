// Scheduler view: renders the week grid (driver rows × 7 day columns).
// Data fetching delegated to DB; this module handles state + DOM.

window.Scheduler = (function () {

  // ---------- State ----------
  const state = {
    activeTab:     APP_CONFIG.defaultTab || "drivers",
    view:          "grid",                      // "grid" | "gantt"
    viewDays:      APP_CONFIG.defaultViewDays || 7,
    anchorDate:    new Date(),                  // FIRST visible day of the window
    showInactive:  false,
    company:       APP_CONFIG.defaultCompany,
    yard:          "",
    search:        "",
    drivers:       [],
    entries:       [],
    companiesLoaded: false,
  };

  // Gantt overflow: extra hours past the last day to show overnight tails.
  const GANTT_OVERFLOW_HOURS = 6;
  function ganttHours() { return state.viewDays * 24 + GANTT_OVERFLOW_HOURS; }

  // ---------- DOM refs ----------
  let grid, headerEl, body, emptyEl, rangeEl, prevBtn, nextBtn, todayBtn, jumpInput,
      showInactiveEl, companyEl, yardEl, countEl, searchEl, tabBarEl, statsEl,
      copyLastBtn, copyNextBtn, clearWeekBtn, undoBtn,
      viewToggleEl, gridViewEl, ganttViewEl, ganttAxisEl, ganttBodyEl,
      daysPickerEl;

  // Snapshot of the most recent bulk action so we can undo it.
  // Shape: { driverIds, isoStart, isoEnd, snapshot: [rows], label }
  let lastBulkAction = null;

  // ---------- Mount ----------

  function mount() {
    grid           = document.getElementById("schedule-grid");
    headerEl       = document.getElementById("schedule-header");
    body           = document.getElementById("schedule-body");
    emptyEl        = document.getElementById("schedule-empty");
    rangeEl        = document.getElementById("week-range");
    prevBtn        = document.getElementById("week-prev");
    nextBtn        = document.getElementById("week-next");
    todayBtn       = document.getElementById("week-today");
    jumpInput      = document.getElementById("week-jump");
    showInactiveEl = document.getElementById("show-inactive");
    companyEl      = document.getElementById("filter-company");
    yardEl         = document.getElementById("filter-yard");
    countEl        = document.getElementById("filter-count");
    searchEl       = document.getElementById("filter-search");
    tabBarEl       = document.getElementById("tab-bar");
    statsEl        = document.getElementById("week-stats");
    copyLastBtn    = document.getElementById("copy-last-week");
    copyNextBtn    = document.getElementById("copy-next-week");
    clearWeekBtn   = document.getElementById("clear-week");
    undoBtn        = document.getElementById("undo-btn");
    viewToggleEl   = document.getElementById("view-toggle");
    gridViewEl     = document.getElementById("schedule-grid-view");
    ganttViewEl    = document.getElementById("schedule-gantt-view");
    ganttAxisEl    = document.getElementById("gantt-axis");
    ganttBodyEl    = document.getElementById("gantt-body");
    daysPickerEl   = document.getElementById("days-picker");

    renderDaysPicker();
    daysPickerEl.addEventListener("change", () => {
      state.viewDays = Number(daysPickerEl.value) || 7;
      render();
    });

    viewToggleEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".view-btn[data-view]");
      if (!btn || btn.dataset.view === state.view) return;
      state.view = btn.dataset.view;
      applyViewToggle();
      render();
    });

    ganttBodyEl.addEventListener("click", onGanttClick);
    ganttBodyEl.addEventListener("pointerdown", onGanttPointerDown);
    ganttAxisEl.addEventListener("click", onGanttAxisClick);

    renderTabs();
    tabBarEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab[data-tab]");
      if (!btn || btn.dataset.tab === state.activeTab) return;
      state.activeTab = btn.dataset.tab;
      state.yard = "";        // dispatchers and drivers don't share yard codes
      state.search = "";
      if (searchEl) searchEl.value = "";
      renderTabs();
      applyTabView();
      if (state.activeTab === "stats") {
        if (typeof Stats !== "undefined") Stats.open();
      } else {
        if (typeof Stats !== "undefined") Stats.close();
        loadYards().then(() => render());
      }
    });

    prevBtn.addEventListener("click",  () => shiftWeek(-state.viewDays));
    nextBtn.addEventListener("click",  () => shiftWeek(+state.viewDays));
    todayBtn.addEventListener("click", () => goTo(new Date()));
    jumpInput.addEventListener("change", () => {
      if (jumpInput.value) goTo(Utils.fromIsoDate(jumpInput.value));
    });
    showInactiveEl.addEventListener("change", () => {
      state.showInactive = showInactiveEl.checked;
      render();
    });

    companyEl.addEventListener("change", async () => {
      state.company = companyEl.value;
      state.yard = "";          // reset yard when company changes
      await loadYards();
      render();
    });

    yardEl.addEventListener("change", () => {
      state.yard = yardEl.value;
      render();
    });

    searchEl.addEventListener("input", () => {
      state.search = searchEl.value.trim().toLowerCase();
      render();
    });

    copyLastBtn.addEventListener("click", onCopyLastWeek);
    copyNextBtn.addEventListener("click", onCopyToNextWeek);
    clearWeekBtn.addEventListener("click", onClearWeek);
    undoBtn.addEventListener("click", onUndo);

    // Click on any day cell -> open the editor modal.
    body.addEventListener("click", onCellClick);

    // Click on any day header -> open the day-detail viewer.
    grid.addEventListener("click", onHeaderClick);

    // Re-render when the modal saves or deletes (and later when Realtime fires).
    document.addEventListener("schedule-changed", () => render());
  }

  // ---------- Bulk actions: copy last week / clear week ----------

  async function onCopyLastWeek() {
    const N = state.viewDays;
    const week = Utils.dateRange(state.anchorDate, N);
    const lastWeek = Utils.dateRange(Utils.addDays(state.anchorDate, -N), N);
    const driverIds = state.drivers.map(d => d.id);
    if (!driverIds.length) {
      alert("No drivers visible — nothing to copy into.");
      return;
    }

    const weekEnd = week[week.length - 1];
    const isoStart = Utils.toIsoDate(week[0]);
    const isoEnd   = Utils.toIsoDate(weekEnd);
    const snapshot = snapshotForRange(driverIds);

    setBulkBusy(true);
    try {
      const n = await DB.copyEntriesShifted(
        driverIds,
        Utils.toIsoDate(lastWeek[0]),
        Utils.toIsoDate(lastWeek[6]),
        7
      );
      lastBulkAction = {
        driverIds, isoStart, isoEnd, snapshot,
        label: `Copy last week (${Utils.shortDateLabel(week[0])})`,
      };
      updateUndoButton();
      document.dispatchEvent(new CustomEvent("schedule-changed"));
      if (n === 0) alert("Last week had no entries to copy.");
    } catch (err) {
      console.error("Copy last week failed:", err);
      alert(`Copy failed: ${err.message || err}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function onCopyToNextWeek() {
    const N = state.viewDays;
    const week = Utils.dateRange(state.anchorDate, N);
    const nextWeek = Utils.dateRange(Utils.addDays(state.anchorDate, +N), N);
    const driverIds = state.drivers.map(d => d.id);
    if (!driverIds.length) {
      alert("No drivers visible — nothing to copy.");
      return;
    }

    const tabLabel = (APP_CONFIG.tabs.find(t => t.id === state.activeTab) || {}).label || "drivers";
    const weekEnd = week[week.length - 1];
    const nextEnd = nextWeek[nextWeek.length - 1];
    const confirmMsg =
      `Copy this period (${Utils.shortDateLabel(week[0])} → ${Utils.shortDateLabel(weekEnd)}) ` +
      `to next ${N} day${N === 1 ? "" : "s"} (${Utils.shortDateLabel(nextWeek[0])} → ${Utils.shortDateLabel(nextEnd)}) ` +
      `for ${driverIds.length} ${tabLabel}?\n\n` +
      `This will overwrite any existing entries in that range.`;
    if (!confirm(confirmMsg)) return;

    const isoSrcStart  = Utils.toIsoDate(week[0]);
    const isoSrcEnd    = Utils.toIsoDate(weekEnd);
    const isoDestStart = Utils.toIsoDate(nextWeek[0]);
    const isoDestEnd   = Utils.toIsoDate(nextEnd);

    setBulkBusy(true);
    try {
      const snapshot = await fetchEntriesForRange(driverIds, isoDestStart, isoDestEnd);
      const n = await DB.copyEntriesShifted(driverIds, isoSrcStart, isoSrcEnd, N);

      lastBulkAction = {
        driverIds,
        isoStart: isoDestStart,
        isoEnd:   isoDestEnd,
        snapshot,
        label: `Copy to next ${N} day${N === 1 ? "" : "s"} (${Utils.shortDateLabel(nextWeek[0])})`,
      };
      updateUndoButton();
      document.dispatchEvent(new CustomEvent("schedule-changed"));
      if (n === 0) alert("This week had no entries to copy.");
    } catch (err) {
      console.error("Copy to next week failed:", err);
      alert(`Copy failed: ${err.message || err}`);
    } finally {
      setBulkBusy(false);
    }
  }

  // Lightweight one-shot fetch used to snapshot a range we're about to overwrite.
  async function fetchEntriesForRange(driverIds, isoStart, isoEnd) {
    if (!driverIds.length) return [];
    const { data, error } = await window.sb
      .from("scheduler_driver_schedule")
      .select("driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes")
      .in("driver_id", driverIds)
      .gte("schedule_date", isoStart)
      .lte("schedule_date", isoEnd);
    if (error) throw error;
    return data || [];
  }

  async function onClearWeek() {
    const N = state.viewDays;
    const week = Utils.dateRange(state.anchorDate, N);
    const weekEnd = week[week.length - 1];
    const driverIds = state.drivers.map(d => d.id);
    if (!driverIds.length) return;

    const visibleEntryCount = state.entries.filter(
      e => driverIds.includes(e.driver_id)
    ).length;
    if (!visibleEntryCount) {
      alert("No entries to clear for this period.");
      return;
    }

    const tabLabel = (APP_CONFIG.tabs.find(t => t.id === state.activeTab) || {}).label || "drivers";
    const confirmMsg =
      `Delete all ${visibleEntryCount} entries for ${driverIds.length} ${tabLabel} ` +
      `(${Utils.shortDateLabel(week[0])} → ${Utils.shortDateLabel(weekEnd)})?\n\n` +
      `This cannot be undone.`;
    if (!confirm(confirmMsg)) return;

    const isoStart = Utils.toIsoDate(week[0]);
    const isoEnd   = Utils.toIsoDate(weekEnd);
    const snapshot = snapshotForRange(driverIds);

    setBulkBusy(true);
    try {
      await DB.deleteEntriesForDriversInRange(driverIds, isoStart, isoEnd);
      lastBulkAction = {
        driverIds, isoStart, isoEnd, snapshot,
        label: `Clear ${Utils.shortDateLabel(week[0])} → ${Utils.shortDateLabel(weekEnd)}`,
      };
      updateUndoButton();
      document.dispatchEvent(new CustomEvent("schedule-changed"));
    } catch (err) {
      console.error("Clear week failed:", err);
      alert(`Clear failed: ${err.message || err}`);
    } finally {
      setBulkBusy(false);
    }
  }

  // ---------- Undo ----------

  // Capture a plain copy of the visible entries for the given drivers, suitable
  // for re-inserting later. Drops the row id so re-inserts don't collide.
  function snapshotForRange(driverIds) {
    const set = new Set(driverIds);
    return state.entries
      .filter(e => set.has(e.driver_id))
      .map(e => ({
        driver_id:     e.driver_id,
        schedule_date: e.schedule_date,
        entry_type:    e.entry_type,
        start_time:    e.start_time,
        end_time:      e.end_time,
        off_reason:    e.off_reason,
        notes:         e.notes,
      }));
  }

  async function onUndo() {
    if (!lastBulkAction) return;
    const { driverIds, isoStart, isoEnd, snapshot, label } = lastBulkAction;

    if (!confirm(`Undo: ${label}?`)) return;

    setBulkBusy(true);
    try {
      // Delete whatever's currently in the range, then re-insert the snapshot.
      await DB.deleteEntriesForDriversInRange(driverIds, isoStart, isoEnd);
      if (snapshot.length) {
        const { error } = await window.sb
          .from("scheduler_driver_schedule")
          .insert(snapshot);
        if (error) throw error;
      }
      lastBulkAction = null;
      updateUndoButton();
      document.dispatchEvent(new CustomEvent("schedule-changed"));
    } catch (err) {
      console.error("Undo failed:", err);
      alert(`Undo failed: ${err.message || err}`);
    } finally {
      setBulkBusy(false);
    }
  }

  function updateUndoButton() {
    if (!undoBtn) return;
    if (lastBulkAction) {
      undoBtn.disabled = false;
      undoBtn.title = `Undo: ${lastBulkAction.label}`;
    } else {
      undoBtn.disabled = true;
      undoBtn.title = "Nothing to undo";
    }
  }

  function setBulkBusy(busy) {
    copyLastBtn.disabled  = busy;
    copyNextBtn.disabled  = busy;
    clearWeekBtn.disabled = busy;
    undoBtn.disabled      = busy || !lastBulkAction;
    copyLastBtn.innerHTML  = busy ? "Working…" : "&larr; Copy last week";
    copyNextBtn.innerHTML  = busy ? "Working…" : "Copy to next &rarr;";
    clearWeekBtn.textContent = busy ? "Working…" : "Clear week";
    undoBtn.textContent      = busy ? "Working…" : "Undo";
  }

  function onHeaderClick(e) {
    const header = e.target.closest(".cell--header[data-date]");
    if (!header) return;
    DayView.open({
      isoDate: header.dataset.date,
      drivers: state.drivers,
      entries: state.entries,
    });
  }

  function onCellClick(e) {
    const cell = e.target.closest(".cell--day");
    if (!cell) return;
    const driverId = Number(cell.dataset.driverId);
    const isoDate  = cell.dataset.date;
    if (!driverId || !isoDate) return;

    const driver = state.drivers.find(d => d.id === driverId);
    if (!driver) return;

    // Click on a specific entry (pill or off-block) -> edit that entry.
    const entryEl = e.target.closest("[data-entry-id]");
    if (entryEl) {
      const entryId = entryEl.dataset.entryId;
      const entry = state.entries.find(x => String(x.id) === entryId);
      if (entry) {
        ShiftModal.open({ driver, isoDate, entry });
        return;
      }
    }

    // Click on the "+" button or empty cell -> add a new entry.
    ShiftModal.open({ driver, isoDate, entry: null });
  }

  // ---------- Navigation ----------

  function shiftWeek(deltaDays) {
    state.anchorDate = Utils.addDays(state.anchorDate, deltaDays);
    render();
  }

  function goTo(d) {
    // anchor is the first visible day of the window
    const start = new Date(d);
    start.setHours(0, 0, 0, 0);
    state.anchorDate = start;
    render();
  }

  // ---------- Filter dropdowns ----------

  async function loadCompanies() {
    try {
      // If config restricts the visible companies, use that list verbatim
      // (no DB call — keeps other companies out of the UI entirely).
      let companies;
      if (APP_CONFIG.allowedCompanies && APP_CONFIG.allowedCompanies.length) {
        companies = APP_CONFIG.allowedCompanies.slice();
      } else {
        companies = await DB.listDistinctCompanies();
      }

      // When the dropdown is locked to one option, skip the "All companies" entry.
      const showAllOption = companies.length !== 1;
      companyEl.innerHTML =
        (showAllOption ? `<option value="">All companies</option>` : "") +
        companies.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");

      // Force the selection to a valid value
      if (companies.includes(state.company)) {
        companyEl.value = state.company;
      } else {
        state.company = companies.length === 1 ? companies[0] : "";
        companyEl.value = state.company;
      }
      // If only one option, no point letting the user "change" it.
      companyEl.disabled = companies.length === 1;
      state.companiesLoaded = true;
    } catch (err) {
      console.error("Failed to load companies:", err);
    }
  }

  async function loadYards() {
    try {
      const allYards = await DB.listDistinctYards({
        company:   state.company || null,
        functions: activeFunctions(),
      });
      // Apply yard aliases (e.g. "5" -> "1") so merged yards show as one
      // option, then keep only real yard codes for the dropdown.
      const aliases = APP_CONFIG.yardAliases || {};
      const visible = [
        ...new Set(allYards.map(y => aliases[y] || y))
      ].filter(y => /^\d+$/.test(y) || y === "UFP").sort();

      yardEl.innerHTML =
        `<option value="">All yards</option>` +
        visible.map(y => `<option value="${escapeHtml(y)}">${escapeHtml(y)}</option>`).join("");
      yardEl.value = visible.includes(state.yard) ? state.yard : "";
      state.yard = yardEl.value;
    } catch (err) {
      console.error("Failed to load yards:", err);
    }
  }

  // Expand a selected display yard into the list of real yards it represents
  // (target itself + any aliases pointing to it). Returns null if no filter set.
  function yardFilterFor(displayYard) {
    if (!displayYard) return null;
    const aliases = APP_CONFIG.yardAliases || {};
    const sources = Object.keys(aliases).filter(k => aliases[k] === displayYard);
    return [displayYard, ...sources];
  }

  // Render the days-picker dropdown options + selected.
  function renderDaysPicker() {
    if (!daysPickerEl) return;
    const choices = APP_CONFIG.viewDayChoices || [1,2,3,4,5,6,7,14];
    daysPickerEl.innerHTML = choices.map(n =>
      `<option value="${n}">${n} day${n === 1 ? "" : "s"}</option>`
    ).join("");
    daysPickerEl.value = String(state.viewDays);
  }

  // Function set for the active tab.
  function activeFunctions() {
    const tabs = APP_CONFIG.tabs || [];
    const t = tabs.find(t => t.id === state.activeTab);
    return t ? t.functions : APP_CONFIG.schedulableFunctions;
  }

  // Render the tab buttons.
  function renderTabs() {
    if (!tabBarEl) return;
    const tabs = APP_CONFIG.tabs || [];
    tabBarEl.innerHTML = tabs.map(t => {
      const cls = t.id === state.activeTab ? "tab tab--active" : "tab";
      return `<button type="button" class="${cls}" data-tab="${t.id}">${escapeHtml(t.label)}</button>`;
    }).join("");
  }

  // Toggle visibility of the schedule UI vs the stats panel based on active tab.
  function applyTabView() {
    const onStats = state.activeTab === "stats";
    // Hide the schedule controls + grid/gantt when on Stats.
    const scheduleChrome = [
      document.querySelector(".week-nav"),
      document.querySelector(".filters"),
      document.querySelector(".view-toolbar"),
      document.getElementById("week-stats"),
      gridViewEl,
      ganttViewEl,
    ];
    scheduleChrome.forEach(el => { if (el) el.hidden = onStats; });
  }

  // ---------- Render ----------

  async function render() {
    if (!state.companiesLoaded) {
      await loadCompanies();
      await loadYards();
    }

    const N = state.viewDays;
    const week     = Utils.dateRange(state.anchorDate,                     N);
    const lastWeek = Utils.dateRange(Utils.addDays(state.anchorDate, -N),   N);
    const nextWeek = Utils.dateRange(Utils.addDays(state.anchorDate, +N),   N);
    const lastDay  = week[week.length - 1];
    const isoStart      = Utils.toIsoDate(week[0]);
    const isoEnd        = Utils.toIsoDate(lastDay);
    const isoRangeStart = Utils.toIsoDate(lastWeek[0]);
    const isoRangeEnd   = Utils.toIsoDate(nextWeek[nextWeek.length - 1]);

    renderHeader(week);
    rangeEl.textContent =
      `${Utils.shortDateLabel(week[0])} → ${Utils.shortDateLabel(lastDay)}`;
    jumpInput.value = isoStart;

    let drivers, allEntries;
    try {
      [drivers, allEntries] = await Promise.all([
        DB.listDrivers({
          includeInactive: state.showInactive,
          company:         state.company || null,
          yard:            yardFilterFor(state.yard),
          functions:       activeFunctions(),
        }),
        // Pull 3 weeks at once so we can compute last/this/next stats from one fetch.
        DB.listScheduleBetween(isoRangeStart, isoRangeEnd),
      ]);
    } catch (err) {
      body.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.innerHTML =
        `<p><strong>Couldn't load schedule.</strong></p>` +
        `<p class="muted">${escapeHtml(err.message || String(err))}</p>`;
      console.error(err);
      return;
    }

    // Apply free-text search client-side (matches name OR IRH# OR DB id).
    const filtered = filterBySearch(drivers, state.search);
    state.drivers = filtered;

    // The grid/day-view only need this week's entries.
    const entries = allEntries.filter(e =>
      e.schedule_date >= isoStart && e.schedule_date <= isoEnd
    );
    state.entries = entries;

    const total = drivers.length;
    const shown = filtered.length;
    countEl.textContent = state.search
      ? `${shown} of ${total} driver${total === 1 ? "" : "s"}`
      : (shown ? `${shown} driver${shown === 1 ? "" : "s"}` : "");

    // Stats: total scheduled hours for the active tab's drivers across 3 weeks.
    renderWeekStats(allEntries, drivers, week, lastWeek, nextWeek);

    if (!filtered.length) {
      body.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.innerHTML = renderEmptyState();
      ganttBodyEl.innerHTML = "";
      ganttAxisEl.innerHTML = "";
      return;
    }

    emptyEl.hidden = true;
    if (state.view === "grid") {
      renderBody(filtered, entries, week);
    } else {
      renderGantt(filtered, entries, week);
    }
  }

  // ---------- View toggle ----------

  function applyViewToggle() {
    if (gridViewEl)  gridViewEl.hidden  = (state.view !== "grid");
    if (ganttViewEl) ganttViewEl.hidden = (state.view !== "gantt");
    if (viewToggleEl) {
      viewToggleEl.querySelectorAll(".view-btn").forEach(b => {
        b.classList.toggle("view-btn--active", b.dataset.view === state.view);
      });
    }
  }

  // ---------- Gantt view ----------

  function renderGantt(drivers, entries, week) {
    const totalHours = ganttHours();
    // Day labels (clickable -> open day-detail) + 24h boundary lines
    const labels = week.map((d, i) => {
      const leftPct = ((i * 24) / totalHours) * 100;
      const widthPct = (24 / totalHours) * 100;
      const dow = d.toLocaleDateString(undefined, { weekday: "short" });
      const dom = `${d.getMonth() + 1}/${d.getDate()}`;
      const iso = Utils.toIsoDate(d);
      return `<div class="gantt__day" style="left:${leftPct}%; width:${widthPct}%"
                   data-date="${iso}" title="Click for day detail">
                <span class="gantt__day-dow">${dow}</span>
                <span class="gantt__day-dom">${dom}</span>
              </div>`;
    }).join("");
    ganttAxisEl.innerHTML = labels;

    // Group entries by driver
    const byDriver = new Map();
    for (const e of entries) {
      if (!byDriver.has(e.driver_id)) byDriver.set(e.driver_id, []);
      byDriver.get(e.driver_id).push(e);
    }

    const weekStartMs = week[0].getTime();

    // Sort drivers by their earliest shift start across the visible window so
    // bars cascade naturally left-to-right. Drivers with no shifts go last.
    const earliestStart = (driverId) => {
      const driverEntries = byDriver.get(driverId) || [];
      const shifts = driverEntries.filter(e => e.entry_type === "shift");
      if (!shifts.length) return Infinity;
      let min = Infinity;
      for (const e of shifts) {
        const date = Utils.fromIsoDate(e.schedule_date);
        const dayOffsetH = Math.round((date.getTime() - weekStartMs) / 3600000);
        if (dayOffsetH < 0 || dayOffsetH >= state.viewDays * 24) continue;
        const total = dayOffsetH + parseTimeToHours(e.start_time);
        if (total < min) min = total;
      }
      return min;
    };

    const sorted = drivers.slice().sort((a, b) => {
      const sa = earliestStart(a.id);
      const sb = earliestStart(b.id);
      if (sa !== sb) return sa - sb;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    // Build per-driver byKey for hours computation
    const byKey = new Map();
    for (const e of entries) {
      const k = `${e.driver_id}|${e.schedule_date}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }

    ganttBodyEl.innerHTML = sorted.map(d => {
      const driverEntries = byDriver.get(d.id) || [];
      const hours = computeDriverWeekHours(d.id, week, byKey);
      return renderGanttRow(d, weekStartMs, driverEntries, hours);
    }).join("");
  }

  function renderGanttRow(driver, weekStartMs, entries, hours) {
    const totalHours = ganttHours();
    const dayLines = Array.from({ length: state.viewDays }, (_, i) => {
      const leftPct = (((i + 1) * 24) / totalHours) * 100;
      return `<div class="gantt__divider" style="left:${leftPct}%"></div>`;
    }).join("");

    const bars = entries.map(e => renderGanttBar(e, weekStartMs)).filter(Boolean).join("");

    const meta = `#${escapeHtml(driver.irh_driver_number || driver.id)} · ${escapeHtml(driver.function || "—")}`;
    const hoursBadge = hours > 0
      ? `<span class="driver-hours" title="Scheduled this week">${escapeHtml(Utils.formatHours(hours))}</span>`
      : "";

    return `
      <div class="gantt-row">
        <div class="gantt-row__driver">
          <div class="gantt-row__name">
            ${escapeHtml(driver.name)}
            ${hoursBadge}
          </div>
          <div class="muted gantt-row__meta">${meta}</div>
        </div>
        <div class="gantt-row__track">
          ${dayLines}
          ${bars}
        </div>
      </div>
    `;
  }

  function renderGanttBar(entry, weekStartMs) {
    const totalHours = ganttHours();
    const lastVisibleHour = state.viewDays * 24;            // exclusive end of the visible day range
    const date = Utils.fromIsoDate(entry.schedule_date);
    const dayOffsetH = Math.round((date.getTime() - weekStartMs) / (1000 * 60 * 60));
    if (dayOffsetH < 0 || dayOffsetH >= lastVisibleHour) return "";

    if (entry.entry_type === "off") {
      const leftPct  = (dayOffsetH / totalHours) * 100;
      const widthPct = (24 / totalHours) * 100;
      return `
        <div class="gantt-bar gantt-bar--off"
             style="left:${leftPct}%; width:${widthPct}%"
             data-entry-id="${entry.id}"
             title="Off${entry.off_reason ? ' · ' + entry.off_reason : ''}">
          <span>off</span>
        </div>
      `;
    }

    if (entry.entry_type !== "shift") return "";

    const startH = parseTimeToHours(entry.start_time);
    let endH     = parseTimeToHours(entry.end_time);
    if (endH <= startH) endH += 24;
    const startTotal = dayOffsetH + startH;
    const endTotal   = dayOffsetH + endH;
    const leftPct  = (startTotal / totalHours) * 100;
    const widthPct = ((endTotal - startTotal) / totalHours) * 100;

    const start = Utils.formatTime12(entry.start_time);
    const end   = Utils.formatTime12(entry.end_time);
    const overnight = endH > 24;

    return `
      <div class="gantt-bar gantt-bar--shift ${overnight ? "gantt-bar--overnight" : ""}"
           style="left:${leftPct}%; width:${widthPct}%"
           data-entry-id="${entry.id}"
           data-day-offset="${dayOffsetH}"
           title="${start} - ${end}${overnight ? " (next day)" : ""}">
        <div class="gantt-bar__handle gantt-bar__handle--left"  data-side="left"  title="Drag to change start"></div>
        <span class="gantt-bar__label">${start}</span>
        <div class="gantt-bar__handle gantt-bar__handle--right" data-side="right" title="Drag to change end"></div>
      </div>
    `;
  }

  function parseTimeToHours(t) {
    if (!t) return 0;
    const [h, m] = String(t).split(":").map(Number);
    return h + (m || 0) / 60;
  }

  function onGanttClick(e) {
    if (ganttSuppressClick) return;
    if (e.target.closest(".gantt-bar__handle")) return;   // handle drag handles separately
    const bar = e.target.closest(".gantt-bar[data-entry-id]");
    if (!bar) return;
    const entryId = bar.dataset.entryId;
    const entry = state.entries.find(x => String(x.id) === entryId);
    if (!entry) return;
    const driver = state.drivers.find(d => d.id === entry.driver_id);
    if (!driver) return;
    ShiftModal.open({ driver, isoDate: entry.schedule_date, entry });
  }

  // Click a day label in the gantt axis -> open the day-detail viewer.
  function onGanttAxisClick(e) {
    const day = e.target.closest(".gantt__day[data-date]");
    if (!day) return;
    DayView.open({
      isoDate: day.dataset.date,
      drivers: state.drivers,
      entries: state.entries,
    });
  }

  // ---------- Gantt drag-resize ----------

  let ganttDrag = null;
  let ganttSuppressClick = false;

  function onGanttPointerDown(e) {
    const handle = e.target.closest(".gantt-bar__handle");
    if (!handle) return;
    const bar = handle.closest(".gantt-bar");
    if (!bar || bar.classList.contains("gantt-bar--off")) return;

    const entryId = bar.dataset.entryId;
    const entry = state.entries.find(x => String(x.id) === entryId);
    if (!entry || entry.entry_type !== "shift") return;

    const track = bar.parentElement;
    const dayOffsetH = Number(bar.dataset.dayOffset);
    ganttDrag = {
      bar,
      side: handle.dataset.side,
      track,
      trackWidth: track.getBoundingClientRect().width,
      entry,
      driver: state.drivers.find(d => d.id === entry.driver_id),
      dayOffsetH,
      startX: e.clientX,
      startLeftPct:  parseFloat(bar.style.left)  || 0,
      startWidthPct: parseFloat(bar.style.width) || 0,
      moved: false,
    };
    bar.classList.add("gantt-bar--dragging");
    handle.setPointerCapture(e.pointerId);
    document.addEventListener("pointermove", onGanttPointerMove);
    document.addEventListener("pointerup",   onGanttPointerUp,   { once: true });
    document.addEventListener("pointercancel", onGanttPointerUp, { once: true });
    e.stopPropagation();
    e.preventDefault();
  }

  function onGanttPointerMove(e) {
    if (!ganttDrag) return;
    const dx = e.clientX - ganttDrag.startX;
    if (Math.abs(dx) > 3) ganttDrag.moved = true;
    if (!ganttDrag.moved) return;

    const totalHours = ganttHours();
    const dPct = (dx / ganttDrag.trackWidth) * 100;
    const minWidthPct = (0.5 / totalHours) * 100;
    // Constrain within the entry's day so start stays on the same date and
    // end can run up to ~6 AM next day for overnight shifts.
    const dayStartPct = (ganttDrag.dayOffsetH / totalHours) * 100;
    const dayEndPct   = ((ganttDrag.dayOffsetH + 30) / totalHours) * 100;

    if (ganttDrag.side === "right") {
      let newRight = snapPct(ganttDrag.startLeftPct + ganttDrag.startWidthPct + dPct, totalHours);
      newRight = Math.max(ganttDrag.startLeftPct + minWidthPct, Math.min(dayEndPct, newRight));
      ganttDrag.bar.style.width = (newRight - ganttDrag.startLeftPct) + "%";
    } else {
      let newLeft = snapPct(ganttDrag.startLeftPct + dPct, totalHours);
      const right = ganttDrag.startLeftPct + ganttDrag.startWidthPct;
      newLeft = Math.max(dayStartPct, Math.min(right - minWidthPct, newLeft));
      ganttDrag.bar.style.left  = newLeft + "%";
      ganttDrag.bar.style.width = (right - newLeft) + "%";
    }
  }

  async function onGanttPointerUp() {
    if (!ganttDrag) return;
    document.removeEventListener("pointermove", onGanttPointerMove);
    ganttDrag.bar.classList.remove("gantt-bar--dragging");

    if (ganttDrag.moved) {
      ganttSuppressClick = true;
      setTimeout(() => { ganttSuppressClick = false; }, 250);
    }
    if (!ganttDrag.moved) { ganttDrag = null; return; }

    const totalHours = ganttHours();
    const leftPct  = parseFloat(ganttDrag.bar.style.left)  || 0;
    const widthPct = parseFloat(ganttDrag.bar.style.width) || 0;
    const startTotalH = (leftPct  / 100) * totalHours;
    const endTotalH   = ((leftPct + widthPct) / 100) * totalHours;
    const startInDay  = startTotalH - ganttDrag.dayOffsetH;
    const endInDay    = endTotalH   - ganttDrag.dayOffsetH;

    const newStart = hoursToTimeStr(startInDay % 24);
    const newEnd   = hoursToTimeStr(endInDay   % 24);

    const oldStart = (ganttDrag.entry.start_time || "").slice(0, 5);
    const oldEnd   = (ganttDrag.entry.end_time   || "").slice(0, 5);
    if (newStart === oldStart && newEnd === oldEnd) {
      ganttDrag = null;
      return;
    }

    const saving = ganttDrag;
    ganttDrag = null;

    try {
      await DB.upsertEntry({
        id:            saving.entry.id,
        driver_id:     saving.driver.id,
        schedule_date: saving.entry.schedule_date,
        entry_type:    "shift",
        start_time:    newStart,
        end_time:      newEnd,
        off_reason:    null,
        notes:         saving.entry.notes,
      });
      document.dispatchEvent(new CustomEvent("schedule-changed"));
    } catch (err) {
      console.error("Gantt drag-save failed:", err);
      saving.bar.style.left  = saving.startLeftPct  + "%";
      saving.bar.style.width = saving.startWidthPct + "%";
      alert("Couldn't save the new times: " + (err.message || err));
    }
  }

  function snapPct(pct, totalHours) {
    const hours = (pct / 100) * totalHours;
    const snapped = Math.round(hours * 2) / 2;
    return (snapped / totalHours) * 100;
  }

  function hoursToTimeStr(h) {
    const totalMin = Math.round(h * 60);
    const hh = ((Math.floor(totalMin / 60) % 24) + 24) % 24;
    const mm = ((totalMin % 60) + 60) % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // ---------- Stats bar ----------

  function renderWeekStats(allEntries, drivers, thisWk, lastWk, nextWk) {
    if (!statsEl) return;
    if (!drivers.length) { statsEl.innerHTML = ""; return; }

    const driverIds = new Set(drivers.map(d => d.id));
    const sumWeek = (wk) => {
      const dateSet = new Set(wk.map(Utils.toIsoDate));
      let total = 0;
      for (const e of allEntries) {
        if (e.entry_type !== "shift") continue;
        if (!driverIds.has(e.driver_id)) continue;
        if (!dateSet.has(e.schedule_date)) continue;
        total += Utils.shiftDurationHours(e.start_time, e.end_time);
      }
      return total;
    };

    const lastH = sumWeek(lastWk);
    const thisH = sumWeek(thisWk);
    const nextH = sumWeek(nextWk);

    const fmt = (h) => Utils.formatHours(h);
    const delta = (a, b) => {
      const d = a - b;
      if (Math.abs(d) < 0.01) return "—";
      return (d > 0 ? "+" : "") + Utils.formatHours(Math.abs(d)).replace(/^(\d)/, d > 0 ? "$1" : "-$1");
    };

    statsEl.innerHTML = `
      <div class="stat">
        <div class="stat__label">Last week</div>
        <div class="stat__value">${fmt(lastH)}</div>
      </div>
      <div class="stat stat--current">
        <div class="stat__label">This week</div>
        <div class="stat__value">${fmt(thisH)}</div>
        <div class="stat__delta">${delta(thisH, lastH)} vs last</div>
      </div>
      <div class="stat">
        <div class="stat__label">Next week</div>
        <div class="stat__value">${fmt(nextH)}</div>
        <div class="stat__delta">${delta(nextH, thisH)} vs this</div>
      </div>
    `;
  }

  function filterBySearch(drivers, q) {
    if (!q) return drivers;
    return drivers.filter(d => {
      const name = String(d.name || "").toLowerCase();
      const irh  = String(d.irh_driver_number || "").toLowerCase();
      const id   = String(d.id || "").toLowerCase();
      return name.includes(q) || irh.includes(q) || id.includes(q);
    });
  }

  function renderEmptyState() {
    const filtersDescribed = [
      state.company ? `Company = "${state.company}"` : null,
      state.yard    ? `Yard = "${state.yard}"`       : null,
      state.search  ? `Search = "${state.search}"`   : null,
      !state.showInactive ? `active drivers only` : null,
    ].filter(Boolean).join(", ");
    return `
      <p><strong>No drivers match the current filters.</strong></p>
      <p class="muted">Filters: ${filtersDescribed || "none"}.</p>
      <p class="muted">
        Clear the search, change a filter above, or add drivers in
        Supabase Dashboard &rarr; Table Editor &rarr; <code>drivers</code>.
      </p>
    `;
  }

  // ---------- Grid header (day labels) ----------

  function renderHeader(week) {
    // Make the grid template adapt to N days so columns always span the row.
    grid.style.gridTemplateColumns =
      `220px repeat(${week.length}, minmax(120px, 1fr))`;

    const today = Utils.toIsoDate(new Date());
    const cells = [`<div class="cell cell--header cell--driver">Driver</div>`];
    week.forEach((d, i) => {
      const iso = Utils.toIsoDate(d);
      const isToday = iso === today;
      const dow = d.toLocaleDateString(undefined, { weekday: "short" });
      const dom = `${d.getMonth() + 1}/${d.getDate()}`;
      cells.push(
        `<div class="cell cell--header cell--clickable ${isToday ? "cell--today" : ""}"
              data-col="${i}" data-date="${iso}" title="Click for day detail">
          <div class="dow">${dow}</div>
          <div class="dom">${dom}</div>
        </div>`
      );
    });
    headerEl.innerHTML = cells.join("");
  }

  // ---------- Grid body (driver rows) ----------

  function renderBody(drivers, entries, week) {
    // Index entries by (driver_id|date) -> array of entries (multi-shift support)
    const byKey = new Map();
    for (const e of entries) {
      const key = `${e.driver_id}|${e.schedule_date}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(e);
    }

    const sorted = drivers.slice().sort((a, b) => {
      const catCmp = String(a.function || "").localeCompare(String(b.function || ""));
      if (catCmp !== 0) return catCmp;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    body.innerHTML = sorted.map(d => renderDriverRow(d, week, byKey)).join("");
  }

  function renderDriverRow(driver, week, byKey) {
    const isInactive = driver.active === false;
    const weeklyHours = computeDriverWeekHours(driver.id, week, byKey);
    const hoursBadge = weeklyHours > 0
      ? `<span class="driver-hours" title="Scheduled this week">${escapeHtml(Utils.formatHours(weeklyHours))}</span>`
      : "";
    const driverCell = `
      <div class="cell cell--driver ${isInactive ? "is-inactive" : ""}" data-driver-id="${driver.id}">
        <div class="driver-name">
          ${escapeHtml(driver.name || "(unnamed)")}
          ${hoursBadge}
        </div>
        <div class="driver-meta">
          <span class="badge badge--${categoryClass(driver.function)}">${escapeHtml(driver.function || "—")}</span>
          <span class="muted">#${escapeHtml(driver.irh_driver_number || driver.id)} · yard ${escapeHtml(formatYards(driver.irh_yard_number) || driver.yard || "—")}</span>
          ${isInactive ? `<span class="badge badge--off">inactive</span>` : ""}
        </div>
      </div>
    `;

    const dayCells = week.map(d => {
      const iso = Utils.toIsoDate(d);
      const entries = byKey.get(`${driver.id}|${iso}`) || [];
      return renderDayCell(driver, iso, entries);
    }).join("");

    return `<div class="row">${driverCell}${dayCells}</div>`;
  }

  function renderDayCell(driver, iso, entries) {
    // Empty cell — click to add.
    if (!entries || entries.length === 0) {
      return `
        <div class="cell cell--day cell--empty"
             data-driver-id="${driver.id}"
             data-date="${iso}"
             title="Click to add">
          <span class="cell--empty__plus">+</span>
        </div>
      `;
    }

    // Off-day takes precedence.
    const off = entries.find(e => e.entry_type === "off");
    if (off) {
      return `
        <div class="cell cell--day cell--off"
             data-driver-id="${driver.id}"
             data-date="${iso}"
             data-entry-id="${off.id}"
             title="Off: ${off.off_reason || ""}">
          <div class="off__label">${escapeHtml(off.off_reason || "off")}</div>
        </div>
      `;
    }

    // 1+ shift entries. Single shift renders inline like before; multiple stack as pills.
    const shifts = entries
      .filter(e => e.entry_type === "shift")
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));

    if (shifts.length === 1) {
      const e = shifts[0];
      const start = Utils.formatTime12(e.start_time);
      const end   = Utils.formatTime12(e.end_time);
      const crossesMidnight = e.end_time < e.start_time;
      const nextDayBadge = crossesMidnight
        ? ` <span class="shift__nextday" title="Ends next day">+1d</span>`
        : "";
      return `
        <div class="cell cell--day cell--shift ${crossesMidnight ? "cell--shift-overnight" : ""}"
             data-driver-id="${driver.id}"
             data-date="${iso}"
             data-entry-id="${e.id}"
             title="${start} - ${end}${crossesMidnight ? " (next day)" : ""}">
          <div class="shift__times">${start}<br>${end}${nextDayBadge}</div>
          ${e.notes ? `<div class="shift__notes">${escapeHtml(e.notes)}</div>` : ""}
        </div>
      `;
    }

    // Multiple shifts: render pills + an "add another" button.
    const pills = shifts.map(e => {
      const start = Utils.formatTime12(e.start_time);
      const end   = Utils.formatTime12(e.end_time);
      const overnight = e.end_time < e.start_time;
      const nextDay = overnight ? ` <small>+1d</small>` : "";
      return `
        <div class="shift-pill ${overnight ? "shift-pill--overnight" : ""}"
             data-entry-id="${e.id}"
             title="${start} - ${end}${overnight ? " (next day)" : ""}">
          <span class="shift-pill__times">${start} – ${end}${nextDay}</span>
          ${e.notes ? `<span class="shift-pill__notes">${escapeHtml(e.notes)}</span>` : ""}
        </div>
      `;
    }).join("");

    return `
      <div class="cell cell--day cell--shifts"
           data-driver-id="${driver.id}"
           data-date="${iso}">
        ${pills}
        <button type="button" class="shift-add" title="Add another shift">+</button>
      </div>
    `;
  }

  // ---------- Helpers ----------

  // "1,6" -> "1 / 6"; single values pass through unchanged.
  function formatYards(value) {
    if (!value) return "";
    return String(value).split(",").map(s => s.trim()).filter(Boolean).join(" / ");
  }

  // Sum a driver's shift hours for the visible week (uses the byKey index).
  function computeDriverWeekHours(driverId, week, byKey) {
    let total = 0;
    for (const d of week) {
      const iso = Utils.toIsoDate(d);
      const entries = byKey.get(`${driverId}|${iso}`) || [];
      for (const entry of entries) {
        if (entry.entry_type !== "shift") continue;
        total += Utils.shiftDurationHours(entry.start_time, entry.end_time);
      }
    }
    return total;
  }

  function categoryClass(fn) {
    switch ((fn || "").toLowerCase()) {
      case "ldt":          return "ldt";
      case "hdt":          return "hdt";
      case "transport":    return "transport";
      case "road service": return "road";
      default:             return "default";
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  return { mount, render, goTo, shiftWeek };
})();
