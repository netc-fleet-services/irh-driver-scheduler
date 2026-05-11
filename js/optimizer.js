// Demand-vs-supply optimizer. Compares scheduled drivers per hour against
// the historical call-volume baseline (table: call_volume_baseline) and
// flags hours that look under- or over-staffed.
//
// Pure logic plus one network read for the baseline. No DOM. Callers
// (day-view, app, print-schedule) consume the returned plain objects.

window.Optimizer = (function () {

  // Live config: prefer Settings (DB-backed) when available, fall back to
  // the static APP_CONFIG defaults. Functions instead of constants so each
  // call sees the latest saved values.
  const CFG = () => (window.Settings && Settings.getGroup)
    ? Settings.getGroup("optimizer")
    : ((window.APP_CONFIG && window.APP_CONFIG.optimizer) || {});
  const SUPPLY_FN = () => CFG().supplyFunctions || ["LDT", "HDT"];
  const EXCLUDE_YARDS = () => CFG().excludeYards || [];

  // Returns the subset of drivers eligible to count toward towing-supply.
  // Filters by `function` (must be in supplyFunctions) and excludes any
  // driver whose `irh_yard_number` contains any of `excludeYards` as a
  // comma-separated element (so "1,UFP" matches "UFP" and is excluded).
  // Matching is case-insensitive and whitespace-tolerant so a driver with
  // `function = "LDT "` or `"ldt"` still counts.
  // True if a single driver lives in any excluded yard (UFP by default).
  // Independent of `function` — used by the UI to tint these driver cards
  // so dispatchers can see at a glance "this person doesn't count toward
  // the towing supply baseline."
  function isInExcludedYard(driver) {
    const excludes = new Set(
      EXCLUDE_YARDS().map(s => String(s).trim().toUpperCase()).filter(Boolean)
    );
    if (!excludes.size) return false;
    const yards = String(driver?.irh_yard_number || "")
      .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
    return yards.some(y => excludes.has(y));
  }

  function filterSupplyDrivers(drivers) {
    const fns = new Set(SUPPLY_FN().map(s => String(s).trim().toUpperCase()));
    const excludes = new Set(
      EXCLUDE_YARDS().map(s => String(s).trim().toUpperCase()).filter(Boolean)
    );
    return (drivers || []).filter(d => {
      const fn = String(d.function || "").trim().toUpperCase();
      if (!fns.has(fn)) return false;
      if (!excludes.size) return true;
      const yards = String(d.irh_yard_number || "")
        .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
      return !yards.some(y => excludes.has(y));
    });
  }

  // ---------- Baseline cache ----------
  // Shape: { aggregate: number[7][24], byMonth: Map<month, number[7][24]> }
  let cached = null;
  let inflight = null;

  async function loadBaseline() {
    if (cached) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      const { data, error } = await window.sb
        .from("call_volume_baseline")
        .select("day_of_week, hour, month, avg_calls");
      if (error) throw error;

      const agg = Array.from({ length: 7 }, () => new Array(24).fill(0));
      const byMonth = new Map();
      for (const r of data || []) {
        const dow = r.day_of_week, hr = r.hour, m = r.month;
        const v = Number(r.avg_calls) || 0;
        if (m == null) {
          agg[dow][hr] = v;
        } else {
          if (!byMonth.has(m)) {
            byMonth.set(m, Array.from({ length: 7 }, () => new Array(24).fill(0)));
          }
          byMonth.get(m)[dow][hr] = v;
        }
      }
      cached = { aggregate: agg, byMonth };
      return cached;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  // Force a re-fetch (e.g. after re-importing the seed).
  function clearCache() { cached = null; }

  // Read access to the cached baseline. Returns null until loadBaseline()
  // resolves. Shape: { aggregate: number[7][24], byMonth: Map<int, [7][24]> }.
  function getCachedBaseline() { return cached; }

  // ---------- Demand lookup ----------

  // avg_calls for a given JS Date + hour. Prefers the per-month value if
  // available, falls back to the aggregate.
  function demandFor(baseline, date, hour) {
    if (!baseline) return 0;
    const dow = (date.getDay() + 6) % 7;   // Mon=0..Sun=6
    const month = date.getMonth() + 1;
    const monthGrid = baseline.byMonth.get(month);
    if (monthGrid && monthGrid[dow][hour] > 0) return monthGrid[dow][hour];
    return baseline.aggregate[dow][hour] || 0;
  }

  // ---------- Supply ----------

  // For a single date and hour, count how many in-scope drivers are
  // scheduled (entry overlaps that hour). Scope = drivers whose `function`
  // is in supplyFunctions.
  function supplyFor(entries, drivers, isoDate, hour) {
    // `drivers` is already pre-filtered by filterSupplyDrivers — this set is
    // the authoritative supply roster. Entries for drivers not in the set are
    // skipped (Transport, Road Service, UFP, excluded names, etc.).
    const supplyIds = new Set(drivers.map(d => d.id));

    let count = 0;
    const yesterdayIso = Utils.toIsoDate(
      Utils.addDays(Utils.fromIsoDate(isoDate), -1)
    );

    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      if (!supplyIds.has(e.driver_id)) continue;

      const s = Utils.timeToHours(e.start_time);
      let f = Utils.timeToHours(e.end_time);
      const overnight = f <= s;
      if (overnight) f += 24;

      if (e.schedule_date === isoDate) {
        // Today's shift. Active hours: [floor(s), ceil(f)) on a 0..48h axis.
        if (hour + 1 > s && hour < f) count += 1;
      } else if (overnight && e.schedule_date === yesterdayIso) {
        // Yesterday's overnight shift bleeds into today on hours
        // [0, ceil(f - 24)).
        const tailEnd = f - 24;
        if (hour + 1 > 0 && hour < tailEnd) count += 1;
      }
    }
    return count;
  }

  // ---------- Gap computation ----------

  // For each (date, hour) in the range, return:
  //   { isoDate, date, hour, supply, demandCalls, demandDrivers, gap, status }
  // status ∈ { "under", "over", "ok" }
  function computeGaps(entries, drivers, baseline, isoStart, isoEnd) {
    const cfg = CFG();
    const callsPerDriver = Number(cfg.callsPerDriverPerHour) || 1.0;
    const under = Number(cfg.understaffedThreshold);
    const over  = Number(cfg.overstaffedThreshold);

    const start = Utils.fromIsoDate(isoStart);
    const end   = Utils.fromIsoDate(isoEnd);
    const out = [];

    for (let d = new Date(start); d <= end; d = Utils.addDays(d, 1)) {
      const isoDate = Utils.toIsoDate(d);
      for (let h = 0; h < 24; h++) {
        const supply = supplyFor(entries, drivers, isoDate, h);
        const demandCalls = demandFor(baseline, d, h);
        const demandDrivers = demandCalls / callsPerDriver;
        const gap = supply - demandDrivers;

        let status = "ok";
        if (gap <= under) status = "under";
        else if (gap >= over) status = "over";

        out.push({
          isoDate,
          date: new Date(d),
          hour: h,
          supply,
          demandCalls,
          demandDrivers,
          gap,
          status,
        });
      }
    }
    return out;
  }

  // ---------- Suggestions ----------

  // Return at most { topUnder, topOver } items, sorted by severity (largest
  // |gap| first). Includes only flagged hours.
  function topSuggestions(gaps) {
    const cfg = CFG();
    const nUnder = Number(cfg.topUnderstaffedCount) || 5;
    const nOver  = Number(cfg.topOverstaffedCount)  || 3;

    const under = gaps.filter(g => g.status === "under")
      .sort((a, b) => a.gap - b.gap)        // most negative first
      .slice(0, nUnder);
    const over = gaps.filter(g => g.status === "over")
      .sort((a, b) => b.gap - a.gap)        // most positive first
      .slice(0, nOver);

    return { under, over };
  }

  // ---------- Formatting helpers (used by UI) ----------

  function formatHour12(h) {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  function suggestionText(g) {
    const dayLabel = g.date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const hourLabel = formatHour12(g.hour);
    const calls = g.demandCalls.toFixed(1);
    if (g.status === "under") {
      const need = Math.ceil(-g.gap);
      return `${dayLabel} ${hourLabel} — historically ${calls} calls/hr, only ${g.supply} on shift. Consider +${need} driver${need === 1 ? "" : "s"}.`;
    }
    if (g.status === "over") {
      const cut = Math.floor(g.gap);
      return `${dayLabel} ${hourLabel} — ${g.supply} on shift but historical avg is ${calls} calls/hr. Could trim by ${cut}.`;
    }
    return `${dayLabel} ${hourLabel} — ${g.supply} drivers, ${calls} calls/hr (gap ${g.gap.toFixed(1)}).`;
  }

  // ---------- Debug helpers ----------

  // Roll-call inspector: returns exactly which drivers are counted (and which
  // are NOT, with reasons) for a given date and hour. Drivers/entries are
  // pulled from Scheduler state. Intended for browser-console use:
  //
  //   Optimizer.debugSupplyAt('2026-05-11', 8)
  //
  // Returns: { isoDate, hour, supplyCount, breakdown: [...] }
  function debugSupplyAt(isoDate, hour) {
    const drivers = window.Scheduler?.getAllDrivers?.() || [];
    const entries = window.Scheduler?.getAllEntries?.() || [];
    const supply  = filterSupplyDrivers(drivers);
    const supplyIds = new Set(supply.map(d => d.id));
    const driverById = new Map(drivers.map(d => [d.id, d]));

    const yesterdayIso = Utils.toIsoDate(
      Utils.addDays(Utils.fromIsoDate(isoDate), -1)
    );

    const breakdown = [];
    for (const e of entries) {
      if (e.entry_type !== "shift") continue;
      if (e.schedule_date !== isoDate && e.schedule_date !== yesterdayIso) continue;
      const d = driverById.get(e.driver_id);

      const s = Utils.timeToHours(e.start_time);
      let f = Utils.timeToHours(e.end_time);
      const overnight = f <= s;
      if (overnight) f += 24;

      let overlaps;
      if (e.schedule_date === isoDate) {
        overlaps = (hour + 1 > s && hour < f);
      } else {
        if (!overnight) continue;          // non-overnight yesterday is irrelevant
        const tailEnd = f - 24;
        overlaps = (hour + 1 > 0 && hour < tailEnd);
      }
      if (!overlaps) continue;

      const inSupply = supplyIds.has(e.driver_id);
      let reason = "✓ counted";
      if (!d) {
        reason = "✗ driver row missing (inactive / not in current roster)";
      } else if (!inSupply) {
        const cfg = CFG();
        const fns = new Set((cfg.supplyFunctions || ["LDT", "HDT"])
          .map(s => String(s).trim().toUpperCase()));
        const fn = String(d.function || "").trim().toUpperCase();
        const yards = String(d.irh_yard_number || "")
          .split(",").map(s => s.trim().toUpperCase()).filter(Boolean);
        const excludes = new Set((cfg.excludeYards || ["UFP"])
          .map(s => String(s).trim().toUpperCase()).filter(Boolean));
        const excluded = yards.find(y => excludes.has(y));
        if (!fns.has(fn))    reason = `✗ function "${d.function}" not in supplyFunctions`;
        else if (excluded)   reason = `✗ yard "${excluded}" is excluded`;
        else                 reason = "✗ excluded (unknown reason)";
      }

      breakdown.push({
        driver: d?.name || `#${e.driver_id}`,
        function: d?.function ?? "—",
        yard: d?.irh_yard_number ?? "—",
        start: e.start_time,
        end: e.end_time,
        date: e.schedule_date,
        overnight,
        counted: inSupply && !!d,
        reason,
      });
    }

    const counted = breakdown.filter(b => b.counted).length;
    console.log(`Supply at ${isoDate} ${hour}:00 — ${counted} driver(s) counted`);
    console.table(breakdown);
    return { isoDate, hour, supplyCount: counted, breakdown };
  }

  return {
    loadBaseline,
    clearCache,
    getCachedBaseline,
    filterSupplyDrivers,
    isInExcludedYard,
    debugSupplyAt,
    demandFor,
    supplyFor,
    computeGaps,
    topSuggestions,
    formatHour12,
    suggestionText,
  };
})();
