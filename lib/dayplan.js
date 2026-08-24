import {
  employees, clientTimings, specificClientsFor, customTextFor,
  distributeClientsForHour, getScheduledEmployeesAtHour, auditHourAssignment,
} from './schedule'
import { buildHourPool, collapseSlotOwners } from './distribution'
import {
  businessHourOrder, hourHasPassed, whoWasOnShiftAtHour,
  getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames,
} from './sheets'

// ══════════════════════════════════════════════════════════════════════
// The day, worked out once.
//
// "How many clients does this person have today?" was being answered in four
// places, four different ways, and it gave four different answers about the
// same person on the same afternoon: 69 on their own dashboard, 50 in the rail
// beside it, 176 on the admin's Dashboard, 207 on Hour by hour. Every one of
// them was defensible on its own and no two agreed, which makes all four
// useless — you cannot chase a number you cannot trust.
//
// There is one answer now and this is where it is computed. Everything else
// reads it: the employee's board, the employee's own day, the rail on their
// dashboard, the admin's Dashboard and the admin's Hour by hour.
//
// The rules, in one place:
//
//   DUE      Every client Client_Timings schedules for the hour, plus every
//            client named against somebody in Employee_Hours for that hour.
//            A named client is delivered whether or not the timings sheet
//            mentions it, so it is part of the day either way.
//
//   SETTLED  An hour that is over and has rows in CRM_Updates is read from
//            those rows — they are the record of who actually held what, and
//            the only honest one. Settled applies to the WHOLE hour, never to
//            one employee at a time: mixing rows for some people with a
//            recomputed split for others put the same client on two boards.
//
//   LIVE     The hour in progress is split between whoever is clocked in,
//            exactly as the employee's own board splits it.
//
//   AHEAD    An hour still to come is split between the people the ROSTER puts
//            on it, minus anyone on leave, on a week off, or who has already
//            gone home for the day. Not "who is at a desk this minute" — the
//            night shift covers tonight whether or not it has arrived.
//
//   GONE     An hour already finished with no rows at all is judged on who was
//            actually at work then, read back from the attendance log.
//
// Anything the split cannot place is returned by name in `unassigned`. It is
// never dropped: a client on no board is invisible, and invisible is the one
// thing this platform must never let a client be.
// ══════════════════════════════════════════════════════════════════════
export function computeDayPlan({
  date,                       // the operating day being planned, DD/MM/YYYY
  today,                      // the operating day right now
  nowHour,                    // IST hour right now
  shiftRows, updateRows,
  breakRows = [],
  leaveMap = {}, overridesMap = {},
  vehicleMap = {},
  // The STANDING weekly week-off from Credentials. Everything else that keeps
  // somebody off for the day — the "Week Off" row the no-show sweep writes, and
  // the fact that turning up overrides both — is worked out here, so every
  // caller gets the same answer. Passing a differently-built set from each
  // screen is what made the Dashboard say an employee had no clients today
  // while Hour by hour, reading the same plan, said a hundred and four.
  weekOffNames = new Set(),
  yesterday,
}) {
  const isToday = date === today
  const vehiclesOf = (c) => vehicleMap[(c || '').toString().replace(/\s+/g, ' ').trim().toLowerCase()]?.vehicleCount || 0

  // ── Presence ────────────────────────────────────────────────────────
  const dates = yesterday ? [date, yesterday] : [date]
  const onShiftNames = isToday
    ? getOnShiftNamesFromLog(shiftRows, dates)
    // A day already finished has nobody Active: presence means "turned up".
    : new Set(shiftRows.slice(1).filter(r => r[2] === date).map(r => (r[1] || '').toString().trim()).filter(Boolean))
  const clockedOutNames = isToday ? getClockedOutNamesFromLog(shiftRows, dates) : new Set()
  const awayNames = isToday ? getAwayOnBreakNames(breakRows, dates) : new Set()

  // Gone home for THIS operating day: a row dated today, none of them Active.
  // Rows dated yesterday are ignored on purpose — a night shift that ended at
  // six this morning is due back tonight, and reading its Ended row would
  // empty every night hour of its staff.
  const rowsTodayByName = {}
  shiftRows.slice(1).filter(r => r[2] === date).forEach(r => {
    const n = (r[1] || '').toString().trim()
    if (n) (rowsTodayByName[n] ||= []).push(r)
  })
  const goneHomeToday = new Set(
    Object.entries(rowsTodayByName)
      .filter(([, rows]) => !rows.some(r => r[6] === 'Active'))
      .map(([n]) => n)
  )

  // Off for the whole day: the standing flag, plus anyone the no-show sweep
  // marked "Week Off" — and never anyone who actually turned up, whatever any
  // flag says.
  const offToday = new Set(weekOffNames)
  Object.entries(leaveMap || {}).forEach(([name, entries]) => {
    if (entries.some(l => (l.reason || '').toString().trim() === 'Week Off')) offToday.add(name)
  })
  Object.entries(rowsTodayByName).forEach(([name, rows]) => {
    if (rows.some(r => r[3])) offToday.delete(name)
  })

  // The hour each person first clocked in today, in operating-day position.
  //
  // Hours before that are not their day. Somebody who signed in at four in the
  // afternoon was still being shown seven in the morning through three in the
  // afternoon on their own hour strip — eight hours they were not present for,
  // with client counts against them — because the strip was built from the
  // roster rather than from when they actually arrived.
  const ORDER = businessHourOrder()
  const posOf = (h) => ORDER.indexOf(h)
  const arrivedAt = {}
  Object.entries(rowsTodayByName).forEach(([name, rows]) => {
    let best = null
    rows.forEach(r => {
      const t = (r[3] || '').toString().trim()
      const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i)
      if (!m) return
      let h = parseInt(m[1], 10)
      const ap = (m[3] || '').toLowerCase()
      if (ap === 'pm' && h !== 12) h += 12
      if (ap === 'am' && h === 12) h = 0
      if (!Number.isFinite(h)) return
      if (best === null || posOf(h) < posOf(best)) best = h
    })
    if (best !== null) arrivedAt[name] = best
  })

  // ── The grace hour ──────────────────────────────────────────────────
  //
  // Somebody who has not clocked in still gets their FIRST shift hour. They
  // may be five minutes away, and pulling their clients the moment the hour
  // opens would churn the whole floor for nothing. From the NEXT hour on they
  // are treated as absent — their share goes to the people who are here — and
  // the no-show sweep writes the matching "Week Off" row into the Leaves tab.
  // The moment they do sign in, their shift starts from that hour and they get
  // that hour's clients, like anybody else arriving late.
  //
  // This is decided here rather than read off the swept row, because the sweep
  // only fires when somebody's board happens to be loaded. Waiting for it left
  // an employee who never turned up showing a full nine-hour day — 0 of 64
  // clients spread across every hour of a shift they were not working — which
  // is both wrong on their screen and wrong in every total that reads it.
  // The hour the ROSTER says they were due, which is the only thing "were you
  // late?" can honestly be measured against.
  //
  // This used to read the Shift_Overrides row first — and that row is written
  // BY the late arrival, with start set to the hour they turned up. So the
  // question became "did you arrive later than you arrived", the answer was
  // always no, and the hour somebody was due for vanished from their name the
  // instant they signed in. An employee rostered from eight who came at noon
  // showed a clean day from noon, with nothing anywhere saying the eight, nine,
  // ten and eleven o'clock hours had gone unworked.
  //
  // The override still decides their WINDOW — when their day now ends, and
  // which hours they are scheduled for — which is what it is for. It does not
  // get to decide what they were due for, because it is derived from the very
  // thing it would be judging.
  const startHourOf = (name) => {
    const e = employees().find(x => x.name === name)
    return Number.isFinite(e?.start) ? e.start : null
  }
  // The first rostered hour somebody was absent for — and it STAYS that hour.
  //
  // This used to be cleared the moment they finally clocked in, which threw
  // away the very thing it records. Somebody rostered from eight who turns up
  // at noon did not work eight, nine, ten or eleven; the eight o'clock hour has
  // to keep showing against their name or "you were due and did not come"
  // disappears from the day as soon as they arrive.
  const graceHourOnly = {}
  employees().forEach(e => {
    const start = startHourOf(e.name)
    if (start == null) return
    const arrived = arrivedAt[e.name]
    if (arrived === undefined) {
      // Not here yet. Before their first hour is over nothing is decided —
      // the day is still projected as if they will arrive, because they
      // probably will.
      if (isToday && !hourHasPassed(start, nowHour)) return
      graceHourOnly[e.name] = start
      return
    }
    // They came, but not at the hour they were due. The hours in between were
    // not worked, and the first of them stays theirs.
    if (posOf(arrived) > posOf(start)) graceHourOnly[e.name] = start
  })

  // ── Whose hour is this? ─────────────────────────────────────────────
  //
  // One predicate, and it must give the SAME answer at half past twelve as it
  // does at half past one. A client that sat on one person's board during the
  // hour and on somebody else's an hour later is the worst kind of wrong:
  // nobody can be asked about their own work, and the record contradicts what
  // the person actually saw.
  //
  // Evaluated entirely from things that do not move once the hour is over —
  // the roster, when they arrived, and whether they were on shift then.
  const hasAttendance = (name) => !!rowsTodayByName[name]?.some(r => r[3])
  const wereHereCache = {}
  const wereHere = (hour) => (wereHereCache[hour] ||=
    whoWasOnShiftAtHour(shiftRows, date, hour, nowHour))

  // An hour that has not arrived yet.
  const isAhead = (hour) => isToday && posOf(hour) > posOf(nowHour)

  // The hour somebody clocked out in, for anyone who has gone home today.
  //
  // Anchored to the clock-out, never to the clock. Anchoring it to "now" would
  // hold a leaver's unfinished work away from the floor while their last hour
  // was still running and then hand it straight back the moment that hour
  // passed — the same client on two different boards an hour apart, which is
  // exactly what a finished hour must never do.
  const leftAtHour = {}
  goneHomeToday.forEach(name => {
    let latest = null
    ;(rowsTodayByName[name] || []).forEach(r => {
      const m = (r[4] || '').toString().trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i)
      if (!m) return
      let h = parseInt(m[1], 10)
      const ap = (m[3] || '').toLowerCase()
      if (ap === 'pm' && h !== 12) h += 12
      if (ap === 'am' && h === 12) h = 0
      if (!Number.isFinite(h)) return
      if (latest === null || posOf(h) > posOf(latest)) latest = h
    })
    if (latest !== null) leftAtHour[name] = latest
  })

  const holdsHour = (name, hour) => {
    const start = startHourOf(name)
    const arrived = arrivedAt[name]

    // Never clocked in: they hold the one hour they were due and nothing else.
    if (!hasAttendance(name)) {
      if (graceHourOnly[name] === undefined) return true      // grace still running
      return graceHourOnly[name] === hour
    }
    // Came late: the hours before they arrived were not worked. The first of
    // them stays theirs; the rest belong to whoever was actually here.
    if (start != null && arrived != null && posOf(arrived) > posOf(start)) {
      if (posOf(hour) >= posOf(start) && posOf(hour) < posOf(arrived)) {
        return hour === start
      }
    }
    // ── The rest of the day still belongs to whoever is working it ────────
    //
    // The attendance log cannot answer this for an hour that has not happened.
    // An open shift is only RECORDED up to this minute, so asking it "were you
    // on shift at four o'clock?" at eight in the morning correctly answers no —
    // and that answer is worthless, because the question was never about the
    // past.
    //
    // Reading it as no emptied the entire day ahead of everybody who had
    // clocked in. Somebody at their desk since 07:44 was shown the seven
    // o'clock hour and then nine blanks; every client from eight onwards fell
    // to the people who had NOT signed in yet, because those people were still
    // inside their grace hour and so held everything. The floor's whole day
    // landed on whoever was late, and the people actually working had an empty
    // screen.
    //
    // An open shift means still here. The rest of their rostered day is theirs
    // until they clock out — and when they do, those hours move to the people
    // who are still on the floor, which is the one and only reason work should
    // ever change hands.
    if (isAhead(hour)) return !goneHomeToday.has(name)

    // ── Going home hands back what was not finished ───────────────────────
    //
    // Somebody who clocked out at five past six had five minutes of the six
    // o'clock hour. The attendance log says they were on shift for it, which
    // is true and useless: they were still given a full share of that hour —
    // twenty clients — and then marked as having missed every one of them,
    // while the people still on the floor were never handed the work.
    //
    // The hour they left in, and everything after it, belongs to whoever is
    // still here. What they actually recorded stays theirs regardless: the
    // record is laid over the split further down, so finished work never
    // moves. Only the unfinished part goes back.
    if (leftAtHour[name] != null && posOf(hour) >= posOf(leftAtHour[name])) return false

    // Gone home, but the row does not say when.
    //
    // A closed shift always carries an end time — both End shift and the
    // auto-close write one — so this is a row that has been damaged or edited
    // by hand. The attendance reader treats a missing end as "still here up to
    // now" (see whoWasOnShiftAtHour), which is the right reading for an OPEN
    // shift and exactly the wrong one here: it would leave the hour in
    // progress, and every hour after it, sitting with somebody who has left,
    // where nobody would ever do the work.
    //
    // We do not know when they went, so past hours are left to the attendance
    // log. From this hour on, the work belongs to whoever is still here.
    if (leftAtHour[name] == null && goneHomeToday.has(name) && posOf(hour) >= posOf(nowHour)) return false

    // Otherwise it is theirs if they were on shift for it — which also takes
    // care of the hours after they clocked out.
    return wereHere(hour).has(name)
  }

  // Kept for the callers that still ask the old question.
  const missedThisHour = (name, hour) =>
    graceHourOnly[name] !== undefined && graceHourOnly[name] !== hour

  // ── What each hour holds ────────────────────────────────────────────
  const timings = clientTimings()
  const dueAt = (hour) => {
    const s = new Set(
      Object.entries(timings).filter(([, hs]) => hs.includes(hour)).map(([n]) => n)
    )
    employees().forEach(e => (specificClientsFor(e.name, hour) || []).forEach(c => s.add(c)))
    return [...s]
  }

  // Rows for this date, indexed once.
  const rowsForDate = updateRows.slice(1).filter(r => r[0] === date)

  // ── Which slots were actually recorded, and when ─────────────────────
  //
  // Computed here, before the split, because every hour below needs it — and
  // because the thing that was standing in for it was wrong.
  //
  // `isLocked` was being read as "this slot was updated". It is not: it means
  // "this was taken off whoever the split gave it to and put with the person
  // who recorded it". When the split had ALREADY given the client to the
  // person who then recorded it, nothing was moved, so nothing was locked —
  // and the slot read as untouched.
  //
  // Zingbus, 23 August: recorded at 7am by Nesiya, 5pm by Afzal and 11pm by
  // CHANDAN, and listed as "no update since 7am" because all three of them
  // had been given it by the split in the first place.
  //
  // The rows are the answer. A slot is done when it has a row with a status
  // against it, whoever wrote it.
  const doneAt = new Map()          // "hour|client" -> the time it was recorded
  rowsForDate.forEach(r => {
    if (!(r[5] || '').toString().trim()) return
    doneAt.set(`${r[4]}|${r[3]}`, r[1] || '')
  })
  const slotDone = (hour, client) => doneAt.has(`${hour}|${client}`)
  const settledOwners = {}
  collapseSlotOwners(updateRows, r => r[0] === date).forEach(({ owner, client, hour }) => {
    const h = parseInt(hour)
    if (!Number.isFinite(h)) return
    ;(settledOwners[h] ||= {})
    ;(settledOwners[h][owner] ||= []).push(client)
  })

  const rosterCache = {}
  const rosterPool = (hour) => (rosterCache[hour] ||= (
    getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
      .map(e => e.name)
      .filter(n => !offToday.has(n))
  ))
  const livePool = (hour) => buildHourPool({
    hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames,
  }).poolNames

  // Nobody who has missed their grace hour is in any pool but that one hour.
  const withoutNoShows = (hour, names) => names.filter(n => !missedThisHour(n, hour))

  // Somebody who was due for this hour and did not work it, whose window has
  // since moved past it.
  //
  // Signing in at noon rewrites the window to noon–nine, so the roster no
  // longer schedules them at eight — and the hour they were absent for would
  // fall out of the pool even though holdsHour still says it is theirs. That
  // hour is the record of "you were due and you did not come"; losing it is
  // losing the only reason it was kept.
  const owedHourCache = {}
  const owedAt = (hour) => (owedHourCache[hour] ||= employees()
    .map(e => e.name)
    .filter(n => graceHourOnly[n] === hour && !offToday.has(n)))

  const poolFor = (hour) => {
    if (!isToday) return livePool(hour)
    // One rule for every hour of the day, past, present and to come: the
    // people the ROSTER puts on it, minus anyone off for the day, and then
    // only those whose hour it actually is (see holdsHour). Nothing in that
    // depends on what time it is now, which is exactly the point — the answer
    // for twelve o'clock must not change when one o'clock arrives.
    const base = rosterPool(hour)
    const owed = owedAt(hour).filter(n => !base.includes(n))
    return [...base, ...owed].filter(n => holdsHour(n, hour))
  }

  const hours = []
  const byEmployee = {}
  const ofEmp = (name) => (byEmployee[name] ||= {
    name, hours: {}, clients: 0, vehicles: 0, hoursWithClients: 0,
  })
  let dueClients = 0, dueVehicles = 0, placedClients = 0
  let dueClientsSoFar = 0, dueVehiclesSoFar = 0

  for (const hour of businessHourOrder()) {
    const due = dueAt(hour)
    if (due.length === 0) continue

    const hourVehicles = due.reduce((s, c) => s + vehiclesOf(c), 0)
    // "So far" counts every hour up to and including the one in progress.
    const passed = !isToday || hourHasPassed(hour, nowHour) || hour === nowHour
    dueClients  += due.length
    dueVehicles += hourVehicles
    if (passed) { dueClientsSoFar += due.length; dueVehiclesSoFar += hourVehicles }

    // ── A finished hour keeps everything it held, not just what got done ──
    //
    // An hour that is over used to be read back from CRM_Updates alone. That
    // was fine while a blank row was written for every client on every board;
    // once rows are written only where somebody recorded something, it turned
    // every past hour into a perfect score. Fifteen clients of which five were
    // done read back, an hour later, as "5 / 5" — the ten that were never
    // touched simply were not there any more.
    //
    // That is the opposite of what the record is for. Nobody can be asked why
    // ten clients went untouched if the screen says there were only ever five,
    // and nobody can go back and finish them if they cannot see them.
    //
    // So a past hour is worked out the same way every other hour is: the
    // schedule's clients, split between the people who were actually there,
    // with anything already recorded PINNED to whoever recorded it. The rows
    // decide what is DONE; they no longer decide what existed.
    const pool = poolFor(hour)

    // ── The split, then the record on top ────────────────────────────────
    //
    // The split is a pure function of the hour, its pool and the vehicle
    // counts. It is deliberately NOT given the list of what has already been
    // recorded, and that is the whole fix: feeding the finished work back in
    // changed everybody else's share every time anyone pressed Save, so a
    // client could sit on one person's board at noon and somebody else's at
    // one o'clock — in the noon hour — without either of them doing anything.
    //
    // What HAS been recorded is then laid over the top. Whoever actually did
    // a client owns it, whatever the split says; it is simply removed from
    // wherever the split had put it. Work moves when the floor changes —
    // somebody clocks in, somebody goes home — and at no other time.
    const owners = {}
    const dist = distributeClientsForHour(hour, pool, vehicleMap, {}, true)
    Object.entries(dist).forEach(([name, cs]) => {
      if (cs.length) owners[name] = cs.map(c => ({
        client: c.client, vehicleCount: c.vehicleCount || 0,
        isSpecific: !!c.isSpecific, isLocked: false,
        // Whether this client-hour has a recorded update against it, by
        // ANYBODY. Not the same question as isLocked — see doneAt above.
        done: slotDone(hour, c.client),
        doneAt: doneAt.get(`${hour}|${c.client}`) || '',
      }))
    })

    Object.entries(settledOwners[hour] || {}).forEach(([name, cs]) => {
      cs.forEach(client => {
        // Take it off whoever the split gave it to…
        Object.keys(owners).forEach(other => {
          if (other === name) return
          const i = owners[other].findIndex(c => c.client === client)
          if (i >= 0) owners[other].splice(i, 1)
        })
        // …and put it with the person whose work it is.
        const mine = (owners[name] ||= [])
        if (!mine.some(c => c.client === client)) {
          mine.push({
            client, vehicleCount: vehiclesOf(client), isLocked: true,
            done: slotDone(hour, client),
            doneAt: doneAt.get(`${hour}|${client}`) || '',
          })
        }
      })
    })
    Object.keys(owners).forEach(n => { if (owners[n].length === 0) delete owners[n] })

    const placed = new Set()
    Object.entries(owners).forEach(([name, cs]) => {
      const e = ofEmp(name)
      e.hours[hour] = cs
      e.clients  += cs.length
      e.vehicles += cs.reduce((s, c) => s + (c.vehicleCount || 0), 0)
      e.hoursWithClients += 1
      cs.forEach(c => placed.add(c.client))
    })
    placedClients += placed.size

    // What the hour could not place, and why.
    let unassigned = due.filter(c => !placed.has(c))
    let reason = unassigned.length === 0 ? 'ok' : (pool.length === 0 ? 'no-staff' : 'custom-duty')
    if (unassigned.length > 0) {
      const audit = auditHourAssignment(hour, pool, vehicleMap, {}, true)
      unassigned = audit.unassigned
      reason = audit.reason
    }

    hours.push({
      hour, passed, pool,
      due, dueCount: due.length, dueVehicles: hourVehicles,
      owners, placed: placed.size,
      unassigned, reason,
    })
  }

  // ── What was actually recorded ──────────────────────────────────────
  // Counted as SLOTS — one client in one hour is one piece of work — the same
  // unit the due figures use, so done can never outrun due the way a count of
  // distinct client names or of raw rows could.
  // ONE row per slot, the newest wins — then count.
  //
  // A save normally rewrites the row it already has, but nothing guarantees
  // that: two instances of the app can each read the tab a moment apart and
  // both append, and re-saving a client is a perfectly ordinary thing to do.
  // Adding the rows up as they come would then count the same piece of work
  // twice — vehicles watched, alerts, fatigue, all doubled for whoever saved
  // twice, which is worse than an error because nothing looks wrong.
  const latestBySlot = new Map()
  rowsForDate.filter(r => (r[5] || '').toString().trim()).forEach(r => {
    latestBySlot.set(`${r[2]}|${r[4]}|${r[3]}`, r)   // employee | hour | client
  })

  const doneSlots = new Set()
  const doneByEmp = {}
  let doneVehicles = 0, doneAlerts = 0, doneFatigue = 0
  latestBySlot.forEach(r => {
    const key = `${r[4]}|${r[3]}`
    const a = (doneByEmp[r[2]] ||= { clients: new Set(), vehicles: 0, alerts: 0, fatigue: 0 })
    a.clients.add(key)
    a.vehicles += parseInt(r[11]) || 0
    a.alerts   += parseInt(r[7])  || 0
    a.fatigue  += parseInt(r[9])  || 0
    doneSlots.add(key)
    doneVehicles += parseInt(r[11]) || 0
    doneAlerts   += parseInt(r[7])  || 0
    doneFatigue  += parseInt(r[9])  || 0
  })

  let doneSoFar = 0, doneAll = 0
  hours.forEach(h => {
    const n = h.due.filter(c => doneSlots.has(`${h.hour}|${c}`)).length
    h.done = n
    doneAll += n
    if (h.passed) doneSoFar += n
  })

  Object.values(byEmployee).forEach(e => {
    const a = doneByEmp[e.name]
    e.clientsDone     = a ? a.clients.size : 0
    e.vehiclesChecked = a ? a.vehicles : 0
    e.alerts          = a ? a.alerts : 0
    e.fatigue         = a ? a.fatigue : 0
  })
  // Somebody who recorded work but holds nothing right now still belongs here.
  Object.entries(doneByEmp).forEach(([name, a]) => {
    if (byEmployee[name]) return
    const e = ofEmp(name)
    e.clientsDone = a.clients.size
    e.vehiclesChecked = a.vehicles
    e.alerts = a.alerts
    e.fatigue = a.fatigue
  })

  return {
    date, isToday, nowHour,
    hours,
    byEmployee,
    goneHomeToday, offToday, awayNames, onShiftNames, arrivedAt, graceHourOnly, leftAtHour,
    totals: {
      dueClients, dueVehicles, placedClients,
      dueClientsSoFar, dueVehiclesSoFar,
      doneClients: doneAll, doneClientsSoFar: doneSoFar,
      doneVehicles, doneAlerts, doneFatigue,
      unassigned: hours.reduce((s, h) => s + h.unassigned.length, 0),
    },
  }
}

