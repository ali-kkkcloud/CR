import { useState } from 'react'
import Icon from '../Icons'
import HistoryPanel from './HistoryPanel'
import { C, Donut, LineChart, ScoreBadge } from '../Widgets'
import { Card, CardHead, Segmented, Meter, EmptyState, SkeletonCard, T, R, SP, SURF } from '../ui'

function fmtMinutes(mins) {
  const h = Math.floor(mins/60), m = mins%60
  return h>0 ? `${h}h ${m}m` : `${m}m`
}

const CAL_COLORS = {
  worked: C.accent, leave: C.purple, weekoff: C.dim, upcoming: '#2a2a2a',
}
const CAL_LABELS = {
  worked: 'Worked', leave: 'Leave', weekoff: 'Week Off', upcoming: 'Upcoming',
}

export default function EmpDashboardTab({ summary, range, setRange, loading, onGoToTab, breakStatus }) {
  // Skeletons only while there is genuinely nothing to show. A refresh that
  // arrives behind data must never take the data away — see the note on
  // loadSummary in pages/dashboard.js.
  if (!summary || (loading && !summary.trend)) return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(230px, 1fr))', gap:SP[3] }}>
      {[0,1,2,3].map(i => <SkeletonCard key={i} lines={3} />)}
    </div>
  )

  const {
    performanceScore, performanceTier, clientsAssigned, vehiclesCovered,
    updatesCompleted, updatesMissed, footageTaken, footagePending,
    followupsClosed, followupsPending, trend, calendar, topClients, recentActivity,
    today = {},
  } = summary

  const completionPct = (updatesCompleted+updatesMissed)>0 ? Math.round((updatesCompleted/(updatesCompleted+updatesMissed))*100) : 100

  const notifications = []
  if (footagePending>0) notifications.push({ icon:'footage', color:C.red, title:'Footage Pending', desc:`${footagePending} footage request(s) awaiting upload`, tab:'footage' })
  if (followupsPending>0) notifications.push({ icon:'followups', color:C.amber, title:'Follow-up Pending', desc:`${followupsPending} follow-up(s) need attention`, tab:'followup' })
  if (updatesMissed>0) notifications.push({ icon:'clock', color:C.amber, title:'Missed Updates', desc:`${updatesMissed} update(s) missed this period`, tab:'board' })

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:SP[3] }}>
        <Segmented
          size="sm" value={range} onChange={setRange}
          options={[
            { value:'today', label:'Today' }, { value:'week', label:'Weekly' },
            { value:'month', label:'Monthly' }, { value:'year', label:'Yearly' },
          ]}
        />
      </div>

      {/* Performance hero row.
          Score and today's progress share one card. Five tiles never divide
          evenly across a row — at every width one of them ended up alone with
          a hole beside it — and the two are about the same thing anyway. */}
      <div className="hero-grid" style={{ marginBottom:SP[4] }}>
        <Card style={{ display:'flex', alignItems:'center', gap:SP[4], minWidth:0, flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:SP[3], minWidth:0, flex:1 }}>
            <Donut segments={[{value:performanceScore,color:C.accent},{value:100-performanceScore,color:'#2a2a2a'}]} size={84} thickness={11} centerLabel={`${performanceScore}%`} />
            <div style={{ minWidth:0 }}>
              <div className="eyebrow">Performance score</div>
              <div style={{ marginTop:'8px' }}><ScoreBadge score={performanceScore} /></div>
              <div style={{ color:C.muted, fontSize:T.xs, marginTop:'8px' }} className="ellip">{performanceTier} this period</div>
            </div>
          </div>
          <button
            onClick={()=>onGoToTab('board')}
            className="pressable"
            style={{
              display:'flex', alignItems:'center', gap:SP[3],
              background:'transparent', border:'none',
              borderLeft:`1px solid ${C.border2}`, paddingLeft:SP[4],
            }}
          >
            <Donut segments={[{value:completionPct,color:C.accent},{value:100-completionPct,color:'#2a2a2a'}]} size={62} thickness={8} centerLabel={`${completionPct}%`} />
            <span style={{ textAlign:'left' }}>
              <span className="eyebrow" style={{ display:'block' }}>Today's progress</span>
              <span style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'5px' }}>Back to my board →</span>
            </span>
          </button>
        </Card>

        <MiniStatusCard icon="check-circle" label="Attendance" value={summary.attendanceStatus||'—'} sub={summary.loginTime||''} color={summary.attendanceStatus==='Late'?C.amber:C.accent} />
        <MiniStatusCard icon="overview" label="Shift status" value={breakStatus?.onBreak?'On break':'Active'} sub={breakStatus?.onBreak?'':`${fmtMinutes(summary.workingMinutes||0)} worked`} color={breakStatus?.onBreak?C.amber:C.accent} />
        <MiniStatusCard icon="clock" label="Break time today" value={fmtMinutes(breakStatus?.totalMinutesToday||0)} sub={breakStatus?.onBreak?'Currently on break':`${breakStatus?.history?.length||0} session${(breakStatus?.history?.length||0)===1?'':'s'}`} color={breakStatus?.onBreak?C.red:C.text} />
      </div>

      {/* Trend + calendar + notifications */}
      <div className="three-grid" style={{ marginBottom:SP[4] }}>
        <Card>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'10px' }}>
            <div className="eyebrow">Updates trend — completed vs missed</div>
          </div>
          <div style={{ display:'flex', gap:'16px', marginBottom:'8px' }}>
            <div><span style={{color:C.accent,fontSize:'18px',fontWeight:800}}>{updatesCompleted}</span> <span style={{color:C.muted,fontSize:'10px'}}>Completed</span></div>
            <div><span style={{color:C.red,fontSize:'18px',fontWeight:800}}>{updatesMissed}</span> <span style={{color:C.muted,fontSize:'10px'}}>Missed</span></div>
          </div>
          <LineChart series={[{name:'Completed',color:C.accent,data:trend.completed},{name:'Missed',color:C.red,data:trend.missed}]} labels={trend.labels} height={180} />
        </Card>

        <Card>
          <div className="eyebrow" style={{ marginBottom:'10px' }}>Monthly calendar</div>
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
        </Card>

        <Card>
          <div className="eyebrow" style={{ marginBottom:'10px' }}>Notifications</div>
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
        </Card>
      </div>

      {/* My Targets — always TODAY's numbers, independent of the trend range above */}
      <Card style={{ marginBottom:SP[4] }}>
        <div className="eyebrow" style={{ marginBottom:'4px' }}>My targets — today</div>
        <div style={{ color:C.muted, fontSize:'10px', marginBottom:'12px' }}>What's assigned to you today vs. what's completed so far</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(170px, 1fr))', gap:'10px' }}>
          {[
            { label:'Clients Assigned', done: today.clientsCompleted, target: today.clientsAssigned },
            { label:'Vehicles Covered', done: today.vehiclesCompleted, target: today.vehiclesAssigned },
            { label:'CRM Updates', done: today.updatesCompleted, target: today.updatesAssigned },
            { label:'Footage Completed', done: today.footageCompleted, target: today.footageAssigned },
            { label:'Follow-ups Closed', done: today.followupsCompleted, target: today.followupsAssigned },
          ].map(t => {
            const pct = t.target>0 ? Math.round((t.done/t.target)*100) : (t.done>0 ? 100 : 0)
            return (
              <div key={t.label} style={{ background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md, padding:'13px' }}>
                <div style={{ color:C.muted, fontSize:T.xs, marginBottom:'7px' }} className="ellip">{t.label}</div>
                <div style={{ color:C.text, fontSize:'17px', fontWeight:800, marginBottom:'9px', lineHeight:1 }}>
                  {t.done} <span style={{ color:C.muted, fontSize:T.base, fontWeight:600 }}>/ {t.target}</span>
                </div>
                <Meter value={pct} color={pct>=100?C.accent:pct>=70?C.amber:C.red} height={5} />
              </div>
            )
          })}
        </div>
      </Card>

      {/* Footage / Followup / Top clients / recent activity */}
      <div className="four-grid">
        <Card onClick={()=>onGoToTab('footage')} className="pressable" style={{ cursor:'pointer' }}>
          <div className="eyebrow" style={{ marginBottom:'10px' }}>Footage overview</div>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:'10px' }}>
            <Donut segments={[{label:'Uploaded',value:footageTaken,color:C.accent},{label:'Pending',value:footagePending,color:C.amber}]} size={84} thickness={11} centerLabel={footageTaken+footagePending} centerSub="Total" />
          </div>
          <Legend items={[['Uploaded',footageTaken,C.accent],['Pending',footagePending,C.amber]]} />
        </Card>

        <Card onClick={()=>onGoToTab('followup')} className="pressable" style={{ cursor:'pointer' }}>
          <div className="eyebrow" style={{ marginBottom:'10px' }}>Follow-up overview</div>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:'10px' }}>
            <Donut segments={[{label:'Closed',value:followupsClosed,color:C.accent},{label:'Pending',value:followupsPending,color:C.amber}]} size={84} thickness={11} centerLabel={followupsClosed+followupsPending} centerSub="Total" />
          </div>
          <Legend items={[['Closed',followupsClosed,C.accent],['Pending',followupsPending,C.amber]]} />
        </Card>

        <Card>
          <div className="eyebrow" style={{ marginBottom:'10px' }}>Top clients</div>
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
        </Card>

        <Card>
          <div className="eyebrow" style={{ marginBottom:'10px' }}>Recent activity</div>
          {recentActivity.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>Nothing yet.</div> : (
            <div className="scroll-fade" style={{ display:'flex', flexDirection:'column', gap:'9px', maxHeight:'220px', overflowY:'auto' }}>
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
        </Card>
      </div>

      {/* Their own months from before the platform existed. Kept below the
          live figures and clearly labelled — those are monthly totals from the
          old spreadsheets and are not part of any range chosen above. */}
      {summary.history && (
        <div style={{ marginTop:SP[4] }}>
          <HistoryPanel history={{ periods: summary.history.months || [], byEmployee: { [summary.history.name]: summary.history } }} only={summary.history.name} title="My work before the platform" />
        </div>
      )}
    </div>
  )
}

function MiniStatusCard({ icon, label, value, sub, color }) {
  return (
    <Card style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center' }}>
      <div className="eyebrow" style={{ marginBottom:'11px' }}>{label}</div>
      <div style={{
        width:'38px', height:'38px', borderRadius:'50%', background:color+'1a',
        display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'10px',
      }}>
        <Icon name={icon} size={17} color={color} />
      </div>
      <div style={{ color, fontSize:T.md, fontWeight:800 }}>{value}</div>
      {sub && <div style={{ color:C.muted, fontSize:T.xs, marginTop:'4px' }}>{sub}</div>}
    </Card>
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
