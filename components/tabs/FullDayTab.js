import { useState, useEffect, useMemo, useRef } from 'react'
import Icon from '../Icons'
import { C, MiniStat, ScoreBadge } from '../Widgets'

function hourLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)}`
}
function hourLabelShort(h) { return h.toString().padStart(2,'0') }

function statusOf(emp) {
  if (!emp) return { label:'—', color:C.muted }
  const nowOnLeave = emp.hours.some(h => h.isOnLeave)
  if (nowOnLeave && !emp.loggedIn) return { label:'On Leave', color:C.purple }
  if (!emp.loggedIn) return { label:'Not Started', color:C.red }
  if (emp.endTime) return { label:'Shift Ended', color:C.blue }
  return { label:'Working', color:C.accent }
}

function initials(name) { return (name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase() }

// 🟢 Healthy / 🟡 Warning / 🔴 Critical — per client-hour instance
function clientHealth(c) {
  if (!c.filled) return { label:'Critical', color:C.red, dot:'🔴' }
  if ((c.alertCount||0) > 0 || (c.misalignVehicles||0) > 0) return { label:'Warning', color:C.amber, dot:'🟡' }
  return { label:'Healthy', color:C.accent, dot:'🟢' }
}

// Heuristic single-day performance score, same spirit as ProgressTab's range score.
function dayScore(emp) {
  if (!emp || emp.totalAssigned === 0) return null
  const completion = (emp.totalCompleted / emp.totalAssigned) * 60
  const alertPenalty    = Math.min(20, emp.totalAlerts)
  const misalignPenalty = Math.min(20, emp.totalMisalign * 2)
  return Math.max(0, Math.min(100, Math.round(completion + (20-alertPenalty) + (20-misalignPenalty))))
}

export default function FullDayTab({ date, setDate, data, loading, onMarkLeave, footageAll, matchDateFlexible, downloadCSV, todayISO, onGoToTab }) {
  const [search, setSearch] = useState('')
  const [shiftFilter, setShiftFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [onlyPending, setOnlyPending] = useState(false)
  const [onlyRedistributed, setOnlyRedistributed] = useState(false)
  const [selectedEmpName, setSelectedEmpName] = useState(null)
  const [selectedHour, setSelectedHour] = useState(null)
  const [drawerClient, setDrawerClient] = useState(null)
  const [compact, setCompact] = useState(false)
  const [drawer, setDrawer] = useState(null) // { type:'client'|'employee'|'vehicle'|'hour', payload }
  const [vehicleQuery, setVehicleQuery] = useState('')

  // Playback / Replay Day
  const [isPlaying, setIsPlaying] = useState(false)
  const [playHour, setPlayHour] = useState(0)
  const playRef = useRef(null)

  const employees = data?.employees || []

  const allScheduledHours = useMemo(() => {
    const set = new Set()
    employees.forEach(e => e.hours.forEach(h => set.add(h.hour)))
    return [...set].sort((a,b)=>a-b)
  }, [employees])
  const minHour = allScheduledHours.length ? allScheduledHours[0] : 0
  const maxHour = allScheduledHours.length ? allScheduledHours[allScheduledHours.length-1] : 23

  useEffect(() => {
    if (!isPlaying) return
    playRef.current = setInterval(() => {
      setPlayHour(h => {
        if (h >= maxHour) { setIsPlaying(false); return h }
        return h + 1
      })
    }, 1100)
    return () => clearInterval(playRef.current)
  }, [isPlaying, maxHour])

  function startPlayback() { setPlayHour(minHour); setIsPlaying(true) }
  function stopPlayback() { setIsPlaying(false) }

  const allClientsToday = useMemo(() => {
    const set = new Set()
    employees.forEach(e => e.hours.forEach(h => h.clients.forEach(c => set.add(c.client))))
    return [...set].sort()
  }, [employees])

  const filtered = useMemo(() => {
    let list = employees
    if (shiftFilter !== 'all') list = list.filter(e => shiftFilter === 'night' ? e.isNight : !e.isNight)
    if (statusFilter !== 'all') list = list.filter(e => {
      const st = statusOf(e).label
      return { working:'Working', ended:'Shift Ended', leave:'On Leave', not_started:'Not Started' }[statusFilter] === st
    })
    if (clientFilter !== 'all') list = list.filter(e => e.hours.some(h => h.clients.some(c => c.client === clientFilter)))
    if (onlyPending) list = list.filter(e => e.totalMissed > 0)
    if (onlyRedistributed) list = list.filter(e => e.totalRedistributed > 0)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.hours.some(h => h.clients.some(c => (c.client||'').toLowerCase().includes(q)))
      )
    }
    return list
  }, [employees, shiftFilter, statusFilter, clientFilter, onlyPending, onlyRedistributed, search])

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

  const kpis = useMemo(() => {
    let active=0, onLeave=0, completed=0, pending=0, vehicles=0
    const clientSet = new Set()
    employees.forEach(e => {
      const st = statusOf(e).label
      if (st==='Working') active++
      if (st==='On Leave') onLeave++
      e.hours.forEach(h => h.clients.forEach(c => {
        clientSet.add(c.client)
        vehicles += c.vehicleCount||0
        if (c.filled) completed++; else pending++
      }))
    })
    const footagePendingToday = footageAll.pending.filter(i => matchDateFlexible(i.raisedAt, date)).length
    const redistCount = employees.reduce((s,e)=>s+e.totalRedistributed,0)
    return { scheduled: employees.length, active, onLeave, totalClients: clientSet.size, totalVehicles: vehicles, completed, pending, footagePendingToday, redistCount }
  }, [employees, footageAll, date])

  const timelineEvents = useMemo(() => {
    if (!selectedEmp || !drawerClient) return []
    const events = []
    selectedEmp.hours.forEach(h => {
      const c = h.clients.find(cl => cl.client === drawerClient.client)
      if (!c) return
      if (c.isRedistributed) events.push({ hour:h.hour, label:`Redistributed from ${c.fromEmployee||'another employee'}${c.redistReason?` (${c.redistReason})`:''}`, color:C.purple })
      if (c.filled) events.push({ hour:h.hour, label:`Update completed${c.updatedAt?` at ${c.updatedAt}`:''}`, color:C.accent, meta:`Alerts: ${c.alertCount||0} · Misalign: ${c.misalignVehicles||0}` })
      else events.push({ hour:h.hour, label:'Not updated yet', color:C.red })
    })
    return events.sort((a,b)=>a.hour-b.hour)
  }, [selectedEmp, drawerClient])

  // Recent activities — real, built from every employee's hour data + footage/leaves
  const recentActivities = useMemo(() => {
    const events = []
    employees.forEach(e => {
      if (e.loggedIn && e.startTime) events.push({ hour:-1, time:e.startTime, name:e.name, label:'Started shift', color:C.accent, icon:'check-circle' })
      if (e.endTime) events.push({ hour:24, time:e.endTime, name:e.name, label:'Ended shift', color:C.blue, icon:'check-circle' })
      e.leaves.forEach(l => events.push({ hour:l.fromHour, time:hourLabel(l.fromHour), name:e.name, label:`Marked on leave${l.reason?` — ${l.reason}`:''}`, color:C.purple, icon:'leaves' }))
      e.hours.forEach(h => h.clients.forEach(c => {
        if (c.filled) events.push({ hour:h.hour, time:c.updatedAt||hourLabel(h.hour), name:e.name, label:`Completed ${c.client}`, color:C.accent, icon:'check-circle' })
        if (c.isRedistributed) events.push({ hour:h.hour, time:c.redistributedAt||hourLabel(h.hour), name:e.name, label:`Received ${c.client} from ${c.fromEmployee||'—'}`, color:C.purple, icon:'shuffle' })
      }))
    })
    return events.sort((a,b)=> b.hour-a.hour).slice(0, 40)
  }, [employees])

  const visibleActivities = isPlaying || playHour>0
    ? recentActivities.filter(a => a.hour <= playHour).slice(0,12)
    : recentActivities.slice(0,12)

  function exportReport() {
    const rows = [
      ['Employee','Status','Assigned','Completed','Pending','Alerts','Misalign','Redistributed','Score'],
      ...employees.map(e => [e.name, statusOf(e).label, e.totalAssigned, e.totalCompleted, e.totalMissed, e.totalAlerts, e.totalMisalign, e.totalRedistributed, dayScore(e)]),
    ]
    downloadCSV(rows, `FullDay_${date}.csv`)
  }

  if (loading) return <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
  if (!data) return <div style={{color:C.muted,textAlign:'center',padding:'3rem'}}>Loading...</div>

  const activeHourData = selectedEmp?.hours.find(h => h.hour === selectedHour)
  const st = statusOf(selectedEmp)
  const playbackOn = isPlaying || playHour > minHour

  return (
    <div>
      {/* Control bar */}
      <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 16px', marginBottom:'10px' }}>
        <button style={navBtnStyle} onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()-1); setDate(d.toISOString().split('T')[0]) }}>‹</button>
        <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={dateInpStyle} />
        <button style={navBtnStyle} onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()+1); setDate(d.toISOString().split('T')[0]) }}>›</button>
        <button style={quickBtnStyle} onClick={()=>setDate(todayISO())}>Today</button>
        <button style={quickBtnStyle} onClick={()=>{ const d=new Date(); d.setDate(d.getDate()-1); setDate(d.toISOString().split('T')[0]) }}>Yesterday</button>
        <select value={shiftFilter} onChange={e=>setShiftFilter(e.target.value)} style={selStyle}>
          <option value="all">All Shifts</option><option value="day">Day Shift</option><option value="night">Night Shift</option>
        </select>
        <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={selStyle}>
          <option value="all">All Status</option><option value="working">Working</option><option value="ended">Shift Ended</option>
          <option value="leave">On Leave</option><option value="not_started">Not Started</option>
        </select>
        <select value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={selStyle}>
          <option value="all">All Clients</option>
          {allClientsToday.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="🔍 Search employee or client..." value={search} onChange={e=>setSearch(e.target.value)} style={{...selStyle, flex:1, minWidth:'160px'}} />
        <button style={{...outlineBtnStyle, ...(onlyPending?{background:C.accentDark,borderColor:C.accent,color:C.accent}:{})}} onClick={()=>setOnlyPending(v=>!v)}>Only Pending</button>
        <button style={{...outlineBtnStyle, ...(onlyRedistributed?{background:C.accentDark,borderColor:C.accent,color:C.accent}:{})}} onClick={()=>setOnlyRedistributed(v=>!v)}>Only Redistributed</button>
        <button style={outlineBtnStyle} onClick={exportReport}><Icon name="download" size={12} color={C.text2}/> Export</button>
        {selectedEmp && (
          <button style={leaveBtnStyle} onClick={()=>onMarkLeave(selectedEmp)}><Icon name="leaves" size={12} color={C.amber}/> Mark Leave — {selectedEmp.name}</button>
        )}
      </div>

      {/* Vehicle search + Replay Day */}
      <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap', marginBottom:'14px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'6px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'6px 10px', flex:1, minWidth:'220px' }}>
          <Icon name="search" size={13} color={C.muted}/>
          <input placeholder="Search a vehicle number (from footage requests)..." value={vehicleQuery} onChange={e=>setVehicleQuery(e.target.value)} style={{ background:'transparent', border:'none', outline:'none', color:C.text, fontSize:'12px', flex:1 }} />
          {vehicleQuery.trim() && <button onClick={()=>setDrawer({type:'vehicle', payload:vehicleQuery.trim()})} style={{...quickBtnStyle, padding:'5px 10px'}}>Search</button>}
        </div>
        {!playbackOn ? (
          <button style={playBtnStyle} onClick={startPlayback}>▶ Replay Day</button>
        ) : (
          <div style={{ display:'flex', alignItems:'center', gap:'8px', background:C.card, border:`1px solid ${C.accent}55`, borderRadius:'8px', padding:'6px 12px', flex:1, minWidth:'260px' }}>
            <button onClick={()=> isPlaying ? stopPlayback() : setIsPlaying(true)} style={{ background:'transparent', border:'none', color:C.accent, cursor:'pointer', fontSize:'14px' }}>{isPlaying?'⏸':'▶'}</button>
            <span style={{ color:C.accent, fontSize:'11px', fontWeight:700, whiteSpace:'nowrap' }}>{hourLabel(playHour)}</span>
            <input type="range" min={minHour} max={maxHour} value={playHour} onChange={e=>{ setIsPlaying(false); setPlayHour(parseInt(e.target.value)) }} style={{ flex:1 }} />
            <button onClick={()=>{ setIsPlaying(false); setPlayHour(minHour) }} style={{ background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'6px', color:C.muted, fontSize:'10px', padding:'4px 8px', cursor:'pointer' }}>Exit Replay</button>
          </div>
        )}
      </div>

      {/* KPI strip — clickable */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(110px, 1fr))', gap:'8px', marginBottom:'14px' }}>
        {[
          { icon:'users', label:'Scheduled', val:kpis.scheduled, onClick:()=>setStatusFilter('all') },
          { icon:'check-circle', label:'Active Now', val:kpis.active, onClick:()=>setStatusFilter('working') },
          { icon:'leaves', label:'On Leave', val:kpis.onLeave, onClick:()=>setStatusFilter('leave') },
          { icon:'overview', label:'Total Clients', val:kpis.totalClients },
          { icon:'camera', label:'Total Vehicles', val:kpis.totalVehicles },
          { icon:'check-circle', label:'Completed', val:kpis.completed },
          { icon:'clock', label:'Pending', val:kpis.pending, warn:kpis.pending>0, onClick:()=>setOnlyPending(v=>!v) },
          { icon:'footage', label:'Footage Pending', val:kpis.footagePendingToday, warn:kpis.footagePendingToday>0 },
          { icon:'shuffle', label:'Redistributions', val:kpis.redistCount, onClick:()=>setOnlyRedistributed(v=>!v) },
        ].map((s,i) => (
          <div key={i} onClick={s.onClick} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'10px 12px', display:'flex', alignItems:'center', gap:'8px', cursor:s.onClick?'pointer':'default' }}>
            <Icon name={s.icon} size={14} color={s.warn?C.amber:C.accent}/>
            <div><div style={{ color:s.warn?C.amber:C.text, fontSize:'15px', fontWeight:800, lineHeight:1 }}>{s.val}</div><div style={{ color:C.muted, fontSize:'8.5px', marginTop:'2px' }}>{s.label}</div></div>
          </div>
        ))}
      </div>

      {!selectedEmp ? (
        <div style={{color:C.muted,textAlign:'center',padding:'2rem'}}>No employees match this filter.</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'2.4fr 1fr', gap:'14px', alignItems:'start' }}>
          <div>
            {/* Expanded employee card */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginBottom:'12px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                <div onClick={()=>setDrawer({type:'employee', payload:selectedEmp.name})} style={{ cursor:'pointer', width:'42px', height:'42px', borderRadius:'50%', background:C.accentDark, color:C.accent, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:'13px' }}>{initials(selectedEmp.name)}</div>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                    <span onClick={()=>setDrawer({type:'employee', payload:selectedEmp.name})} style={{ color:C.text, fontSize:'15px', fontWeight:700, cursor:'pointer' }}>{selectedEmp.name}</span>
                    <span style={{ background:st.color+'1f', color:st.color, border:`1px solid ${st.color}40`, borderRadius:'20px', padding:'2px 9px', fontSize:'10px', fontWeight:700 }}>{st.label}</span>
                    {dayScore(selectedEmp)!=null && <ScoreBadge score={dayScore(selectedEmp)} />}
                  </div>
                  <div style={{ color:C.muted, fontSize:'11px', marginTop:'2px' }}>
                    {selectedEmp.isNight?'Night':'Day'} shift · {selectedEmp.shiftStart}:00–{selectedEmp.shiftEnd}:00
                    {selectedEmp.loggedIn && ` · In ${selectedEmp.startTime}${selectedEmp.endTime?` → Out ${selectedEmp.endTime}`:''}`}
                  </div>
                </div>
                <div style={{ display:'flex', gap:'16px', marginLeft:'auto', flexWrap:'wrap' }}>
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
                  const future = playbackOn && h.hour > playHour
                  return (
                    <button key={h.hour} disabled={future} onClick={()=>{setSelectedHour(h.hour); setDrawerClient(null)}} style={{
                      minWidth:'64px', flexShrink:0, background: future?C.bg:active?C.accentDark:C.s2, opacity: future?0.35:1,
                      border:`1px solid ${active?C.accent:C.border2}`, borderRadius:'8px', padding:'8px 6px',
                      cursor:future?'not-allowed':'pointer', textAlign:'center',
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
            {activeHourData && (!playbackOn || activeHourData.hour <= playHour) && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginBottom:'12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                  <div style={{ color:C.accent, fontSize:'11px', fontWeight:700 }}>
                    {hourLabel(activeHourData.hour)} · {activeHourData.isOnLeave ? 'ON LEAVE' : `${activeHourData.totalClients} CLIENT(S) ASSIGNED`}
                  </div>
                  <label style={{ display:'flex', alignItems:'center', gap:'5px', color:C.muted, fontSize:'10px', cursor:'pointer' }}>
                    <input type="checkbox" checked={compact} onChange={e=>setCompact(e.target.checked)} /> Compact View
                  </label>
                </div>
                {activeHourData.isOnLeave ? (
                  <div style={{ color:C.amber, fontSize:'12px' }}>On leave{activeHourData.leaveReason?` — ${activeHourData.leaveReason}`:''}.</div>
                ) : activeHourData.clients.length===0 ? (
                  <div style={{ color:C.muted, fontSize:'12px' }}>No clients scheduled this hour.</div>
                ) : compact ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:'6px' }}>
                    {activeHourData.clients.map((c,i) => {
                      const health = clientHealth(c)
                      return (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', background:C.s2, borderRadius:'7px', padding:'6px 10px' }}>
                          <span>{health.dot}</span>
                          <span onClick={()=>setDrawer({type:'client', payload:c.client})} style={{ color:C.text, fontSize:'11.5px', fontWeight:600, cursor:'pointer', flex:1 }}>{c.client}</span>
                          <span style={{ color:C.muted, fontSize:'10px' }}>{c.vehicleCount}v</span>
                          <span style={{ color:C.text2, fontSize:'10px' }}>A:{c.alertCount||0} M:{c.misalignVehicles||0}</span>
                          <span style={{ background:(c.filled?C.accent:C.amber)+'1f', color:c.filled?C.accent:C.amber, borderRadius:'5px', padding:'2px 7px', fontSize:'9px', fontWeight:700 }}>{c.filled?'DONE':'PENDING'}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:'10px' }}>
                    {activeHourData.clients.map((c,i) => {
                      const footageN = footageAll.pending.filter(f=>f.client===c.client && matchDateFlexible(f.raisedAt, date)).length
                      const health = clientHealth(c)
                      return (
                        <div key={i} style={{ background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'10px', padding:'12px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                            <div onClick={()=>setDrawer({type:'client', payload:c.client})} style={{ cursor:'pointer' }}>
                              <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                                <span>{health.dot}</span>
                                <span style={{ color:C.text, fontSize:'12.5px', fontWeight:700 }}>{c.client}</span>
                              </div>
                              <div style={{ color:C.muted, fontSize:'10px', marginTop:'1px' }}>{c.vehicleCount} Vehicles</div>
                            </div>
                            <span style={{ background:(c.filled?C.accent:C.amber)+'1f', color:c.filled?C.accent:C.amber, borderRadius:'5px', padding:'2px 7px', fontSize:'9px', fontWeight:700 }}>
                              {c.filled?'COMPLETED':'PENDING'}
                            </span>
                          </div>
                          {c.isRedistributed && (
                            <div style={{ marginTop:'8px', background:C.purple+'14', border:`1px solid ${C.purple}33`, borderRadius:'6px', padding:'4px 7px', fontSize:'9.5px', color:C.purple }}>
                              ↩ Received from {c.fromEmployee}{c.redistributedAt?` at ${c.redistributedAt}`:''}{c.redistReason?` · ${c.redistReason}`:''}
                            </div>
                          )}
                          <div style={{ display:'flex', gap:'12px', marginTop:'10px' }}>
                            <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.alertCount||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>ALERTS</div></div>
                            <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.misalignVehicles||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>MISALIGN</div></div>
                            <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.updatedAt||'—'}</div><div style={{color:C.muted,fontSize:'8.5px'}}>LAST UPDATE</div></div>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:'10px', marginTop:'10px' }}>
                            <button onClick={()=>setDrawerClient({employeeName:selectedEmp.name, client:c.client})} style={{ background:'transparent', border:'none', color:C.accent, fontSize:'10.5px', fontWeight:600, cursor:'pointer', padding:0, display:'flex', alignItems:'center', gap:'4px' }}>
                              View Timeline <Icon name="arrow-right" size={10} color={C.accent}/>
                            </button>
                            {footageN>0 && (
                              <button onClick={()=>onGoToTab && onGoToTab('footage')} style={{ background:'transparent', border:'none', color:C.amber, fontSize:'10px', cursor:'pointer', padding:0 }}>
                                🎥 Pending {footageN}
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Timeline Grid — all employees × hours */}
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginBottom:'12px', overflowX:'auto' }}>
              <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>TIMELINE GRID — {filtered.length} employee(s)</div>
              <table style={{ borderCollapse:'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ position:'sticky', left:0, background:C.card, color:C.muted, fontSize:'9px', textAlign:'left', padding:'4px 10px 4px 2px', minWidth:'110px' }}>EMPLOYEE</th>
                    {Array.from({length:24},(_,h)=>h).map(h => (
                      <th key={h} onClick={()=>setDrawer({type:'hour', payload:h})} style={{ color: playbackOn && h>playHour ? C.dim : C.muted, fontSize:'8px', fontWeight:600, padding:'4px 2px', cursor:'pointer', minWidth:'18px' }} title={`Hour summary — ${hourLabel(h)}`}>
                        {hourLabelShort(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(e => {
                    const es = statusOf(e)
                    return (
                      <tr key={e.name} onClick={()=>setSelectedEmpName(e.name)} style={{ cursor:'pointer', background: e.name===selectedEmp.name ? C.accentDark+'33' : 'transparent' }}>
                        <td style={{ position:'sticky', left:0, background: e.name===selectedEmp.name ? '#16321f' : C.card, padding:'3px 10px 3px 2px', display:'flex', alignItems:'center', gap:'6px' }}>
                          <span style={{ width:6,height:6,borderRadius:'50%',background:es.color,flexShrink:0 }}></span>
                          <span style={{ color:C.text2, fontSize:'10.5px', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'96px' }}>{e.name}</span>
                        </td>
                        {Array.from({length:24},(_,h)=>h).map(h => {
                          const hd = e.hours.find(x=>x.hour===h)
                          const future = playbackOn && h > playHour
                          let bg = 'transparent', label='·'
                          if (hd) {
                            if (future) { bg = C.s2 }
                            else if (hd.isOnLeave) { bg = C.purple; label='L' }
                            else if (hd.totalClients===0) { bg = C.dim }
                            else if (hd.clients.some(c=>c.isRedistributed)) { bg = C.blue; label='↩' }
                            else if (hd.completedClients===hd.totalClients) { bg = C.accent; label='✓' }
                            else { bg = C.red; label='○' }
                          }
                          return (
                            <td key={h} onClick={(ev)=>{ ev.stopPropagation(); if(!hd||future) return; setSelectedEmpName(e.name); setSelectedHour(h); setDrawerClient(null) }} style={{ padding:'2px' }}>
                              <div title={hd?hourLabel(h):''} style={{ width:'15px', height:'15px', borderRadius:'3px', background:bg, opacity: future?0.4: hd?0.9:0.25, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'8px', color:'#06120a', fontWeight:700 }}>
                                {!future && hd && hd.totalClients>0 ? label : ''}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <div style={{ display:'flex', gap:'14px', marginTop:'10px', flexWrap:'wrap' }}>
                {[['✓ Completed',C.accent],['○ Pending',C.red],['L On Leave',C.purple],['↩ Redistributed',C.blue],['· Not scheduled',C.dim]].map(([l,c])=>(
                  <div key={l} style={{ display:'flex', alignItems:'center', gap:'5px' }}><span style={{width:9,height:9,borderRadius:'2px',background:c}}></span><span style={{color:C.muted,fontSize:'9.5px'}}>{l}</span></div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: client timeline / recent activity */}
          <div style={{ display:'flex', flexDirection:'column', gap:'14px', position:'sticky', top:'12px' }}>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
              {!drawerClient ? (
                <div style={{ color:C.muted, fontSize:'11.5px', textAlign:'center', padding:'20px 6px' }}>
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
                    {timelineEvents.length===0 ? <div style={{ color:C.muted, fontSize:'11px' }}>No activity recorded yet.</div> : timelineEvents.map((ev,i) => (
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

            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
              <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>RECENT ACTIVITIES{playbackOn?' (up to '+hourLabel(playHour)+')':''}</div>
              {visibleActivities.length===0 ? <div style={{ color:C.muted, fontSize:'11px' }}>Nothing yet.</div> : (
                <div style={{ display:'flex', flexDirection:'column', gap:'10px', maxHeight:'340px', overflowY:'auto' }}>
                  {visibleActivities.map((a,i) => (
                    <div key={i} style={{ display:'flex', gap:'8px' }}>
                      <div style={{ width:'22px', height:'22px', borderRadius:'50%', background:C.s2, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <Icon name={a.icon} size={11} color={a.color}/>
                      </div>
                      <div>
                        <div style={{ color:C.text, fontSize:'10.5px', fontWeight:600 }}>{a.time} · {a.name}</div>
                        <div style={{ color:C.muted, fontSize:'10px' }}>{a.label}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══════ Drawers ══════ */}
      {drawer?.type === 'client' && <ClientDrawer client={drawer.payload} employees={employees} footageAll={footageAll} date={date} matchDateFlexible={matchDateFlexible} onClose={()=>setDrawer(null)} />}
      {drawer?.type === 'employee' && <EmployeeDrawer emp={employees.find(e=>e.name===drawer.payload)} employees={employees} footageAll={footageAll} date={date} matchDateFlexible={matchDateFlexible} onClose={()=>setDrawer(null)} onMarkLeave={onMarkLeave} />}
      {drawer?.type === 'vehicle' && <VehicleDrawer query={drawer.payload} footageAll={footageAll} onClose={()=>setDrawer(null)} />}
      {drawer?.type === 'hour' && <HourSummaryDrawer hour={drawer.payload} employees={employees} onClose={()=>setDrawer(null)} />}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Drawers
// ─────────────────────────────────────────────────────────────────────────

function DrawerShell({ title, onClose, children }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', justifyContent:'flex-end', zIndex:1000 }} onClick={onClose}>
      <div style={{ width:'400px', maxWidth:'92vw', height:'100%', background:C.card, borderLeft:`1px solid ${C.border}`, padding:'20px', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
          <div style={{ color:C.text, fontSize:'15px', fontWeight:700 }}>{title}</div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', color:C.muted, fontSize:'18px', cursor:'pointer' }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ⭐ Client Investigation Mode
function ClientDrawer({ client, employees, footageAll, date, matchDateFlexible, onClose }) {
  const stats = useMemo(() => {
    let vehicleCount=0, updates=0, pending=0, alerts=0, misalign=0
    const touches = []
    employees.forEach(e => e.hours.forEach(h => {
      const c = h.clients.find(cl => cl.client === client)
      if (!c) return
      vehicleCount = Math.max(vehicleCount, c.vehicleCount||0)
      if (c.filled) updates++; else pending++
      alerts += c.alertCount||0
      misalign += c.misalignVehicles||0
      touches.push({ hour:h.hour, emp:e.name, filled:c.filled, updatedAt:c.updatedAt, redistributed:c.isRedistributed })
    }))
    touches.sort((a,b)=>a.hour-b.hour)
    const footageForClient = [...footageAll.pending, ...footageAll.completed].filter(f => f.client===client && matchDateFlexible(f.raisedAt, date))
    return { vehicleCount, updates, pending, alerts, misalign, touches, footageForClient }
  }, [client, employees, footageAll, date])

  return (
    <DrawerShell title={client} onClose={onClose}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'16px' }}>
        <MiniBox label="VEHICLES" val={stats.vehicleCount} />
        <MiniBox label="UPDATES" val={stats.updates} color={C.accent} />
        <MiniBox label="PENDING" val={stats.pending} color={stats.pending>0?C.amber:C.muted} />
        <MiniBox label="ALERTS+MISALIGN" val={stats.alerts+stats.misalign} color={stats.alerts+stats.misalign>0?C.red:C.muted} />
      </div>
      <div style={{ color:C.accent, fontSize:'10px', fontWeight:700, marginBottom:'8px' }}>HOUR-WISE TIMELINE</div>
      <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'16px' }}>
        {stats.touches.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No activity today.</div> : stats.touches.map((t,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', background:C.s2, borderRadius:'7px', padding:'6px 10px' }}>
            <span style={{ color:C.muted, fontSize:'10px', width:'56px' }}>{hourLabel(t.hour)}</span>
            <span style={{ color:C.text, fontSize:'11px', flex:1 }}>{t.emp}{t.redistributed?' (redistributed)':''}</span>
            <span style={{ background:(t.filled?C.accent:C.amber)+'1f', color:t.filled?C.accent:C.amber, borderRadius:'5px', padding:'2px 7px', fontSize:'9px', fontWeight:700 }}>{t.filled?'DONE':'PENDING'}</span>
          </div>
        ))}
      </div>
      <div style={{ color:C.accent, fontSize:'10px', fontWeight:700, marginBottom:'8px' }}>FOOTAGE REQUESTS TODAY ({stats.footageForClient.length})</div>
      {stats.footageForClient.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>None.</div> : stats.footageForClient.map(f => (
        <div key={f.issueId} style={{ display:'flex', justifyContent:'space-between', fontSize:'11px', color:C.text2, marginBottom:'5px' }}>
          <span>{f.vehicle} — {f.issueId}</span><span style={{color:f.resolved?C.accent:C.amber}}>{f.resolved?'Done':'Pending'}</span>
        </div>
      ))}
    </DrawerShell>
  )
}

// ⭐ Employee Investigation Mode
function EmployeeDrawer({ emp, employees, footageAll, date, matchDateFlexible, onClose, onMarkLeave }) {
  const given = useMemo(() => {
    if (!emp) return 0
    let count = 0
    employees.forEach(e => e.hours.forEach(h => h.clients.forEach(c => { if (c.fromEmployee === emp.name) count++ })))
    return count
  }, [employees, emp && emp.name])

  if (!emp) return null

  const st = statusOf(emp)
  const score = dayScore(emp)
  const footageHandled = [...footageAll.pending, ...footageAll.completed].filter(f => f.raisedBy===emp.name && matchDateFlexible(f.raisedAt, date))
  const followupsHandled = footageAll.followups.filter(f => f.originalEmployee===emp.name || f.forwardedTo===emp.name)
  const lastActivity = [...emp.hours].reverse().flatMap(h=>h.clients).find(c=>c.filled)

  return (
    <DrawerShell title={emp.name} onClose={onClose}>
      <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'14px', flexWrap:'wrap' }}>
        <span style={{ background:st.color+'1f', color:st.color, border:`1px solid ${st.color}40`, borderRadius:'20px', padding:'2px 9px', fontSize:'10px', fontWeight:700 }}>{st.label}</span>
        {score!=null && <ScoreBadge score={score} />}
      </div>
      <div style={{ color:C.muted, fontSize:'11px', marginBottom:'14px' }}>{emp.isNight?'Night':'Day'} shift · {emp.shiftStart}:00–{emp.shiftEnd}:00{emp.loggedIn && ` · In ${emp.startTime}${emp.endTime?` → Out ${emp.endTime}`:''}`}</div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'16px' }}>
        <MiniBox label="CLIENTS" val={emp.totalAssigned} />
        <MiniBox label="COMPLETED" val={emp.totalCompleted} color={C.accent} />
        <MiniBox label="PENDING" val={emp.totalMissed} color={emp.totalMissed>0?C.amber:C.muted} />
        <MiniBox label="ALERTS" val={emp.totalAlerts} color={emp.totalAlerts>0?C.red:C.muted} />
        <MiniBox label="MISALIGN" val={emp.totalMisalign} color={emp.totalMisalign>0?C.red:C.muted} />
        <MiniBox label="REDIST. RECEIVED / GIVEN" val={`${emp.totalRedistributed} / ${given}`} />
        <MiniBox label="FOOTAGE HANDLED" val={footageHandled.length} />
        <MiniBox label="FOLLOW-UPS" val={followupsHandled.length} />
      </div>
      {emp.leaves.length>0 && (
        <div style={{ background:C.purple+'14', border:`1px solid ${C.purple}33`, borderRadius:'8px', padding:'10px 12px', marginBottom:'14px' }}>
          <div style={{ color:C.purple, fontSize:'10px', fontWeight:700, marginBottom:'4px' }}>ON LEAVE TODAY</div>
          {emp.leaves.map((l,i) => <div key={i} style={{ color:C.text2, fontSize:'11px' }}>{hourLabel(l.fromHour)} → {hourLabel(l.toHour)}{l.reason?` — ${l.reason}`:''}</div>)}
        </div>
      )}
      <div style={{ color:C.muted, fontSize:'10.5px', marginBottom:'14px' }}>Last activity: {lastActivity ? `${lastActivity.client} at ${lastActivity.updatedAt}` : '—'}</div>
      <button onClick={()=>{ onMarkLeave(emp); onClose() }} style={{ width:'100%', background:C.amberBg, border:`1px solid ${C.amber}33`, borderRadius:'8px', color:C.amber, fontSize:'12px', fontWeight:600, padding:'10px', cursor:'pointer' }}>Mark Leave</button>
    </DrawerShell>
  )
}

// ⭐ Vehicle Investigation Mode (limited to footage-request history — CRM_Updates has no per-vehicle granularity)
function VehicleDrawer({ query, footageAll, onClose }) {
  const results = useMemo(() => {
    const q = query.toLowerCase()
    return [...footageAll.pending, ...footageAll.completed].filter(f => (f.vehicle||'').toLowerCase().includes(q))
  }, [query, footageAll])

  return (
    <DrawerShell title={`Vehicle: ${query}`} onClose={onClose}>
      <div style={{ color:C.muted, fontSize:'10.5px', marginBottom:'14px', lineHeight:1.5 }}>
        Showing footage-request history for this vehicle. General CRM update history isn't tracked per individual vehicle (only per-client vehicle counts), so this covers footage requests only.
      </div>
      {results.length===0 ? <div style={{ color:C.muted, fontSize:'12px' }}>No footage requests found for this vehicle.</div> : results.map(f => (
        <div key={f.issueId} style={{ background:C.s2, borderRadius:'8px', padding:'10px 12px', marginBottom:'8px' }}>
          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <span style={{ color:C.text, fontSize:'12px', fontWeight:600 }}>{f.client}</span>
            <span style={{ color:f.resolved?C.accent:C.amber, fontSize:'10px', fontWeight:700 }}>{f.resolved?'COMPLETED':'PENDING'}</span>
          </div>
          <div style={{ color:C.muted, fontSize:'10.5px', marginTop:'3px' }}>Raised {f.raisedAt} by {f.raisedBy}</div>
          {f.resolved && <div style={{ color:C.muted, fontSize:'10.5px' }}>Resolved {f.resolvedAt}</div>}
        </div>
      ))}
    </DrawerShell>
  )
}

// Hour Summary — aggregate across all employees for one hour
function HourSummaryDrawer({ hour, employees, onClose }) {
  const stats = useMemo(() => {
    let scheduled=0, clients=0, completed=0, pending=0, vehicles=0
    const clientSet = new Set()
    employees.forEach(e => {
      const h = e.hours.find(x=>x.hour===hour)
      if (!h) return
      scheduled++
      h.clients.forEach(c => { clientSet.add(c.client); clients++; vehicles+=c.vehicleCount||0; c.filled?completed++:pending++ })
    })
    return { scheduled, clients: clientSet.size, completed, pending, vehicles }
  }, [hour, employees])

  return (
    <DrawerShell title={`Hour Summary — ${hourLabel(hour)}`} onClose={onClose}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
        <MiniBox label="SCHEDULED EMPLOYEES" val={stats.scheduled} />
        <MiniBox label="DISTINCT CLIENTS" val={stats.clients} />
        <MiniBox label="COMPLETED" val={stats.completed} color={C.accent} />
        <MiniBox label="PENDING" val={stats.pending} color={stats.pending>0?C.amber:C.muted} />
        <MiniBox label="VEHICLES COVERED" val={stats.vehicles} />
      </div>
    </DrawerShell>
  )
}

function MiniBox({ label, val, color }) {
  return (
    <div style={{ background:C.s2, borderRadius:'8px', padding:'10px 12px' }}>
      <div style={{ color:color||C.text, fontSize:'16px', fontWeight:800 }}>{val}</div>
      <div style={{ color:C.muted, fontSize:'8.5px', marginTop:'2px' }}>{label}</div>
    </div>
  )
}

const navBtnStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'7px', color:C.text2, width:'28px', height:'32px', cursor:'pointer', fontSize:'14px' }
const dateInpStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'12.5px', padding:'7px 10px' }
const selStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'11.5px', padding:'8px 10px' }
const outlineBtnStyle = { display:'flex', alignItems:'center', gap:'5px', background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11px', fontWeight:600, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const leaveBtnStyle = { display:'flex', alignItems:'center', gap:'5px', background:C.amberBg, border:`1px solid ${C.amber}33`, borderRadius:'8px', color:C.amber, fontSize:'11.5px', fontWeight:600, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const quickBtnStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11px', padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const playBtnStyle = { display:'flex', alignItems:'center', gap:'6px', background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'12px', fontWeight:700, padding:'9px 16px', cursor:'pointer', whiteSpace:'nowrap' }
