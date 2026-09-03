// ══════════════════════════════════════════════════════════════════════
// Reports — the Daily_Summary tab, read back
//
// The platform has been writing one row per employee per finished operating
// day into Daily_Summary since the rollup landed, and until now nothing read
// it. This is that record: pick a day, a week, a month or any stretch, and
// see what the sheet holds for it, per person, with the performance score for
// the SAME period rather than for today.
//
// ── Why the score moves with the picker ────────────────────────────────
//
// A score that always meant "today" while the table beside it meant "August"
// would be two answers to one question on one screen, which is the fault this
// platform keeps having to fix. So the period drives everything: change the
// range and the score is recomputed over exactly the days on screen. It is an
// average of the daily scores, because every part of the score is defined per
// day — see averageScore in lib/score.js.
// ══════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, CardHead, Button, Segmented, Tag, Stat, Table, Meter,
         EmptyState, Field, T, R, SP, SURF } from '../ui'
import { fetchJSON } from '../../lib/fetchJson'

const toneOf = (s) => (s == null ? C.muted : s >= 85 ? C.accent : s >= 70 ? C.amber : C.red)

// The sheets speak dd/mm/yyyy; <input type="date"> speaks yyyy-mm-dd.
const toISO = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
const fromISO = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

// Today as the OPERATING day, not the calendar day.
//
// The day runs 07:00 to 07:00, so between midnight and seven the report still
// belongs to yesterday's date — open it at 2am and a calendar "today" would
// show an empty report for a shift that is still running.
function operatingToday() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  if (d.getHours() < 7) d.setDate(d.getDate() - 1)
  return d
}
const isoOf = (d) => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// What each preset means, as a pair of ISO dates ending on the chosen day.
//
// Week is the Monday-to-Sunday week the chosen day falls in, and month is
// that whole calendar month — not "the last 7 days", which is a different
// question and would make two people looking at "this week" on different
// mornings see different weeks.
function rangeFor(preset, anchorISO) {
  const [y, m, d] = anchorISO.split('-').map(Number)
  const day = new Date(y, m - 1, d)
  if (preset === 'day') return [anchorISO, anchorISO]
  if (preset === 'week') {
    const back = (day.getDay() + 6) % 7          // Sunday steps back six, not none
    const start = new Date(day); start.setDate(start.getDate() - back)
    const end = new Date(start); end.setDate(end.getDate() + 6)
    return [isoOf(start), isoOf(end)]
  }
  if (preset === 'month') {
    return [isoOf(new Date(y, m - 1, 1)), isoOf(new Date(y, m, 0))]
  }
  return [anchorISO, anchorISO]
}

const hm = (mins) => {
  const v = Math.max(0, Math.round(mins || 0))
  return v >= 60 ? `${Math.floor(v / 60)}h ${v % 60}m` : `${v}m`
}
const num = (n) => (n || 0).toLocaleString()

