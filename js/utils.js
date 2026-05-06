// Date / formatting helpers. Pure functions, no DOM, no Supabase.

window.Utils = (function () {

  // Format a JS Date as "YYYY-MM-DD" in local time (matches Postgres `date`).
  function toIsoDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  // Parse "YYYY-MM-DD" back to a local-midnight Date.
  function fromIsoDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Monday of the ISO week containing `d`.
  function startOfWeek(d) {
    const out = new Date(d);
    const dow = out.getDay();           // 0=Sun..6=Sat
    const diff = (dow === 0 ? -6 : 1 - dow);
    out.setDate(out.getDate() + diff);
    out.setHours(0, 0, 0, 0);
    return out;
  }

  // Return [Mon, Tue, ..., Sun] dates for the week containing `d`.
  function weekDates(d) {
    const start = startOfWeek(d);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }

  // Return N consecutive dates starting from `start` (which is itself the first day).
  function dateRange(start, n) {
    const out = [];
    const base = new Date(start);
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < n; i++) {
      const day = new Date(base);
      day.setDate(base.getDate() + i);
      out.push(day);
    }
    return out;
  }

  // Add days (returns a new Date)
  function addDays(d, n) {
    const out = new Date(d);
    out.setDate(out.getDate() + n);
    return out;
  }

  // "Mon, May 5"
  function shortDateLabel(d) {
    return d.toLocaleDateString(undefined, {
      weekday: "short",
      month:   "short",
      day:     "numeric",
    });
  }

  // "08:00" -> "8:00 AM"
  function formatTime12(t) {
    if (!t) return "";
    const [h, m] = t.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${period}`;
  }

  // Hours between two "HH:MM[:SS]" times. If end <= start, treat as overnight
  // (rolls into the next day) and add 24h.
  function shiftDurationHours(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const t = (s) => {
      const [h, m] = s.split(":").map(Number);
      return h + (m || 0) / 60;
    };
    const s = t(startTime);
    let e = t(endTime);
    if (e <= s) e += 24;
    return e - s;
  }

  // 8 -> "8h", 8.5 -> "8h 30m", 0 -> "0h"
  function formatHours(h) {
    if (!h || h <= 0) return "0h";
    const whole = Math.floor(h);
    const mins  = Math.round((h - whole) * 60);
    if (mins === 0) return `${whole}h`;
    if (whole === 0) return `${mins}m`;
    return `${whole}h ${mins}m`;
  }

  return {
    toIsoDate,
    fromIsoDate,
    startOfWeek,
    weekDates,
    dateRange,
    addDays,
    shortDateLabel,
    formatTime12,
    shiftDurationHours,
    formatHours,
  };
})();
