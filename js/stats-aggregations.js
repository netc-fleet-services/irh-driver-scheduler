// Pure aggregation helpers for the Stats tab.
// No DOM, no Supabase, no module-level state. Each function takes its inputs
// and returns plain data ready to feed into a Chart.js dataset.
//
// Extracted from stats.js so the chart-orchestration file stays focused on
// rendering.

window.StatsAgg = (function () {

  const timeToHours = Utils.timeToHours;

  // ---------- Totals ----------

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

  // ---------- Coverage ----------

  // Avg drivers covering each hour 0..23 across `days` days.
  function hoursByHourOfDay(entries, days) {
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
    const dayCount = Math.max(1, days || 1);
    return counts.map(c => +(c / dayCount).toFixed(2));
  }

  // Total scheduled hours grouped by Mon..Sun.
  function hoursByDayOfWeek(entries) {
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

  // 7 dows × 24 hours of average drivers covering, normalized by how many of
  // each dow actually appeared in the entries' date range.
  function heatmap(entries) {
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
    return grid.map((row, dow) =>
      row.map(v => dayCounts[dow] ? +(v / dayCounts[dow]).toFixed(2) : 0)
    );
  }

  // ---------- Shift shape ----------

  function shiftLengthDist(entries) {
    const bins   = [4, 6, 8, 10, 12, 24];                              // upper bounds
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

  function dayNightSplit(entries) {
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

  // ---------- People ----------

  function hoursPerDriver(entries, drivers) {
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

  function hoursDistribution(entries, drivers) {
    const arr = hoursPerDriver(entries, drivers).map(x => x.hours);
    const max = Math.max(40, ...arr);
    const binWidth = Math.ceil(max / 8);
    const bins = [];
    for (let i = 0; i * binWidth <= max; i++) bins.push(i * binWidth);
    const labels = bins.map((b, i) => i === bins.length - 1 ? `${b}+` : `${b}-${bins[i + 1]}`);
    const counts = new Array(bins.length).fill(0);
    for (const h of arr) {
      const idx = Math.min(bins.length - 1, Math.floor(h / binWidth));
      counts[idx] += 1;
    }
    return { labels, data: counts };
  }

  function functionBreakdown(entries, drivers) {
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

  function offReasons(entries) {
    const buckets = new Map();
    for (const e of entries) {
      if (e.entry_type !== "off") continue;
      const r = e.off_reason || "unknown";
      buckets.set(r, (buckets.get(r) || 0) + 1);
    }
    const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: arr.map(x => x[0]), data: arr.map(x => x[1]) };
  }

  function yardUtilization(entries, drivers) {
    const drvYard = new Map();
    for (const d of drivers) {
      const y = d.irh_yard_number || "—";
      const list = String(y).split(",").map(s => s.trim()).filter(Boolean);
      drvYard.set(d.id, list.length ? list : ["—"]);
    }
    const buckets = new Map();
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      const yards = drvYard.get(e.driver_id) || ["—"];
      // Multi-yard drivers get their hours split evenly across yards.
      const h = Utils.shiftDurationHours(e.start_time, e.end_time) / yards.length;
      for (const y of yards) buckets.set(y, (buckets.get(y) || 0) + h);
    }
    const arr = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    return { labels: arr.map(x => x[0]), data: arr.map(x => +x[1].toFixed(1)) };
  }

  // ---------- Trends (week buckets) ----------

  // Bucket entries into the last `weeks` rolling 7-day windows, ending today.
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
      // Day-precision diff using local-midnight Dates dodges DST off-by-ones.
      const diffDays = Math.round((today - d) / 86400000);
      if (diffDays < 0) continue;
      const wIdx = weeks - 1 - Math.floor(diffDays / 7);
      if (wIdx < 0 || wIdx >= weeks) continue;
      buckets[wIdx].push(e);
    }
    return { labels, buckets };
  }

  function weeklyTotals(entries, weeks) {
    const { labels, buckets } = bucketByWeek(entries, weeks);
    return { labels, data: buckets.map(b => +totalHours(b).toFixed(1)) };
  }

  function overnightByWeek(entries, weeks) {
    const { labels, buckets } = bucketByWeek(entries, weeks);
    return {
      labels,
      data: buckets.map(b =>
        b.filter(e => e.entry_type === "shift" && e.end_time < e.start_time).length
      ),
    };
  }

  function activeDriverCountByWeek(entries, weeks) {
    const { labels, buckets } = bucketByWeek(entries, weeks);
    return {
      labels,
      data: buckets.map(b =>
        new Set(b.filter(e => e.entry_type === "shift").map(e => e.driver_id)).size
      ),
    };
  }

  return {
    totalHours,
    countShifts,
    hoursByHourOfDay,
    hoursByDayOfWeek,
    heatmap,
    shiftLengthDist,
    dayNightSplit,
    hoursPerDriver,
    hoursDistribution,
    functionBreakdown,
    offReasons,
    yardUtilization,
    bucketByWeek,
    weeklyTotals,
    overnightByWeek,
    activeDriverCountByWeek,
  };
})();
