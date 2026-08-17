// ══════════════════════════════════════════════════════════════════════
// The rail beside the board: what else needs this operator today.
//
// Everything here used to be a separate destination — the Dashboard tab's
// headline numbers, the My Day tab's next-hour preview, the reminders. None
// of it is worth leaving the board for, and all of it is worth seeing while
// working. So it sits next to the work instead of replacing it.
//
// The deeper charts stay a click away behind "My stats", because they are
// something you read occasionally, not something you glance at.
// ══════════════════════════════════════════════════════════════════════
import Icon from './Icons'
import { C } from './Widgets'
import { Card, Button, Meter, Tag, T, R, SP, SURF, fmtHourSlot } from './ui'

function fmtMinutes(mins) {
  const h = Math.floor((mins || 0) / 60), m = (mins || 0) % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function TodayRail({
  summary, myDay, breakStatus, footage, currentHour,
  hourDone, hourTotal, onGoToTab, onOpenStats, isActive,
  // The next client still needing an update this hour, and the way to put it
  // in front of the operator. Both came from My Day's "Current task" panel.
  upNext, onFocusClient,
  // Every update saved today, newest first — My Day's "Recent activity".
  recent = [],
}) {
  const pct = hourTotal > 0 ? Math.round((hourDone / hourTotal) * 100) : 0
  const next = myDay?.timeline?.find(t => t.hour === (currentHour + 1) % 24)
  const today = summary?.today || {}

  // Two sources say how much of the day is done: the summary endpoint counts
  // it from the sheet, my-day counts it from the timeline it just built. They
  // agree, but only one of them is present early in a shift — so whichever
  // has numbers wins, rather than showing 0 / 0 while the other loads.
  const dayTotal = today.clientsAssigned  || myDay?.totalClients   || 0
  const dayDone  = today.clientsCompleted || myDay?.totalCompleted || 0
  const dayLeft  = Math.max(0, dayTotal - dayDone)
  const dayPct   = dayTotal > 0 ? Math.round((dayDone / dayTotal) * 100) : 0

  const alerts = []
  if (footage.pending.length > 0)
    alerts.push({ icon:'footage', color:C.red, label:`${footage.pending.length} footage request${footage.pending.length===1?'':'s'} open`, tab:'footage' })
  if (footage.followups.length > 0)
    alerts.push({ icon:'followups', color:C.amber, label:`${footage.followups.length} follow-up${footage.followups.length===1?'':'s'} waiting`, tab:'followup' })

  return (
    <aside
      className="today-rail"
      style={{ display:'flex', flexDirection:'column', gap:SP[3], minWidth:0 }}
    >
      {/* ── This hour ── */}
      <Card>
        <div className="eyebrow">This hour</div>
        <div style={{ color:C.text, fontSize:T.md, fontWeight:700, marginTop:'4px' }}>
          {fmtHourSlot(currentHour)}
        </div>
        <div style={{ display:'flex', alignItems:'baseline', gap:'7px', marginTop:'12px' }}>
          <span style={{ color:C.text, fontSize:'27px', fontWeight:800, lineHeight:1, letterSpacing:'-0.6px' }}>
            {hourDone}
          </span>
          <span style={{ color:C.muted, fontSize:T.base, fontWeight:600 }}>of {hourTotal} done</span>
        </div>
        <Meter value={pct} height={5} style={{ marginTop:'11px' }} />
        <div style={{ color: hourTotal - hourDone > 0 ? C.amber : C.accent, fontSize:T.xs, marginTop:'8px', fontWeight:600 }}>
          {hourTotal === 0 ? 'Nothing assigned this hour'
            : hourTotal - hourDone === 0 ? '✓ All caught up'
            : `${hourTotal - hourDone} still to go`}
        </div>
      </Card>

      {/* ── Up next ──
          My Day's "Current task": the one client to do now, and a button that
          puts it on the board. Only while there is still work in the hour —
          "all caught up" is already said by the card above. */}
      {upNext && (
        <Card>
          <div className="eyebrow">Up next</div>
          <div style={{ display:'flex', alignItems:'center', gap:SP[2], marginTop:'7px', flexWrap:'wrap' }}>
            <span className="ellip" style={{ color:C.text, fontSize:T.md, fontWeight:700, minWidth:0 }}>
              {upNext.client}
            </span>
            <Tag color={C.amber} dot>PENDING</Tag>
          </div>
          <div style={{ color:C.muted, fontSize:T.xs, marginTop:'3px' }}>
            {upNext.vehicleCount || 0} vehicles
          </div>
          <Button
            variant="primary" size="sm" full
            onClick={() => onFocusClient && onFocusClient(upNext.client)}
            style={{ marginTop:SP[3] }}
          >Open on the board →</Button>
        </Card>
      )}

      {/* ── Needs you ── */}
      {alerts.length > 0 && (
        <Card pad={false}>
          <div style={{ padding:`${SP[3]} ${SP[4]} ${SP[2]}` }}>
            <div className="eyebrow">Needs you</div>
          </div>
          {alerts.map((a, i) => (
            <button
              key={i}
              onClick={() => onGoToTab(a.tab)}
              className="row-hover"
              style={{
                display:'flex', alignItems:'center', gap:'10px', width:'100%',
                background:'transparent', border:'none',
                borderTop:`1px solid ${C.border}`, padding:'11px 16px', textAlign:'left',
              }}
            >
              <span style={{
                width:'26px', height:'26px', borderRadius:R.sm, flexShrink:0,
                background:a.color+'1a', display:'flex', alignItems:'center', justifyContent:'center',
              }}>
                <Icon name={a.icon} size={13} color={a.color} />
              </span>
              <span className="ellip" style={{ flex:1, color:a.color, fontSize:T.base, fontWeight:600 }}>
                {a.label}
              </span>
              <Icon name="arrow-right" size={13} color={C.dim} />
            </button>
          ))}
        </Card>
      )}

      {/* ── Next hour ── */}
      <Card>
        <div className="eyebrow">Next hour · {fmtHourSlot((currentHour + 1) % 24)}</div>
        {!next || (next.clients || []).length === 0 ? (
          <div style={{ color:C.muted, fontSize:T.base, marginTop:'9px' }}>Nothing scheduled yet.</div>
        ) : next.isCustom ? (
          <div style={{ color:C.text2, fontSize:T.base, marginTop:'9px' }}>{next.customText}</div>
        ) : (
          <>
            <div className="ellip" style={{ color:C.text, fontSize:T.md, fontWeight:700, marginTop:'8px' }}>
              {next.clients[0].client}
            </div>
            <div style={{ color:C.muted, fontSize:T.xs, marginTop:'3px' }}>
              {next.clients[0].vehicleCount || 0} vehicles
              {next.clients.length > 1 ? ` · +${next.clients.length - 1} more` : ''}
            </div>
            <div style={{ color:C.muted, fontSize:T.xs, marginTop:'10px', display:'flex', alignItems:'center', gap:'5px' }}>
              <Icon name="clock" size={12} color={C.muted} /> starts in {59 - new Date().getMinutes()} min
            </div>
          </>
        )}
      </Card>

      {/* ── Today ── */}
      <Card>
        <div className="eyebrow" style={{ marginBottom:'11px' }}>Today</div>

        {/* The three day-level numbers My Day carried under its donut. Total,
            done and what is still outstanding across the whole shift — not
            just this hour, which the top card already covers. */}
        <div style={{
          display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:SP[2],
          background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md,
          padding:'11px 8px', marginBottom:SP[3],
        }}>
          <DayFact value={dayTotal} label="TOTAL" color={C.text} />
          <DayFact value={dayDone}  label="DONE"  color={C.accent} />
          <DayFact value={dayLeft}  label="LEFT"  color={dayLeft > 0 ? C.amber : C.accent} />
        </div>

        <RailRow label="Clients" value={`${dayDone} / ${dayTotal}`} meter={dayPct} />
        <RailRow
          label="Attendance"
          value={summary?.attendanceStatus || '—'}
          valueColor={summary?.attendanceStatus === 'Late' ? C.amber : C.accent}
        />
        <RailRow
          label="On shift"
          value={isActive ? fmtMinutes(summary?.workingMinutes || 0) : '—'}
        />
        <RailRow
          label="Breaks"
          value={fmtMinutes(breakStatus?.totalMinutesToday || 0)}
          valueColor={breakStatus?.onBreak ? C.red : C.text2}
          sub={`${breakStatus?.history?.length || 0} session${(breakStatus?.history?.length || 0) === 1 ? '' : 's'}`}
        />

        <Button
          variant="subtle" size="sm" full onClick={onOpenStats}
          style={{ marginTop:SP[3] }}
        >My stats &amp; trend →</Button>
      </Card>

      {/* ── Recent activity ──
          The last updates saved today, newest first, straight from My Day.
          It is the only place an operator can see that a save actually
          landed and at what time, hours after the fact. */}
      <Card>
        <div className="eyebrow" style={{ marginBottom:'10px' }}>Recent activity</div>
        {recent.length === 0 ? (
          <div style={{ color:C.muted, fontSize:T.base }}>No updates saved yet today.</div>
        ) : (
          <div className="scroll-fade" style={{
            display:'flex', flexDirection:'column', gap:'8px',
            maxHeight:'168px', overflowY:'auto',
          }}>
            {recent.map((e, i) => (
              <div key={`${e.hour}|${e.client}|${i}`} style={{
                display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:SP[2],
              }}>
                <span className="ellip" style={{ color:C.text2, fontSize:T.xs, minWidth:0 }}>
                  {e.client}
                </span>
                <span style={{ color:C.muted, fontSize:'9.5px', flexShrink:0 }}>{e.time}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </aside>
  )
}

function DayFact({ value, label, color }) {
  return (
    <div style={{ textAlign:'center', minWidth:0 }}>
      <div style={{ color, fontSize:T.lg, fontWeight:800, lineHeight:1 }}>{value}</div>
      <div style={{ color:C.muted, fontSize:'9px', marginTop:'4px', letterSpacing:'0.4px' }}>{label}</div>
    </div>
  )
}

function RailRow({ label, value, valueColor, sub, meter }) {
  return (
    <div style={{ marginBottom:'11px' }}>
      <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:SP[2] }}>
        <span style={{ color:C.muted, fontSize:T.xs }}>{label}</span>
        <span className="ellip" style={{ color:valueColor || C.text, fontSize:T.base, fontWeight:700, textAlign:'right' }}>
          {value}
        </span>
      </div>
      {sub && <div style={{ color:C.dim, fontSize:'9.5px', textAlign:'right', marginTop:'1px' }}>{sub}</div>}
      {typeof meter === 'number' && <Meter value={meter} height={3} style={{ marginTop:'6px' }} />}
    </div>
  )
}
