// ══════════════════════════════════════════════════════════════════════
// Everybody's performance score, on the admin's dashboard
//
// The score existed only on the employee's own screen, so the one person
// whose job is to compare the floor could not see it anywhere. Each employee
// knew their number and nobody knew the shape.
//
// The figure here is not a second calculation of it — both screens call the
// same function (lib/score.js), so the number beside a name is exactly the
// number that person is looking at. Two copies of a scoring rule is how the
// floor stops trusting either.
//
// The working is shown on demand rather than in a tooltip, because the first
// question a score gets asked is "why", and the answer is three numbers.
// ══════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, Tag, EmptyState, T, R, SP, SURF } from '../ui'

const toneOf = (s) => (s >= 85 ? C.accent : s >= 70 ? C.amber : C.red)

export default function ScoresPanel({ scores = [] }) {
  const [open, setOpen] = useState(null)

  if (!scores.length) {
    return (
      <Card>
        <div className="eyebrow">Performance today</div>
        <EmptyState icon="chart" title="No scores yet." detail="Scores appear once the roster loads." />
      </Card>
    )
  }

  const avg = Math.round(scores.reduce((s, e) => s + e.score, 0) / scores.length)

  return (
    <Card pad={false} style={{ overflow:'hidden', marginBottom:SP[5] }}>
      <div style={{
        display:'flex', alignItems:'center', gap:SP[3],
        padding:'13px 15px', borderBottom:`1px solid ${C.border}`,
      }}>
        <span style={{ flex:1, minWidth:0 }}>
          <span className="eyebrow" style={{ display:'block' }}>Performance today</span>
          <span style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'3px' }}>
            footage 40% · vehicles seen 60% · −20 if break passes an hour
          </span>
        </span>
        <span style={{ textAlign:'right', flexShrink:0 }}>
          <span style={{ display:'block', color:toneOf(avg), fontSize:'24px', fontWeight:800, lineHeight:1 }}>{avg}</span>
          <span style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'3px' }}>floor average</span>
        </span>
      </div>

      {scores.map(e => {
        const isOpen = open === e.name
        const b = e.breakdown || {}
        return (
          <div key={e.name} style={{ borderBottom:`1px solid ${C.border}` }}>
            <button
              onClick={() => setOpen(isOpen ? null : e.name)}
              className="row-hover"
              style={{
                display:'flex', alignItems:'center', gap:SP[3], width:'100%',
                background:'transparent', border:'none', padding:'11px 15px', textAlign:'left',
              }}
            >
              <span className="ellip" style={{ width:'132px', flexShrink:0, color:C.text, fontSize:T.base, fontWeight:600 }}>
                {e.name}
              </span>
              <span style={{ flex:1, minWidth:0, height:'8px', borderRadius:'99px', background:C.border, overflow:'hidden' }}>
                <span style={{
                  display:'block', height:'100%', borderRadius:'99px',
                  background: toneOf(e.score), width: `${Math.max(2, e.score)}%`,
                }} />
              </span>
              <span style={{ color:toneOf(e.score), fontSize:T.base, fontWeight:800, width:'34px', textAlign:'right', flexShrink:0 }}>
                {e.score}
              </span>
              <Tag color={toneOf(e.score)}>{e.tier}</Tag>
              <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={C.muted} />
            </button>

            {isOpen && (
              <div style={{ background:SURF.sunken, padding:SP[3], borderTop:`1px solid ${C.border}` }}>
                <Line
                  label="Footage"
                  detail={b.footage?.total ? `${b.footage.mine} of ${b.footage.total} raised today · ${b.footage.sharePct}%`
                                           : 'no requests today — scored in full'}
                  points={b.footage?.points} out={40} />
                <Line
                  label="Vehicles seen"
                  detail={`${(b.vehicles?.seen || 0).toLocaleString()} of ${(b.vehicles?.target || 800).toLocaleString()} · ${b.vehicles?.pct}%`}
                  points={b.vehicles?.points} out={60} />
                <Line
                  label="Break"
                  detail={b.breakPenalty?.applied
                    ? `${b.breakPenalty.minutes}m away — past the ${b.breakPenalty.allowanceMinutes}m allowance`
                    : `${b.breakPenalty?.minutes || 0}m away — within the ${b.breakPenalty?.allowanceMinutes || 60}m allowance`}
                  points={b.breakPenalty?.points} out={null} />
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}

function Line({ label, detail, points, out }) {
  const neg = (points || 0) < 0
  return (
    <div style={{ display:'flex', alignItems:'center', gap:SP[3], padding:'7px 10px', borderRadius:R.sm }}>
      <span style={{ width:'112px', flexShrink:0, color:C.text2, fontSize:T.base, fontWeight:600 }}>{label}</span>
      <span className="ellip" style={{ flex:1, minWidth:0, color:C.muted, fontSize:T.xs }}>{detail}</span>
      <span style={{ color: neg ? C.red : C.text, fontSize:T.base, fontWeight:700, flexShrink:0 }}>
        {neg ? points : `${points ?? 0}${out ? ` / ${out}` : ''}`}
      </span>
    </div>
  )
}
