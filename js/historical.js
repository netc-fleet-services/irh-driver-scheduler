// Historical tab. Visualizes the call_volume_baseline (the data that drives
// the Optimizer's demand side) so anyone can pull up patterns at a glance.
//
// Three views:
//   1. 7×24 heatmap of avg calls per hour-of-day × day-of-week
//   2. Bar chart of total avg calls by hour-of-day (summed across the week)
//   3. Bar chart of total avg calls by day-of-week (summed across hours)
//
// Filter: month picker. "All months" uses the aggregate baseline (month=NULL);
// otherwise pulls the per-month grid.

window.Historical = (function () {

  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  let panel, sectionsEl, monthEl, summaryEl;
  let mounted = false;
  let chartHourly = null;
  let chartDaily  = null;
  let state = { month: "" };  // "" = all months

  // ---------- Mount ----------

  function mount() {
    if (mounted) return;
    panel      = document.getElementById("historical-view");
    monthEl    = document.getElementById("historical-month");
    summaryEl  = document.getElementById("historical-summary");
    sectionsEl = document.getElementById("historical-sections");
    if (!panel) return;

    monthEl.addEventListener("change", () => {
      state.month = monthEl.value;
      paint();
    });

    mounted = true;
  }

  // ---------- Open / close ----------

  async function open() {
    if (!panel) return;
    panel.hidden = false;
    if (!sectionsEl.dataset.scaffold) renderScaffold();
    try {
      await Optimizer.loadBaseline();
      paint();
    } catch (err) {
      sectionsEl.innerHTML = `<div class="historical__empty">Couldn't load baseline: ${escapeHtml(err.message || String(err))}</div>`;
    }
  }

  function close() {
    if (panel) panel.hidden = true;
  }

  // ---------- Scaffold ----------

  function renderScaffold() {
    sectionsEl.innerHTML = `
      <section class="historical__section">
        <h3>Avg calls per hour × day-of-week</h3>
        <p class="muted">Darker cells = busier hours. Hover for the exact value.</p>
        <div class="heatmap" id="historical-heatmap"></div>
      </section>
      <section class="historical__section historical__section--charts">
        <div class="historical__chart">
          <h3>Calls by hour-of-day</h3>
          <p class="muted">Total avg calls per hour, summed across the week.</p>
          <div class="historical__chart-wrap"><canvas id="historical-hourly"></canvas></div>
        </div>
        <div class="historical__chart">
          <h3>Calls by day-of-week</h3>
          <p class="muted">Total avg calls per day, summed across hours.</p>
          <div class="historical__chart-wrap"><canvas id="historical-daily"></canvas></div>
        </div>
      </section>
    `;
    sectionsEl.dataset.scaffold = "1";
  }

  // ---------- Paint ----------

  function paint() {
    const grid = currentGrid();
    if (!grid) {
      summaryEl.textContent = state.month ? "No data for that month yet." : "No baseline loaded.";
      return;
    }
    const total = sumGrid(grid);
    const monthLabel = state.month
      ? new Date(2025, Number(state.month) - 1, 1).toLocaleString(undefined, { month: "long" })
      : "all months (aggregate)";
    const peak = peakCell(grid);
    summaryEl.textContent =
      `${monthLabel}: avg ${total.toFixed(0)} calls/week · peak ${peak.value.toFixed(1)}/hr at ${DAY_LABELS[peak.dow]} ${formatHour(peak.hour)}`;

    renderHeatmap(grid);
    renderHourlyChart(grid);
    renderDailyChart(grid);
  }

  function currentGrid() {
    const cached = Optimizer.getCachedBaseline();
    if (!cached) return null;
    if (state.month) {
      const m = Number(state.month);
      return cached.byMonth.get(m) || null;
    }
    return cached.aggregate;
  }

  // ---------- Heatmap ----------

  function renderHeatmap(grid) {
    const max = Math.max(0.0001, ...grid.flat());
    const root = document.getElementById("historical-heatmap");

    // Hour header row + 7 day rows
    const header = `
      <div class="heatmap__row heatmap__row--header">
        <div class="heatmap__cell heatmap__cell--label"></div>
        ${Array.from({ length: 24 }, (_, h) =>
          `<div class="heatmap__cell heatmap__cell--header">${formatHourCompact(h)}</div>`
        ).join("")}
      </div>`;

    const rows = grid.map((row, dow) => {
      const cells = row.map((v, h) => {
        const intensity = v / max;
        const tip = `${DAY_LABELS[dow]} ${formatHour(h)}: ${v.toFixed(2)} calls/hr`;
        return `<div class="heatmap__cell" style="--i:${intensity.toFixed(3)}" title="${tip}">${v >= 0.5 ? v.toFixed(1) : ""}</div>`;
      }).join("");
      return `
        <div class="heatmap__row">
          <div class="heatmap__cell heatmap__cell--label">${DAY_LABELS[dow]}</div>
          ${cells}
        </div>`;
    }).join("");

    root.innerHTML = header + rows;
  }

  // ---------- Bar charts ----------

  function renderHourlyChart(grid) {
    const labels = Array.from({ length: 24 }, (_, h) => formatHourCompact(h));
    const data = Array.from({ length: 24 }, (_, h) =>
      grid.reduce((s, row) => s + row[h], 0)
    );
    chartHourly = upsertChart(chartHourly, "historical-hourly", {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "Avg calls/hr (sum across weekdays)",
          data,
          backgroundColor: "rgba(59, 130, 246, 0.65)",
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 1,
        }],
      },
      options: barChartOpts(),
    });
  }

  function renderDailyChart(grid) {
    const data = grid.map(row => row.reduce((s, v) => s + v, 0));
    chartDaily = upsertChart(chartDaily, "historical-daily", {
      type: "bar",
      data: {
        labels: DAY_LABELS,
        datasets: [{
          label: "Avg calls/day (sum across hours)",
          data,
          backgroundColor: DAY_LABELS.map((_, i) =>
            i >= 5 ? "rgba(245, 158, 11, 0.65)" : "rgba(59, 130, 246, 0.65)"
          ),
          borderColor: DAY_LABELS.map((_, i) =>
            i >= 5 ? "rgba(245, 158, 11, 1)" : "rgba(59, 130, 246, 1)"
          ),
          borderWidth: 1,
        }],
      },
      options: barChartOpts(),
    });
  }

  function barChartOpts() {
    const dim = "#9ca3af";
    const grid = "rgba(255,255,255,0.08)";
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(15,17,21,0.95)",
          borderColor: "rgba(59,130,246,0.35)",
          borderWidth: 1,
          titleColor: "#fff",
          bodyColor: "#e5e7eb",
          padding: 10,
          cornerRadius: 6,
        },
      },
      scales: {
        x: { ticks: { color: dim, font: { size: 10 } }, grid: { color: grid } },
        y: { ticks: { color: dim, font: { size: 10 } }, grid: { color: grid }, beginAtZero: true },
      },
    };
  }

  function upsertChart(prev, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return prev;
    if (prev && prev.canvas === canvas) {
      prev.data = config.data;
      prev.options = config.options;
      prev.update();
      return prev;
    }
    if (prev) prev.destroy();
    return new Chart(canvas, config);
  }

  // ---------- Helpers ----------

  function sumGrid(grid) {
    return grid.reduce((s, row) => s + row.reduce((rs, v) => rs + v, 0), 0);
  }

  function peakCell(grid) {
    let best = { dow: 0, hour: 0, value: -Infinity };
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 24; h++) {
        if (grid[dow][h] > best.value) best = { dow, hour: h, value: grid[dow][h] };
      }
    }
    return best;
  }

  function formatHour(h) {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  function formatHourCompact(h) {
    if (h === 0) return "12a";
    if (h === 12) return "12p";
    return h < 12 ? `${h}a` : `${h - 12}p`;
  }

  function escapeHtml(s) {
    return Utils.escapeHtml(s);
  }

  return { mount, open, close };
})();
