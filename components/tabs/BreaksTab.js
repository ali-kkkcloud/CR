import { useState } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, CardHead, Button, Segmented, Tag, EmptyState, Stat, Meter, T, R, SP, SURF } from '../ui'
import { liveBreakMinutes } from '../../lib/breakclock'

// Lives in lib/breakclock.js so it can be tested without a browser, and so
// every screen showing this figure reads the same one. Re-exported here
// because that is where the rest of the platform already imports it from.
export { liveBreakMinutes }

function hm(mins) {
  const m = Math.max(0, mins || 0)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export default function BreaksTab({
  breaks, liveTick, range, setRange, from, to, setFrom, setTo,
}) {
  const [expanded, setExpanded] = useState(null)

  const employees = breaks?.employees || []
  const onNow     = employees.filter(e => e.currentlyOnBreak)
  const totalMins = employees.reduce((s, e) => s + liveBreakMinutes(e, breaks?.asOf), 0)
  const sessions  = employees.reduce((s, e) => s + (e.sessions || 0), 0)
  const longest   = employees.reduce((m, e) => Math.max(m, liveBreakMinutes(e, breaks?.asOf)), 0)

  // Sorted by time taken, so whoever needs looking at is at the top rather
  // than wherever the sheet happened to list them.
  const sorted = [...employees].sort((a, b) => {
    if (a.currentlyOnBreak !== b.currentlyOnBreak) return a.currentlyOnBreak ? -1 : 1
    return liveBreakMinutes(b, breaks?.asOf) - liveBreakMinutes(a, breaks?.asOf)
  })

  return (
    <>
      {/* Range picker */}
      <Card style={{ marginBottom:SP[4] }}>
        <div style={{ display:'flex', alignItems:'center', gap:SP[3], flexWrap:'wrap' }}>
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value:'today',  label:'Today' },
              { value:'all',    label:'All time' },
              { value:'custom', label:'Custom' },
            ]}
          />
          {range === 'custom' && (
            <div style={{ display:'flex', alignItems:'center', gap:SP[2], flexWrap:'wrap' }}>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width:'auto' }} />
              <span style={{ color:C.muted, fontSize:T.base }}>to</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width:'auto' }} />
            </div>
          )}
          <div style={{ flex:1 }} />
          {onNow.length > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
              <span className="live-dot" style={{ background:C.red }} />
              <span style={{ color:C.red, fontSize:T.base, fontWeight:700 }}>
                {onNow.length} on break right now
              </span>
            </div>
          )}
        </div>
      </Card>

      {!breaks ? (
        <Card><div style={{ display:'flex', justifyContent:'center', padding:'2.5rem' }}><div className="spinner" /></div></Card>
      ) : employees.length === 0 ? (
        <Card pad={false}>
          <EmptyState icon="clock" title="No breaks recorded in this range." detail="Breaks appear here the moment somebody takes one, or is put on one automatically after ten idle minutes." />
        </Card>
      ) : (
        <>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:SP[3], marginBottom:SP[4] }}>
            <Stat icon="clock"        label="On break now"    value={onNow.length} sub={onNow.length ? onNow.map(e => e.name).join(', ') : 'Nobody is away'} subColor={onNow.length ? C.red : C.muted} accent={onNow.length ? C.red : C.accent} />
            <Stat icon="users"        label="People with breaks" value={employees.length} sub={`${sessions} session${sessions === 1 ? '' : 's'} in range`} />
            <Stat icon="trend-up"     label="Total break time"   value={hm(totalMins)} sub="Across everyone in range" />
            <Stat icon="alerts"       label="Longest"             value={hm(longest)} sub="Single employee, total" subColor={longest > 90 ? C.amber : C.muted} accent={longest > 90 ? C.amber : C.accent} />
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(280px, 1fr))', gap:SP[3], alignItems:'start' }}>
            {sorted.map(e => {
              const open  = expanded === e.name
              const mine  = (breaks.sessions || []).filter(s => s.name === e.name)
              const mins  = liveBreakMinutes(e, breaks?.asOf)
              const share = longest > 0 ? Math.round((mins / longest) * 100) : 0
              return (
                <Card
                  key={e.name}
                  pad={false}
                  style={{ borderColor: e.currentlyOnBreak ? C.red + '55' : C.border, overflow:'hidden' }}
                >
                  <button
                    onClick={() => setExpanded(open ? null : e.name)}
                    className="row-hover"
                    style={{ display:'block', width:'100%', background:'transparent', border:'none', textAlign:'left', padding:SP[4] }}
                  >
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:SP[2], marginBottom:'10px' }}>
                      <span className="ellip" style={{ color:C.text, fontSize:T.md, fontWeight:700 }}>{e.name}</span>
                      {e.currentlyOnBreak
                        ? <Tag color={C.red} dot>ON BREAK</Tag>
                        : <Tag color={C.muted}>{e.sessions} session{e.sessions !== 1 ? 's' : ''}</Tag>}
                    </div>
                    <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:SP[2] }}>
                      {/* Re-keyed every tick so the running total actually moves. */}
                      <span key={liveTick} style={{ color: e.currentlyOnBreak ? C.red : C.accent, fontSize:'23px', fontWeight:800, letterSpacing:'-0.5px' }}>
                        {hm(mins)}
                      </span>
                      <span style={{ display:'flex', transform: open ? 'rotate(180deg)' : 'none', transition:'transform var(--fast)' }}>
                        <Icon name="chevron-down" size={14} color={C.muted} />
                      </span>
                    </div>
                    <Meter value={share} color={e.currentlyOnBreak ? C.red : C.accent} style={{ marginTop:'10px' }} />
                    {e.currentlyOnBreak && (
                      <div style={{ color:C.muted, fontSize:T.xs, marginTop:'8px' }}>Since {e.activeSince}</div>
                    )}
                  </button>

                  {open && (
                    <div style={{ borderTop:`1px solid ${C.border}`, padding:SP[3], display:'flex', flexDirection:'column', gap:'6px', background:SURF.sunken }}>
                      {mine.length === 0 ? (
                        <div style={{ color:C.muted, fontSize:T.sm, padding:'6px 2px' }}>No individual sessions recorded.</div>
                      ) : mine.map((sess, i) => (
                        <div key={i} style={{ background:C.bg, borderRadius:R.sm, padding:'8px 10px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', gap:SP[2] }}>
                            <span style={{ color:C.text2, fontSize:T.xs }}>{sess.date}</span>
                            <span style={{ color: sess.status === 'Active' ? C.red : C.accent, fontSize:T.xs, fontWeight:700 }}>
                              {sess.minutes}m
                            </span>
                          </div>
                          <div style={{ display:'flex', justifyContent:'space-between', gap:SP[2], color:C.muted, fontSize:T.xs, marginTop:'3px' }}>
                            <span>{sess.startTime} → {sess.endTime || (sess.status === 'Active' ? 'ongoing' : '—')}</span>
                            {sess.isAuto && <span style={{ color:C.amber }}>auto</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
