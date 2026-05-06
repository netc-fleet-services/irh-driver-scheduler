// Stats tab. 15 cards across 3 categories. Built on Chart.js.
// Each card shows a mini chart preview; click any card to expand.
// The Drivers card opens a per-driver detail modal (past 7 days + upcoming 7).

window.Stats = (function () {

  // ---------- State ----------
  const state = {
    rangeDays: 30,
    scope:     "all",      // "all" | "drivers" | "dispatchers"
    drivers:   [],
    entries:   [],         // entries within [startIso, todayIso]
    extEntries:[],         // 4-week-extended for trend charts
    cardOverrides: {},     // cardId -> { startIso, endIso, days, label }
    cardEntries:   {},     // cardId -> entries[] (only set when override active)
  };

  // ---------- Per-card range helpers ----------

  function globalRangeLabel(days) {
    const presets = { 7: "Last 7 days", 14: "Last 14 days", 30: "Last 30 days", 60: "Last 60 days", 90: "Last 90 days" };
    return presets[days] || `Last ${days} days`;
  }

  function getCardRange(cardId) {
    const ov = state.cardOverrides[cardId];
    if (ov) return ov;
    const today = new Date();
    const start = Utils.addDays(today, -state.rangeDays);
    return {
      startIso: Utils.toIsoDate(start),
      endIso:   Utils.toIsoDate(today),
      days:     state.rangeDays,
      label:    globalRangeLabel(state.rangeDays),
    };
  }

  function getEntriesForCard(cardId) {
    if (state.cardOverrides[cardId]) return state.cardEntries[cardId] || [];
    return state.entries;
  }

  function getExtEntriesForCard(cardId) {
    if (state.cardOverrides[cardId]) return state.cardEntries[cardId] || [];
    return state.extEntries;
  }

  async function loadCardEntries(cardId) {
    const r = getCardRange(cardId);
    const inScope = new Set(state.drivers.map(d => d.id));
    const ents = (await DB.listScheduleBetween(r.startIso, r.endIso))
      .filter(e => inScope.has(e.driver_id));
    state.cardEntries[cardId] = ents;
    return ents;
  }

  function updateChipLabel(cardId) {
    const chip = document.querySelector(`[data-range-chip][data-card="${cardId}"] .stat-card__range-label`);
    if (!chip) return;
    const r = getCardRange(cardId);
    chip.textContent = r.label;
    const wrap = chip.closest("[data-range-chip]");
    if (wrap) wrap.classList.toggle("stat-card__range-chip--override", !!state.cardOverrides[cardId]);
  }

  // ---------- Card definitions ----------
  // Each: { id, label, blurb, type, render(canvas, opts) }
  const CARDS = [];

  function addCard(c) { CARDS.push(c); }

  // ---------- DOM refs ----------
  let panel, sectionsEl, rangeEl, scopeEl, summaryEl;
  let modal, modalTitleEl, modalCanvas;
  let detailModal, detailTitle, detailMeta, pastStats, pastList, futureStats, futureList;

  const charts = new Map();           // canvasId -> Chart instance
  let modalChart = null;
  let initialized = false;

  // ---------- Categories layout ----------
  // 4 cards per category = 12 total. Hours-histogram was the least actionable
  // (purely statistical — top/bottom leaderboards already show distribution).
  const CATEGORIES = [
    {
      title: "Coverage & Scheduling",
      cards: ["coverage-hour", "coverage-day", "coverage-heatmap", "shift-length"],
    },
    {
      title: "People & Workload",
      cards: ["top-drivers", "bottom-drivers", "driver-detail", "function-breakdown"],
    },
    {
      title: "Trends & Operations",
      cards: ["week-over-week", "off-reasons", "yard-utilization", "overnight-trend"],
    },
  ];

  // ---------- Mount / open / close ----------

  function mount() {
    panel       = document.getElementById("stats-view");
    sectionsEl  = document.getElementById("stats-sections");
    rangeEl     = document.getElementById("stats-range");
    scopeEl     = document.getElementById("stats-scope");
    summaryEl   = document.getElementById("stats-summary");

    modal        = document.getElementById("stat-modal");
    modalTitleEl = document.getElementById("stat-modal-title");
    modalCanvas  = document.getElementById("stat-modal-canvas");

    detailModal  = document.getElementById("driver-detail-modal");
    detailTitle  = document.getElementById("driver-detail-title");
    detailMeta   = document.getElementById("driver-detail-meta");
    pastStats    = document.getElementById("driver-past-stats");
    pastList     = document.getElementById("driver-past-list");
    futureStats  = document.getElementById("driver-future-stats");
    futureList   = document.getElementById("driver-future-list");

    rangeEl.addEventListener("change", () => {
      state.rangeDays = Number(rangeEl.value);
      refresh();
    });

    document.addEventListener("click", (ev) => {
      const pop = document.getElementById("stat-range-pop");
      if (!pop || pop.hidden) return;
      if (ev.target.closest("#stat-range-pop")) return;
      if (ev.target.closest("[data-range-chip]")) return;
      pop.hidden = true;
    });
    scopeEl.addEventListener("change", () => {
      state.scope = scopeEl.value;
      refresh();
    });

    sectionsEl.addEventListener("click", onSectionClick);

    [modal, detailModal].forEach(m => {
      m.querySelectorAll("[data-modal-close]").forEach(el =>
        el.addEventListener("click", () => closeModal(m))
      );
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!modal.hidden)       closeModal(modal);
      if (!detailModal.hidden) closeModal(detailModal);
    });

    initialized = true;
    renderShell();
  }

  async function open() {
    if (!initialized) mount();
    panel.hidden = false;
    await refresh();
  }

  function close() {
    panel.hidden = true;
    // Keep mini-chart instances alive so the next open shows immediately;
    // only release the modal chart.
    destroyModalChart();
  }

  function closeModal(m) {
    m.hidden = true;
    if (m === modal && modalChart) { modalChart.destroy(); modalChart = null; }
  }

  function destroyAllCharts() {
    for (const c of charts.values()) c.destroy();
    charts.clear();
    if (modalChart) { modalChart.destroy(); modalChart = null; }
  }

  // Tear down ONLY the modal chart (called when the modal closes).
  function destroyModalChart() {
    if (modalChart) { modalChart.destroy(); modalChart = null; }
  }

  // ---------- Shell (renders the empty cards once; refresh fills them) ----------

  function renderShell() {
    sectionsEl.innerHTML = CATEGORIES.map((cat, idx) => `
      <section class="stats-category">
        <header class="stats-category__head">
          <span class="stats-category__num">${idx + 1}</span>
          <h2 class="stats-category__title">${cat.title}</h2>
          <span class="stats-category__count muted">${cat.cards.length} charts</span>
        </header>
        <div class="stats-grid">
          ${cat.cards.map(id => {
            const def = CARDS.find(c => c.id === id);
            if (!def) return "";
            const interactive = id !== "driver-detail";
            return `
              <button type="button" class="stat-card ${interactive ? "stat-card--interactive" : "stat-card--picker"}"
                      data-card="${id}"
                      ${interactive ? `aria-label="Expand ${escapeHtml(def.label)}"` : ""}>
                <header class="stat-card__head">
                  <h3>${escapeHtml(def.label)}</h3>
                  <span class="stat-card__range-chip ${state.cardOverrides[id] ? "stat-card__range-chip--override" : ""}"
                        data-range-chip data-card="${id}" role="button" tabindex="0"
                        title="Change date range for this card">
                    <span class="stat-card__range-label">${escapeHtml((state.cardOverrides[id] || { label: globalRangeLabel(state.rangeDays) }).label)}</span>
                    <span class="stat-card__range-caret" aria-hidden="true">&#9662;</span>
                  </span>
                  ${interactive ? `<span class="stat-card__expand" aria-hidden="true">&plus;</span>` : ""}
                </header>
                <div class="stat-card__body">
                  <canvas id="canvas-${id}"></canvas>
                  <div class="stat-card__overlay" id="overlay-${id}"></div>
                </div>
                ${def.blurb ? `<p class="stat-card__blurb muted">${escapeHtml(def.blurb)}</p>` : ""}
              </button>
            `;
          }).join("")}
        </div>
      </section>
    `).join("");
  }

  // ---------- Refresh / data fetch ----------

  async function refresh() {
    sectionsEl.classList.add("stats-sections--loading");
    const todayIso = Utils.toIsoDate(new Date());
    const startIso = Utils.toIsoDate(Utils.addDays(new Date(), -state.rangeDays));

    // Drivers in scope
    const tabs = APP_CONFIG.tabs || [];
    const scopeFunctions = (() => {
      if (state.scope === "drivers")     return tabs.find(t => t.id === "drivers")?.functions || null;
      if (state.scope === "dispatchers") return tabs.find(t => t.id === "dispatchers")?.functions || null;
      return null;
    })();

    state.drivers = await DB.listDrivers({
      includeInactive: false,
      company:         APP_CONFIG.defaultCompany || null,
      functions:       scopeFunctions,
    });

    // Main entries window
    state.entries = await DB.listScheduleBetween(startIso, todayIso);
    // Filter entries to in-scope drivers only
    const inScope = new Set(state.drivers.map(d => d.id));
    state.entries = state.entries.filter(e => inScope.has(e.driver_id));

    // Extended window for trends (max(rangeDays, 28))
    const extDays = Math.max(state.rangeDays, 28);
    const extStartIso = Utils.toIsoDate(Utils.addDays(new Date(), -extDays));
    state.extEntries = await DB.listScheduleBetween(extStartIso, todayIso);
    state.extEntries = state.extEntries.filter(e => inScope.has(e.driver_id));

    // Reload entries for cards with active overrides (scope/drivers may have changed)
    const overrideIds = Object.keys(state.cardOverrides);
    if (overrideIds.length) {
      await Promise.all(overrideIds.map(id => loadCardEntries(id)));
    }

    // Refresh chip labels (cards without override show the new global label)
    document.querySelectorAll("[data-range-chip]").forEach(chip => {
      updateChipLabel(chip.dataset.card);
    });

    summaryEl.textContent =
      `${state.drivers.length} ${state.scope === "all" ? "people" : state.scope} ` +
      `· ${countShifts(state.entries)} shifts · ${Utils.formatHours(totalHours(state.entries))}`;

    // Only render the cards that are currently shown in the categories layout
    // (we trimmed to 12 — keep card definitions for the full 15 in case we
    // want to re-add later).
    const visibleIds = new Set();
    CATEGORIES.forEach(cat => cat.cards.forEach(id => visibleIds.add(id)));
    for (const c of CARDS) {
      if (!visibleIds.has(c.id)) continue;
      try { renderCard(c.id, false); }
      catch (err) { console.error("Stats card render failed:", c.id, err); }
    }
    sectionsEl.classList.remove("stats-sections--loading");
  }

  function renderCard(id, expanded) {
    const def = CARDS.find(c => c.id === id);
    if (!def) return;
    const canvasId = expanded ? "stat-modal-canvas" : `canvas-${id}`;
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const overlayEl = document.getElementById(`overlay-${id}`);
    def.render(canvas, { expanded, overlayEl, cardId: id });
  }

  // ---------- Card click -> expand ----------

  function onSectionClick(e) {
    const chip = e.target.closest("[data-range-chip]");
    if (chip) {
      e.stopPropagation();
      openRangePopover(chip, chip.dataset.card);
      return;
    }
    const card = e.target.closest(".stat-card[data-card]");
    if (!card) return;
    const id = card.dataset.card;
    if (id === "driver-detail") {
      // Clicking inside the picker overlay handled by its own listeners; ignore card-level click
      if (e.target.closest(".driver-detail__pick-item, .driver-detail__search")) return;
      return;
    }
    openExpanded(id);
  }

  // ---------- Per-card range popover ----------

  function ensureRangePopover() {
    let pop = document.getElementById("stat-range-pop");
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "stat-range-pop";
    pop.className = "range-pop";
    pop.hidden = true;
    pop.innerHTML = `
      <div class="range-pop__section">
        <button type="button" class="range-pop__preset" data-preset="this-week">This week</button>
        <button type="button" class="range-pop__preset" data-preset="7">Last 7 days</button>
        <button type="button" class="range-pop__preset" data-preset="14">Two weeks</button>
        <button type="button" class="range-pop__preset" data-preset="this-month">This month</button>
        <button type="button" class="range-pop__preset" data-preset="30">Last 30 days</button>
        <button type="button" class="range-pop__preset" data-preset="60">Last 60 days</button>
        <button type="button" class="range-pop__preset" data-preset="90">Last 90 days</button>
      </div>
      <div class="range-pop__section range-pop__custom">
        <label class="range-pop__label">Custom range <span class="muted">(set start = end for a single day)</span></label>
        <div class="range-pop__row">
          <input type="date" class="range-pop__date" data-custom-from />
          <span class="muted">→</span>
          <input type="date" class="range-pop__date" data-custom-to />
          <button type="button" class="btn btn--primary range-pop__apply" data-custom-apply>Apply</button>
        </div>
      </div>
      <div class="range-pop__section range-pop__footer">
        <button type="button" class="range-pop__reset" data-reset>Reset to global range</button>
      </div>
    `;
    document.body.appendChild(pop);
    pop.addEventListener("click", onRangePopClick);
    return pop;
  }

  let rangePopCardId = null;

  function openRangePopover(chipEl, cardId) {
    const pop = ensureRangePopover();
    rangePopCardId = cardId;
    const r = getCardRange(cardId);
    pop.querySelector("[data-custom-from]").value = r.startIso;
    pop.querySelector("[data-custom-to]").value   = r.endIso;
    // Position below the chip
    const rect = chipEl.getBoundingClientRect();
    pop.hidden = false;
    const popW = pop.offsetWidth;
    const top  = rect.bottom + window.scrollY + 6;
    let left   = rect.left + window.scrollX;
    if (left + popW > window.scrollX + window.innerWidth - 8) {
      left = window.scrollX + window.innerWidth - popW - 8;
    }
    pop.style.top  = top + "px";
    pop.style.left = left + "px";
  }

  async function onRangePopClick(ev) {
    const id = rangePopCardId;
    if (!id) return;
    const presetBtn = ev.target.closest("[data-preset]");
    const applyBtn  = ev.target.closest("[data-custom-apply]");
    const resetBtn  = ev.target.closest("[data-reset]");
    if (!presetBtn && !applyBtn && !resetBtn) return;

    const today = new Date();
    let startIso, endIso, days, label;

    if (resetBtn) {
      delete state.cardOverrides[id];
      delete state.cardEntries[id];
      updateChipLabel(id);
      try { renderCard(id, false); } catch (err) { console.error(err); }
      document.getElementById("stat-range-pop").hidden = true;
      return;
    }

    if (presetBtn) {
      const p = presetBtn.dataset.preset;
      if (p === "this-week") {
        const monday = Utils.startOfWeek(today);
        startIso = Utils.toIsoDate(monday);
        endIso   = Utils.toIsoDate(today);
        days     = Math.max(1, Math.round((today - monday) / 86400000) + 1);
        label    = "This week";
      } else if (p === "this-month") {
        const first = new Date(today.getFullYear(), today.getMonth(), 1);
        startIso = Utils.toIsoDate(first);
        endIso   = Utils.toIsoDate(today);
        days     = Math.max(1, Math.round((today - first) / 86400000) + 1);
        label    = "This month";
      } else {
        const n = Number(p);
        startIso = Utils.toIsoDate(Utils.addDays(today, -n));
        endIso   = Utils.toIsoDate(today);
        days     = n;
        label    = p === "14" ? "Two weeks" : globalRangeLabel(n);
      }
    } else if (applyBtn) {
      const fromV = document.querySelector("#stat-range-pop [data-custom-from]").value;
      const toV   = document.querySelector("#stat-range-pop [data-custom-to]").value;
      if (!fromV || !toV) return;
      if (fromV > toV) { alert("Start date must be on or before end date."); return; }
      startIso = fromV;
      endIso   = toV;
      const sD = Utils.fromIsoDate(fromV), eD = Utils.fromIsoDate(toV);
      days = Math.max(1, Math.round((eD - sD) / 86400000) + 1);
      label = (fromV === toV)
        ? Utils.fromIsoDate(fromV).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : `${Utils.fromIsoDate(fromV).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${Utils.fromIsoDate(toV).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    }

    state.cardOverrides[id] = { startIso, endIso, days, label };
    document.getElementById("stat-range-pop").hidden = true;
    updateChipLabel(id);
    try {
      await loadCardEntries(id);
      renderCard(id, false);
    } catch (err) { console.error("card override failed:", err); }
  }

  function openExpanded(id) {
    const def = CARDS.find(c => c.id === id);
    if (!def) return;
    modalTitleEl.textContent = def.label + (def.blurb ? ` — ${def.blurb}` : "");
    modal.hidden = false;
    if (modalChart) { modalChart.destroy(); modalChart = null; }
    setTimeout(() => renderCard(id, true), 0);   // wait for canvas size to settle
  }

  // ---------- Driver detail modal ----------

  async function openDriverDetail(driver) {
    if (!driver) return;
    detailTitle.textContent = driver.name || "(unnamed)";
    detailMeta.textContent =
      `#${driver.irh_driver_number || driver.id} · ${driver.function || "—"}`
      + (driver.irh_yard_number ? ` · yard ${driver.irh_yard_number}` : "");
    pastStats.textContent  = "Loading…";
    pastList.innerHTML     = "";
    futureStats.textContent = "Loading…";
    futureList.innerHTML    = "";
    detailModal.hidden = false;

    const today  = new Date();
    const past   = Utils.toIsoDate(Utils.addDays(today, -7));
    const future = Utils.toIsoDate(Utils.addDays(today,  7));
    const todayIso = Utils.toIsoDate(today);

    let entries;
    try {
      entries = await DB.listScheduleBetween(past, future);
    } catch (err) {
      pastStats.textContent  = "Failed to load.";
      futureStats.textContent = "";
      return;
    }
    entries = entries.filter(e => e.driver_id === driver.id);

    const past7   = entries.filter(e => e.schedule_date <  todayIso);
    const future7 = entries.filter(e => e.schedule_date >= todayIso);

    pastStats.innerHTML   = renderDriverStats(past7);
    futureStats.innerHTML = renderDriverStats(future7);
    pastList.innerHTML    = renderDriverList(past7);
    futureList.innerHTML  = renderDriverList(future7);
  }

  function renderDriverStats(entries) {
    const shifts = entries.filter(e => e.entry_type === "shift");
    const hours  = totalHours(shifts);
    const offs   = entries.filter(e => e.entry_type === "off").length;
    return `
      <div class="stat-pill">${Utils.formatHours(hours)} <small>scheduled</small></div>
      <div class="stat-pill">${shifts.length} <small>shifts</small></div>
      <div class="stat-pill">${offs} <small>off days</small></div>
    `;
  }

  function renderDriverList(entries) {
    if (!entries.length) return `<li class="muted">No entries.</li>`;
    return entries
      .slice()
      .sort((a, b) => a.schedule_date.localeCompare(b.schedule_date))
      .map(e => {
        const d = Utils.fromIsoDate(e.schedule_date);
        const dateLabel = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
        if (e.entry_type === "off") {
          return `<li class="driver-detail__item driver-detail__item--off">
                    <span class="driver-detail__date">${dateLabel}</span>
                    <span>OFF · ${escapeHtml(e.off_reason || "—")}</span>
                  </li>`;
        }
        const start = Utils.formatTime12(e.start_time);
        const end   = Utils.formatTime12(e.end_time);
        const overnight = e.end_time < e.start_time;
        const hrs = Utils.shiftDurationHours(e.start_time, e.end_time);
        return `<li class="driver-detail__item">
                  <span class="driver-detail__date">${dateLabel}</span>
                  <span>${start} – ${end}${overnight ? " <small>+1d</small>" : ""} · ${Utils.formatHours(hrs)}</span>
                </li>`;
      }).join("");
  }

  // ============================================================================
  //  Helpers / aggregations
  // ============================================================================

  function totalHours(entries) {
    let total = 0;
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      total += Utils.shiftDurationHours(e.start_time, e.end_time);
    }
    return total;
  }

  function countShifts(entries) {
    return entries.filter(e => e.entry_type === "shift").length;
  }

  function timeToHours(t) {
    if (!t) return 0;
    const [h, m] = String(t).split(":").map(Number);
    return h + (m || 0) / 60;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }

  // Coverage-by-hour: for each hour 0..23, average # drivers covering across days.
  function aggHoursByHourOfDay(entries, days) {
    const counts = new Array(24).fill(0);
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      let s = timeToHours(e.start_time);
      let f = timeToHours(e.end_time);
      if (f <= s) f += 24;
      const start = Math.floor(s);
      const end   = Math.ceil(f);
      for (let h = start; h < end; h++) counts[h % 24] += 1;
    }
    const dayCount = Math.max(1, days || state.rangeDays);
    return counts.map(c => +(c / dayCount).toFixed(2));
  }

  // Coverage-by-day-of-week: total scheduled hours grouped by Mon..Sun.
  function aggHoursByDayOfWeek(entries) {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const buckets = new Array(7).fill(0);
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      const d = Utils.fromIsoDate(e.schedule_date);
      const dow = (d.getDay() + 6) % 7;   // Mon=0
      buckets[dow] += Utils.shiftDurationHours(e.start_time, e.end_time);
    }
    return { labels, data: buckets.map(v => +v.toFixed(1)) };
  }

  // 7-day x 24-hour heatmap: avg drivers per hour per dow.
  function aggHeatmap(entries) {
    const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const dayCounts = new Array(7).fill(0);
    const seenDates = new Set();
    for (const e of entries) {
      if (!seenDates.has(e.schedule_date)) {
        const d = Utils.fromIsoDate(e.schedule_date);
        const dow = (d.getDay() + 6) % 7;
        dayCounts[dow] += 1;
        seenDates.add(e.schedule_date);
      }
      if (e.entry_type !== "shift") continue;
      const d = Utils.fromIsoDate(e.schedule_date);
      const dow = (d.getDay() + 6) % 7;
      let s = timeToHours(e.start_time);
      let f = timeToHours(e.end_time);
      if (f <= s) f += 24;
      for (let h = Math.floor(s); h < Math.ceil(f); h++) {
        grid[dow][h % 24] += 1;
      }
    }
    // Average per occurrence of that dow in the range
    return grid.map((row, dow) =>
      row.map(v => dayCounts[dow] ? +(v / dayCounts[dow]).toFixed(2) : 0)
    );
  }

  function aggShiftLengthDist(entries) {
    const bins = [4, 6, 8, 10, 12, 24];   // upper bounds
    const labels = ["<4h", "4-6h", "6-8h", "8-10h", "10-12h", "12+h"];
    const counts = new Array(bins.length).fill(0);
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      const h = Utils.shiftDurationHours(e.start_time, e.end_time);
      let i = bins.findIndex(b => h <= b); if (i < 0) i = bins.length - 1;
      counts[i] += 1;
    }
    return { labels, data: counts };
  }

  function aggDayNightSplit(entries) {
    let day = 0, night = 0, overnight = 0;
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      const s = timeToHours(e.start_time);
      const f = timeToHours(e.end_time);
      if (f <= s) overnight += 1;
      else if (s >= 18 || f <= 6) night += 1;
      else day += 1;
    }
    return { labels: ["Day", "Night", "Overnight"], data: [day, night, overnight] };
  }

  function aggHoursPerDriver(entries, drivers) {
    const map = new Map();
    for (const d of drivers) map.set(d.id, 0);
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      if (!map.has(e.driver_id)) continue;
      map.set(e.driver_id, map.get(e.driver_id) + Utils.shiftDurationHours(e.start_time, e.end_time));
    }
    return [...map.entries()].map(([id, hours]) => {
      const d = drivers.find(x => x.id === id);
      return { id, name: d?.name || `#${id}`, hours: +hours.toFixed(1), driver: d };
    });
  }

  function aggHoursDistribution(entries, drivers) {
    const arr = aggHoursPerDriver(entries, drivers).map(x => x.hours);
    const max = Math.max(40, ...arr);
    const binWidth = Math.ceil(max / 8);
    const bins = [];
    for (let i = 0; i * binWidth <= max; i++) bins.push(i * binWidth);
    const labels = bins.map((b, i) => i === bins.length - 1 ? `${b}+` : `${b}-${bins[i + 1]}`);
    const counts = new Array(bins.length).fill(0);
    for (const h of arr) {
      let idx = Math.min(bins.length - 1, Math.floor(h / binWidth));
      counts[idx] += 1;
    }
    return { labels, data: counts };
  }

  function aggFunctionBreakdown(entries, drivers) {
    const drvFn = new Map(drivers.map(d => [d.id, d.function || "Unknown"]));
    const buckets = new Map();
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      const fn = drvFn.get(e.driver_id) || "Unknown";
      const h = Utils.shiftDurationHours(e.start_time, e.end_time);
      buckets.set(fn, (buckets.get(fn) || 0) + h);
    }
    const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    return {
      labels: arr.map(x => x[0]),
      data:   arr.map(x => +x[1].toFixed(1)),
    };
  }

  function aggOffReasons(entries) {
    const buckets = new Map();
    for (const e of entries) {
      if (e.entry_type !== "off") continue;
      const r = e.off_reason || "unknown";
      buckets.set(r, (buckets.get(r) || 0) + 1);
    }
    const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: arr.map(x => x[0]), data: arr.map(x => x[1]) };
  }

  function aggYardUtilization(entries, drivers) {
    const drvYard = new Map();
    for (const d of drivers) {
      const y = d.irh_yard_number || "—";
      // multi-yard drivers split evenly
      const list = String(y).split(",").map(s => s.trim()).filter(Boolean);
      drvYard.set(d.id, list.length ? list : ["—"]);
    }
    const buckets = new Map();
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      const yards = drvYard.get(e.driver_id) || ["—"];
      const h = Utils.shiftDurationHours(e.start_time, e.end_time) / yards.length;
      for (const y of yards) buckets.set(y, (buckets.get(y) || 0) + h);
    }
    const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: arr.map(x => x[0]), data: arr.map(x => +x[1].toFixed(1)) };
  }

  // For trends — bucket by ISO-week relative to today.
  function bucketByWeek(entries, weeks) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = new Array(weeks).fill(0).map(() => []);
    const labels = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const start = Utils.addDays(today, -7 * (i + 1) + 1);
      labels.push(start.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    }
    for (const e of entries) {
      const d = Utils.fromIsoDate(e.schedule_date);
      const diffDays = Math.floor((today - d) / (1000 * 60 * 60 * 24));
      if (diffDays < 0) continue;
      const wIdx = weeks - 1 - Math.floor(diffDays / 7);
      if (wIdx < 0 || wIdx >= weeks) continue;
      buckets[wIdx].push(e);
    }
    return { labels, buckets };
  }

  function aggWeeklyTotals(entries, weeks) {
    const { labels, buckets } = bucketByWeek(entries, weeks);
    return { labels, data: buckets.map(b => +totalHours(b).toFixed(1)) };
  }

  function aggOvernightByWeek(entries, weeks) {
    const { labels, buckets } = bucketByWeek(entries, weeks);
    return {
      labels,
      data: buckets.map(b =>
        b.filter(e => e.entry_type === "shift" && e.end_time < e.start_time).length
      ),
    };
  }

  function aggActiveDriverCountByWeek(entries, weeks) {
    const { labels, buckets } = bucketByWeek(entries, weeks);
    return {
      labels,
      data: buckets.map(b => new Set(b.filter(e => e.entry_type === "shift").map(e => e.driver_id)).size),
    };
  }

  // ============================================================================
  //  Chart factories  (Chart.js wrappers)
  // ============================================================================

  const CHART_COLORS = {
    accent:    "#3b82f6",
    accent2:   "#8b5cf6",
    warn:      "#f59e0b",
    err:       "#ef4444",
    ok:        "#10b981",
    palette:   ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"],
    gridDark:  "rgba(255,255,255,0.08)",
    textDim:   "#9ca3af",
  };

  function commonChartOpts(expanded, extra = {}) {
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 700,
        easing: "easeInOutQuart",
      },
      transitions: {
        active:    { animation: { duration: 700, easing: "easeInOutQuart" } },
        resize:    { animation: { duration: 0 } },
        show:      { animation: { duration: 700 } },
        hide:      { animation: { duration: 400 } },
      },
      plugins: {
        legend: {
          display: !!extra.showLegend,
          labels: { color: CHART_COLORS.textDim, font: { size: expanded ? 13 : 10 } },
        },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(15,17,21,0.95)",
          borderColor: "rgba(59,130,246,0.35)",
          borderWidth: 1,
          titleColor: "#fff",
          bodyColor: "#e5e7eb",
          padding: 10,
          cornerRadius: 6,
        },
      },
      scales: extra.scales || {
        x: { ticks: { color: CHART_COLORS.textDim, font: { size: expanded ? 12 : 10 } }, grid: { color: CHART_COLORS.gridDark } },
        y: { ticks: { color: CHART_COLORS.textDim, font: { size: expanded ? 12 : 10 } }, grid: { color: CHART_COLORS.gridDark }, beginAtZero: true },
      },
    };
    return base;
  }

  // Reuse existing Chart.js instances on refresh so the dataset transition
  // animates instead of snapping. Only recreate when the chart type changes
  // or when no chart exists yet.
  function instantiate(canvas, expanded, config) {
    const id = canvas.id;
    const existing = expanded ? modalChart : charts.get(id);
    if (existing && existing.canvas === canvas && existing.config?.type === config.type) {
      existing.data = config.data;
      existing.options = config.options;
      existing.update();
      return existing;
    }
    if (existing) existing.destroy();
    const chart = new Chart(canvas, config);
    if (expanded) modalChart = chart;
    else charts.set(id, chart);
    return chart;
  }

  // ============================================================================
  //  Card definitions (15 charts)
  // ============================================================================

  // 1. Coverage by hour
  addCard({
    id: "coverage-hour", label: "Coverage by hour-of-day",
    blurb: "Avg drivers on duty each hour across the range",
    render(canvas, { expanded, cardId }) {
      const r = getCardRange(cardId);
      const data = aggHoursByHourOfDay(getEntriesForCard(cardId), r.days);
      const labels = Array.from({ length: 24 }, (_, h) => `${(h % 12) || 12}${h < 12 ? "a" : "p"}`);
      instantiate(canvas, expanded, {
        type: "line",
        data: { labels, datasets: [{
          label: "Avg drivers on duty",
          data, borderColor: CHART_COLORS.accent,
          backgroundColor: "rgba(59,130,246,0.15)",
          fill: true, tension: 0.3, pointRadius: expanded ? 3 : 0,
        }]},
        options: commonChartOpts(expanded, { showLegend: expanded }),
      });
    },
  });

  // 2. Coverage by day-of-week
  addCard({
    id: "coverage-day", label: "Hours by day-of-week",
    blurb: "Total scheduled hours by Mon–Sun",
    render(canvas, { expanded, cardId }) {
      const { labels, data } = aggHoursByDayOfWeek(getEntriesForCard(cardId));
      instantiate(canvas, expanded, {
        type: "bar",
        data: { labels, datasets: [{
          label: "Hours", data,
          backgroundColor: CHART_COLORS.accent2,
          borderRadius: 4,
        }]},
        options: commonChartOpts(expanded, { showLegend: false }),
      });
    },
  });

  // 3. Coverage heatmap (built without a Chart.js plugin — use stacked grid via DOM)
  addCard({
    id: "coverage-heatmap", label: "Coverage heatmap",
    blurb: "Day-of-week × hour. Brighter = more drivers covering.",
    render(canvas, { expanded, overlayEl, cardId }) {
      // Hand-rolled canvas heatmap. Size it from the PARENT container, then
      // set internal pixel buffer at devicePixelRatio for crisp rendering.
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth  : 300;
      const h = parent ? parent.clientHeight : 200;
      if (w === 0 || h === 0) {
        requestAnimationFrame(() => this.render(canvas, { expanded, overlayEl, cardId }));
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width  = w + "px";
      canvas.style.height = h + "px";
      canvas.width  = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // reset+scale (handles re-renders)
      ctx.clearRect(0, 0, w, h);

      const grid = aggHeatmap(getEntriesForCard(cardId));
      const days = 7, hours = 24;
      const padL = expanded ? 32 : 26, padT = expanded ? 18 : 14;
      const cw = (w - padL) / hours;
      const ch = (h - padT) / days;

      // Find max for normalization
      let max = 0; for (const row of grid) for (const v of row) max = Math.max(max, v);
      max = Math.max(max, 1);

      // Cells
      for (let dow = 0; dow < days; dow++) {
        for (let hr = 0; hr < hours; hr++) {
          const v = grid[dow][hr] / max;
          const alpha = 0.05 + v * 0.85;
          ctx.fillStyle = `rgba(59,130,246,${alpha})`;
          ctx.fillRect(padL + hr * cw + 1, padT + dow * ch + 1, cw - 2, ch - 2);
        }
      }
      // Axis labels
      ctx.fillStyle = CHART_COLORS.textDim;
      ctx.font = `${expanded ? 11 : 9}px sans-serif`;
      const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      for (let i = 0; i < 7; i++)  ctx.fillText(dayLabels[i], 2, padT + i * ch + ch / 2 + 3);
      for (let i = 0; i < 24; i += (expanded ? 2 : 4)) {
        const lab = `${(i % 12) || 12}${i < 12 ? "a" : "p"}`;
        ctx.fillText(lab, padL + i * cw, padT - 4);
      }
      if (overlayEl) overlayEl.textContent = "";
    },
  });

  // 4. Shift length distribution
  addCard({
    id: "shift-length", label: "Shift-length distribution",
    blurb: "How long are shifts in this range",
    render(canvas, { expanded, cardId }) {
      const { labels, data } = aggShiftLengthDist(getEntriesForCard(cardId));
      instantiate(canvas, expanded, {
        type: "bar",
        data: { labels, datasets: [{ label: "Shifts", data,
          backgroundColor: CHART_COLORS.ok, borderRadius: 4 }] },
        options: commonChartOpts(expanded, { showLegend: false }),
      });
    },
  });

  // 5. Day vs Night vs Overnight
  addCard({
    id: "day-night-split", label: "Day / Night / Overnight",
    blurb: "Shift distribution by time-of-day",
    render(canvas, { expanded, cardId }) {
      const { labels, data } = aggDayNightSplit(getEntriesForCard(cardId));
      instantiate(canvas, expanded, {
        type: "doughnut",
        data: { labels, datasets: [{ data,
          backgroundColor: [CHART_COLORS.accent, CHART_COLORS.accent2, CHART_COLORS.warn] }] },
        options: { ...commonChartOpts(expanded, { showLegend: true, scales: {} }), cutout: "55%" },
      });
    },
  });

  // 6. Top drivers by hours
  addCard({
    id: "top-drivers", label: "Top 10 drivers by hours",
    blurb: "Most scheduled in this range",
    render(canvas, { expanded, cardId }) {
      const top = aggHoursPerDriver(getEntriesForCard(cardId), state.drivers)
        .filter(x => x.hours > 0)
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 10);
      instantiate(canvas, expanded, {
        type: "bar",
        data: { labels: top.map(x => x.name), datasets: [{ label: "Hours",
          data: top.map(x => x.hours), backgroundColor: CHART_COLORS.accent, borderRadius: 4 }] },
        options: { ...commonChartOpts(expanded, { showLegend: false }), indexAxis: "y" },
      });
    },
  });

  // 7. Bottom drivers
  addCard({
    id: "bottom-drivers", label: "Bottom 10 drivers by hours",
    blurb: "Least scheduled — possible underuse",
    render(canvas, { expanded, cardId }) {
      const bottom = aggHoursPerDriver(getEntriesForCard(cardId), state.drivers)
        .sort((a, b) => a.hours - b.hours)
        .slice(0, 10);
      instantiate(canvas, expanded, {
        type: "bar",
        data: { labels: bottom.map(x => x.name), datasets: [{ label: "Hours",
          data: bottom.map(x => x.hours), backgroundColor: CHART_COLORS.warn, borderRadius: 4 }] },
        options: { ...commonChartOpts(expanded, { showLegend: false }), indexAxis: "y" },
      });
    },
  });

  // 8. Hours distribution histogram
  addCard({
    id: "hours-distribution", label: "Hours per driver (histogram)",
    blurb: "How hours spread across all drivers",
    render(canvas, { expanded, cardId }) {
      const { labels, data } = aggHoursDistribution(getEntriesForCard(cardId), state.drivers);
      instantiate(canvas, expanded, {
        type: "bar",
        data: { labels, datasets: [{ label: "Drivers", data,
          backgroundColor: CHART_COLORS.accent2, borderRadius: 4 }] },
        options: commonChartOpts(expanded, { showLegend: false }),
      });
    },
  });

  // Driver detail picker
  addCard({
    id: "driver-detail", label: "Driver detail",
    blurb: "Click any driver for past 7 + upcoming 7",
    render(canvas, { overlayEl, cardId }) {
      canvas.style.display = "none";
      if (!overlayEl) return;
      const all = aggHoursPerDriver(getEntriesForCard(cardId), state.drivers)
        .sort((a, b) => b.hours - a.hours);
      overlayEl.innerHTML = `
        <input type="search" class="driver-detail__search" placeholder="Search by name or #" />
        <ul class="driver-detail__pick">
          ${all.map(d => `
            <li class="driver-detail__pick-item" data-driver-id="${d.id}">
              <div class="driver-detail__pick-main">
                <span class="driver-detail__pick-name">${escapeHtml(d.name)}</span>
                <span class="muted driver-detail__pick-meta">#${escapeHtml(d.driver?.irh_driver_number || d.id)} · ${escapeHtml(d.driver?.function || "—")}</span>
              </div>
              <span class="driver-detail__pick-hrs">${Utils.formatHours(d.hours)}</span>
            </li>
          `).join("")}
        </ul>
      `;
      const searchInp = overlayEl.querySelector(".driver-detail__search");
      searchInp.addEventListener("click", e => e.stopPropagation());
      searchInp.addEventListener("input", (ev) => {
        const q = ev.target.value.trim().toLowerCase();
        overlayEl.querySelectorAll(".driver-detail__pick-item").forEach(li => {
          li.hidden = !li.textContent.toLowerCase().includes(q);
        });
      });
      overlayEl.querySelectorAll(".driver-detail__pick-item").forEach(li => {
        li.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const id = Number(li.dataset.driverId);
          const drv = state.drivers.find(x => x.id === id);
          openDriverDetail(drv);
        });
      });
    },
  });

  // 10. Function breakdown
  addCard({
    id: "function-breakdown", label: "Hours by function",
    blurb: "HDT / LDT / Transport / Road Service / Dispatch",
    render(canvas, { expanded, cardId }) {
      const { labels, data } = aggFunctionBreakdown(getEntriesForCard(cardId), state.drivers);
      instantiate(canvas, expanded, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS.palette }] },
        options: { ...commonChartOpts(expanded, { showLegend: true, scales: {} }), cutout: "55%" },
      });
    },
  });

  // 11. Week-over-week totals
  addCard({
    id: "week-over-week", label: "Week-over-week total hours",
    blurb: "Last 4 weeks of scheduled hours",
    render(canvas, { expanded, cardId }) {
      const r = getCardRange(cardId);
      const weeks = state.cardOverrides[cardId] ? Math.max(2, Math.ceil(r.days / 7)) : 4;
      const { labels, data } = aggWeeklyTotals(getExtEntriesForCard(cardId), weeks);
      instantiate(canvas, expanded, {
        type: "line",
        data: { labels, datasets: [{ label: "Hours",
          data, borderColor: CHART_COLORS.ok,
          backgroundColor: "rgba(16,185,129,0.15)",
          fill: true, tension: 0.3 }] },
        options: commonChartOpts(expanded, { showLegend: false }),
      });
    },
  });

  // 12. Off-day reasons
  addCard({
    id: "off-reasons", label: "Off-day reasons",
    blurb: "Why people are off",
    render(canvas, { expanded, cardId }) {
      const { labels, data } = aggOffReasons(getEntriesForCard(cardId));
      instantiate(canvas, expanded, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: CHART_COLORS.palette }] },
        options: { ...commonChartOpts(expanded, { showLegend: true, scales: {} }), cutout: "55%" },
      });
    },
  });

  // 13. Yard utilization
  addCard({
    id: "yard-utilization", label: "Yard utilization",
    blurb: "Hours scheduled per yard",
    render(canvas, { expanded, cardId }) {
      const { labels, data } = aggYardUtilization(getEntriesForCard(cardId), state.drivers);
      instantiate(canvas, expanded, {
        type: "bar",
        data: { labels, datasets: [{ label: "Hours", data,
          backgroundColor: CHART_COLORS.accent, borderRadius: 4 }] },
        options: commonChartOpts(expanded, { showLegend: false }),
      });
    },
  });

  // 14. Overnight shift trend
  addCard({
    id: "overnight-trend", label: "Overnight shifts (4-week trend)",
    blurb: "Count of overnight shifts per week",
    render(canvas, { expanded, cardId }) {
      const r = getCardRange(cardId);
      const weeks = state.cardOverrides[cardId] ? Math.max(2, Math.ceil(r.days / 7)) : 4;
      const { labels, data } = aggOvernightByWeek(getExtEntriesForCard(cardId), weeks);
      instantiate(canvas, expanded, {
        type: "bar",
        data: { labels, datasets: [{ label: "Overnight shifts", data,
          backgroundColor: CHART_COLORS.warn, borderRadius: 4 }] },
        options: commonChartOpts(expanded, { showLegend: false }),
      });
    },
  });

  // 15. Active driver count by week
  addCard({
    id: "active-drivers-trend", label: "Distinct drivers scheduled (4-week trend)",
    blurb: "How many unique drivers worked each week",
    render(canvas, { expanded, cardId }) {
      const r = getCardRange(cardId);
      const weeks = state.cardOverrides[cardId] ? Math.max(2, Math.ceil(r.days / 7)) : 4;
      const { labels, data } = aggActiveDriverCountByWeek(getExtEntriesForCard(cardId), weeks);
      instantiate(canvas, expanded, {
        type: "line",
        data: { labels, datasets: [{ label: "Drivers",
          data, borderColor: CHART_COLORS.accent2,
          backgroundColor: "rgba(139,92,246,0.15)",
          fill: true, tension: 0.3 }] },
        options: commonChartOpts(expanded, { showLegend: false }),
      });
    },
  });

  // ---------- Public API ----------

  return { mount, open, close, refresh };
})();
