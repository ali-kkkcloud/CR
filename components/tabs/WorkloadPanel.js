// ══════════════════════════════════════════════════════════════════════
// What the day holds, and how much of it has been done.
//
// The Command Center could say how many updates had been typed, and nothing
// else. It could not say how many clients the day actually holds, how many
// vehicles those clients add up to, how many of those vehicles anybody
// actually watched, or how much of any of it a given employee is going to
// see. Every one of those is a question a supervisor asks before lunch.
//
// Two readings, deliberately kept apart:
//
//   SO FAR   — cumulative to the hour in progress. At noon it covers 7–8,
//              8–9 … 12–1 and nothing later. This is the honest measure of
//              "are we keeping up", because work that isn't due yet can't
//              be behind.
//   FULL DAY — the whole operating day, 7am through 6am. This is the size
//              of the day, and the done side of it fills in live.
//
// Nothing here is estimated from a rate or extrapolated from a trend. Due
// figures come from the schedule itself hour by hour; done figures come
// from rows employees actually wrote.
// ══════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, CardHead, Section, SearchInput, Segmented, Tag, Meter, EmptyState, T, R, SP, SURF } from '../ui'

function fmtHourShort(h) {
  const to12 = n => (n === 0 ? 12 : n > 12 ? n - 12 : n)
  return `${to12(h)}${h >= 12 ? 'p' : 'a'}`
}

const pct = (done, due) => (due > 0 ? Math.min(100, Math.round((done / due) * 100)) : 0)