// ══════════════════════════════════════════════════════════════════════
// Clients nobody has filled since the day began
//
// One question about the CLIENT, not about whoever is looking at it. Five
// clients due in the morning and again at night: if ANYBODY fills three of
// them at ANY hour, those three are off this list for EVERYBODY. The two
// nobody filled stay on it, for everybody.
//
// Different from a coverage gap, and quieter. A coverage gap is work that
// reached no board — nobody could have done it. This reached somebody's
// board, in one hour or in six, and still has not one update against it.
//
// The hour in progress is left out. Nothing in it is late yet.
//
// Lives here rather than in the endpoint that first needed it, because the
// admin's screen and the employee's have to give the same answer — and
// because a rule that only exists inside a handler can only be tested through
// the clock, which meant it could not be tested at seven in the morning at
// all.
// ══════════════════════════════════════════════════════════════════════
export function staleClientsFrom(plan, nowHour) {
  const ORDER = businessHourOrder()
  const seen = new Map()

  plan.hours.forEach(h => {
    if (!h.passed || h.hour === nowHour) return
    Object.entries(h.owners).forEach(([name, cs]) => {
      cs.forEach(c => {
        const rec = seen.get(c.client) || {
          client: c.client, vehicleCount: c.vehicleCount || 0,
          slots: [], done: 0, pending: 0, lastUpdatedAt: '',
        }
        // c.done comes from the rows themselves: this client-hour has an
        // update against it, whoever wrote it. NOT c.isLocked, which means
        // "this was moved to the person who recorded it" — a client the split
        // had already given to its recorder was never moved, never locked,
        // and read as untouched. Zingbus was listed with three updates on it.
        const done = !!c.done
        rec.slots.push({ hour: h.hour, owner: name, done, at: c.doneAt || '' })
        if (done) { rec.done++; if (c.doneAt) rec.lastUpdatedAt = c.doneAt }
        else rec.pending++
        seen.set(c.client, rec)
      })
    })
  })

  return [...seen.values()]
    // Untouched all day. One update anywhere, by anyone, and it is not this.
    .filter(r => r.done === 0 && r.pending > 0)
    .map(r => {
      // Newest first, so "who had it last" is the first line.
      const slots = r.slots.slice().sort((a, b) => ORDER.indexOf(b.hour) - ORDER.indexOf(a.hour))
      return {
        ...r, slots,
        lastOwner: slots.length ? slots[0].owner : null,
        firstHour: slots.length ? slots[slots.length - 1].hour : null,
      }
    })
    // The biggest fleets first — that is where the exposure is.
    .sort((a, b) => (b.vehicleCount || 0) - (a.vehicleCount || 0))
}

