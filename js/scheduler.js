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
    // Each view remembers its own sort. Gantt defaults to "startTime" so
    // bars cascade left-to-right; grid defaults to "function" so categories
    // group together. Either can be overridden by the user; the choice
    // sticks per view.
    sortBy: {
      grid:  "function",
      gantt: "startTime",
    },
    // Cached fetch results (set by loadData, consumed by paint).
    allDrivers:    [],   // DB result, pre-search-filter
    allEntries:    [],   // 3-week window of entries (last/this/next)
    // Post-filter slices used by render & callers.
    drivers:       [],   // allDrivers narrowed by search
    entries:       [],   // allEntries narrowed to the visible window
    companiesLoaded: false,
  };

  // Debounce timer for the search input; data is already loaded so we only
  // need to re-paint, but rapid typing would still thrash the DOM otherwise.
  let searchDebounceTimer = null;
  // Set during loadData to dedupe overlapping fetches from rapid events.
  let inflightFetch = null;

  // Gantt overflow: extra hours past the last day to show overnight tails.
  const GANTT_OVERFLOW_HOURS = 6;
  function ganttHours() { return state.viewDays * 24 + GANTT_OVERFLOW_HOURS; }

  // ---------- DOM refs ----------
  let grid, headerEl, body, emptyEl, rangeEl, prevBtn, nextBtn, todayBtn, jumpInput,
      showInactiveEl, companyEl, yardEl, countEl, searchEl, tabBarEl, statsEl,
      copyLastBtn, copyNextBtn, clearWeekBtn, undoBtn,
      viewToggleEl, gridViewEl, ganttViewEl, ganttAxisEl, ganttBodyEl,
      daysPickerEl,
      coverageEl, coverageBodyEl, coverageToggleEl, coverageSummaryEl,
      coverageUnderEl, coverageOverEl;

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

    coverageEl         = document.getElementById("coverage-panel");
    coverageBodyEl     = document.getElementById("coverage-body");
    coverageToggleEl   = document.getElementById("coverage-toggle");
    coverageSummaryEl  = document.getElementById("coverage-summary");
    coverageUnderEl    = document.getElementById("coverage-under");
    coverageOverEl     = document.getElementById("coverage-over");

    if (coverageToggleEl) {
      coverageToggleEl.addEventListener("click", () => {
        const expanded = coverageToggleEl.getAttribute("aria-expanded") === "true";
        coverageToggleEl.setAttribute("aria-expanded", String(!expanded));
        coverageBodyEl.hidden = expanded;
      });
    }

    if (coverageEl) {
      coverageEl.addEventListener("click", (e) => {
        const item = e.target.closest(".coverage__item");
        if (!item || !item.dataset.iso) return;
        const isoDate = item.dataset.iso;
        DayView.open({
          isoDate,
          drivers: state.drivers,
          entries: state.allEntries,
        });
      });
    }

    renderDaysPicker();
    daysPickerEl.addEventListener("change", () => {
      state.viewDays = Number(daysPickerEl.value) || 7;
      render();
    });

    // Sort dropdown lives inside both view headers (grid re-renders it every
    // paint; gantt's is static in HTML). Each view edits its own per-view
    // sort key — they don't sync, so a user's grid sort is preserved when
    // they jump to gantt and back.
    document.getElementById("app-view").addEventListener("change", (e) => {
      const t = e.target;
      if (!t) return;
      if (t.id === "driver-sort")        state.sortBy.grid  = t.value;
      else if (t.id === "driver-sort-gantt") state.sortBy.gantt = t.value;
      else return;
      paint();
    });

    viewToggleEl.addEventListener("click", (e) => {
      const btn = e.target.closest(".view-btn[data-view]");
      if (!btn || btn.dataset.view === state.view) return;
      state.view = btn.dataset.view;
      applyViewToggle();
      paint();   // pure view switch — no DB hit needed
    });

    ganttBodyEl.addEventListener("click", onGanttClick);
    ganttBodyEl.addEventListener("pointerdown", onGanttPointerDown);
    ganttAxisEl.addEventListener("click", onGanttAxisClick);

    // Live "now" line: re-position once per minute. Cheap (no DB), and quietly
    // hides itself if "now" falls outside the visible week.
    setInterval(updateGanttNowLine, 60 * 1000);

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
      const tab = state.activeTab;
      // Close any panel currently open before switching scenes.
      if (typeof Stats !== "undefined")       Stats.close();
      if (window.Historical?.close)           Historical.close();
      if (window.SettingsView?.close)         SettingsView.close();

      if (tab === "stats") {
        if (typeof Stats !== "undefined") Stats.open();
      } else if (tab === "historical") {
        if (window.Historical?.open) Historical.open();
      } else if (tab === "settings") {
        if (window.SettingsView?.open) SettingsView.open();
      } else {
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
      // Search is purely client-side; debounce + repaint without re-fetching.
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(paint, 120);
    });

    copyLastBtn.addEventListener("click", onCopyLastWeek);
    copyNextBtn.addEventListener("click", onCopyToNextWeek);
    clearWeekBtn.addEventListener("click", onClearWeek);
    undoBtn.addEventListener("click", onUndo);

    // Click on any day cell -> open the editor modal.
    body.addEventListener("click", onCellClick);

    // Click on any day header -> open the day-detail viewer.
    grid.addEventListener("click", onHeaderClick);

    // Re-render when the modal saves or deletes (and when Realtime fires).
    // Coalesced through a small debounce so a burst of changes (e.g. a Copy
    // operation that inserts 60 rows) only triggers one render.
    document.addEventListener("schedule-changed", scheduleRerender);

    // Realtime: any logged-in dispatcher's INSERT/UPDATE/DELETE re-renders us.
    subscribeRealtime();
  }

  let rerenderTimer = null;
  function scheduleRerender() {
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => render(), 100);
  }

  let realtimeChannel = null;
  function subscribeRealtime() {
    if (realtimeChannel || !window.sb) return;
    realtimeChannel = window.sb
      .channel("scheduler-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scheduler_driver_schedule" },
        () => scheduleRerender(),
      )
      .subscribe();
  }

  // ---------- Bulk actions: copy last week / clear week ----------

  async function onCopyLastWeek() {
    // Always operate on the full Mon–Sun calendar week containing the anchor,
    // regardless of viewDays — so copying covers the entire week, not just the
    // visible slice from the current day forward.
    const thisWeek = Utils.weekDates(state.anchorDate);
    const lastWeek = thisWeek.map(d => Utils.addDays(d, -7));
    const driverIds = state.drivers.map(d => d.id);
    if (!driverIds.length) {
      alert("No drivers visible — nothing to copy into.");
      return;
    }

    const isoStart    = Utils.toIsoDate(thisWeek[0]);
    const isoEnd      = Utils.toIsoDate(thisWeek[6]);
    const isoSrcStart = Utils.toIsoDate(lastWeek[0]);
    const isoSrcEnd   = Utils.toIsoDate(lastWeek[6]);

    setBulkBusy(true);
    try {
      // Fetch the destination snapshot fresh — state.entries only covers the
      // visible window, which may be narrower than a full week.
      const snapshot = await fetchEntriesForRange(driverIds, isoStart, isoEnd);
      const n = await DB.copyEntriesShifted(driverIds, isoSrcStart, isoSrcEnd, 7);
      lastBulkAction = {
        driverIds, isoStart, isoEnd, snapshot,
        label: `Copy last week (${Utils.shortDateLabel(thisWeek[0])})`,
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
    // Always operate on the full Mon–Sun calendar week containing the anchor,
    // regardless of viewDays — so copying covers the entire week.
    const thisWeek = Utils.weekDates(state.anchorDate);
    const nextWeek = thisWeek.map(d => Utils.addDays(d, 7));
    const driverIds = state.drivers.map(d => d.id);
    if (!driverIds.length) {
      alert("No drivers visible — nothing to copy.");
      return;
    }

    const tabLabel = (APP_CONFIG.tabs.find(t => t.id === state.activeTab) || {}).label || "drivers";
    const confirmMsg =
      `Copy this week (${Utils.shortDateLabel(thisWeek[0])} → ${Utils.shortDateLabel(thisWeek[6])}) ` +
      `to next week (${Utils.shortDateLabel(nextWeek[0])} → ${Utils.shortDateLabel(nextWeek[6])}) ` +
      `for ${driverIds.length} ${tabLabel}?\n\n` +
      `This will overwrite any existing entries in that range.`;
    if (!confirm(confirmMsg)) return;

    const isoSrcStart  = Utils.toIsoDate(thisWeek[0]);
    const isoSrcEnd    = Utils.toIsoDate(thisWeek[6]);
    const isoDestStart = Utils.toIsoDate(nextWeek[0]);
    const isoDestEnd   = Utils.toIsoDate(nextWeek[6]);

    setBulkBusy(true);
    try {
      const snapshot = await fetchEntriesForRange(driverIds, isoDestStart, isoDestEnd);
      const n = await DB.copyEntriesShifted(driverIds, isoSrcStart, isoSrcEnd, 7);

      lastBulkAction = {
        driverIds,
        isoStart: isoDestStart,
        isoEnd:   isoDestEnd,
        snapshot,
        label: `Copy to next week (${Utils.shortDateLabel(nextWeek[0])})`,
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
    // Operate on the full Mon–Sun calendar week containing the anchor.
    const thisWeek = Utils.weekDates(state.anchorDate);
    const driverIds = state.drivers.map(d => d.id);
    if (!driverIds.length) return;

    const isoStart = Utils.toIsoDate(thisWeek[0]);
    const isoEnd   = Utils.toIsoDate(thisWeek[6]);

    // Fetch the full destination range fresh so the count + undo snapshot
    // include days outside the visible window.
    let snapshot;
    try {
      snapshot = await fetchEntriesForRange(driverIds, isoStart, isoEnd);
    } catch (err) {
      console.error("Clear week pre-fetch failed:", err);
      alert(`Couldn't read this week's entries: ${err.message || err}`);
      return;
    }

    if (!snapshot.length) {
      alert("No entries to clear for this week.");
      return;
    }

    const tabLabel = (APP_CONFIG.tabs.find(t => t.id === state.activeTab) || {}).label || "drivers";
    const confirmMsg =
      `Delete all ${snapshot.length} entries for ${driverIds.length} ${tabLabel} ` +
      `(${Utils.shortDateLabel(thisWeek[0])} → ${Utils.shortDateLabel(thisWeek[6])})?\n\n` +
      `Use Undo to restore.`;
    if (!confirm(confirmMsg)) return;

    setBulkBusy(true);
    try {
      await DB.deleteEntriesForDriversInRange(driverIds, isoStart, isoEnd);
      lastBulkAction = {
        driverIds, isoStart, isoEnd, snapshot,
        label: `Clear ${Utils.shortDateLabel(thisWeek[0])} → ${Utils.shortDateLabel(thisWeek[6])}`,
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

  // Toggle visibility of the schedule UI vs auxiliary tabs (stats, historical,
  // settings). The schedule chrome is shared across drivers/dispatchers.
  function applyTabView() {
    const tab = state.activeTab;
    const isAuxView = (tab === "stats" || tab === "historical" || tab === "settings");

    const scheduleChrome = [
      document.querySelector(".week-nav"),
      document.querySelector(".filters"),
      document.querySelector(".view-toolbar"),
      document.getElementById("week-stats"),
      coverageEl,
      gridViewEl,
      ganttViewEl,
    ];
    scheduleChrome.forEach(el => { if (el) el.hidden = isAuxView; });
    // Coverage panel only makes sense for the towing tab.
    if (coverageEl && !isAuxView) {
      coverageEl.hidden = tab !== "drivers";
    }
  }

  // ---------- Render ----------
  // render() = loadData() + paint(). Filter changes that affect the DB query
  // (tab/yard/company/anchor/days) call render(). Search-only changes call
  // paint() directly.

  async function render() {
    try {
      await loadData();
    } catch (err) {
      body.innerHTML = "";
      emptyEl.hidden = false;
      emptyEl.innerHTML =
        `<p><strong>Couldn't load schedule.</strong></p>` +
        `<p class="muted">${escapeHtml(err.message || String(err))}</p>`;
      console.error(err);
      return;
    }
    paint();
  }

  // Fetch drivers + the 3-week entries window into state.allDrivers/allEntries.
  // Concurrent calls collapse into a single shared promise so rapid trigger
  // events (Realtime, schedule-changed bursts) don't pile up DB roundtrips.
  function loadData() {
    if (inflightFetch) return inflightFetch;

    inflightFetch = (async () => {
      if (!state.companiesLoaded) {
        await loadCompanies();
        await loadYards();
      }

      const [drivers, allEntries] = await Promise.all([
        DB.listDrivers({
          includeInactive: state.showInactive,
          company:         state.company || null,
          yard:            yardFilterFor(state.yard),
          functions:       activeFunctions(),
        }),
        // Pull 3 weeks at once so we can compute last/this/next stats from one fetch.
        DB.listScheduleBetween(weekRangeIsoStart(), weekRangeIsoEnd()),
      ]);
      state.allDrivers = drivers;
      state.allEntries = allEntries;
    })();

    inflightFetch.finally(() => { inflightFetch = null; });
    return inflightFetch;
  }

  function weekRangeIsoStart() {
    const N = state.viewDays;
    return Utils.toIsoDate(Utils.addDays(state.anchorDate, -N));
  }

  function weekRangeIsoEnd() {
    const N = state.viewDays;
    const nextWeek = Utils.dateRange(Utils.addDays(state.anchorDate, +N), N);
    return Utils.toIsoDate(nextWeek[nextWeek.length - 1]);
  }

  // Filter cached data + render. Cheap; safe to call on every search keystroke.
  function paint() {
    const N = state.viewDays;
    const week     = Utils.dateRange(state.anchorDate,                     N);
    const lastWeek = Utils.dateRange(Utils.addDays(state.anchorDate, -N),   N);
    const nextWeek = Utils.dateRange(Utils.addDays(state.anchorDate, +N),   N);
    const lastDay  = week[week.length - 1];
    const isoStart = Utils.toIsoDate(week[0]);
    const isoEnd   = Utils.toIsoDate(lastDay);

    renderHeader(week);
    rangeEl.textContent =
      `${Utils.shortDateLabel(week[0])} → ${Utils.shortDateLabel(lastDay)}`;
    jumpInput.value = isoStart;

    const drivers    = state.allDrivers || [];
    const allEntries = state.allEntries || [];

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

    // Coverage panel (Drivers tab only). Uses the FULL roster, not the
    // search-filtered subset — coverage is a system-wide metric, not a
    // function of what's currently typed in the search box.
    renderCoveragePanel(state.allDrivers || [], allEntries, isoStart, isoEnd);

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
    // Keep the gantt's static sort dropdown in sync with state.
    const ganttSort = document.getElementById("driver-sort-gantt");
    if (ganttSort && ganttSort.value !== state.sortBy.gantt) {
      ganttSort.value = state.sortBy.gantt;
    }

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
    ganttAxisEl.innerHTML = labels +
      `<div class="gantt__now-line" data-now-line hidden></div>`;

    // Group entries by driver
    const byDriver = new Map();
    for (const e of entries) {
      if (!byDriver.has(e.driver_id)) byDriver.set(e.driver_id, []);
      byDriver.get(e.driver_id).push(e);
    }

    const weekStartMs = week[0].getTime();
    const sorted = sortDrivers(drivers, { entries, week });

    // Build per-(driver|date) index for fast lookup + hours computation.
    const byKey = new Map();
    for (const e of entries) {
      const k = `${e.driver_id}|${e.schedule_date}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }

    // OFF blocks visually start at the moment the previous day's last shift
    // ends, not at midnight. Precompute the override start (in week-hours)
    // for each OFF entry that has a preceding-day shift.
    const offStartByEntryId = computeOffStartOverrides(entries, byKey, weekStartMs);

    ganttBodyEl.innerHTML = sorted.map(d => {
      const driverEntries = byDriver.get(d.id) || [];
      const hours = computeDriverWeekHours(d.id, week, byKey);
      return renderGanttRow(d, weekStartMs, driverEntries, hours, offStartByEntryId);
    }).join("");

    updateGanttNowLine();
  }

  // Live "now" indicator: vertical line at the current time. Reads the gantt's
  // current week start + total hours, computes a percentage, and toggles each
  // [data-now-line] element. Cheap — runs once on render and once per minute.
  function updateGanttNowLine() {
    const lines = document.querySelectorAll("[data-now-line]");
    if (!lines.length) return;

    const base = new Date(state.anchorDate);
    base.setHours(0, 0, 0, 0);
    const weekStartMs = base.getTime();
    const totalHours  = ganttHours();
    const visibleH    = state.viewDays * 24;
    const nowOffsetH  = (Date.now() - weekStartMs) / 3600000;

    if (nowOffsetH < 0 || nowOffsetH > visibleH) {
      lines.forEach(el => { el.hidden = true; });
      return;
    }
    const leftPct = (nowOffsetH / totalHours) * 100;
    const tip     = `Now · ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
    lines.forEach(el => {
      el.hidden = false;
      el.style.left = leftPct + "%";
      el.title = tip;
    });
  }

  // For each OFF entry on day N, look at the driver's day-(N-1) shifts. If
  // any shift's end time falls AFTER day N's midnight (overnight) or after
  // some same-day point, the OFF should start at that latest end instead of
  // at midnight. Returns Map<entryId, hoursSinceWeekStart>.
  function computeOffStartOverrides(entries, byKey, weekStartMs) {
    const overrides = new Map();
    for (const e of entries) {
      if (e.entry_type !== "off") continue;

      const offDate = Utils.fromIsoDate(e.schedule_date);
      const offDayOffsetH = Math.round((offDate.getTime() - weekStartMs) / 3600000);
      // Default: starts at day N midnight.
      let earliestStartH = offDayOffsetH;

      const prevIso = Utils.toIsoDate(Utils.addDays(offDate, -1));
      const prevEntries = byKey.get(`${e.driver_id}|${prevIso}`) || [];
      const prevShifts = prevEntries.filter(x => x.entry_type === "shift");
      if (!prevShifts.length) continue;

      const prevDate = Utils.fromIsoDate(prevIso);
      const prevDayOffsetH = Math.round((prevDate.getTime() - weekStartMs) / 3600000);

      let latestEndAbs = -Infinity;
      for (const ps of prevShifts) {
        const sH = Utils.timeToHours(ps.start_time);
        let eH  = Utils.timeToHours(ps.end_time);
        if (eH <= sH) eH += 24;                          // overnight
        const endAbs = prevDayOffsetH + eH;
        if (endAbs > latestEndAbs) latestEndAbs = endAbs;
      }
      if (latestEndAbs > earliestStartH) earliestStartH = latestEndAbs;

      // Don't push the bar off the left edge if the previous day isn't
      // visible (e.g. yard switch). Falls back to midnight in that case.
      if (earliestStartH < offDayOffsetH && prevDayOffsetH < 0) continue;

      if (earliestStartH !== offDayOffsetH) overrides.set(e.id, earliestStartH);
    }
    return overrides;
  }

  function renderGanttRow(driver, weekStartMs, entries, hours, offStartByEntryId) {
    const totalHours = ganttHours();
    const dayLines = Array.from({ length: state.viewDays }, (_, i) => {
      const leftPct = (((i + 1) * 24) / totalHours) * 100;
      return `<div class="gantt__divider" style="left:${leftPct}%"></div>`;
    }).join("");

    const bars = entries.map(e =>
      renderGanttBar(e, weekStartMs, offStartByEntryId)
    ).filter(Boolean).join("");

    // Same markup as the grid's driver cell so both views show the type badge,
    // yard, weekly hours, and inactive flag identically. The outer container
    // class differs to keep the gantt's column-width layout.
    const isInactive = driver.active === false;
    const isExcludedYard = window.Optimizer?.isInExcludedYard?.(driver) || false;
    const hoursBadge = hours > 0
      ? `<span class="driver-hours" title="Scheduled this week">${escapeHtml(Utils.formatHours(hours))}</span>`
      : "";
    const driverInfo = `
      <div class="gantt-row__driver ${isInactive ? "is-inactive" : ""} ${isExcludedYard ? "is-excluded-yard" : ""}" data-driver-id="${driver.id}"
           ${isExcludedYard ? 'title="Yard is excluded from towing-supply count (Settings → Excluded yards)"' : ""}>
        <div class="driver-name">
          ${escapeHtml(driver.name || "(unnamed)")}
          ${hoursBadge}
        </div>
        <div class="driver-meta">
          <span class="badge badge--${categoryClass(driver.function)}">${escapeHtml(driver.function || "—")}</span>
          <span class="muted">#${escapeHtml(driver.irh_driver_number || driver.id)} · yard ${escapeHtml(formatYards(driver.irh_yard_number) || driver.yard || "—")}</span>
          ${isInactive ? `<span class="badge badge--off">inactive</span>` : ""}
        </div>
      </div>`;

    return `
      <div class="gantt-row">
        ${driverInfo}
        <div class="gantt-row__track">
          ${dayLines}
          ${bars}
          <div class="gantt__now-line gantt__now-line--track" data-now-line hidden></div>
        </div>
      </div>
    `;
  }

  function renderGanttBar(entry, weekStartMs, offStartByEntryId) {
    const totalHours = ganttHours();
    const lastVisibleHour = state.viewDays * 24;            // exclusive end of the visible day range
    const date = Utils.fromIsoDate(entry.schedule_date);
    const dayOffsetH = Math.round((date.getTime() - weekStartMs) / (1000 * 60 * 60));
    if (dayOffsetH < 0 || dayOffsetH >= lastVisibleHour) return "";

    if (entry.entry_type === "off") {
      // Default span = the full off day. If the driver had a shift end on the
      // previous day (overnight, or just any same-day shift), the off block
      // starts at that shift's end instead of midnight, so it visually
      // connects to the work that preceded it.
      const dayEndH = dayOffsetH + 24;
      const overrideStartH = offStartByEntryId?.get(entry.id);
      const startH = (overrideStartH != null) ? overrideStartH : dayOffsetH;
      const leftPct  = (Math.max(0, startH) / totalHours) * 100;
      const widthPct = ((dayEndH - Math.max(0, startH)) / totalHours) * 100;
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
    const startShort = Utils.formatTime12Compact(entry.start_time);
    const endShort   = Utils.formatTime12Compact(entry.end_time);
    const overnight = endH > 24;

    return `
      <div class="gantt-bar gantt-bar--shift ${overnight ? "gantt-bar--overnight" : ""}"
           style="left:${leftPct}%; width:${widthPct}%"
           data-entry-id="${entry.id}"
           data-day-offset="${dayOffsetH}"
           title="${start} - ${end}${overnight ? " (next day)" : ""}">
        <div class="gantt-bar__handle gantt-bar__handle--left"  data-side="left"  title="Drag to change start"></div>
        <span class="gantt-bar__label gantt-bar__label--start">${startShort}</span>
        <span class="gantt-bar__label gantt-bar__label--end">${endShort}${overnight ? "+" : ""}</span>
        <div class="gantt-bar__handle gantt-bar__handle--right" data-side="right" title="Drag to change end"></div>
      </div>
    `;
  }

  const parseTimeToHours = Utils.timeToHours;

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
    const sel = (v) => state.sortBy.grid === v ? " selected" : "";
    const driverHeader = `
      <div class="cell cell--header cell--driver">
        <label class="driver-sort">
          <span class="driver-sort__label">Drivers</span>
          <select id="driver-sort" class="driver-sort__select"
                  title="Sort drivers by…">
            <option value="function"${sel("function")}>Type</option>
            <option value="name"${sel("name")}>Name</option>
            <option value="driverNumber"${sel("driverNumber")}>Driver #</option>
            <option value="startTime"${sel("startTime")}>Start time</option>
          </select>
        </label>
      </div>`;
    const cells = [driverHeader];
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

    const sorted = sortDrivers(drivers, { entries, week });
    body.innerHTML = sorted.map(d => renderDriverRow(d, week, byKey)).join("");
  }

  // Apply the current view's sort. Always falls back to name as the secondary
  // key so adjacent rows in the same group order predictably.
  // `entries` + `week` are only required when sorting by startTime.
  function sortDrivers(drivers, { entries = [], week = [] } = {}) {
    const sortKey = state.view === "gantt" ? state.sortBy.gantt : state.sortBy.grid;

    const byName = (a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });

    const numericIfPossible = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const byDriverNumber = (a, b) => {
      const an = numericIfPossible(a.irh_driver_number);
      const bn = numericIfPossible(b.irh_driver_number);
      if (an !== null && bn !== null) return an - bn;
      if (an === null && bn !== null) return 1;
      if (an !== null && bn === null) return -1;
      return String(a.irh_driver_number || a.id).localeCompare(
        String(b.irh_driver_number || b.id),
        undefined,
        { numeric: true },
      );
    };

    // Per-driver earliest shift start (in hours since week start) across the
    // visible window. Drivers with no shift in-window go to the bottom.
    const earliestStartByDriver = (() => {
      if (sortKey !== "startTime" || !week.length) return null;
      const weekStartMs = week[0].getTime();
      const totalHoursVisible = (week.length) * 24;
      const map = new Map();
      for (const e of entries) {
        if (e.entry_type !== "shift") continue;
        const date = Utils.fromIsoDate(e.schedule_date);
        const dayOffsetH = Math.round((date.getTime() - weekStartMs) / 3600000);
        if (dayOffsetH < 0 || dayOffsetH >= totalHoursVisible) continue;
        const total = dayOffsetH + Utils.timeToHours(e.start_time);
        const prev = map.get(e.driver_id);
        if (prev === undefined || total < prev) map.set(e.driver_id, total);
      }
      return map;
    })();

    return drivers.slice().sort((a, b) => {
      switch (sortKey) {
        case "name":
          return byName(a, b);
        case "driverNumber": {
          const cmp = byDriverNumber(a, b);
          return cmp !== 0 ? cmp : byName(a, b);
        }
        case "startTime": {
          const sa = earliestStartByDriver?.get(a.id) ?? Infinity;
          const sb = earliestStartByDriver?.get(b.id) ?? Infinity;
          if (sa !== sb) return sa - sb;
          return byName(a, b);
        }
        case "function":
        default: {
          const cmp = String(a.function || "").localeCompare(String(b.function || ""));
          return cmp !== 0 ? cmp : byName(a, b);
        }
      }
    });
  }

  function renderDriverRow(driver, week, byKey) {
    const isInactive = driver.active === false;
    const isExcludedYard = window.Optimizer?.isInExcludedYard?.(driver) || false;
    const weeklyHours = computeDriverWeekHours(driver.id, week, byKey);
    const hoursBadge = weeklyHours > 0
      ? `<span class="driver-hours" title="Scheduled this week">${escapeHtml(Utils.formatHours(weeklyHours))}</span>`
      : "";
    const driverCell = `
      <div class="cell cell--driver ${isInactive ? "is-inactive" : ""} ${isExcludedYard ? "is-excluded-yard" : ""}" data-driver-id="${driver.id}"
           ${isExcludedYard ? 'title="Yard is excluded from towing-supply count (Settings → Excluded yards)"' : ""}>
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

  // ---------- Coverage panel ----------

  // Inflight token so a slow baseline fetch doesn't overwrite a newer paint.
  let coverageRenderToken = 0;

  async function renderCoveragePanel(drivers, allEntries, isoStart, isoEnd) {
    if (!coverageEl) return;
    if (state.activeTab !== "drivers") {
      coverageEl.hidden = true;
      return;
    }
    coverageEl.hidden = false;

    const myToken = ++coverageRenderToken;
    coverageSummaryEl.textContent = "loading historical baseline…";
    coverageUnderEl.innerHTML = "";
    coverageOverEl.innerHTML = "";

    let baseline;
    try {
      baseline = await Optimizer.loadBaseline();
    } catch (err) {
      if (myToken !== coverageRenderToken) return;
      coverageSummaryEl.textContent = "couldn't load baseline";
      console.warn("Optimizer baseline load failed:", err);
      return;
    }
    if (myToken !== coverageRenderToken) return;

    const towingDrivers = Optimizer.filterSupplyDrivers(drivers);

    // Use the cached 3-week window we already fetched, narrowed to visible week.
    const entries = allEntries.filter(e =>
      e.schedule_date >= isoStart && e.schedule_date <= isoEnd
    );
    // Plus any overnight shifts from the day before the window (their tail
    // bleeds into the first morning).
    const dayBeforeIso = Utils.toIsoDate(
      Utils.addDays(Utils.fromIsoDate(isoStart), -1)
    );
    const carryIns = allEntries.filter(e =>
      e.schedule_date === dayBeforeIso &&
      e.entry_type === "shift" &&
      e.end_time < e.start_time
    );

    const gaps = Optimizer.computeGaps(
      [...entries, ...carryIns],
      towingDrivers,
      baseline,
      isoStart,
      isoEnd,
    );
    const { under, over } = Optimizer.topSuggestions(gaps);

    const totalUnder = gaps.filter(g => g.status === "under").length;
    const totalOver  = gaps.filter(g => g.status === "over").length;
    coverageSummaryEl.textContent =
      `${totalUnder} understaffed · ${totalOver} overstaffed (LDT+HDT vs historical avg)`;

    coverageUnderEl.innerHTML = under.length
      ? under.map(g => coverageItemHtml(g)).join("")
      : `<li class="coverage__empty">No flagged hours this week.</li>`;
    coverageOverEl.innerHTML = over.length
      ? over.map(g => coverageItemHtml(g)).join("")
      : `<li class="coverage__empty">No flagged hours this week.</li>`;
  }

  function coverageItemHtml(g) {
    const cls = g.status === "under" ? "coverage__chip--under" : "coverage__chip--over";
    const sign = g.gap > 0 ? "+" : "";
    const chip = `${sign}${g.gap.toFixed(1)}`;
    const text = Utils.escapeHtml(Optimizer.suggestionText(g));
    return (
      `<li class="coverage__item" data-iso="${g.isoDate}" title="Click to open day detail">` +
        `<span class="coverage__chip ${cls}">${chip}</span>` +
        `<span class="coverage__text">${text}</span>` +
      `</li>`
    );
  }

  const escapeHtml = Utils.escapeHtml;

  return {
    mount,
    render,
    goTo,
    shiftWeek,
    getAnchorDate: () => state.anchorDate,
    getActiveTab:  () => state.activeTab,
    getActiveView: () => state.view,
    getYard:       () => state.yard,
    // Roster / entries snapshots — used by Optimizer.debugSupplyAt and any
    // future inspection tooling. Always returns the most recent fetch.
    getAllDrivers: () => state.allDrivers || [],
    getAllEntries: () => state.allEntries || [],
    // Expand a display-yard code into the array of underlying yard codes
    // (target itself + any aliases pointing to it). Returns null if no filter.
    yardFilterFor,
    // Sort an arbitrary driver list by whichever sort the active view uses.
    // Pass { entries, week } when sorting by startTime.
    sortDrivers,
  };
})();
