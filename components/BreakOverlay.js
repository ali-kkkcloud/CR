import { useState, useEffect } from 'react'
import Icon from './Icons'
import { C } from './Widgets'
import { Card, Button, Tag, T, SP, elapsedSecondsIST } from './ui'

function fmtMinutes(mins) {
  const h = Math.floor(mins/60), m = mins%60
  return h>0 ? `${h}h ${m}m` : `${m}m`
}

export default function BreakOverlay({ startTime, startDate, history, totalMinutesToday, onResume, resuming, isAuto, idleMinutes }) {
  const [elapsed, setElapsed] = useState(0)

  // Measured in IST on both ends. The old version built the start time with
  // the browser's own setHours and compared it against the browser's clock —
  // correct only on a machine already set to IST, and out by the whole offset
  // on any other, which turned a nineteen-minute break into nineteen hours.
  useEffect(() => {
    if (!startTime) return
    const tick = () => setElapsed(elapsedSecondsIST(startDate, startTime))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startTime, startDate])

  // Past an hour, mm:ss keeps counting the minutes up — "111:29" — which
  // nobody reads as an hour and fifty-one minutes. Roll into hours instead.
  const hrs = Math.floor(elapsed / 3600)
  const mm  = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
  const ss  = String(elapsed % 60).padStart(2, '0')
  const clock = hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`

  return (
    <div style={{
      position:'fixed', inset:0, background:C.bg, zIndex:2000,
      display:'flex', alignItems:'center', justifyContent:'center', padding:SP[5],
    }}>
      <div style={{ maxWidth:'440px', width:'100%' }} className="fade-in">
        <div style={{ textAlign:'center', marginBottom:SP[5] }}>
          <div style={{
            width:'66px', height:'66px', borderRadius:'50%',
            background: isAuto ? C.amber+'18' : C.accentDark,
            display:'flex', alignItems:'center', justifyContent:'center', margin:`0 auto ${SP[4]}`,
          }}>
            <Icon name="clock" size={29} color={isAuto ? C.amber : C.accent} />
          </div>
          <div style={{ color:C.text, fontSize:T.xl, fontWeight:800, letterSpacing:'-0.4px' }}>
            {isAuto ? 'Break started automatically' : 'You’re on a break'}
          </div>
          <div style={{ color:C.muted, fontSize:T.base, marginTop:'8px', lineHeight:1.65 }}>
            {isAuto
              ? `Nothing was recorded for ${idleMinutes || 10} minutes, so a break was started from the moment you stopped. Resume when you’re back at your desk.`
              : 'Take your time. Your board will be exactly where you left it.'}
          </div>
        </div>

        <Card style={{ textAlign:'center', padding:'30px 24px', marginBottom:SP[4] }}>
          <div className="eyebrow" style={{ marginBottom:'12px' }}>Started at {startTime}</div>
          <div style={{
            color: isAuto ? C.amber : C.accent,
            fontSize: hrs > 0 ? '40px' : '46px', fontWeight:800, lineHeight:1, letterSpacing:'-1.5px',
          }}>{clock}</div>
          <div style={{ color:C.muted, fontSize:T.sm, marginTop:'8px' }}>elapsed</div>
        </Card>

        <Button variant="primary" size="lg" full loading={resuming} onClick={onResume} style={{ marginBottom:SP[4] }}>
          ▶ Resume work
        </Button>

        {history.length > 0 && (
          <Card>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'11px' }}>
              <span className="eyebrow">Today’s breaks</span>
              <span style={{ color:C.text2, fontSize:T.xs, fontWeight:600 }}>Total {fmtMinutes(totalMinutesToday)}</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              {history.map((h,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:SP[2], fontSize:T.sm }}>
                  <span style={{ color:C.text2, display:'flex', alignItems:'center', gap:'7px', minWidth:0 }}>
                    <span className="ellip">{h.startTime} {h.endTime ? `→ ${h.endTime}` : '(ongoing)'}</span>
                    {h.isAuto && <Tag color={C.amber}>AUTO</Tag>}
                  </span>
                  <span style={{ color: h.status==='Active' ? C.accent : C.muted, fontWeight:700, flexShrink:0 }}>
                    {fmtMinutes(h.minutes)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}