// One measured pair: what was due, what was done, and the gap between them.
function Measure({ label, done, due, hint, color = C.accent }) {
  const p = pct(done, due)
  const short = Math.max(0, (due || 0) - (done || 0))
  return (
    <div style={{ minWidth:0 }}>
      <div style={{ color:C.muted, fontSize:T.xs, fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase' }}>
        {label}
      </div>
      <div style={{ display:'flex', alignItems:'baseline', gap:'5px', marginTop:'4px' }}>
        <span style={{ color:C.text, fontSize:'23px', fontWeight:800, lineHeight:1 }}>
          {(done || 0).toLocaleString()}
        </span>
        <span style={{ color:C.dim, fontSize:T.md, fontWeight:700 }}>/ {(due || 0).toLocaleString()}</span>
      </div>
      <Meter value={p} color={color} height={4} style={{ marginTop:'8px' }} />
      <div style={{ color: short > 0 ? C.amber : C.muted, fontSize:T.xs, marginTop:'5px' }}>
        {due > 0 ? (short > 0 ? `${short.toLocaleString()} still to go · ${p}%` : `all done · ${p}%`) : (hint || 'nothing due')}
      </div>
    </div>
  )
}

// A plain count, for things that have no denominator — alerts are typed in,
// not scheduled, so there is nothing to be "behind" on.
function Count({ label, value, color = C.text, sub }) {
  return (
    <div style={{ minWidth:0 }}>
      <div style={{ color:C.muted, fontSize:T.xs, fontWeight:700, letterSpacing:'0.05em', textTransform:'uppercase' }}>
        {label}
      </div>
      <div style={{ color, fontSize:'23px', fontWeight:800, lineHeight:1, marginTop:'4px' }}>
        {(value || 0).toLocaleString()}
      </div>
      {sub && <div style={{ color:C.dim, fontSize:T.xs, marginTop:'5px' }}>{sub}</div>}
    </div>
  )
}

const GRID = { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(148px, 1fr))', gap:SP[4], alignItems:'start' }

// ── The hour strip ──────────────────────────────────────────────────
// Every hour the schedule has clients in, in operating-day order, with the
// filled share drawn inside it. Hours still ahead are drawn hollow, so the
// line between "what has happened" and "what is coming" is visible without
// reading a single number.
function HourStrip({ byHour }) {
  if (!byHour || byHour.length === 0) return null
  const max = Math.max(1, ...byHour.map(h => h.clients || 0))
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:'3px', marginTop:SP[3] }}>
      {byHour.map(h => {
        const height = Math.max(6, Math.round(((h.clients || 0) / max) * 54))
        const fill   = pct(h.done, h.clients)
        return (
          <div key={h.hour} style={{ flex:1, minWidth:0, textAlign:'center' }} title={
            `${fmtHourShort(h.hour)} — ${h.done} of ${h.clients} clients done, ${h.vehicles} vehicles due`
          }>
            <div style={{
              height:`${height}px`, borderRadius:'3px', position:'relative', overflow:'hidden',
              background: h.passed ? '#2f2f2f' : '#1c1c1c',
              border: h.passed ? 'none' : `1px solid ${C.border}`,
              boxSizing:'border-box',
            }}>
              {h.passed && (
                <div style={{
                  position:'absolute', left:0, right:0, bottom:0,
                  height:`${fill}%`, background:C.accent,
                }} />
              )}
            </div>
            <div style={{ color: h.passed ? C.text2 : C.dim, fontSize:'8.5px', marginTop:'3px', fontWeight: h.passed ? 700 : 400 }}>
              {fmtHourShort(h.hour)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Per employee ────────────────────────────────────────────────────
// What each person's day looks like: how many clients and vehicles the
// schedule sends them, how many they have recorded, what they found, and
// what they raised. Anyone whose hour carries a named client or a custom
// duty is already outside the ordinary share for that hour — the split
// itself does that — so these are the numbers they will really see.
const SORTS = [
  { value:'due',   label:'Most due' },
  { value:'done',  label:'Most done' },
  { value:'left',  label:'Furthest behind' },
  { value:'name',  label:'A–Z' },
]

function PerEmployee({ rows, onPick }) {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('due')

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    const out = rows.filter(r => !term || r.name.toLowerCase().includes(term))
    const left = r => (r.expectedClients || 0) - (r.clientsDone || 0)
    out.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'done') return (b.clientsDone || 0) - (a.clientsDone || 0)
      if (sort === 'left') return left(b) - left(a)
      return (b.expectedClients || 0) - (a.expectedClients || 0)
    })
    return out
  }, [rows, q, sort])

  return (
    <Card pad={false}>
      <div style={{ padding:SP[4], borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:SP[2] }}>
        <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:SP[2], flexWrap:'wrap' }}>
          <div style={{ minWidth:0 }}>
            <span className="eyebrow">Per employee</span>
            <div style={{ color:C.muted, fontSize:T.sm, marginTop:'3px' }}>
              What today sends each person, and what they have recorded against it
            </div>
          </div>
          <Segmented size="sm" value={sort} onChange={setSort} options={SORTS} />
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Find someone…" />
      </div>

      {list.length === 0 ? (
        <EmptyState icon="users" title="Nobody matches." detail="No one on the roster matches that name." />
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', minWidth:'760px', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:SURF.sunken }}>
                {['Employee','Clients','Vehicles','Alerts','Fatigue','Total','Footage'].map((h, i) => (
                  <th key={h} style={{
                    color:C.muted, fontSize:T.xs, fontWeight:800, letterSpacing:'0.05em', textTransform:'uppercase',
                    textAlign: i === 0 ? 'left' : 'right', padding:'9px 14px',
                    borderBottom:`1px solid ${C.border}`, whiteSpace:'nowrap',
                    // The roster runs to twenty rows; without this the column
                    // names scroll away and every number becomes a guess.
                    position:'sticky', top:0, zIndex:2, background:SURF.sunken,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map(r => {
                const off  = r.isWeekOff
                const cP   = pct(r.clientsDone, r.expectedClients)
                const vP   = pct(r.vehiclesChecked, r.expectedVehicles)
                const cell = { padding:'10px 14px', borderBottom:`1px solid ${C.border}`, textAlign:'right', whiteSpace:'nowrap' }
                return (
                  <tr key={r.name} className={onPick ? 'row-hover' : ''}
                      onClick={() => onPick && onPick(r)}
                      style={{ cursor: onPick ? 'pointer' : 'default', opacity: off ? 0.55 : 1 }}>
                    <td style={{ ...cell, textAlign:'left' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span className="ellip" style={{ color:C.text, fontSize:T.base, fontWeight:700 }}>{r.name}</span>
                        {off && <Tag color={C.purple}>WEEK OFF</Tag>}
                      </div>
                      <div style={{ color:C.dim, fontSize:T.xs, marginTop:'2px' }}>
                        {off ? 'not coming in — no clients today'
                             : `${r.expectedHours || 0} hour${r.expectedHours === 1 ? '' : 's'} of clients today`}
                      </div>
                    </td>
                    <td style={cell}>
                      <span style={{ color:C.text, fontSize:T.md, fontWeight:800 }}>{r.clientsDone || 0}</span>
                      <span style={{ color:C.dim, fontSize:T.sm, fontWeight:700 }}>/{r.expectedClients || 0}</span>
                      <Meter value={cP} height={3} style={{ marginTop:'5px', width:'72px', marginLeft:'auto' }} />
                    </td>
                    <td style={cell}>
                      <span style={{ color:C.text, fontSize:T.md, fontWeight:800 }}>{(r.vehiclesChecked || 0).toLocaleString()}</span>
                      <span style={{ color:C.dim, fontSize:T.sm, fontWeight:700 }}>/{(r.expectedVehicles || 0).toLocaleString()}</span>
                      <Meter value={vP} color={C.blue} height={3} style={{ marginTop:'5px', width:'72px', marginLeft:'auto' }} />
                    </td>
                    <td style={{ ...cell, color:C.text2, fontSize:T.md, fontWeight:700 }}>{r.alerts || 0}</td>
                    <td style={{ ...cell, color:C.text2, fontSize:T.md, fontWeight:700 }}>{r.fatigue || 0}</td>
                    <td style={{ ...cell, color: r.alertsTotal ? C.amber : C.dim, fontSize:T.md, fontWeight:800 }}>{r.alertsTotal || 0}</td>
                    <td style={cell}>
                      <span style={{ color:C.text, fontSize:T.md, fontWeight:800 }}>{r.footageDone || 0}</span>
                      <span style={{ color:C.dim, fontSize:T.sm, fontWeight:700 }}>/{r.footageRaised || 0}</span>
                      <div style={{ color:C.dim, fontSize:'9px', marginTop:'2px' }}>delivered / raised</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function WorkloadPanel({ workload, onPickEmployee }) {
  if (!workload) return null
  const { soFar, fullDay, byHour, perEmployee } = workload
  const upto = (byHour || []).filter(h => h.passed)
  const lastHour = upto.length ? upto[upto.length - 1].hour : null

  return (
    <>
      <Section
        title="Today, so far"
        sub={
          lastHour == null
            ? 'The day has not opened an hour with clients in it yet.'
            : `Everything due from 7am through the ${fmtHourShort(lastHour)} slot — ${upto.length} hour${upto.length === 1 ? '' : 's'}, counted live, nothing assumed.`
        }
      >
        <Card>
          <div style={GRID}>
            <Measure label="Clients"  done={soFar.clientsDone} due={soFar.clients} />
            <Measure label="Vehicles" done={soFar.vehiclesChecked} due={soFar.vehicles} color={C.blue} />
            <Count   label="Alerts"   value={soFar.alerts}      sub="normal alerts entered" />
            <Count   label="Fatigue"  value={soFar.fatigue}     sub="fatigue alerts entered" />
            <Count   label="All alerts" value={soFar.alertsTotal} color={C.amber} sub="normal + fatigue" />
          </div>
          <div style={{ borderTop:`1px solid ${C.border}`, marginTop:SP[4], paddingTop:SP[3] }}>
            <span className="eyebrow">Hour by hour · filled share</span>
            <HourStrip byHour={byHour} />
          </div>
        </Card>
      </Section>

      <Section
        title="Full day total"
        sub="The whole operating day, 7am through 6am — the size of the day, filling in as it is worked."
      >
        <Card style={{ background:SURF.sunken }}>
          <div style={GRID}>
            <Measure label="Clients"  done={fullDay.clientsDone}     due={fullDay.clients} />
            <Measure label="Vehicles" done={fullDay.vehiclesChecked} due={fullDay.vehicles} color={C.blue} />
            <Count   label="Alerts"   value={fullDay.alerts}  sub="normal alerts entered" />
            <Count   label="Fatigue"  value={fullDay.fatigue} sub="fatigue alerts entered" />
            <Count   label="All alerts" value={fullDay.alertsTotal} color={C.amber} sub="normal + fatigue" />
          </div>
        </Card>
      </Section>

      <Section
        title="Who sees what"
        sub="Named clients and custom-duty hours are left out of the ordinary share, so these are the clients each person will really be given."
      >
        <PerEmployee rows={perEmployee || []} onPick={onPickEmployee} />
      </Section>
    </>
  )
}
