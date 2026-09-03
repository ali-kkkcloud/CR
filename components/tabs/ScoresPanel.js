// ══════════════════════════════════════════════════════════════════════
// Everybody's performance score, as small cards
//
// The score existed only on the employee's own screen, so the one person
// whose job is to compare the floor could not see it anywhere. Each employee
// knew their number and nobody knew the shape.
//
// The figure is not a second calculation of it — both screens call the same
// function (lib/score.js), so the number on a card is exactly the number
// that person is looking at.
//
// Small on purpose: eighteen people have to fit above the fold, and the only
// thing worth reading at a glance is the name and the number. The working —
// footage share, vehicles seen, break penalty — opens on a click, because it
// is the answer to "why", which is a second question and not the first.
//
// The day runs 07:00 to 07:00, so at seven each morning the date rolls and
// every card starts again. Nothing resets it; it is simply a different day
// being asked about. The picker is here so the admin can ask about an
// earlier one.
// ══════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from 'react'
import { C } from '../Widgets'
import { Card, T, R, SP, SURF } from '../ui'
import { fetchJSON } from '../../lib/fetchJson'

const toneOf = (s) => (s >= 85 ? C.accent : s >= 70 ? C.amber : C.red)

// dd/mm/yyyy → yyyy-mm-dd for the date input, and back.
const toISO = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
const fromISO = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