export default function ReportsPanel() {
  const [preset, setPreset] = useState('day')
  const [anchor, setAnchor] = useState(() => isoOf(operatingToday()))
  const [customFrom, setCustomFrom] = useState(() => isoOf(operatingToday()))
  const [customTo, setCustomTo]     = useState(() => isoOf(operatingToday()))
  const [data, setData]   = useState(null)
  // Starts true. The first paint happens before the first fetch resolves, and
  // with this false the screen fell straight through to "nothing has been
  // summarised" for a moment — an empty answer shown before anything had been
  // asked.
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen]   = useState(null)      // which employee's days are showing

  const [fromISOd, toISOd] = useMemo(
    () => (preset === 'custom' ? [customFrom, customTo] : rangeFor(preset, anchor)),
    [preset, anchor, customFrom, customTo])

  // How the days are cut up for the trend underneath. A single day has
  // nothing to group, a week reads best day by day, and a month by week.
  const granularity = preset === 'month' ? 'week' : preset === 'custom' ? 'week' : 'day'

  // fetchJSON hands back a WRAPPER — { ok, status, data, failed } — and never
  // throws. The report itself is at `r.data`.
  //
  // Getting that wrong is what made this screen say "nothing has been
  // summarised" over a Daily_Summary tab with two hundred rows in it: the
  // wrapper was stored as though it were the report, so `data.hasData` read
  // undefined, and the try/catch never fired because there was no exception to
  // catch. The server was answering correctly the whole time. See
  // scripts/reports-check.mjs, which now pins this shape.
  const load = useCallback(async () => {
    const from = fromISO(fromISOd), to = fromISO(toISOd)
    if (!from || !to) return
    setLoading(true); setError('')
    const q = new URLSearchParams({ from, to, granularity })
    const r = await fetchJSON(`/api/admin/reports?${q}`)
    if (r.ok && r.data) {
      setData(r.data)
    } else {
      // A record of the past that cannot be read must say so plainly, rather
      // than showing an empty table that reads as "nobody did anything".
      setData(null)
      setError(r.failed ? `The server did not answer (${r.error}).`
             : r.data?.error ? r.data.error
             : `The server answered ${r.status}.`)
    }
    setLoading(false)
  }, [fromISOd, toISOd, granularity])

  useEffect(() => { load() }, [load])

  const people = data?.people || []
  const floor  = data?.floor
  const series = data?.series || []
  const maxBar = Math.max(1, ...series.map(s => s.vehiclesChecked || 0))

  const label = fromISOd === toISOd
    ? fromISO(fromISOd)
    : `${fromISO(fromISOd)} → ${fromISO(toISOd)}`

  // ── Download, so the report can leave the screen ────────────────────
  //
  // Built from what is already on screen rather than a second request, so the
  // file can never disagree with the table above it.
  const downloadCsv = () => {
    const head = ['Employee', 'Days', 'Clients assigned', 'Clients completed',
                  'Vehicles assigned', 'Vehicles checked', 'Footage', 'Alerts',
                  'Misaligns', 'Break minutes', 'Performance']
    const esc = (v) => {
      const s = (v ?? '').toString()
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [head.join(',')]
    people.forEach(p => lines.push([
      p.name, p.daysWorked, p.clientsAssigned, p.clientsCompleted,
      p.vehiclesAssigned, p.vehiclesChecked, p.footage, p.alerts,
      p.misaligns, p.breakMinutes, p.score ?? '',
    ].map(esc).join(',')))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `daily-summary_${fromISOd}_to_${toISOd}.csv`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a); URL.revokeObjectURL(a.href)
  }

  return (
    <div style={{ maxWidth:'1180px', margin:'0 auto' }}>

      {/* ══ The picker ══════════════════════════════════════════════ */}
      <Card style={{ marginBottom:SP[4] }}>
        <div style={{ display:'flex', alignItems:'flex-end', gap:SP[3], flexWrap:'wrap' }}>
          <Segmented
            value={preset}
            onChange={(v) => { setPreset(v); setOpen(null) }}
            options={[
              { value:'day',    label:'Day' },
              { value:'week',   label:'Week' },
              { value:'month',  label:'Month' },
              { value:'custom', label:'Custom' },
            ]}
          />

          {preset !== 'custom' ? (
            <Field
              label={preset === 'day' ? 'Date' : preset === 'week' ? 'Any day in the week' : 'Any day in the month'}
              style={{ minWidth:'170px' }}
            >
              <input type="date" value={anchor} max={isoOf(operatingToday())}
                     onChange={e => setAnchor(e.target.value)} />
            </Field>
          ) : (
            <>
              <Field label="From" style={{ minWidth:'150px' }}>
                <input type="date" value={customFrom} max={isoOf(operatingToday())}
                       onChange={e => setCustomFrom(e.target.value)} />
              </Field>
              <Field label="To" style={{ minWidth:'150px' }}>
                <input type="date" value={customTo} max={isoOf(operatingToday())}
                       onChange={e => setCustomTo(e.target.value)} />
              </Field>
            </>
          )}

          <div style={{ flex:1 }} />
          <Button variant="ghost" icon="download" onClick={downloadCsv}
                  disabled={!people.length}>CSV</Button>
        </div>

        <div style={{ color:C.muted, fontSize:T.xs, marginTop:SP[3] }}>
          Showing <strong style={{ color:C.text2 }}>{label}</strong> — the operating day, 7am to 7am.
          Performance is worked out over these days, so it moves with this picker.
        </div>
      </Card>

      {error ? (
        <Card pad={false}>
          <EmptyState icon="offline" tone="warn" title="The report could not be loaded"
                      detail={`${error} Nothing has been lost — Daily_Summary is written by the rollup and this screen only reads it.`}
                      action={<Button variant="primary" onClick={load}>Try again</Button>} />
        </Card>
      ) : loading && !data ? (
        <Card><div style={{ display:'flex', justifyContent:'center', padding:'2.5rem' }}><div className="spinner" /></div></Card>
      ) : !data?.hasData ? (
        <Card pad={false}>
          <EmptyState
            icon="reports"
            title="Nothing has been summarised for these days yet"
            detail="Daily_Summary holds a row per person per FINISHED operating day — a day still running is not in it. Pick an earlier date, or a wider range."
          />
        </Card>
      ) : (
        <>
          {/* ══ The period at a glance ═══════════════════════════════ */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:SP[3], marginBottom:SP[4] }}>
            <Stat icon="trend-up" label="Floor performance"
                  value={floor?.score ?? '—'}
                  sub={floor?.tier || 'no scored days'}
                  subColor={toneOf(floor?.score)} accent={toneOf(floor?.score)} />
            <Stat icon="users" label="People" value={floor?.people || 0}
                  sub={`${data.dates.length} day${data.dates.length === 1 ? '' : 's'} · ${floor?.entries || 0} rows`} />
            <Stat icon="check-circle" label="Clients completed"
                  value={num(floor?.clientsCompleted)}
                  sub={`of ${num(floor?.clientsAssigned)} assigned`} />
            <Stat icon="camera" label="Vehicles checked" value={num(floor?.vehiclesChecked)}
                  sub={`of ${num(floor?.vehiclesAssigned)} on the boards`} />
            <Stat icon="footage" label="Footage raised" value={num(floor?.footage)}
                  sub={`worth ${num((floor?.footage || 0) * 5)} points across the floor`} />
          </div>

          {/* ══ The trend across the period ══════════════════════════ */}
          {series.length > 1 && (
            <Card style={{ marginBottom:SP[4] }}>
              <CardHead title={granularity === 'week' ? 'Week by week' : 'Day by day'}
                        sub="Vehicles checked, with the score for each" />
              <div style={{ display:'flex', flexDirection:'column', gap:'9px', marginTop:SP[3] }}>
                {series.map(s => (
                  <div key={s.key} style={{ display:'flex', alignItems:'center', gap:SP[3] }}>
                    <span className="ellip" style={{ width:'132px', flexShrink:0, color:C.text2, fontSize:T.xs, fontWeight:600 }}>
                      {s.label}
                    </span>
                    <span style={{ flex:1, minWidth:0 }}>
                      <Meter value={Math.round((s.vehiclesChecked / maxBar) * 100)} color={toneOf(s.score)} height={6} />
                    </span>
                    <span style={{ width:'86px', flexShrink:0, textAlign:'right', color:C.muted, fontSize:T.xs }}>
                      {num(s.vehiclesChecked)}
                    </span>
                    <span style={{ width:'34px', flexShrink:0, textAlign:'right', color:toneOf(s.score), fontSize:T.base, fontWeight:800 }}>
                      {s.score ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ══ Per employee ═════════════════════════════════════════ */}
          <Card pad={false}>
            <div style={{ padding:SP[4], paddingBottom:0 }}>
              <CardHead title="Per employee"
                        sub="Straight from Daily_Summary. Click a row for the days behind it." />
            </div>
            <Table
              cols={[
                { key:'name', label:'Employee', render: p => (
                  <span style={{ display:'flex', alignItems:'center', gap:SP[2] }}>
                    <span style={{ color:C.text, fontWeight:700 }}>{p.name}</span>
                    {!p.onRoster && <Tag color={C.muted}>left</Tag>}
                    <Icon name="chevron-down" size={11} color={C.dim}
                          style={{ transform: open === p.name ? 'rotate(180deg)' : 'none' }} />
                  </span>
                )},
                { key:'daysWorked', label:'Days', align:'right' },
                { key:'clients', label:'Clients', align:'right', render: p => (
                  <span>{num(p.clientsCompleted)}<span style={{ color:C.dim }}> / {num(p.clientsAssigned)}</span></span>
                )},
                { key:'vehiclesChecked', label:'Vehicles seen', align:'right', render: p => (
                  <span>{num(p.vehiclesChecked)}<span style={{ color:C.dim }}> / {num(p.vehiclesAssigned)}</span></span>
                )},
                { key:'footage', label:'Footage', align:'right', render: p => num(p.footage) },
                { key:'alerts', label:'Alerts', align:'right', render: p => num(p.alerts) },
                { key:'breakMinutes', label:'Break', align:'right', render: p => hm(p.breakMinutes) },
                { key:'score', label:'Performance', align:'right', render: p => (
                  <span style={{ color:toneOf(p.score), fontWeight:800, fontSize:T.md }}>{p.score ?? '—'}</span>
                )},
              ]}
              rows={people}
              rowKey={p => p.name}
              onRowClick={p => setOpen(open === p.name ? null : p.name)}
            />

            {/* The working for whoever is open. */}
            {open && people.some(p => p.name === open) && (() => {
              const p = people.find(x => x.name === open)
              const b = p.scoreBreakdown || {}
              return (
                <div style={{ background:SURF.sunken, borderTop:`1px solid ${C.border}`, padding:SP[4] }}>
                  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:SP[3], marginBottom:SP[3], flexWrap:'wrap' }}>
                    <span style={{ color:C.text, fontSize:T.md, fontWeight:700 }}>
                      {p.name} · {p.tier || 'no scored days'}
                    </span>
                    <span style={{ color:C.muted, fontSize:T.xs }}>
                      Averaged over the {p.daysWorked} day{p.daysWorked === 1 ? '' : 's'} they worked in this period —
                      a day off is not counted as a zero.
                    </span>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(190px, 1fr))', gap:SP[3], marginBottom:SP[4] }}>
                    <Working label="Footage"
                             detail={`${num(b.footage?.count)} raised in the period · ${b.footage?.perRequest ?? 5} points each`}
                             value={`${b.footage?.points ?? 0} a day`} />
                    <Working label="Vehicles seen"
                             detail={`${num(b.vehicles?.seen)} against ${num(b.vehicles?.target)} a day · ${b.vehicles?.pct ?? 0}%`}
                             value={`${b.vehicles?.points ?? 0} of ${b.vehicles?.weight ?? 70}`} />
                    <Working label="Break"
                             detail={b.breakPenalty?.daysApplied
                               ? `past the hour on ${b.breakPenalty.daysApplied} day${b.breakPenalty.daysApplied === 1 ? '' : 's'} · ${hm(b.breakPenalty.minutes)} in total`
                               : `${hm(b.breakPenalty?.minutes)} in total, never past the hour in a day`}
                             value={`${b.breakPenalty?.points ?? 0} a day`}
                             tone={b.breakPenalty?.daysApplied ? C.red : C.muted} />
                  </div>

                  {/* ── The sum, written out ──────────────────────────────
                      Three cards each showing a figure, and no line adding
                      them up, left the reader to do it — and the vehicles card
                      carries TWO numbers, the points and the percentage of the
                      target. Reading the percentage as the points is the
                      obvious mistake and it was made: 59.3 + 5 − 20 = 44.3,
                      when 59.3% of the seventy points on offer is 41.5 and the
                      answer is 26. The employee's own screen has always shown
                      this line; this one did not. */}
                  {p.score != null && (
                    <div style={{
                      display:'flex', alignItems:'center', justifyContent:'space-between',
                      gap:SP[3], flexWrap:'wrap',
                      background:C.bg, border:`1px solid ${C.border}`, borderRadius:R.md,
                      padding:`${SP[3]} ${SP[4]}`, marginBottom:SP[4],
                    }}>
                      <span style={{ color:C.text2, fontSize:T.md, fontWeight:700 }}>
                        {b.vehicles?.points ?? 0}
                        <span style={{ color:C.dim, fontWeight:600 }}> vehicles </span>
                        + {b.footage?.points ?? 0}
                        <span style={{ color:C.dim, fontWeight:600 }}> footage </span>
                        {(b.breakPenalty?.points ?? 0) < 0
                          ? <>− {Math.abs(b.breakPenalty.points)}<span style={{ color:C.dim, fontWeight:600 }}> break </span></>
                          : <><span style={{ color:C.dim, fontWeight:600 }}>− 0 break </span></>}
                        =
                      </span>
                      <span style={{ display:'flex', alignItems:'baseline', gap:SP[2] }}>
                        <span style={{ color:toneOf(p.score), fontSize:T.xl, fontWeight:800 }}>{p.score}</span>
                        <span style={{ color:C.dim, fontSize:T.xs }}>out of 100</span>
                      </span>
                    </div>
                  )}

                  <Table
                    dense
                    cols={[
                      { key:'date', label:'Day' },
                      { key:'shift', label:'Shift', render: d => d.shiftStart ? `${d.shiftStart} → ${d.shiftEnd || '—'}` : '—' },
                      { key:'clients', label:'Clients', align:'right', render: d => (
                        <span>{num(d.clientsCompleted)}<span style={{ color:C.dim }}> / {num(d.clientsAssigned)}</span></span>
                      )},
                      { key:'vehiclesChecked', label:'Vehicles', align:'right', render: d => (
                        <span>{num(d.vehiclesChecked)}<span style={{ color:C.dim }}> / {num(d.vehiclesAssigned)}</span></span>
                      )},
                      { key:'footage', label:'Footage', align:'right', render: d => num(d.footage) },
                      { key:'alerts', label:'Alerts', align:'right', render: d => num(d.alerts) },
                      { key:'misaligns', label:'Misaligns', align:'right', render: d => num(d.misaligns) },
                      { key:'breakMinutes', label:'Break', align:'right', render: d => hm(d.breakMinutes) },
                    ]}
                    rows={p.days}
                    rowKey={d => d.date}
                  />
                </div>
              )
            })()}
          </Card>
        </>
      )}
    </div>
  )
}

function Working({ label, detail, value, tone = C.accent }) {
  return (
    <div style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:R.md, padding:SP[3] }}>
      <div style={{ color:C.muted, fontSize:T.xs, fontWeight:700, letterSpacing:'0.4px', textTransform:'uppercase' }}>{label}</div>
      <div style={{ color:tone, fontSize:T.lg, fontWeight:800, marginTop:'4px' }}>{value}</div>
      <div style={{ color:C.dim, fontSize:T.xs, marginTop:'3px' }}>{detail}</div>
    </div>
  )
}
