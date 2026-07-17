import { useState, useEffect } from 'react'
import Icon from './Icons'
import { C } from './Widgets'

function fmtMinutes(mins) {
  const h = Math.floor(mins/60), m = mins%60
  return h>0 ? `${h}h ${m}m` : `${m}m`
}

export default function BreakOverlay({ startTime, history, totalMinutesToday, onResume, resuming }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) return
    function parseToToday(timeStr) {
      const t = (timeStr || '').toString().trim()
      let m = t.match(/(\d+):(\d+):(\d+)\s*(am|pm)/i)
      if (m) {
        let [, h, mi, se, ampm] = m
        h = parseInt(h); mi = parseInt(mi); se = parseInt(se)
        if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
        if (ampm.toLowerCase() === 'am' && h === 12) h = 0
        const d = new Date(); d.setHours(h, mi, se, 0); return d
      }
      m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
      if (m) {
        const [, h, mi, se] = m
        const d = new Date(); d.setHours(parseInt(h), parseInt(mi), parseInt(se), 0); return d
      }
      return null
    }
    function tick() {
      const start = parseToToday(startTime)
      if (!start) return
      const diff = Math.max(0, Math.floor((Date.now()-start.getTime())/1000))
      setElapsed(diff)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startTime])

  const mm = String(Math.floor(elapsed/60)).padStart(2,'0')
  const ss = String(elapsed%60).padStart(2,'0')

  return (
    <div style={{ position:'fixed', inset:0, background:C.bg, zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
      <div style={{ maxWidth:'440px', width:'100%', textAlign:'center' }}>
        <div style={{ width:'72px', height:'72px', borderRadius:'50%', background:C.accentDark, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 20px' }}>
          <Icon name="clock" size={32} color={C.accent} />
        </div>
        <div style={{ color:C.text, fontSize:'20px', fontWeight:800, marginBottom:'6px' }}>You're on a break</div>
        <div style={{ color:C.muted, fontSize:'13px', marginBottom:'28px' }}>Take your time. Your dashboard will be here when you're back.</div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'16px', padding:'28px', marginBottom:'20px' }}>
          <div style={{ color:C.muted, fontSize:'10.5px', fontWeight:700, letterSpacing:'1px', marginBottom:'10px' }}>BREAK STARTED AT {startTime}</div>
          <div style={{ color:C.accent, fontSize:'44px', fontWeight:800, fontVariantNumeric:'tabular-nums' }}>{mm}:{ss}</div>
          <div style={{ color:C.muted, fontSize:'11px', marginTop:'4px' }}>elapsed</div>
        </div>

        <button onClick={onResume} disabled={resuming} style={{ width:'100%', background:C.accent, border:'none', borderRadius:'12px', color:'#06120a', fontSize:'15px', fontWeight:800, padding:'16px', cursor:'pointer', marginBottom:'20px' }}>
          {resuming ? 'Resuming...' : '▶ Resume Work'}
        </button>

        {history.length > 0 && (
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', textAlign:'left' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'10px' }}>
              <span style={{ color:C.accent, fontSize:'10.5px', fontWeight:700 }}>TODAY'S BREAKS</span>
              <span style={{ color:C.muted, fontSize:'10.5px' }}>Total: {fmtMinutes(totalMinutesToday)}</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              {history.map((h,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between', fontSize:'11px' }}>
                  <span style={{ color:C.text2 }}>{h.startTime} {h.endTime ? `→ ${h.endTime}` : '(ongoing)'}</span>
                  <span style={{ color: h.status==='Active'?C.accent:C.muted, fontWeight:600 }}>{fmtMinutes(h.minutes)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