// The hours of one employee's day, in operating-day order (7am → 7am).
//
// Not "from their shift start", which is where this used to begin: a late
// start moved somebody's window to 1pm, and the noon hour they had already
// worked was then printed after nine in the evening. The day runs 7am to 7am
// and the hours read in that order for everybody.
export function employeeDayHours(plan, emp, effective) {
  const inDay = new Set()
  const start = effective?.start ?? emp?.start
  const end   = effective?.end   ?? emp?.end
  if (Number.isFinite(start) && Number.isFinite(end)) {
    if (end <= start) {
      for (let h = start; h < 24; h++) inDay.add(h)
      for (let h = 0; h < end; h++) inDay.add(h)
    } else {
      for (let h = start; h < end; h++) inDay.add(h)
    }
  }
  // Hours before they actually arrived are not their day.
  //
  // Applied only once they HAVE clocked in — somebody who has not started yet
  // should still see the whole day ahead of them, because all of it is still
  // theirs to do. The moment they sign in at four in the afternoon, the
  // morning stops being theirs: they were not there for it, and printing eight
  // empty hours against their name reads as work they failed to do.
  const arrival = plan.arrivedAt?.[emp.name]
  if (arrival != null) {
    const order = businessHourOrder()
    const from = order.indexOf(arrival)
    ;[...inDay].forEach(h => { if (order.indexOf(h) < from) inDay.delete(h) })
  }

  // Once they have gone home, the rest of the day is not their day.
  //
    // The window is what they were ROSTERED for, and it can run hours past the
  // point somebody actually leaves — an OT extension especially. Printing
  // those hours against their name after they have clocked out reads as work
  // they failed to do, when in fact it belongs to the people still on the
  // floor. An employee who ended at six was shown seven and eight o'clock as
  // empty rows on a shift they had finished.
  const leftAt = plan.leftAtHour?.[emp.name]
  if (leftAt != null) {
    const order = businessHourOrder()
    const to = order.indexOf(leftAt)
    ;[...inDay].forEach(h => { if (order.indexOf(h) > to) inDay.delete(h) })
  }

  // An hour the plan actually gives them, or one they have already recorded
  // work in, belongs to their day whatever their window says now — a late
  // start or an OT extension must not erase a morning already worked, and an
  // employee who worked, went home and came back keeps both stretches.
  const mine = plan.byEmployee[emp.name]
  if (mine) Object.keys(mine.hours).forEach(h => inDay.add(parseInt(h)))

  return businessHourOrder().filter(h => inDay.has(h))
}
