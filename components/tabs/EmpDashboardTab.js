import { useState } from 'react'
import Icon from '../Icons'
import { C, Donut, KpiCard, LineChart, ScoreBadge } from '../Widgets'

function fmtMinutes(mins) {
  const h = Math.floor(mins/60), m = mins%60
  return h>0 ? `${h}h ${m}m` : `${m}m`
}

const CAL_COLORS = {
  good: C.accent, average: C.amber, poor: C.red, leave: C.purple, weekoff: C.dim, upcoming: '#2a2a2a',
}
const CAL_LABELS = {
  good: 'Good (100%+)', average: 'Average (70-99%)', poor: 'Poor (<70%)', leave: 'Leave', weekoff: 'Week Off',
}

export default function EmpDashboardTab({ summary, range, setRange, loading, onGoToTab, breakStatus }) {
  if (loading || !summary) return <div style={{display:'flex',justifyContent:'center',padding:'4rem'}}><div className="spinner"></div></div>

  const {
    performanceScore, performanceTier, clientsAssigned, vehiclesCovered,
    updatesCompleted, updatesMissed, footageTaken, footagePending,
    followupsClosed, followupsPending, trend, calendar, topClients, recentActivity,
  } = summary

  const completionPct = (updatesCompleted+updatesMissed)>0 ? Math.round((updatesCompleted/(updatesCompleted+updatesMissed))*100) : 100

  const notifications = []
  if (footagePending>0) notifications.push({ icon:'footage', color:C.red, title:'Footage Pending', desc:`${footagePending} footage request(s) awaiting upload`, tab:'footage' })
  if (followupsPending>0) notifications.push({ icon:'followups', color:C.amber, title:'Follow-up Pending', desc:`${followupsPending} follow-up(s) need attention`, tab:'followup' })
  if (updatesMissed>0) notifications.push({ icon:'clock', color:C.amber, title:'Missed Updates', desc:`${updatesMissed} update(s) missed this period`, tab:'myday' })

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:'12px' }}>
        <div style={{ display:'flex', gap:'4px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'4px' }}>
          {[['today','Today'],['week','Weekly'],['month','Monthly'],['year','Yearly']].map(([k,l]) => (
            <button key={k} onClick={()=>setRange(k)} style={{
              background: range===k?C.accentDark:'transparent', border:'none', borderRadius:'6px', color: range===k?C.accent:C.muted,
              fontSize:'11px', fontWeight:600, padding:'6px 12px', cursor:'pointer',
            }}>{l}</button>
          ))}
        </div>
      </div>

      {/* Performance hero row */}
      <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr 1fr 1fr 1fr', gap:'12px', marginBottom:'14px' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'18px', display:'flex', alignItems:'center', gap:'16px' }}>
          <Donut segments={[{value:performanceScore,color:C.accent},{value:100-performanceScore,color:C.border2}]} size={90} thickness={11} centerLabel={`${performanceScore}%`} />
          <div>
            <div style={{ color:C.text, fontSize:'13px', fontWeight:700 }}>Performance Score</div>
            <div style={{ marginTop:'6px' }}><ScoreBadge score={performanceScore} /></div>
            <div style={{ color:C.muted, fontSize:'10.5px', marginTop:'6px' }}>{performanceTier} this period</div>
          </div>
        </div>

        <div onClick={()=>onGoToTab('myday')} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', display:'flex', flexDirection:'column', alignItems:'center', cursor:'pointer' }}>
          <div style={{ color:C.muted, fontSize:'10px', fontWeight:700, marginBottom:'8px' }}>TODAY'S PROGRESS</div>
          <Donut segments={[{value:completionPct,color:C.accent},{value:100-completionPct,color:C.border2}]} size={72} thickness={9} centerLabel={`${completionPct}%`} />
        </div>

        <MiniStatusCard icon="check-circle" label="Attendance" value={summary.attendanceStatus||'—'} sub={summary.loginTime||''} color={summary.attendanceStatus==='Late'?C.amber:C.accent} />
        <MiniStatusCard icon="overview" label="Shift Status" value={breakStatus?.onBreak?'On Break':'Active'} sub={breakStatus?.onBreak?'':`${fmtMinutes(summary.workingMinutes||0)} worked`} color={breakStatus?.onBreak?C.amber:C.accent} />
        <MiniStatusCard icon="clock" label="Break Status" value={breakStatus?.onBreak?'On Break':'Available'} sub={`${fmtMinutes(breakStatus?.totalMinutesToday||0)} today`} color={breakStatus?.onBreak?C.red:C.accent} />
      </div>

      {/* Trend + calendar + notifications */}
      <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1.1fr 1fr', gap:'12px', marginBottom:'14px' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
            <div style={{ color:C.accent, fontSize:'11px', fontWeight:700 }}>UPDATES TREND (Completed vs Missed)</div>
          </div>
          <div style={{ display:'flex', gap:'16px', marginBottom:'8px' }}>
            <div><span style={{color:C.accent,fontSize:'18px',fontWeight:800}}>{updatesCompleted}</span> <span style={{color:C.muted,fontSize:'10px'}}>COMPLETED</span></div>
            <div><span style={{color:C.red,fontSize:'18px',fontWeight:800}}>{updatesMissed}</span> <span style={{color:C.muted,fontSize:'10px'}}>MISSED</span></div>
          </div>
          <LineChart series={[{name:'Completed',color:C.accent,data:trend.completed},{name:'Missed',color:C.red,data:trend.missed}]} labels={trend.labels} height={180} />
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'11px', fontWeight:700, marginBottom:'10px' }}>MONTHLY CALENDAR</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'4px', marginBottom:'10px' }}>
            {calendar.map(d => (
              <div key={d.date} title={`${d.date} — ${CAL_LABELS[d.status]||d.status} (${d.completed}/${d.total})`} style={{
                aspectRatio:'1', borderRadius:'6px', background: CAL_COLORS[d.status]+'22', border:`1px solid ${CAL_COLORS[d.status]}55`,
                display:'flex', alignItems:'center', justifyContent:'center', color:CAL_COLORS[d.status], fontSize:'10px', fontWeight:600,
              }}>{d.day}</div>
            ))}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
            {Object.entries(CAL_LABELS).map(([k,l]) => (
              <div key={k} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                <span style={{width:7,height:7,borderRadius:'2px',background:CAL_COLORS[k]}}></span>
                <span style={{color:C.muted,fontSize:'9.5px'}}>{l}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'11px', fontWeight:700, marginBottom:'10px' }}>NOTIFICATIONS</div>
          {notifications.length===0 ? (
            <div style={{ color:C.muted, fontSize:'11px', padding:'10px 0' }}>All clear — no action needed.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
              {notifications.map((n,i) => (
                <div key={i} onClick={()=>onGoToTab(n.tab)} style={{ display:'flex', gap:'8px', cursor:'pointer' }}>
                  <div style={{ width:'26px', height:'26px', borderRadius:'8px', background:n.color+'1a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <Icon name={n.icon} size={13} color={n.color} />
                  </div>
                  <div>
                    <div style={{ color:n.color, fontSize:'11px', fontWeight:700 }}>{n.title}</div>
                    <div style={{ color:C.muted, fontSize:'10px' }}>{n.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* My Targets */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', marginBottom:'14px' }}>
        <div style={{ color:C.accent, fontSize:'11px', fontWeight:700, marginBottom:'4px' }}>MY TARGETS</div>
        <div style={{ color:C.muted, fontSize:'10px', marginBottom:'12px' }}>Based on what's assigned to you this period vs. what's completed</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:'10px' }}>
          {[
            { label:'Clients Assigned', done: clientsAssigned, target: clientsAssigned },
            { label:'Vehicles Covered', done: vehiclesCovered, target: vehiclesCovered },
            { label:'CRM Updates', done: updatesCompleted, target: updatesCompleted+updatesMissed },
            { label:'Footage Completed', done: footageTaken, target: footageTaken+footagePending },
            { label:'Follow-ups Closed', done: followupsClosed, target: followupsClosed+followupsPending },
          ].map(t => {
            const pct = t.target>0 ? Math.round((t.done/t.target)*100) : 100
            return (
              <div key={t.label} style={{ background:C.s2, borderRadius:'10px', padding:'12px' }}>
                <div style={{ color:C.text2, fontSize:'10.5px', marginBottom:'6px' }}>{t.label}</div>
                <div style={{ color:C.text, fontSize:'15px', fontWeight:800, marginBottom:'6px' }}>{t.done} / {t.target}</div>
                <div style={{ height:'5px', background:C.border2, borderRadius:'3px', overflow:'hidden' }}>
                  <div style={{ height:'100%', width:`${Math.min(100,pct)}%`, background: pct>=100?C.accent:pct>=70?C.amber:C.red, borderRadius:'3px' }}></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footage / Followup / Top clients / recent activity */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1.2fr 1.2fr', gap:'12px' }}>
        <div onClick={()=>onGoToTab('footage')} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', cursor:'pointer' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>FOOTAGE OVERVIEW</div>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:'10px' }}>
            <Donut segments={[{label:'Uploaded',value:footageTaken,color:C.accent},{label:'Pending',value:footagePending,color:C.amber}]} size={84} thickness={11} centerLabel={footageTaken+footagePending} centerSub="Total" />
          </div>
          <Legend items={[['Uploaded',footageTaken,C.accent],['Pending',footagePending,C.amber]]} />
        </div>

        <div onClick={()=>onGoToTab('followup')} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', cursor:'pointer' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>FOLLOW-UP OVERVIEW</div>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:'10px' }}>
            <Donut segments={[{label:'Closed',value:followupsClosed,color:C.accent},{label:'Pending',value:followupsPending,color:C.amber}]} size={84} thickness={11} centerLabel={followupsClosed+followupsPending} centerSub="Total" />
          </div>
          <Legend items={[['Closed',followupsClosed,C.accent],['Pending',followupsPending,C.amber]]} />
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>TOP CLIENTS</div>
          {topClients.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No data for this period.</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
              {topClients.map((c,i) => (
                <div key={c.name} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ color:C.muted, fontSize:'10px', width:'14px' }}>{i+1}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:C.text, fontSize:'11.5px', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div>
                    <div style={{ color:C.muted, fontSize:'9.5px' }}>{c.vehicleCount} vehicles</div>
                  </div>
                  <span style={{ color: c.completionPct>=90?C.accent:c.completionPct>=70?C.amber:C.red, fontSize:'11px', fontWeight:700 }}>{c.completionPct}%</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>RECENT ACTIVITY</div>
          {recentActivity.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>Nothing yet.</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:'9px', maxHeight:'220px', overflowY:'auto' }}>
              {recentActivity.map((a,i) => (
                <div key={i}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                    <span style={{ color:C.text, fontSize:'11px', fontWeight:600 }}>{a.label}</span>
                    <span style={{ color:C.muted, fontSize:'9.5px' }}>{a.time}</span>
                  </div>
                  <div style={{ color:C.muted, fontSize:'10px' }}>{a.client}{a.detail?` — ${a.detail}`:''}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MiniStatusCard({ icon, label, value, sub, color }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center' }}>
      <div style={{ color:C.muted, fontSize:'10px', fontWeight:700, marginBottom:'10px' }}>{label.toUpperCase()}</div>
      <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:color+'1a', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'8px' }}>
        <Icon name={icon} size={18} color={color} />
      </div>
      <div style={{ color, fontSize:'13px', fontWeight:800 }}>{value}</div>
      {sub && <div style={{ color:C.muted, fontSize:'9.5px', marginTop:'2px' }}>{sub}</div>}
    </div>
  )
}

function Legend({ items }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'5px' }}>
      {items.map(([label,val,color]) => (
        <div key={label} style={{ display:'flex', alignItems:'center', gap:'6px' }}>
          <span style={{width:7,height:7,borderRadius:'50%',background:color}}></span>
          <span style={{color:C.text2,fontSize:'10.5px',flex:1}}>{label}</span>
          <span style={{color:C.text,fontSize:'10.5px',fontWeight:700}}>{val}</span>
        </div>
      ))}
    </div>
  )
}
