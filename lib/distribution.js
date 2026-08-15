import { getScheduledEmployeesAtHour } from './schedule'

// Who an hour is actually shared between.
//
// Two different questions get confused easily: who the roster says should be
// working, and who is actually at their desk. Distribution follows the second
// one — an hour rostered to six people but staffed by one belongs entirely to
// that one person, and every arrival or departure reshuffles the remainder.
//
// This lives on its own because the employee's board and the admin's Command
// Center both have to answer it, and the two must never disagree. They used to
// each work it out their own way: the employee's board recomputed the split
// live, while the admin counted placeholder rows in CRM_Updates — rows that
// keep the name of whoever held a client when the row was written, not
// whoever holds it now. With three people on shift the admin was reporting a
// 20/31 split of the same hour the employees saw as 25/26.
export function buildHourPool({ hour, leaveMap, overridesMap, onShiftNames, clockedOutNames = new Set(), alwaysInclude = null }) {
  // Somebody who is clocked in is, by definition, not absent. The no-show
  // sweep writes "Week Off" rows by itself, and a stale one left over from
  // before an employee arrived would otherwise keep them out of the split for
  // the rest of their shift. Leave an admin marked by hand always stands.
  const leaveMapForPool = {}
  Object.entries(leaveMap || {}).forEach(([name, entries]) => {
    leaveMapForPool[name] = onShiftNames.has(name)
      ? entries.filter(l => (l.markedBy || '') !== 'System')
      : entries
  })

  const scheduledNames = getScheduledEmployeesAtHour(hour, leaveMapForPool, overridesMap).map(e => e.name)

  let poolNames = scheduledNames.filter(n => onShiftNames.has(n))
  // Nobody clocked in yet (start of day, or everyone still to arrive): fall
  // back to the roster so the hour still has owners and no client silently
  // drops off the board.
  //
  // Anyone who has already finished for the day is left out of that fallback.
  // They are "not on shift" in the same way somebody who hasn't arrived is,
  // but they are not coming back — including them handed a full client list
  // to an employee who had gone home, and they could still update it.
  if (poolNames.length === 0) poolNames = scheduledNames.filter(n => !clockedOutNames.has(n))
  // The caller is looking at this screen because they're working, so keep
  // them in the pool even if their own Shift_Log row is a beat behind the
  // read cache.
  if (alwaysInclude && !poolNames.includes(alwaysInclude) && scheduledNames.includes(alwaysInclude)) {
    poolNames = [...poolNames, alwaysInclude]
  }
  return { poolNames, scheduledNames }
}

// One owner per (date, client, hour), instead of one row per time the slot
// changed hands.
//
// CRM_Updates is append-only and a placeholder is written whenever a client
// lands on somebody's board, so a single slot can carry three rows in three
// different names before anyone touches it. Counting rows therefore counts
// the same piece of work several times — and, worse, tells an employee they
// "missed" clients that were handed to a colleague the moment one clocked in.
// A row with real data always wins, because that is who actually did it;
// otherwise the most recent placeholder is the current owner.
export function collapseSlotOwners(updateRows, keepRow = () => true) {
  const slots = new Map()
  updateRows.slice(1).forEach(r => {
    if (!keepRow(r)) return
    const key = `${r[0]}|${r[3]}|${r[4]}`
    const done = !!(r[5] || '').toString().trim()
    const prev = slots.get(key)
    if (prev && prev.done && !done) return
    slots.set(key, { date: r[0], client: r[3], hour: r[4], owner: r[2], done, row: r })
  })
  return slots
}

// Slots pinned to whoever already did the work there.
//
// ONLY rows carrying a real update lock. Empty placeholder rows are
// deliberately not locked: pinning those froze an hour's split to whoever
// happened to open the page first, which is what stopped the workload
// rebalancing when somebody else started or ended their shift.
export function buildLockedAssignments(updateRows, shiftDate, hour) {
  const locked = {}
  updateRows.slice(1)
    .filter(r => r[0] === shiftDate && parseInt(r[4]) === hour && (r[5] || '').toString().trim())
    .forEach(r => { locked[r[3]] = r[2] })
  return locked
}
