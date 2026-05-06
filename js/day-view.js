// Day-detail timeline viewer.
// Open via DayView.open({ isoDate, drivers, entries }) to see all shifts for a
// single day plotted on a 0-30 hour axis (so overnight shifts visibly cross
// the midnight boundary into "next day" territory).

window.DayView = (function () {

  // Timeline spans -6h (= 6 PM yesterday) to +30h (= 6 AM tomorrow), so both
  // (a) overnight shifts started yesterday and (b) overnight shifts started
  // today are visible in the same view.
  const TIMELINE_START_H = -6;
  const TIMELINE_END_H   = 30;
  const TIMELINE_HOURS   = TIMELINE_END_H - TIMELINE_START_H;   // = 36
  const TICK_INTERVAL_H  = 4;

  // ---------- DOM refs ----------
  let modal, titleEl, summaryEl, axisEl, rowsEl, emptyEl, offEl;
  let currentDrivers = new Map();
  let currentEntries = [];
  let currentDate    = null;

  // ---------- Drag-resize state ----------
  let drag = null;             // active drag { bar, side, entry, ... }
  let suppressClick = false;   // set after a drag so the bar's click doesn't fire

  // ---------- Mount ----------

  function mount() {
    modal     = document.getElementById("day-view");
    titleEl   = document.getElementById("day-view-title");
    summaryEl = document.getElementById("day-view-summary");
    axisEl    = document.getElementById("timeline-axis");
    rowsEl    = document.getElementById("timeline-rows");
    emptyEl   = document.getElementById("timeline-empty");
    offEl     = document.getElementById("timeline-off");

    // Close handlers
    modal.querySelectorAll("[data-modal-close]").forEach(el => {
      el.addEventListener("click", close);
    });
    document.addEventListener("keydown", (e) => {
      if (!modal.hidden && e.key === "Escape") close();
    });

    // Click a bar -> open the shift editor for that entry.
    // Skip if the click is on a resize handle, or right after a drag.
    rowsEl.addEventListener("click", (e) => {
      if (suppressClick) return;
      if (e.target.closest(".tl-bar__handle")) return;
      const bar = e.target.closest(".tl-bar");
      if (!bar) return;
      const driverId = Number(bar.dataset.driverId);
      const scheduleDate = bar.dataset.scheduleDate || currentDate;
      const entryId = bar.dataset.entryId;
      const driver = currentDrivers.get(driverId);
      // Look up by entry id directly (a driver can have multiple shifts/day).
      const entry = currentEntries.find(x => String(x.id) === entryId);
      if (!driver || !entry) return;
      close();
      ShiftModal.open({ driver, isoDate: scheduleDate, entry });
    });

    // Drag a shift bar:
    //   * pull a left/right handle  -> resize that edge (start_time or end_time)
    //   * grab the bar body         -> slide whole shift left/right (keeps duration)
    rowsEl.addEventListener("pointerdown", onBarPointerDown);
  }

  // ---------- Drag handlers ----------

  function onBarPointerDown(e) {
    const handle = e.target.closest(".tl-bar__handle");
    const bar    = e.target.closest(".tl-bar");
    if (!bar) return;
    // Previous-day bars are read-only context; click opens editor instead.
    if (bar.classList.contains("tl-bar--prev")) return;

    const driverId = Number(bar.dataset.driverId);
    const entryId  = bar.dataset.entryId;
    const entry    = currentEntries.find(x => String(x.id) === entryId);
    if (!entry || entry.entry_type !== "shift") return;

    drag = {
      bar,
      mode:          handle ? "resize" : "move",
      side:          handle ? handle.dataset.side : null,
      track:         bar.parentElement,
      trackWidth:    bar.parentElement.getBoundingClientRect().width,
      driver:        currentDrivers.get(driverId),
      entry,
      startX:        e.clientX,
      startLeftPct:  parseFloat(bar.style.left)  || 0,
      startWidthPct: parseFloat(bar.style.width) || 0,
      moved:         false,
    };

    if (handle) handle.setPointerCapture(e.pointerId);
    else        bar.setPointerCapture(e.pointerId);

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup",   onPointerUp,   { once: true });
    document.addEventListener("pointercancel", onPointerUp, { once: true });

    e.stopPropagation();
    // Don't preventDefault here — that would block the bar's click event when
    // the user releases without moving (we want the editor to still open).
  }

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 3) {
      drag.moved = true;
      drag.bar.classList.add("tl-bar--dragging");
    }
    if (!drag.moved) return;

    const dPct           = (dx / drag.trackWidth) * 100;
    const minDuration    = 0.5;                              // hours
    const minWidthPct    = (minDuration / TIMELINE_HOURS) * 100;
    const todayStartPct  = pctFromHours(0);                  // shift can't start before midnight today
    const timelineEndPct = pctFromHours(TIMELINE_END_H);     // can't extend past +6 AM next day

    if (drag.mode === "resize" && drag.side === "right") {
      let snappedRight = snapPctTo30Min(drag.startLeftPct + drag.startWidthPct + dPct);
      snappedRight = Math.max(drag.startLeftPct + minWidthPct, Math.min(timelineEndPct, snappedRight));
      drag.bar.style.width = (snappedRight - drag.startLeftPct) + "%";

    } else if (drag.mode === "resize" && drag.side === "left") {
      let l = snapPctTo30Min(drag.startLeftPct + dPct);
      const right = drag.startLeftPct + drag.startWidthPct;
      const maxL  = right - minWidthPct;
      l = Math.max(todayStartPct, Math.min(maxL, l));
      drag.bar.style.left  = l + "%";
      drag.bar.style.width = (right - l) + "%";

    } else if (drag.mode === "move") {
      // Slide whole bar; keep width.
      let l = snapPctTo30Min(drag.startLeftPct + dPct);
      const maxL = timelineEndPct - drag.startWidthPct;
      l = Math.max(todayStartPct, Math.min(maxL, l));
      drag.bar.style.left = l + "%";
    }

    updateBarLabel(drag.bar);
  }

  async function onPointerUp() {
    if (!drag) return;
    document.removeEventListener("pointermove", onPointerMove);

    const bar = drag.bar;
    bar.classList.remove("tl-bar--dragging");

    // Suppress the click that follows so the editor doesn't open mid-drag.
    if (drag.moved) {
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 250);
    }

    if (!drag.moved) { drag = null; return; }

    const leftPct  = parseFloat(bar.style.left)  || 0;
    const widthPct = parseFloat(bar.style.width) || 0;
    const startH   = hoursFromPct(leftPct);
    const endH     = hoursFromPct(leftPct + widthPct);
    const newStart = hoursToTime(startH % 24);
    const newEnd   = hoursToTime(endH % 24);

    const oldStart = (drag.entry.start_time || "").slice(0, 5);
    const oldEnd   = (drag.entry.end_time   || "").slice(0, 5);
    if (newStart === oldStart && newEnd === oldEnd) {
      drag = null;
      return;
    }

    const savingDrag = drag;
    drag = null;

    try {
      await DB.upsertEntry({
        id:            savingDrag.entry.id,
        driver_id:     savingDrag.driver.id,
        schedule_date: currentDate,
        entry_type:    "shift",
        start_time:    newStart,
        end_time:      newEnd,
        off_reason:    null,
        notes:         savingDrag.entry.notes,
      });
      document.dispatchEvent(new CustomEvent("schedule-changed"));
    } catch (err) {
      console.error("Drag-save failed:", err);
      bar.style.left  = savingDrag.startLeftPct  + "%";
      bar.style.width = savingDrag.startWidthPct + "%";
      updateBarLabel(bar);
      alert("Couldn't save the new times: " + (err.message || err));
    }
  }

  // ---------- Geometry helpers ----------

  function pctFromHours(h)   { return ((h - TIMELINE_START_H) / TIMELINE_HOURS) * 100; }
  function hoursFromPct(p)   { return TIMELINE_START_H + (p / 100) * TIMELINE_HOURS; }
  function snapPctTo30Min(p) {
    const hours    = hoursFromPct(p);
    const snapped  = Math.round(hours * 2) / 2;   // 30-min steps
    return pctFromHours(snapped);
  }

  function hoursToTime(h) {
    const totalMin = Math.round(h * 60);
    const hh = Math.floor(totalMin / 60) % 24;
    const mm = totalMin % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  function updateBarLabel(bar) {
    const leftPct  = parseFloat(bar.style.left)  || 0;
    const widthPct = parseFloat(bar.style.width) || 0;
    const startH = hoursFromPct(leftPct);
    const endH   = hoursFromPct(leftPct + widthPct);
    const overnight = endH > 24 + 1e-6;
    const startStr  = Utils.formatTime12(hoursToTime(startH % 24));
    const endStr    = Utils.formatTime12(hoursToTime(endH % 24));
    const labelEl   = bar.querySelector(".tl-bar__label");
    if (labelEl) {
      labelEl.innerHTML =
        `${escapeHtml(startStr)} – ${escapeHtml(endStr)}` +
        (overnight ? ' <small>+1d</small>' : "");
    }
    bar.classList.toggle("tl-bar--overnight", overnight);
    bar.title = `${startStr} – ${endStr}${overnight ? " (next day)" : ""}`;
  }

  // ---------- Open / close ----------

  async function open({ isoDate, drivers, entries }) {
    currentDate    = isoDate;
    currentDrivers = new Map(drivers.map(d => [d.id, d]));

    const yesterdayIso = Utils.toIsoDate(
      Utils.addDays(Utils.fromIsoDate(isoDate), -1)
    );

    // Only show entries whose driver is in the current tab's visible set —
    // otherwise dispatchers/etc. leak into the Drivers tab's day view as
    // anonymous "Driver #N" rows.
    const inScope = (e) => currentDrivers.has(e.driver_id);

    const todayEntries = entries.filter(e =>
      e.schedule_date === isoDate && inScope(e)
    );

    // Pull yesterday's entries from the passed set if available, otherwise
    // fetch them. Then keep only the overnight shifts that bleed into today.
    let yesterdayEntries = entries.filter(e => e.schedule_date === yesterdayIso);
    if (yesterdayEntries.length === 0) {
      try {
        yesterdayEntries = await DB.listScheduleBetween(yesterdayIso, yesterdayIso);
      } catch (err) {
        console.warn("Couldn't fetch previous day's shifts:", err);
        yesterdayEntries = [];
      }
    }
    const yesterdayOvernight = yesterdayEntries.filter(e =>
      inScope(e) && e.entry_type === "shift" && e.end_time < e.start_time
    );

    // Combined set used by click/drag handlers to find the right entry.
    currentEntries = [...todayEntries, ...yesterdayOvernight];

    const date = Utils.fromIsoDate(isoDate);
    titleEl.textContent = date.toLocaleDateString(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });

    const shifts = todayEntries
      .filter(e => e.entry_type === "shift")
      .sort((a, b) => a.start_time.localeCompare(b.start_time));
    const offs = todayEntries.filter(e => e.entry_type === "off");

    const carryNote = yesterdayOvernight.length
      ? ` · ${yesterdayOvernight.length} carrying over from prev day`
      : "";
    summaryEl.textContent =
      `${shifts.length} shift${shifts.length === 1 ? "" : "s"} · ${offs.length} off` + carryNote;

    renderAxis();
    renderShiftRows(shifts, yesterdayOvernight);
    renderOffFooter(offs);

    modal.hidden = false;
  }

  function close() {
    modal.hidden = true;
  }

  // ---------- Axis (tick marks + labels) ----------

  function renderAxis() {
    const ticks = [];
    // First tick is the smallest multiple of TICK_INTERVAL_H >= TIMELINE_START_H.
    const firstTick = Math.ceil(TIMELINE_START_H / TICK_INTERVAL_H) * TICK_INTERVAL_H;
    for (let h = firstTick; h <= TIMELINE_END_H; h += TICK_INTERVAL_H) {
      const leftPct = pctFromHours(h);
      const isMidnight = (h === 0 || h === 24);
      const cls = isMidnight ? "tl-tick tl-tick--midnight" : "tl-tick";
      ticks.push(
        `<div class="${cls}" style="left:${leftPct}%">` +
          `<span class="tl-tick__label">${formatHour(h)}</span>` +
        `</div>`
      );
    }
    axisEl.innerHTML = ticks.join("");
  }

  function formatHour(h) {
    const dayHour = ((h % 24) + 24) % 24;
    const period = dayHour >= 12 ? "p" : "a";
    const h12 = dayHour % 12 === 0 ? 12 : dayHour % 12;
    if (h < 0)   return `${h12}${period} ←`;     // yesterday
    if (h >= 24) return `${h12}${period} →`;     // tomorrow
    return `${h12}${period}`;
  }

  // ---------- Shift rows ----------

  function renderShiftRows(todayShifts, prevOvernight) {
    // Group per driver: { driverId: { todays: [], prev } }
    const byDriver = new Map();
    for (const e of todayShifts) {
      if (!byDriver.has(e.driver_id)) byDriver.set(e.driver_id, { todays: [], prev: null });
      byDriver.get(e.driver_id).todays.push(e);
    }
    for (const e of prevOvernight) {
      if (!byDriver.has(e.driver_id)) byDriver.set(e.driver_id, { todays: [], prev: null });
      byDriver.get(e.driver_id).prev = e;
    }

    if (byDriver.size === 0) {
      rowsEl.innerHTML = "";
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;

    // Sort rows by their earliest visible bar start (yesterday-overnight first).
    const rows = [...byDriver.entries()].sort((a, b) =>
      earliestStartH(a[1]) - earliestStartH(b[1])
    );

    rowsEl.innerHTML = rows.map(([driverId, group]) => {
      const driver = currentDrivers.get(driverId);
      if (!driver) return "";
      return renderDriverRow(driver, group);
    }).filter(Boolean).join("");
  }

  function earliestStartH(group) {
    if (group.prev) return timeToHours(group.prev.start_time) - 24; // negative
    if (group.todays && group.todays.length) {
      return Math.min(...group.todays.map(e => timeToHours(e.start_time)));
    }
    return 999;
  }

  function renderDriverRow(driver, group) {
    const driverInfo = `
      <div class="tl-row__driver">
        <span class="tl-row__name">${escapeHtml(driver.name)}</span>
        <span class="muted tl-row__meta">
          #${escapeHtml(driver.irh_driver_number || driver.id)}
          · ${escapeHtml(driver.function || "—")}
          · yard ${escapeHtml(driver.irh_yard_number || "—")}
        </span>
      </div>
    `;

    let bars = renderMidnightLines();
    if (group.prev) bars += renderPrevDayBar(driver, group.prev);
    for (const today of (group.todays || [])) {
      bars += renderTodayBar(driver, today);
    }

    return `<div class="tl-row">${driverInfo}<div class="tl-row__track">${bars}</div></div>`;
  }

  function renderTodayBar(driver, entry) {
    const startH = timeToHours(entry.start_time);
    let   endH   = timeToHours(entry.end_time);
    const overnight = endH <= startH;
    if (overnight) endH += 24;

    const leftPct  = pctFromHours(startH);
    const widthPct = pctFromHours(endH) - pctFromHours(startH);

    const startLabel = Utils.formatTime12(entry.start_time);
    const endLabel   = Utils.formatTime12(entry.end_time);
    const tip = `${startLabel} – ${endLabel}${overnight ? " (next day)" : ""}`;

    return `
      <div class="tl-bar tl-bar--shift ${overnight ? "tl-bar--overnight" : ""}"
           style="left:${leftPct}%; width:${widthPct}%"
           data-driver-id="${driver.id}"
           data-schedule-date="${entry.schedule_date}"
           data-entry-id="${entry.id}"
           title="${escapeHtml(tip)}">
        <div class="tl-bar__handle tl-bar__handle--left"  data-side="left"  title="Drag to change start time"></div>
        <span class="tl-bar__label">${startLabel} – ${endLabel}${overnight ? " <small>+1d</small>" : ""}</span>
        ${entry.notes ? `<span class="tl-bar__notes">${escapeHtml(entry.notes)}</span>` : ""}
        <div class="tl-bar__handle tl-bar__handle--right" data-side="right" title="Drag to change end time"></div>
      </div>
    `;
  }

  function renderPrevDayBar(driver, entry) {
    // Yesterday's overnight bleed into today.
    // Position in today-frame: start = yesterday start - 24 (negative).
    const startH_today = timeToHours(entry.start_time) - 24;
    const endH_today   = timeToHours(entry.end_time);
    const leftPct  = pctFromHours(startH_today);
    const widthPct = pctFromHours(endH_today) - pctFromHours(startH_today);

    const startLabel = Utils.formatTime12(entry.start_time);
    const endLabel   = Utils.formatTime12(entry.end_time);
    const tip = `From previous day: ${startLabel} – ${endLabel}`;

    return `
      <div class="tl-bar tl-bar--shift tl-bar--prev"
           style="left:${leftPct}%; width:${widthPct}%"
           data-driver-id="${driver.id}"
           data-schedule-date="${entry.schedule_date}"
           data-entry-id="${entry.id}"
           title="${escapeHtml(tip)}">
        <span class="tl-bar__label"><small>← prev</small> ${startLabel} – ${endLabel}</span>
      </div>
    `;
  }

  function renderMidnightLines() {
    const lines = [];
    for (const h of [0, 24]) {
      if (h >= TIMELINE_START_H && h <= TIMELINE_END_H) {
        const leftPct = pctFromHours(h);
        lines.push(`<div class="tl-midnight" style="left:${leftPct}%" title="midnight"></div>`);
      }
    }
    return lines.join("");
  }

  // ---------- Off footer ----------

  function renderOffFooter(offs) {
    if (!offs.length) {
      offEl.hidden = true;
      offEl.innerHTML = "";
      return;
    }
    const items = offs.map(e => {
      const driver = currentDrivers.get(e.driver_id);
      const name = driver ? driver.name : `Driver #${e.driver_id}`;
      const reason = e.off_reason ? ` (${e.off_reason})` : "";
      return `<span class="tl-off-pill">${escapeHtml(name)}${escapeHtml(reason)}</span>`;
    }).join("");
    offEl.innerHTML = `<div class="tl-off-label">Also off today (${offs.length}):</div>${items}`;
    offEl.hidden = false;
  }

  // ---------- Helpers ----------

  function timeToHours(t) {
    if (!t) return 0;
    const [h, m] = t.split(":").map(Number);
    return h + (m || 0) / 60;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  return { mount, open, close };
})();
