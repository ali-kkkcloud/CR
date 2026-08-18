// ══════════════════════════════════════════════════════════════════════
// The floor — every employee, their state, and how far through their work
// they are, in one column.
//
// This is what a supervisor actually stares at, and until now it wasn't on
// the Overview at all: you had to open Full Day View to see who was where.
// The Overview instead led with eight stat cards, which answer "how are we
// doing" — a question nobody opens a command centre to ask first.
//
// It is grouped rather than filtered. Filter chips answered "show me the
// people matching X", which is a question you can only ask once you already
// know who is on the floor; and the one chip that existed — "On duty" — put
// people who had not clocked in yet under the same heading as people who
// were working, so the screen said somebody was on duty and not started in
// the same line. The groups are the states themselves: at work, away from
// the desk, not in yet, off today, done. Nothing is hidden behind a choice.
// ══════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, SearchInput, Tag, Meter, EmptyState, T, R, SP, SURF } from '../ui'
import { liveBreakMinutes } from './BreaksTab'

function fmtMins(m) {
  const h = Math.floor((m || 0) / 60), mm = (m || 0) % 60
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`
}

const STATE = {
  'Active':      { color: C.accent, label: 'On shift' },
  'Not Started': { color: C.red,    label: 'Not started' },
  'Left Open':   { color: C.amber,  label: 'Shift left open' },
  'Ended':       { color: C.blue,   label: 'Ended' },
  'Week Off':    { color: C.purple, label: 'Week off' },
  'Off Shift':   { color: C.dim,    label: 'Off shift' },
}

function fmt(h) {
  if (h == null) return '—'
  const to12 = n => (n === 0 ? 12 : n > 12 ? n - 12 : n)
  return `${to12(h)}${h >= 12 ? 'pm' : 'am'}`
}

// The order is the order a supervisor cares: who is working, who has walked
// away, who is missing, who was never coming, who is finished.
const GROUPS = [
  { key:'working', label:'At work',      color:C.accent, hint:'clocked in and at the desk' },
  { key:'break',   label:'On break',     color:C.red,    hint:'clocked in, away from the desk' },
  { key:'missing', label:'Not in yet',   color:C.red,    hint:'their shift has started, they have not' },
  { key:'open',    label:'Shift left open', color:C.amber, hint:'clocked in and never clocked out' },
  { key:'weekoff', label:'Week off',     color:C.purple, hint:'not coming in today' },
  { key:'done',    label:'Finished',     color:C.blue,   hint:'shift ended' },
  { key:'offshift',label:'Off shift',    color:C.dim,    hint:'outside their hours right now' },
]

export default function FloorPanel({ employees, breaks, workload, onPick }) {
  const [q, setQ] = useState('')

  const onBreakNames = useMemo(
    () => new Set((breaks?.employees || []).filter(e => e.currentlyOnBreak).map(e => e.name)),
    [breaks]
  )

  // How long each open break has been running. "BREAK" on its own hid the case
  // that matters: an auto-break opened at ten in the morning and still open in
  // the evening means that person has not been at their desk all day, and until
  // it showed as a duration nothing on this screen said so.
  const breakMinutes = useMemo(() => {
    const m = {}
    ;(breaks?.employees || []).filter(e => e.currentlyOnBreak).forEach(e => { m[e.name] = liveBreakMinutes(e) })
    return m
  }, [breaks])

  // What the day holds for each person, so the row can read
  // "12 done of 46 due" rather than just "12".
  const loadOf = useMemo(() => {
    const m = {}
    ;(workload?.perEmployee || []).forEach(w => { m[w.name] = w })
    return m
  }, [workload])

  const grouped = useMemo(() => {
    const term = q.trim().toLowerCase()
    const buckets = Object.fromEntries(GROUPS.map(g => [g.key, []]))
    employees
      .filter(e => !term || e.name.toLowerCase().includes(term))
      .forEach(e => {
        const st = e.statusLabel
        let key
        if (st === 'Active')           key = onBreakNames.has(e.name) ? 'break' : 'working'
        else if (st === 'Left Open')   key = 'open'
        else if (st === 'Not Started') key = 'missing'
        else if (st === 'Week Off')    key = 'weekoff'
        else if (st === 'Ended')       key = 'done'
        else                           key = 'offshift'
        buckets[key].push(e)
      })
    // Longest break first inside the break group; most work left first
    // everywhere else — the person who needs looking at is at the top.
    buckets.break.sort((a, b) => (breakMinutes[b.name] || 0) - (breakMinutes[a.name] || 0))
    ;['working','missing','open','weekoff','done','offshift'].forEach(k => {
      buckets[k].sort((a, b) => (b.pendingCount || 0) - (a.pendingCount || 0))
    })
    return buckets
  }, [employees, q, onBreakNames, breakMinutes])

  const anyone = GROUPS.some(g => grouped[g.key].length > 0)

  return (
    <Card pad={false} style={{ display:'flex', flexDirection:'column', minHeight:0 }}>
      <div style={{ padding:SP[4], borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:SP[2] }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:SP[2] }}>
          <span className="eyebrow">The floor</span>
          <Tag color={C.accent} dot>LIVE</Tag>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Find someone…" />
        {/* A one-line census, so the shape of the floor is readable before
            you scroll a single row. */}
        <div style={{ display:'flex', alignItems:'flex-start', flexWrap:'wrap', gap:'6px' }}>
          {GROUPS.filter(g => grouped[g.key].length > 0).map(g => (
            <Tag key={g.key} color={g.color}>{grouped[g.key].length} {g.label.toLowerCase()}</Tag>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflowY:'auto', minHeight:0, maxHeight:'620px' }}>
        {!anyone ? (
          <EmptyState icon="users" tone="good" title="Nobody here." detail="No one on the roster matches that name." />
        ) : GROUPS.map(g => {
          const rows = grouped[g.key]
          if (rows.length === 0) return null
          return (
            <div key={g.key}>
              <div style={{
                display:'flex', alignItems:'center', gap:SP[2],
                padding:'7px 16px', background:SURF.sunken,
                borderBottom:`1px solid ${C.border}`, position:'sticky', top:0, zIndex:1,
              }}>
                <span style={{ width:'5px', height:'5px', borderRadius:'50%', background:g.color, flexShrink:0 }} />
                <span style={{ color:g.color, fontSize:T.xs, fontWeight:800, letterSpacing:'0.06em', textTransform:'uppercase' }}>
                  {g.label} · {rows.length}
                </span>
                <span className="ellip hide-narrow" style={{ color:C.dim, fontSize:T.xs, flex:1 }}>{g.hint}</span>
              </div>

              {rows.map(e => {
                const st  = STATE[e.statusLabel] || { color:C.muted, label:e.statusLabel }
                const on  = onBreakNames.has(e.name)
                const load = loadOf[e.name]
                // How far through the day this person is: what they have
                // recorded against what the schedule holds for them. Falls
                // back to the live board count when the estimate is missing.
                const due  = load?.expectedClients || ((e.totalUpdates || 0) + (e.pendingCount || 0))
                const done = load ? load.clientsDone : (e.totalUpdates || 0)
                const pct  = due > 0 ? Math.min(100, Math.round((done / due) * 100)) : 0
                return (
                  <button
                    key={e.name}
                    onClick={() => onPick && onPick(e)}
                    className="row-hover"
                    style={{
                      display:'flex', alignItems:'center', gap:'11px', width:'100%',
                      background:'transparent', border:'none',
                      borderBottom:`1px solid ${C.border}`, padding:'11px 16px', textAlign:'left',
                    }}
                  >
                    <span style={{
                      width:'30px', height:'30px', borderRadius:'50%', flexShrink:0,
                      background:st.color+'1a', color:st.color,
                      fontSize:'10.5px', fontWeight:800,
                      display:'flex', alignItems:'center', justifyContent:'center',
                    }}>{e.name.slice(0, 2).toUpperCase()}</span>

                    <span style={{ flex:1, minWidth:0 }}>
                      <span style={{ display:'flex', alignItems:'flex-start', gap:'7px', flexWrap:'wrap' }}>
                        <span className="ellip" style={{ color:C.text, fontSize:T.base, fontWeight:700 }}>{e.name}</span>
                        {on && (
                          <Tag color={C.red} dot>
                            {breakMinutes[e.name] ? `AWAY ${fmtMins(breakMinutes[e.name])}` : 'ON BREAK'}
                          </Tag>
                        )}
                        {/* Away long enough that the split has stopped giving
                            them clients — their share is on someone else's
                            board right now, which is worth saying out loud. */}
                        {on && e.onBreakLong && <Tag color={C.amber}>WORK REASSIGNED</Tag>}
                        {e.shiftOverdue && <Tag color={C.amber} dot>SHIFT NOT CLOSED</Tag>}
                        {e.isAdjusted && <Tag color={C.amber}>ADJ</Tag>}
                      </span>
                      <span style={{ display:'block', color:st.color, fontSize:'9.5px', marginTop:'2px' }}>
                        {st.label} · {fmt(e.effStart ?? e.shiftStart)}–{fmt(e.effEnd ?? e.shiftEnd)}
                        {e.startTime ? ` · in ${e.startTime}` : ''}
                      </span>
                      {due > 0 && <Meter value={pct} color={g.key === 'weekoff' ? C.dim : C.accent} height={3} style={{ marginTop:'6px' }} />}
                    </span>

                    <span style={{ textAlign:'right', flexShrink:0, minWidth:'62px' }}>
                      <span style={{ display:'block', color:C.text, fontSize:T.base, fontWeight:800 }}>
                        {done}{due > 0 ? <span style={{ color:C.dim, fontWeight:600 }}>/{due}</span> : null}
                      </span>
                      <span style={{
                        display:'block', color: e.pendingCount > 0 ? C.amber : C.dim,
                        fontSize:'9.5px', marginTop:'1px',
                      }}>
                        {load ? `${load.expectedVehicles} veh due` : `${e.pendingCount || 0} left`}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </Card>
  )
}
