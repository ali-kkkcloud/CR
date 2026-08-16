// ══════════════════════════════════════════════════════════════════════
// The shift, hour by hour, as one strip.
//
// This replaces the "My Day" tab. An operator's whole job is a sequence of
// hours, so the sequence belongs on the working screen — not behind a
// navigation item they have to leave the board to reach. Every hour of the
// shift is here with how much of it is done, and clicking one loads that
// hour's board in place.
// ══════════════════════════════════════════════════════════════════════
import { useRef, useEffect } from 'react'
import Icon from './Icons'
import { C } from './Widgets'
import { T, R, SP, SURF } from './ui'

function label(h) {
  const to12 = n => (n === 0 ? 12 : n > 12 ? n - 12 : n)
  return `${to12(h)}${h >= 12 ? 'PM' : 'AM'}`
}

export default function HourRail({ timeline, currentHour, value, onChange, liveCounts }) {
  const ref = useRef(null)

  // Keep the selected hour in view. A night shift is nine or more hours
  // wide and the current one is often past the right edge on first paint.
  useEffect(() => {
    const el = ref.current?.querySelector('[data-on="1"]')
    if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [value, timeline])

  if (!timeline || timeline.length === 0) return null

  return (
    <div style={{
      display:'flex', alignItems:'center', gap:SP[2],
      background:SURF.raised, border:`1px solid ${C.border}`, borderRadius:R.lg,
      padding:'8px 10px',
    }}>
      <span className="eyebrow" style={{ flexShrink:0, paddingLeft:'4px' }}>Shift</span>
      <div
        ref={ref}
        style={{ display:'flex', gap:'6px', overflowX:'auto', flex:1, minWidth:0, paddingBottom:'2px' }}
      >
        {timeline.map(t => {
          const on      = t.hour === value
          const isNow   = t.hour === currentHour
          // The hour in progress is recomputed live on the board itself, so
          // its counts come from there rather than from the timeline's
          // snapshot, which can be a poll behind.
          const total   = isNow && liveCounts ? liveCounts.total : (t.totalClients || 0)
          const done    = isNow && liveCounts ? liveCounts.done  : (t.completedClients || 0)
          const pct     = total > 0 ? Math.round((done / total) * 100) : 0
          const complete = total > 0 && done === total
          const missed  = (t.missedClients || 0) > 0

          const edge = on ? C.accent
            : complete ? C.accent + '55'
            : missed ? C.red + '55'
            : C.border2

          return (
            <button
              key={t.hour}
              data-on={on ? '1' : '0'}
              onClick={() => onChange(t.hour)}
              title={t.isOnLeave ? 'On leave' : t.isCustom ? t.customText : `${done} of ${total} done`}
              className="pressable"
              style={{
                flexShrink:0, minWidth:'74px',
                background: on ? C.accentSoft : SURF.sunken,
                border:`1px solid ${edge}`, borderRadius:R.md,
                padding:'7px 9px', textAlign:'left',
              }}
            >
              <span style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                <span style={{
                  color: on ? C.accent : isNow ? C.text : C.text2,
                  fontSize:T.sm, fontWeight: on || isNow ? 800 : 600,
                }}>{label(t.hour)}</span>
                {isNow && <span className="live-dot" style={{ width:'5px', height:'5px' }} />}
              </span>

              <span style={{
                display:'block', color: on ? C.accent : C.muted,
                fontSize:'9.5px', marginTop:'3px', whiteSpace:'nowrap',
              }}>
                {t.isOnLeave ? 'Leave' : t.isCustom ? 'Other duty' : total === 0 ? '—' : `${done}/${total}`}
              </span>

              {/* A bar rather than a number, so a whole shift reads at a glance. */}
              <span style={{
                display:'block', height:'3px', marginTop:'5px',
                background:'#ffffff12', borderRadius:R.full, overflow:'hidden',
              }}>
                <span style={{
                  display:'block', height:'100%', width:`${pct}%`,
                  background: complete ? C.accent : missed ? C.red : C.accent,
                  borderRadius:R.full, transition:'width var(--slow)',
                }} />
              </span>
            </button>
          )
        })}
      </div>

      {value !== currentHour && (
        <button
          onClick={() => onChange(currentHour)}
          className="pressable"
          style={{
            flexShrink:0, display:'flex', alignItems:'center', gap:'5px',
            background:C.accentSoft, border:`1px solid ${C.accent}44`, borderRadius:R.md,
            color:C.accent, fontSize:T.sm, fontWeight:700, padding:'7px 11px',
          }}
        >
          <Icon name="clock" size={13} color={C.accent} /> Now
        </button>
      )}
    </div>
  )
}
