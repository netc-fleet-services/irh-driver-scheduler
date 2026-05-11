// Print picker.
// Opens a small modal that lets the user pick:
//   * which roster to print (drivers vs dispatchers)
//   * how many days starting from which date (default Mon of current week, 7 days)
// On submit, opens a new window with a print-formatted schedule and triggers
// the browser print dialog.

window.PrintSchedule = (function () {

  let modal, form, tabRadios, formatRadios, startEl, daysEl, yardEl, errorEl, submitEl, openBtn;

  // ---------- Mount ----------

  function mount() {
    openBtn  = document.getElementById("print-btn");
    modal    = document.getElementById("print-modal");
    form     = document.getElementById("print-form");
    startEl  = document.getElementById("print-start");
    daysEl   = document.getElementById("print-days");
    yardEl   = document.getElementById("print-yard");
    errorEl  = document.getElementById("print-error");
    submitEl = document.getElementById("print-submit");
    tabRadios    = form.querySelectorAll('input[name="print-tab"]');
    formatRadios = form.querySelectorAll('input[name="print-format"]');

    if (openBtn) openBtn.addEventListener("click", open);

    modal.querySelectorAll("[data-modal-close]").forEach(el =>
      el.addEventListener("click", close),
    );
    document.addEventListener("keydown", (e) => {
      if (!modal.hidden && e.key === "Escape") close();
    });

    form.addEventListener("submit", onSubmit);
  }

  // ---------- Open / close ----------

  function open() {
    clearError();
    // Default start: Monday of the week containing the scheduler's anchor date.
    // Falls back to today's Monday if the scheduler hasn't mounted yet.
    const anchor = (window.Scheduler && Scheduler.getAnchorDate?.()) || new Date();
    const monday = Utils.startOfWeek(anchor);
    startEl.value = Utils.toIsoDate(monday);
    daysEl.value  = 7;

    // Default tab matches the active scheduler tab if it's one we can print.
    const activeTab = (window.Scheduler && Scheduler.getActiveTab?.()) || "drivers";
    const printable = activeTab === "dispatchers" ? "dispatchers" : "drivers";
    for (const r of tabRadios) r.checked = (r.value === printable);

    // Default format mirrors whichever scheduler view is active.
    const activeView = (window.Scheduler && Scheduler.getActiveView?.()) || "grid";
    const fmt = activeView === "gantt" ? "gantt" : "table";
    for (const r of formatRadios) r.checked = (r.value === fmt);

    // Yard dropdown: clone whatever options the scheduler's yard filter has
    // already loaded (so we don't re-hit the DB), then default to its value.
    populateYardOptions();
    const currentYard = (window.Scheduler && Scheduler.getYard?.()) || "";
    yardEl.value = currentYard;

    modal.hidden = false;
    setTimeout(() => startEl.focus(), 0);
  }

  function close() {
    modal.hidden = true;
    clearError();
  }

  // ---------- Submit ----------

  async function onSubmit(e) {
    e.preventDefault();
    clearError();

    const tab    = getSelectedTab();
    const format = getSelectedFormat();
    const start  = startEl.value;
    const days   = Math.max(1, Math.min(31, Number(daysEl.value) || 7));
    const yard   = yardEl.value || "";
    if (!start) return showError("Pick a start date.");

    submitEl.disabled = true;
    submitEl.textContent = "Loading…";
    try {
      const html = await buildPrintDoc({ tab, format, isoStart: start, days, yard });
      openPrintWindow(html);
      close();
    } catch (err) {
      console.error("Print build failed:", err);
      showError(err.message || "Couldn't build the print sheet.");
    } finally {
      submitEl.disabled = false;
      submitEl.textContent = "Open print preview";
    }
  }

  function getSelectedTab() {
    for (const r of tabRadios) if (r.checked) return r.value;
    return "drivers";
  }
  function getSelectedFormat() {
    for (const r of formatRadios) if (r.checked) return r.value;
    return "table";
  }

  // Mirror the scheduler's already-populated yard select. Falls back to just
  // "All yards" if the scheduler hasn't loaded yet.
  function populateYardOptions() {
    const src = document.getElementById("filter-yard");
    if (!src || !src.options.length) {
      yardEl.innerHTML = `<option value="">All yards</option>`;
      return;
    }
    yardEl.innerHTML = Array.from(src.options)
      .map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.textContent)}</option>`)
      .join("");
  }

  // ---------- Data fetch + HTML build ----------

  async function buildPrintDoc({ tab, format, isoStart, days, yard }) {
    const tabDef = (APP_CONFIG.tabs || []).find(t => t.id === tab);
    const functions = tabDef ? tabDef.functions : null;

    const startDate = Utils.fromIsoDate(isoStart);
    const dates     = Utils.dateRange(startDate, days);
    const isoEnd    = Utils.toIsoDate(dates[dates.length - 1]);

    // Expand the picked display-yard into its underlying real yard codes
    // (handles aliasing like "5" → "1") so multi-yard groupings filter
    // correctly at the DB layer.
    const yardFilter = (yard && window.Scheduler && Scheduler.yardFilterFor)
      ? Scheduler.yardFilterFor(yard)
      : (yard || null);

    const [drivers, entries] = await Promise.all([
      DB.listDrivers({
        includeInactive: false,
        company:         APP_CONFIG.defaultCompany || null,
        yard:            yardFilter,
        functions,
      }),
      DB.listScheduleBetween(isoStart, isoEnd),
    ]);

    // Index entries by (driver|date) for O(1) cell lookup.
    const byKey = new Map();
    for (const e of entries) {
      const k = `${e.driver_id}|${e.schedule_date}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }

    // Sort using whatever sort the scheduler page is currently using.
    // Falls back to type → name if the scheduler isn't mounted.
    const sorted = (window.Scheduler && Scheduler.sortDrivers)
      ? Scheduler.sortDrivers(drivers, { entries, week: dates })
      : drivers.slice().sort((a, b) => {
          const cmp = String(a.function || "").localeCompare(String(b.function || ""));
          if (cmp !== 0) return cmp;
          return String(a.name || "").localeCompare(String(b.name || ""));
        });

    const tabLabel = tab === "dispatchers" ? "Dispatcher" : "Driver";
    const rangeLabel = days === 1
      ? Utils.shortDateLabel(dates[0])
      : `${Utils.shortDateLabel(dates[0])} → ${Utils.shortDateLabel(dates[days - 1])}`;
    const printedAt = new Date().toLocaleString();
    const yardLabel = yard ? `Yard ${yard}` : "All yards";
    const title    = `${tabLabel} Schedule — ${rangeLabel}`;
    const subtitle = `${yardLabel} · ${sorted.length} ${tabLabel.toLowerCase()}${sorted.length === 1 ? "" : "s"} · printed ${printedAt}`;

    // Coverage notes (drivers tab only). Optional — silently skipped if the
    // baseline isn't available.
    const coverageHtml = await buildCoverageBlock({ tab, drivers: sorted, entries, dates });

    if (format === "gantt") {
      return buildGanttDoc({ title, subtitle, sorted, dates, byKey, days, coverageHtml });
    }
    return buildTableDoc({ title, subtitle, sorted, dates, byKey, days, coverageHtml });
  }

  // Build the "Coverage notes" block: top understaffed/overstaffed hours for
  // the printed window. Returns "" if not applicable.
  async function buildCoverageBlock({ tab, drivers, entries, dates }) {
    if (tab !== "drivers" || !window.Optimizer) return "";

    const towingDrivers = Optimizer.filterSupplyDrivers(drivers);
    if (towingDrivers.length === 0) return "";

    let baseline;
    try { baseline = await Optimizer.loadBaseline(); }
    catch (err) { console.warn("Optimizer baseline load failed:", err); return ""; }
    if (!baseline) return "";

    const isoStart = Utils.toIsoDate(dates[0]);
    const isoEnd   = Utils.toIsoDate(dates[dates.length - 1]);
    const gaps = Optimizer.computeGaps(entries, towingDrivers, baseline, isoStart, isoEnd);
    const { under, over } = Optimizer.topSuggestions(gaps);
    if (!under.length && !over.length) return "";

    const li = (g) => `<li>${escapeHtml(Optimizer.suggestionText(g))}</li>`;
    const underBlock = under.length
      ? `<div class="cov-col"><h3 class="cov-col-title cov-col-title--under">Understaffed</h3><ul>${under.map(li).join("")}</ul></div>`
      : "";
    const overBlock = over.length
      ? `<div class="cov-col"><h3 class="cov-col-title cov-col-title--over">Overstaffed</h3><ul>${over.map(li).join("")}</ul></div>`
      : "";

    return `
      <section class="cov">
        <h2>Coverage notes</h2>
        <p class="cov-blurb">Compared to historical call volume (LDT + HDT only). Copart batch dispatches are spread across 8 AM–4 PM in the baseline.</p>
        <div class="cov-cols">${underBlock}${overBlock}</div>
      </section>`;
  }

  // ---------- Table format ----------

  function buildTableDoc({ title, subtitle, sorted, dates, byKey, days, coverageHtml }) {
    const headerRow = `
      <tr>
        <th class="col-driver">Driver</th>
        ${dates.map(d => `
          <th>
            <div class="dow">${d.toLocaleDateString(undefined, { weekday: "short" })}</div>
            <div class="dom">${d.getMonth() + 1}/${d.getDate()}</div>
          </th>`).join("")}
      </tr>`;

    const bodyRows = sorted.map(driver => {
      const driverCell = `
        <td class="col-driver">
          <div class="name">${escapeHtml(driver.name || "(unnamed)")}</div>
          <div class="meta">
            <span>${escapeHtml(driver.function || "—")}</span>
            <span>#${escapeHtml(driver.irh_driver_number || driver.id)}</span>
            <span>yard ${escapeHtml(driver.irh_yard_number || driver.yard || "—")}</span>
          </div>
        </td>`;
      const dayCells = dates.map(d => {
        const iso = Utils.toIsoDate(d);
        const list = byKey.get(`${driver.id}|${iso}`) || [];
        return `<td>${renderTableCell(list)}</td>`;
      }).join("");
      return `<tr>${driverCell}${dayCells}</tr>`;
    }).join("");

    return tablePrintDocTemplate({ title, subtitle, headerRow, bodyRows, colCount: days, coverageHtml });
  }

  function renderTableCell(entries) {
    if (!entries.length) return `<span class="empty">—</span>`;
    // OFF takes precedence (matches the grid view).
    const off = entries.find(e => e.entry_type === "off");
    if (off) {
      return `<div class="off">OFF${off.off_reason ? ` · ${escapeHtml(off.off_reason)}` : ""}</div>`;
    }
    const shifts = entries
      .filter(e => e.entry_type === "shift")
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)));
    return shifts.map(e => {
      const start = Utils.formatTime12(e.start_time);
      const end   = Utils.formatTime12(e.end_time);
      const overnight = e.end_time < e.start_time;
      return `
        <div class="shift">
          <span class="times">${start} – ${end}${overnight ? " <small>+1d</small>" : ""}</span>
          ${e.notes ? `<div class="notes">${escapeHtml(e.notes)}</div>` : ""}
        </div>`;
    }).join("");
  }

  function tablePrintDocTemplate({ title, subtitle, headerRow, bodyRows, colCount, coverageHtml }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${colCount > 7 ? "11in 17in" : "letter"} landscape; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { font: 10pt -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; background: #fff; margin: 0; padding: 0; }
  header { margin-bottom: 10px; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .subtitle { font-size: 9pt; color: #555; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #888; padding: 4px 6px; vertical-align: top; text-align: left; word-wrap: break-word; }
  thead th { background: #eee; font-weight: 600; font-size: 9pt; }
  thead th .dow { font-size: 9pt; }
  thead th .dom { font-size: 8pt; color: #555; font-weight: 400; }
  td.col-driver, th.col-driver { width: 1.6in; }
  .name { font-weight: 600; font-size: 10pt; }
  .meta { font-size: 8pt; color: #555; display: flex; flex-wrap: wrap; gap: 4px 8px; margin-top: 2px; }
  .shift { font-size: 9pt; }
  .shift + .shift { margin-top: 3px; padding-top: 3px; border-top: 1px dashed #bbb; }
  .times { font-weight: 600; }
  .notes { font-size: 8pt; color: #555; }
  .off { color: #b91c1c; font-weight: 700; font-size: 9pt; text-transform: uppercase; }
  .empty { color: #bbb; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .toolbar { margin: 8px 0 14px; }
  .toolbar button { padding: 6px 12px; font: inherit; cursor: pointer; }
  @media print { .toolbar { display: none; } }

  .cov { margin-top: 16px; page-break-inside: avoid; }
  .cov h2 { font-size: 12pt; margin: 0 0 4px; }
  .cov-blurb { font-size: 8pt; color: #555; margin: 0 0 8px; }
  .cov-cols { display: flex; gap: 16px; }
  .cov-col { flex: 1; }
  .cov-col-title { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.6px; margin: 0 0 4px; }
  .cov-col-title--under { color: #b91c1c; }
  .cov-col-title--over  { color: #1d4ed8; }
  .cov ul { margin: 0; padding-left: 18px; font-size: 9pt; }
  .cov li { margin-bottom: 2px; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="subtitle">${escapeHtml(subtitle)}</div>
  </header>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>
  <table>
    <thead>${headerRow}</thead>
    <tbody>${bodyRows}</tbody>
  </table>
  ${coverageHtml || ""}
</body>
</html>`;
  }

  function openPrintWindow(html) {
    // NOTE: do NOT pass "noopener" — Chrome returns null in that case, which
    // would leave us with a blank popup we can't write into. We need the
    // window reference to inject the schedule HTML.
    const w = window.open("", "_blank", "width=1100,height=800");
    if (!w) {
      showError("Popup blocked. Allow popups for this site, then try again.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    // The doc is fully parsed once close() returns. Trigger print after a
    // tick so the browser has a frame to lay out the table.
    setTimeout(() => {
      try { w.focus(); w.print(); }
      catch (err) { console.error("Print failed:", err); }
    }, 250);
  }

  // ---------- Gantt format ----------

  function buildGanttDoc({ title, subtitle, sorted, dates, byKey, days, coverageHtml }) {
    // One percent-positioned bar per shift across (days × 24h). OFF blocks
    // span their day; we don't try to replicate the on-screen "extends back
    // to previous shift end" trick on paper because tightly packed bars get
    // hard to read when the page width is fixed.
    const totalHours = days * 24;
    const weekStartMs = dates[0].getTime();

    // Day axis labels
    const axisLabels = dates.map((d, i) => {
      const leftPct  = ((i * 24) / totalHours) * 100;
      const widthPct = (24 / totalHours) * 100;
      const dow = d.toLocaleDateString(undefined, { weekday: "short" });
      const dom = `${d.getMonth() + 1}/${d.getDate()}`;
      return `<div class="gx-day" style="left:${leftPct}%;width:${widthPct}%">
                <span class="gx-dow">${dow}</span>
                <span class="gx-dom">${dom}</span>
              </div>`;
    }).join("");

    const dayDividers = Array.from({ length: days - 1 }, (_, i) => {
      const leftPct = (((i + 1) * 24) / totalHours) * 100;
      return `<div class="gx-divider" style="left:${leftPct}%"></div>`;
    }).join("");

    const rows = sorted.map(driver => {
      const driverEntries = [];
      for (const d of dates) {
        const iso = Utils.toIsoDate(d);
        const list = byKey.get(`${driver.id}|${iso}`) || [];
        for (const e of list) driverEntries.push(e);
      }

      const bars = driverEntries.map(e => {
        const date = Utils.fromIsoDate(e.schedule_date);
        const dayOffsetH = Math.round((date.getTime() - weekStartMs) / 3600000);
        if (dayOffsetH < 0 || dayOffsetH >= totalHours) return "";

        if (e.entry_type === "off") {
          const leftPct  = (dayOffsetH / totalHours) * 100;
          const widthPct = (24 / totalHours) * 100;
          return `<div class="gx-bar gx-bar--off" style="left:${leftPct}%;width:${widthPct}%"
                       title="OFF${e.off_reason ? ' · ' + escapeHtml(e.off_reason) : ''}">
                    <span>OFF${e.off_reason ? ' · ' + escapeHtml(e.off_reason) : ''}</span>
                  </div>`;
        }
        if (e.entry_type !== "shift") return "";

        const sH = Utils.timeToHours(e.start_time);
        let eH  = Utils.timeToHours(e.end_time);
        if (eH <= sH) eH += 24;                          // overnight
        const startTotal = dayOffsetH + sH;
        const endTotal   = Math.min(totalHours, dayOffsetH + eH);
        if (endTotal <= startTotal) return "";
        const leftPct  = (startTotal / totalHours) * 100;
        const widthPct = ((endTotal - startTotal) / totalHours) * 100;
        const start = Utils.formatTime12(e.start_time);
        const end   = Utils.formatTime12(e.end_time);
        const overnight = eH > 24;
        return `<div class="gx-bar gx-bar--shift" style="left:${leftPct}%;width:${widthPct}%"
                     title="${start} – ${end}${overnight ? ' (next day)' : ''}">
                  <span class="gx-bar__times">${start} – ${end}${overnight ? " <small>+1d</small>" : ""}</span>
                </div>`;
      }).join("");

      return `
        <div class="gx-row">
          <div class="gx-driver">
            <div class="name">${escapeHtml(driver.name || "(unnamed)")}</div>
            <div class="meta">
              <span>${escapeHtml(driver.function || "—")}</span>
              <span>#${escapeHtml(driver.irh_driver_number || driver.id)}</span>
              <span>yard ${escapeHtml(driver.irh_yard_number || driver.yard || "—")}</span>
            </div>
          </div>
          <div class="gx-track">
            ${dayDividers}
            ${bars}
          </div>
        </div>`;
    }).join("");

    return ganttPrintDocTemplate({ title, subtitle, axisLabels, rows, colCount: days, coverageHtml });
  }

  function ganttPrintDocTemplate({ title, subtitle, axisLabels, rows, colCount, coverageHtml }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${colCount > 7 ? "11in 17in" : "letter"} landscape; margin: 0.4in; }
  * { box-sizing: border-box; }
  body { font: 9pt -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; background: #fff; margin: 0; padding: 0; }
  header { margin-bottom: 10px; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .subtitle { font-size: 9pt; color: #555; }

  .gx-head { display: flex; align-items: stretch; border: 1px solid #888; border-bottom: none; }
  .gx-head__driver { width: 1.6in; flex: 0 0 1.6in; padding: 4px 6px; font-weight: 600; background: #eee; border-right: 1px solid #888; }
  .gx-axis { position: relative; flex: 1 1 auto; height: 28px; background: #eee; }
  .gx-day { position: absolute; top: 0; bottom: 0; padding: 4px 6px; border-left: 1px solid #888; }
  .gx-day:first-child { border-left: none; }
  .gx-dow { display: block; font-weight: 600; font-size: 9pt; }
  .gx-dom { display: block; font-size: 8pt; color: #555; }

  .gx-row { display: flex; align-items: stretch; border: 1px solid #888; border-top: none; min-height: 38px; page-break-inside: avoid; }
  .gx-driver { width: 1.6in; flex: 0 0 1.6in; padding: 4px 6px; border-right: 1px solid #888; }
  .gx-driver .name { font-weight: 600; font-size: 10pt; }
  .gx-driver .meta { font-size: 8pt; color: #555; display: flex; flex-wrap: wrap; gap: 2px 6px; margin-top: 2px; }

  .gx-track { position: relative; flex: 1 1 auto; }
  .gx-divider { position: absolute; top: 0; bottom: 0; width: 0; border-left: 1px solid #ccc; }

  .gx-bar { position: absolute; top: 4px; bottom: 4px; padding: 2px 4px; overflow: hidden; border-radius: 2px; font-size: 8pt; }
  .gx-bar--shift { background: #dbeafe; border: 1px solid #1d4ed8; color: #1d4ed8; }
  .gx-bar--shift .gx-bar__times { font-weight: 700; white-space: nowrap; }
  .gx-bar--off   { background: #fee2e2; border: 1px solid #b91c1c; color: #b91c1c; font-weight: 700; text-align: center; }

  .toolbar { margin: 8px 0 14px; }
  .toolbar button { padding: 6px 12px; font: inherit; cursor: pointer; }
  @media print { .toolbar { display: none; } }

  .cov { margin-top: 16px; page-break-inside: avoid; }
  .cov h2 { font-size: 12pt; margin: 0 0 4px; }
  .cov-blurb { font-size: 8pt; color: #555; margin: 0 0 8px; }
  .cov-cols { display: flex; gap: 16px; }
  .cov-col { flex: 1; }
  .cov-col-title { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.6px; margin: 0 0 4px; }
  .cov-col-title--under { color: #b91c1c; }
  .cov-col-title--over  { color: #1d4ed8; }
  .cov ul { margin: 0; padding-left: 18px; font-size: 9pt; }
  .cov li { margin-bottom: 2px; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="subtitle">${escapeHtml(subtitle)}</div>
  </header>
  <div class="toolbar">
    <button type="button" onclick="window.print()">Print</button>
    <button type="button" onclick="window.close()">Close</button>
  </div>
  <div class="gx-head">
    <div class="gx-head__driver">Driver</div>
    <div class="gx-axis">${axisLabels}</div>
  </div>
  ${rows}
  ${coverageHtml || ""}
</body>
</html>`;
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
  const escapeHtml = Utils.escapeHtml;

  return { mount, open, close };
})();