export default function ScoresPanel({ scores = [], today = '' }) {
  const [date, setDate]   = useState('')          // '' = today, straight from the poll
  const [past, setPast]   = useState(null)
  const [loading, setLoad] = useState(false)
  const [open, setOpen]   = useState(null)

  // Only fetched when the admin actually moves the date. Today already
  // arrives with the rest of the dashboard, so it costs nothing.
  useEffect(() => {
    if (!date) { setPast(null); return }
    let cancelled = false
    setLoad(true)
    fetchJSON(`/api/admin/scores?date=${encodeURIComponent(date)}`)
      .then(r => { if (!cancelled && r.ok && Array.isArray(r.data?.scores)) setPast(r.data.scores) })
      .finally(() => { if (!cancelled) setLoad(false) })
    return () => { cancelled = true }
  }, [date])

  const rows = date ? (past || []) : scores
  const avg  = rows.length ? Math.round(rows.reduce((s, e) => s + e.score, 0) / rows.length) : 0

  const onPick = useCallback((e) => setDate(fromISO(e.target.value)), [])

  return (
    <Card pad={false} style={{ overflow:'hidden', marginBottom:SP[5] }}>
      <div style={{
        display:'flex', alignItems:'center', gap:SP[3], flexWrap:'wrap',
        padding:'10px 13px', borderBottom:`1px solid ${C.border}`,
      }}>
        <span className="eyebrow" style={{ flex:1, minWidth:'120px' }}>
          Performance {date ? date : 'today'}
        </span>
        <span style={{ color:toneOf(avg), fontSize:T.base, fontWeight:800 }}>{avg}</span>
        <span style={{ color:C.muted, fontSize:T.xs }}>avg</span>
        <input
          type="date"
          value={toISO(date || today)}
          max={toISO(today)}
          onChange={onPick}
          style={{
            background:SURF.sunken, color:C.text, border:`1px solid ${C.border}`,
            borderRadius:R.sm, padding:'3px 7px', fontSize:T.xs, colorScheme:'dark',
          }}
        />
        {date && (
          <button
            onClick={() => setDate('')}
            style={{ background:'transparent', border:'none', color:C.muted, fontSize:T.xs, cursor:'pointer' }}
          >
            today
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ padding:'14px', color:C.muted, fontSize:T.xs }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ padding:'14px', color:C.muted, fontSize:T.xs }}>Nothing recorded for this day.</div>
      ) : (
        <div style={{
          display:'grid', gap:'6px', padding:SP[3],
          gridTemplateColumns:'repeat(auto-fill, minmax(112px, 1fr))',
        }}>
          {rows.map(e => {
            const isOpen = open === e.name
            const tone = toneOf(e.score)
            return (
              <button
                key={e.name}
                onClick={() => setOpen(isOpen ? null : e.name)}
                title={`${e.name} · ${e.tier}`}
                style={{
                  textAlign:'left', cursor:'pointer',
                  background: isOpen ? SURF.sunken : 'transparent',
                  border:`1px solid ${isOpen ? tone + '66' : C.border}`,
                  borderRadius:R.sm, padding:'7px 8px',
                }}
              >
                <span className="ellip" style={{
                  display:'block', color:C.text2, fontSize:'10px', fontWeight:600,
                  textTransform:'uppercase', letterSpacing:'.04em',
                }}>
                  {e.name}
                </span>
                <span style={{ display:'flex', alignItems:'baseline', gap:'4px', marginTop:'2px' }}>
                  <span style={{ color:tone, fontSize:'19px', fontWeight:800, lineHeight:1 }}>{e.score}</span>
                </span>
                {/* A two-pixel rule instead of a bar: the colour and the
                    number already say it, this just makes the row scannable. */}
                <span style={{ display:'block', height:'2px', borderRadius:'99px', background:C.border, marginTop:'5px' }}>
                  <span style={{ display:'block', height:'100%', borderRadius:'99px', background:tone,
                                 width:`${Math.max(2, e.score)}%` }} />
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* The working, for whichever card is open. */}
      {open && rows.some(e => e.name === open) && (() => {
        const e = rows.find(x => x.name === open)
        const b = e.breakdown || {}
        return (
          <div style={{ background:SURF.sunken, padding:SP[3], borderTop:`1px solid ${C.border}` }}>
            <div style={{ color:C.text, fontSize:T.base, fontWeight:700, marginBottom:'6px' }}>
              {e.name} · {e.tier}
            </div>
            {/* Footage has no ceiling, so no "/ 40" — out={null} prints the
                points alone. */}
            <Line label="Footage"
                  detail={b.footage?.count
                    ? `${b.footage.count} raised · ${b.footage.perRequest ?? 5} each`
                    : 'none raised that day — nothing added, nothing taken off'}
                  points={b.footage?.points} out={null} />
            <Line label="Vehicles seen"
                  detail={`${(b.vehicles?.seen || 0).toLocaleString()} of ${(b.vehicles?.target || 800).toLocaleString()} · ${b.vehicles?.pct}%`}
                  points={b.vehicles?.points} out={b.vehicles?.weight ?? 70} />
            <Line label="Break"
                  detail={`${b.breakPenalty?.minutes || 0}m away · allowance ${b.breakPenalty?.allowanceMinutes || 60}m`}
                  points={b.breakPenalty?.points} out={null} />
            {/* The three lines added up. Without it the reader does the sum
                themselves, and the vehicles line carries two numbers — the
                points and the percentage of the target — so the wrong one gets
                added. 59.3% of seventy is 41.5, not 59.3. */}
            <div style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              gap:SP[3], marginTop:'6px', paddingTop:'7px', borderTop:`1px solid ${C.border}`,
            }}>
              <span style={{ color:C.text2, fontSize:T.xs, fontWeight:700 }}>
                {b.vehicles?.points ?? 0} + {b.footage?.points ?? 0}
                {(b.breakPenalty?.points ?? 0) < 0 ? ` − ${Math.abs(b.breakPenalty.points)}` : ' − 0'} =
              </span>
              <span style={{ color:toneOf(e.score), fontSize:T.md, fontWeight:800 }}>{e.score}</span>
            </div>
          </div>
        )
      })()}
    </Card>
  )
}

function Line({ label, detail, points, out }) {
  const neg = (points || 0) < 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:SP[3], padding:'5px 2px' }}>
      <span style={{ width:'104px', flexShrink:0, color:C.text2, fontSize:T.xs, fontWeight:600 }}>{label}</span>
      <span className="ellip" style={{ flex:1, minWidth:0, color:C.muted, fontSize:T.xs }}>{detail}</span>
      <span style={{ color: neg ? C.red : C.text, fontSize:T.xs, fontWeight:700, flexShrink:0 }}>
        {neg ? points : `${points ?? 0}${out ? ` / ${out}` : ''}`}
      </span>
    </div>
  )
}
