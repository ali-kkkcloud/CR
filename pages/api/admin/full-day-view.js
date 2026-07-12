import { useState, useEffect, useMemo } from 'react'
import Icon from '../Icons'
import { C, MiniStat } from '../Widgets'

function hourLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)}`
}

function statusOf(emp) {
  if (!emp) return { label:'—', color:C.muted }
  const nowOnLeave = emp.hours.some(h => h.isOnLeave)
  if (nowOnLeave && !emp.loggedIn) return { label:'On Leave', color:C.purple }
  if (!emp.loggedIn) return { label:'Not Started', color:C.red }
  if (emp.endTime) return { label:'Shift Ended', color:C.blue }
  return { label:'Working', color:C.accent }
}

function initials(name) {
  return (name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase()
}

export default function FullDayTab({ date, setDate, data, loading, onMarkLeave, footageAll, matchDateFlexible, downloadCSV }) {
  const [search, setSearch] = useState('')
  const [shiftFilter, setShiftFilter] = useState('all')
  const [selectedEmpName, setSelectedEmpName] = useState(null)
  const [selectedHour, setSelectedHour] = useState(null)
  const [drawerClient, setDrawerClient] = useState(null)

  const employees = data?.employees || []

  const filtered = useMemo(() => {
    let list = employees
    if (shiftFilter !== 'all') list = list.filter(e => shiftFilter === 'night' ? e.isNight : !e.isNight)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.hours.some(h => h.clients.some(c => (c.client||'').toLowerCase().includes(q)))
      )
    }
    return list
  }, [employees, shiftFilter, search])

  useEffect(() => {
    if (filtered.length === 0) { setSelectedEmpName(null); return }
    if (!filtered.some(e => e.name === selectedEmpName)) {
      const workingFirst = filtered.find(e => e.loggedIn && !e.endTime) || filtered[0]
      setSelectedEmpName(workingFirst.name)
    }
  }, [filtered])

  const selectedEmp = filtered.find(e => e.name === selectedEmpName) || filtered[0] || null

  useEffect(() => {
    if (!selectedEmp) return
    if (!selectedEmp.hours.some(h => h.hour === selectedHour)) {
      const nowH = new Date().getHours()
      const preferred = selectedEmp.hours.find(h => h.hour === nowH) || selectedEmp.hours[0]
      setSelectedHour(preferred ? preferred.hour : null)
      setDrawerClient(null)
    }
  }, [selectedEmp && selectedEmp.name])

  const footageCountFor = (empName) => {
    if (!footageAll) return 0
    const all = [...footageAll.pending, ...footageAll.completed]
    return all.filter(i => (i.raisedBy||'').toLowerCase()===empName.toLowerCase() && matchDateFlexible(i.raisedAt, date)).length
  }

  const bottomStats = useMemo(() => {
    const clientSet = new Set()
    let completed=0, pending=0, alerts=0, misalign=0, redist=0, notStarted=0
    employees.forEach(e => {
      if (!e.loggedIn) notStarted++
      e.hours.forEach(h => {
        h.clients.forEach(c => {
          clientSet.add(c.client)
          if (c.filled) completed++; else pending++
          alerts += c.alertCount||0
          misalign += c.misalignVehicles||0
          if (c.isRedistributed) redist++
        })
      })
    })
    return { totalEmployees: employees.length, totalClients: clientSet.size, completed, pending, alerts, misalign, redist, notStarted }
  }, [employees])

  function exportReport() {
    const rows = [
      ['Employee','Status','Assigned','Completed','Pending','Alerts','Misalign','Redistributed'],
      ...employees.map(e => [e.name, statusOf(e).label, e.totalAssigned, e.totalCompleted, e.totalMissed, e.totalAlerts, e.totalMisalign, e.totalRedistributed]),
    ]
    downloadCSV(rows, `FullDay_${date}.csv`)
  }

  if (loading) return <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
  if (!data) return <div style={{color:C.muted,textAlign:'center',padding:'3rem'}}>Loading...</div>

  const activeHourData = selectedEmp?.hours.find(h => h.hour === selectedHour)
  const st = statusOf(selectedEmp)

  const timelineEvents = useMemo(() => {
    if (!selectedEmp || !drawerClient) return []
    const events = []
    selectedEmp.hours.forEach(h => {
      const c = h.clients.find(cl => cl.client === drawerClient.client)
      if (!c) return
      if (c.isRedistributed) events.push({ hour:h.hour, label:'Redistributed to this employee', color:C.purple })
      if (c.filled) events.push({ hour:h.hour, label:`Update completed${c.updatedAt?` at ${c.updatedAt}`:''}`, color:C.accent, meta:`Alerts: ${c.alertCount||0} · Misalign: ${c.misalignVehicles||0}` })
      else events.push({ hour:h.hour, label:'Not updated yet', color:C.red })
    })
    return events.sort((a,b)=>a.hour-b.hour)
  }, [selectedEmp, drawerClient])

  return (
    <div>
      {/* Control bar */}
      <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 16px', marginBottom:'14px' }}>
        <button style={navBtnStyle} onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()-1); setDate(d.toISOString().split('T')[0]) }}>‹</button>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={dateInpStyle} />
        <button style={navBtnStyle} onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()+1); setDate(d.toISOString().split('T')[0]) }}>›</button>
        <select value={shiftFilter} onChange={e=>setShiftFilter(e.target.value)} style={selStyle}>
          <option value="all">All Shifts</option>
          <option value="day">Day Shift</option>
          <option value="night">Night Shift</option>
        </select>
        <input placeholder="🔍 Search employee or client..." value={search} onChange={e=>setSearch(e.target.value)} style={{...selStyle, flex:1, minWidth:'180px'}} />
        <button style={outlineBtnStyle} onClick={exportReport}><Icon name="download" size={12} color={C.text2}/> Export</button>
        {selectedEmp && (
          <button style={leaveBtnStyle} onClick={()=>onMarkLeave(selectedEmp)}>
            <Icon name="leaves" size={12} color={C.amber}/> Mark Leave — {selectedEmp.name}
          </button>
        )}
      </div>

      {!selectedEmp ? (
        <div style={{color:C.muted,textAlign:'center',padding:'2rem'}}>No employees match this filter.</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'2.4fr 1fr', gap:'14px', alignItems:'start' }}>
          <div>
            {/* Expanded employee card */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginBottom:'12px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                <div style={{ width:'42px', height:'42px', borderRadius:'50%', background:C.accentDark, color:C.accent, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:'13px' }}>{initials(selectedEmp.name)}</div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                    <span style={{ color:C.text, fontSize:'15px', fontWeight:700 }}>{selectedEmp.name}</span>
                    <span style={{ background:st.color+'1f', color:st.color, border:`1px solid ${st.color}40`, borderRadius:'20px', padding:'2px 9px', fontSize:'10px', fontWeight:700 }}>{st.label}</span>
                  </div>
                  <div style={{ color:C.muted, fontSize:'11px', marginTop:'2px' }}>
                    {selectedEmp.isNight?'Night':'Day'} shift · {selectedEmp.shiftStart}:00–{selectedEmp.shiftEnd}:00
                    {selectedEmp.loggedIn && ` · In ${selectedEmp.startTime}${selectedEmp.endTime?` → Out ${selectedEmp.endTime}`:''}`}
                  </div>
                </div>
                <div style={{ display:'flex', gap:'18px', marginLeft:'auto', flexWrap:'wrap' }}>
                  <MiniStat label="CLIENTS" val={selectedEmp.totalAssigned} />
                  <MiniStat label="COMPLETED" val={selectedEmp.totalCompleted} />
                  <MiniStat label="PENDING" val={selectedEmp.totalMissed} warn={selectedEmp.totalMissed>0} />
                  <MiniStat label="REDIST." val={selectedEmp.totalRedistributed} />
                  <MiniStat label="FOOTAGE" val={footageCountFor(selectedEmp.name)} />
                  <div style={{ textAlign:'center' }}>
                    <div style={{ color:C.accent, fontSize:'14px', fontWeight:800 }}>{selectedEmp.totalAssigned>0?Math.round((selectedEmp.totalCompleted/selectedEmp.totalAssigned)*100):0}%</div>
                    <div style={{ color:C.muted, fontSize:'8px' }}>COMPLETION</div>
                  </div>
                </div>
              </div>

              {/* Hour pills */}
              <div style={{ display:'flex', gap:'6px', overflowX:'auto', marginTop:'14px', paddingBottom:'2px' }}>
                {selectedEmp.hours.map(h => {
                  const active = h.hour === selectedHour
                  const done = !h.isOnLeave && h.totalClients>0 && h.completedClients===h.totalClients
                  return (
                    <button key={h.hour} onClick={()=>{setSelectedHour(h.hour); setDrawerClient(null)}} style={{
                      minWidth:'64px', flexShrink:0, background: active?C.accentDark:C.s2,
                      border:`1px solid ${active?C.accent:C.border2}`, borderRadius:'8px', padding:'8px 6px',
                      cursor:'pointer', textAlign:'center',
                    }}>
                      <div style={{ color: active?C.accent:C.text2, fontSize:'10px', fontWeight:700 }}>{hourLabel(h.hour)}</div>
                      <div style={{ color:C.muted, fontSize:'9px', marginTop:'2px' }}>{h.isOnLeave?'Leave':`${h.totalClients} clients`}</div>
                      <div style={{ marginTop:'3px' }}>
                        {h.isOnLeave ? <Icon name="leaves" size={11} color={C.amber}/> : done ? <Icon name="check-circle" size={11} color={C.accent}/> : <Icon name="clock" size={11} color={C.muted}/>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Client grid for selected hour */}
            {activeHourData && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginBottom:'12px' }}>
                <div style={{ color:C.accent, fontSize:'11px', fontWeight:700, marginBottom:'12px' }}>
                  {hourLabel(activeHourData.hour)} · {activeHourData.isOnLeave ? 'ON LEAVE' : `${activeHourData.totalClients} CLIENT(S) ASSIGNED`}
                </div>
                {activeHourData.isOnLeave ? (
                  <div style={{ color:C.amber, fontSize:'12px' }}>Employee marked on leave for this hour.</div>
                ) : activeHourData.clients.length===0 ? (
                  <div style={{ color:C.muted, fontSize:'12px' }}>No clients scheduled this hour.</div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'10px' }}>
                    {activeHourData.clients.map((c,i) => (
                      <div key={i} style={{ background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'10px', padding:'12px' }}>
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                          <div>
                            <div style={{ color:C.text, fontSize:'12.5px', fontWeight:700 }}>{c.client}</div>
                            <div style={{ color:C.muted, fontSize:'10px', marginTop:'1px' }}>{c.vehicleCount} Vehicles</div>
                          </div>
                          <span style={{ background:(c.filled?C.accent:C.amber)+'1f', color:c.filled?C.accent:C.amber, borderRadius:'5px', padding:'2px 7px', fontSize:'9px', fontWeight:700 }}>
                            {c.filled?'COMPLETED':'PENDING'}
                          </span>
                        </div>
                        <div style={{ display:'flex', gap:'12px', marginTop:'10px' }}>
                          <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.alertCount||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>ALERTS</div></div>
                          <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.misalignVehicles||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>MISALIGN</div></div>
                          <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.updatedAt||'—'}</div><div style={{color:C.muted,fontSize:'8.5px'}}>LAST UPDATE</div></div>
                        </div>
                        <button onClick={()=>setDrawerClient({employeeName:selectedEmp.name, client:c.client})} style={{ marginTop:'10px', background:'transparent', border:'none', color:C.accent, fontSize:'10.5px', fontWeight:600, cursor:'pointer', padding:0, display:'flex', alignItems:'center', gap:'4px' }}>
                          View Timeline <Icon name="arrow-right" size={10} color={C.accent}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Compact employee list */}
            <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
              {filtered.filter(e=>e.name!==selectedEmp.name).map(e => {
                const es = statusOf(e)
                return (
                  <div key={e.name} onClick={()=>setSelectedEmpName(e.name)} style={{ display:'flex', alignItems:'center', gap:'10px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'10px 14px', cursor:'pointer', flexWrap:'wrap' }}>
                    <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:es.color, flexShrink:0 }}></span>
                    <div style={{ minWidth:'110px' }}>
                      <div style={{ color:C.text, fontSize:'12px', fontWeight:600 }}>{e.name}</div>
                      <div style={{ color:C.muted, fontSize:'9.5px' }}>{es.label}</div>
                    </div>
                    <div style={{ display:'flex', gap:'3px', flex:1, minWidth:'140px', flexWrap:'wrap' }}>
                      {e.hours.map(h => (
                        <span key={h.hour} title={hourLabel(h.hour)} style={{
                          width:'16px', height:'16px', borderRadius:'4px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'8px',
                          background: h.isOnLeave ? C.amberBg : (h.totalClients>0 && h.completedClients===h.totalClients) ? C.accentSoft : h.totalClients>0 ? C.redBg : C.s2,
                          color: h.isOnLeave ? C.amber : (h.totalClients>0 && h.completedClients===h.totalClients) ? C.accent : h.totalClients>0 ? C.red : C.dim,
                        }}>{h.isOnLeave?'L':(h.totalClients>0 && h.completedClients===h.totalClients)?'✓':h.totalClients>0?'○':'·'}</span>
                      ))}
                    </div>
                    <div style={{ display:'flex', gap:'14px' }}>
                      <MiniStat label="CLIENTS" val={e.totalAssigned} />
                      <MiniStat label="DONE" val={e.totalCompleted} />
                      <MiniStat label="PENDING" val={e.totalMissed} warn={e.totalMissed>0} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right: client timeline drawer */}
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', position:'sticky', top:'12px' }}>
            {!drawerClient ? (
              <div style={{ color:C.muted, fontSize:'11.5px', textAlign:'center', padding:'30px 6px' }}>
                Select "View Timeline" on any client card to see its hour-by-hour activity here.
              </div>
            ) : (
              <>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                  <div style={{ color:C.text, fontSize:'13px', fontWeight:700 }}>{drawerClient.client}</div>
                  <button onClick={()=>setDrawerClient(null)} style={{ background:'transparent', border:'none', color:C.muted, cursor:'pointer', fontSize:'16px' }}>×</button>
                </div>
                <div style={{ color:C.muted, fontSize:'10.5px', marginBottom:'12px' }}>{drawerClient.employeeName}'s activity today</div>
                <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                  {timelineEvents.length===0 ? (
                    <div style={{ color:C.muted, fontSize:'11px' }}>No activity recorded yet.</div>
                  ) : timelineEvents.map((ev,i) => (
                    <div key={i} style={{ display:'flex', gap:'8px' }}>
                      <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:ev.color, marginTop:'4px', flexShrink:0 }}></div>
                      <div>
                        <div style={{ color:C.text2, fontSize:'10.5px' }}>{hourLabel(ev.hour)} — {ev.label}</div>
                        {ev.meta && <div style={{ color:C.muted, fontSize:'9.5px', marginTop:'1px' }}>{ev.meta}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bottom stat strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:'10px', marginTop:'16px' }}>
        {[
          { icon:'users', label:'Total Employees', val:bottomStats.totalEmployees },
          { icon:'overview', label:'Clients Touched', val:bottomStats.totalClients },
          { icon:'check-circle', label:'Completed Updates', val:bottomStats.completed },
          { icon:'clock', label:'Pending Updates', val:bottomStats.pending, warn:bottomStats.pending>0 },
          { icon:'offline', label:'Not Started', val:bottomStats.notStarted, warn:bottomStats.notStarted>0 },
          { icon:'alerts', label:'Alerts', val:bottomStats.alerts },
          { icon:'analytics', label:'Misalign', val:bottomStats.misalign },
          { icon:'shuffle', label:'Redistributed', val:bottomStats.redist },
        ].map((s,i) => (
          <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 14px', display:'flex', alignItems:'center', gap:'10px' }}>
            <Icon name={s.icon} size={16} color={s.warn?C.amber:C.accent}/>
            <div>
              <div style={{ color:s.warn?C.amber:C.text, fontSize:'16px', fontWeight:800, lineHeight:1 }}>{s.val}</div>
              <div style={{ color:C.muted, fontSize:'9px', marginTop:'2px' }}>{s.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const navBtnStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'7px', color:C.text2, width:'28px', height:'32px', cursor:'pointer', fontSize:'14px' }
const dateInpStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'12.5px', padding:'7px 10px' }
const selStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'12px', padding:'8px 10px' }
const outlineBtnStyle = { display:'flex', alignItems:'center', gap:'5px', background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11.5px', fontWeight:600, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const leaveBtnStyle = { display:'flex', alignItems:'center', gap:'5px', background:C.amberBg, border:`1px solid ${C.amber}33`, borderRadius:'8px', color:C.amber, fontSize:'11.5px', fontWeight:600, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
