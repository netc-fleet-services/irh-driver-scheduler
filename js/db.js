// Supabase CRUD wrappers. All functions return Promises.
// Callers handle UI; this layer only talks to the DB.

window.DB = (function () {

  // ---------- Drivers ----------

  // List drivers for the scheduler. Filters: active, company, yard, functions.
  // The "yard" filter targets `irh_yard_number` (the Interstate yard code),
  // not the shared `yard` column.
  async function listDrivers({
    includeInactive = false,
    company   = null,
    yard      = null,    // matched against irh_yard_number
    functions = null,    // array — restrict to these `function` values
  } = {}) {
    let q = window.sb
      .from("drivers")
      .select('id, name, "function", yard, truck, "Company", active, inactive_reason, inactive_since, irh_driver_number, irh_yard_number')
      .order("name", { ascending: true });

    if (!includeInactive)            q = q.eq("active", true);
    if (company)                     q = q.eq('"Company"', company);
    if (yard) {
      // Accept a single yard ("1") OR an array of yards (["1", "5"]) so the
      // caller can merge multiple real yards under one display yard.
      const list = Array.isArray(yard) ? yard : [yard];
      const escaped = list.map(y =>
        String(y).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      );
      // Match each value as a complete comma-separated element, e.g. for
      // multi-yard drivers like Gables = '1,6'.
      const pattern = `(^|,)(${escaped.join("|")})($|,)`;
      q = q.filter("irh_yard_number", "match", pattern);
    }
    if (functions && functions.length) q = q.in('"function"', functions);

    const { data, error } = await q;
    if (error) throw error;
    return data;
  }

  // Distinct companies present in `drivers` (for the company filter dropdown).
  async function listDistinctCompanies() {
    const { data, error } = await window.sb
      .from("drivers")
      .select('"Company"')
      .not('"Company"', "is", null);
    if (error) throw error;
    return [...new Set(data.map(r => r.Company).filter(Boolean))].sort();
  }

  // Distinct IRH yard codes for the yard filter. Splits comma-separated
  // multi-yard values (e.g. '1,6') so each yard becomes its own option.
  async function listDistinctYards({ company = null, functions = null } = {}) {
    let q = window.sb
      .from("drivers")
      .select("irh_yard_number")
      .not("irh_yard_number", "is", null);
    if (company) q = q.eq('"Company"', company);
    if (functions && functions.length) q = q.in('"function"', functions);
    const { data, error } = await q;
    if (error) throw error;

    const yards = new Set();
    for (const row of data) {
      if (!row.irh_yard_number) continue;
      for (const y of String(row.irh_yard_number).split(",")) {
        const t = y.trim();
        if (t) yards.add(t);
      }
    }
    return [...yards].sort();
  }

  // ---------- Schedule entries ----------

  // Get all schedule entries between two ISO dates (inclusive both ends).
  async function listScheduleBetween(isoStart, isoEnd) {
    const { data, error } = await window.sb
      .from("scheduler_driver_schedule")
      .select("*")
      .gte("schedule_date", isoStart)
      .lte("schedule_date", isoEnd);
    if (error) throw error;
    return data;
  }

  // Save an entry. If entry.id is present -> update; otherwise -> insert.
  // Multiple entries per (driver, date) are allowed since the UNIQUE constraint
  // was dropped in migration 20260505000006.
  async function upsertEntry(entry) {
    if (entry.id) {
      const { id, ...rest } = entry;
      const { data, error } = await window.sb
        .from("scheduler_driver_schedule")
        .update(rest)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    } else {
      const { data, error } = await window.sb
        .from("scheduler_driver_schedule")
        .insert(entry)
        .select()
        .single();
      if (error) throw error;
      return data;
    }
  }

  async function deleteEntry(id) {
    const { error } = await window.sb
      .from("scheduler_driver_schedule")
      .delete()
      .eq("id", id);
    if (error) throw error;
  }

  // Bulk delete every entry in [isoStart..isoEnd] for the given drivers.
  async function deleteEntriesForDriversInRange(driverIds, isoStart, isoEnd) {
    if (!driverIds.length) return 0;
    const { error } = await window.sb
      .from("scheduler_driver_schedule")
      .delete()
      .in("driver_id", driverIds)
      .gte("schedule_date", isoStart)
      .lte("schedule_date", isoEnd);
    if (error) throw error;
    return true;
  }

  // Copy entries from one date range to another (shifted by `daysShift`).
  // Replaces the target range — deletes existing entries there, then inserts
  // the source data shifted forward.
  async function copyEntriesShifted(driverIds, fromIsoStart, fromIsoEnd, daysShift) {
    if (!driverIds.length) return 0;
    const { data, error } = await window.sb
      .from("scheduler_driver_schedule")
      .select("driver_id, schedule_date, entry_type, start_time, end_time, off_reason, notes")
      .in("driver_id", driverIds)
      .gte("schedule_date", fromIsoStart)
      .lte("schedule_date", fromIsoEnd);
    if (error) throw error;
    if (!data.length) return 0;

    const targetStart = Utils.toIsoDate(Utils.addDays(Utils.fromIsoDate(fromIsoStart), daysShift));
    const targetEnd   = Utils.toIsoDate(Utils.addDays(Utils.fromIsoDate(fromIsoEnd),   daysShift));

    const { error: delErr } = await window.sb
      .from("scheduler_driver_schedule")
      .delete()
      .in("driver_id", driverIds)
      .gte("schedule_date", targetStart)
      .lte("schedule_date", targetEnd);
    if (delErr) throw delErr;

    const shifted = data.map(e => ({
      ...e,
      schedule_date: Utils.toIsoDate(
        Utils.addDays(Utils.fromIsoDate(e.schedule_date), daysShift)
      ),
    }));

    const { error: insErr } = await window.sb
      .from("scheduler_driver_schedule")
      .insert(shifted);
    if (insErr) throw insErr;
    return shifted.length;
  }

  // ---------- Health check ----------

  // Lightweight read used to verify the client + RLS are configured correctly.
  async function ping() {
    const { count, error } = await window.sb
      .from("drivers")
      .select("*", { count: "exact", head: true });
    if (error) throw error;
    return { driverCount: count ?? 0 };
  }

  return {
    listDrivers,
    listDistinctCompanies,
    listDistinctYards,
    listScheduleBetween,
    upsertEntry,
    deleteEntry,
    deleteEntriesForDriversInRange,
    copyEntriesShifted,
    ping,
  };
})();
