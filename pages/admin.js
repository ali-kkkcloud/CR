import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Navbar from '../components/Navbar'

function todayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return d.toISOString().split('T')[0]
}

export default function Admin() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [overview, setOverview] = useState(null)
  const [progress, setProgress] = useState(null)
  const [footage, setFootage] = useState({ pending: [], completed: [], followups: [] })
  const [fullDayData, setFullDayData] = useState(null)
  const [fullDayDate, setFullDayDate] = useState(todayISO())
  const [fullDayLoading, setFullDayLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('overview')
  const [footageSearchInput, setFootageSearchInput] = useState('')
  const [footageSearch, setFootageSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [fromDate, setFromDate] = useState(todayISO())
  const [toDate, setToDate] = useState(todayISO())
  const [loading, setLoading] = useState(true)
  const [markLeaveModal, setMarkLeaveModal] = useState(null)
  const [leaveFromHour, setLeaveFromHour] = useState(8)
  const [leaveToHour, setLeaveToHour] = useState(17)
  const [leaveReason, setLeaveReason] = useState('')
  const [markingLeave, setMarkingLeave] = useState(false)
  const [closeFollowupModal, setCloseFollowupModal] = useState(null)
  const [closeReason, setCloseReason] = useState('')
  const [closingFollowup, setClosingFollowup] = useState(false)
  const [expandedEmp, setExpandedEmp] = useState(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setFootageSearch(footageSearchInput), 300)
    return () => clearTimeout(debounceRef.current)
  }, [footageSearchInput])

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.role !== 'admin') { router.replace('/login'); return }
      setUser(d.user)
      loadData()
      setLoading(false)
    })
  }, [])

  const loadData = useCallback(async () => {
    const [ov, ft] = await Promise.all([
      fetch('/api/admin/overview').then(r => r.json()),
      fetch('/api/footage/list').then(r => r.json()),
    ])
    if (ov.employees) setOverview(ov)
    setFootage({ pending: ft.pending || [], completed: ft.completed || [], followups: ft.followups || [] })
  }, [])

  const loadProgress = useCallback(async (from, to) => {
    const data = await fetch(`/api/admin/employee-progress?from=${from}&to=${to}`).then(r => r.json())
    if (data.progress) setProgress(data)
  }, [])

  const loadFullDay = useCallback(async (dateISO) => {
    setFullDayLoading(true)
    setFullDayData(null)
    const ddmmyyyy = dateISO.split('-').reverse().join('/')
    const data = await fetch(`/api/admin/full-day-view?date=${ddmmyyyy}`).then(r => r.json())
    setFullDayData(data)
    setFullDayLoading(false)
  }, [])

  useEffect(() => {
    if (activeTab === 'progress') loadProgress(fromDate, toDate)
  }, [activeTab, fromDate, toDate])

  useEffect(() => {
    if (activeTab === 'fullday') loadFullDay(fullDayDate)
  }, [activeTab, fullDayDate])

  useEffect(() => {
    const id = setInterval(() => {
      if (activeTab === 'overview') loadData()
    }, 60000)
    return () => clearInterval(id)
  }, [activeTab])

  async function handleMarkLeave() {
    if (!markLeaveModal) return
    setMarkingLeave(true)
    await fetch('/api/admin/mark-leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empName: markLeaveModal.name,
        date: fullDayDate.split('-').reverse().join('/'),
        fromHour: leaveFromHour,
        toHour: leaveToHour,
        reason: leaveReason || 'Admin marked',
      }),
    })
    setMarkingLeave(false)
    setMarkLeaveModal(null)
    setLeaveReason('')
    loadFullDay(fullDayDate)
    loadData()
  }

  async function handleCloseFollowup() {
    if (!closeFollowupModal) return
    setClosingFollowup(true)
    await fetch('/api/footage/close-followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issueId: closeFollowupModal.issueId, reason: closeReason }),
    })
    setClosingFollowup(false)
    setCloseFollowupModal(null)
    setCloseReason('')
    loadData()
  }

  function downloadCSV(rows, filename) {
    const csv  = rows.map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
  }

  function matchDateFlexible(raisedAtStr, isoDate) {
    if (!isoDate) return true
    const [y, m, d] = isoDate.split('-')
    return (raisedAtStr || '').includes(`${d}/${m}/${y}`)
  }

  const filteredPending = useMemo(() => {
    let list = footage.pending
    if (dateFilter) list = list.filter(item => matchDateFlexible(item.raisedAt, dateFilter))
    if (footageSearch.trim()) {
      const q = footageSearch.trim().toLowerCase()
      list = list.filter(item =>
        (item.vehicle  || '').toLowerCase().includes(q) ||
        (item.issueId  || '').toString().toLowerCase().includes(q) ||
        (item.client   || '').toLowerCase().includes(q) ||
        (item.raisedBy || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [footage.pending, footageSearch, dateFilter])

  const filteredCompleted = useMemo(() => {
    let list = footage.completed
    if (dateFilter) list = list.filter(item => matchDateFlexible(item.raisedAt, dateFilter))
    if (footageSearch.trim()) {
      const q = footageSearch.trim().toLowerCase()
      list = list.filter(item =>
        (item.vehicle  || '').toLowerCase().includes(q) ||
        (item.issueId  || '').toString().toLowerCase().includes(q) ||
        (item.client   || '').toLowerCase().includes(q) ||
        (item.raisedBy || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [footage.completed, footageSearch, dateFilter])

  if (loading || !overview) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>
      <div className="spinner"></div>
    </div>
  )

  const { employees, kpis, redistribution } = overview

  const statusMeta = (s) => ({
    'Active':      { color:'#22c55e', label:'Active' },
    'Ended':       { color:'#6b7280', label:'Shift ended' },
    'Week Off':    { color:'#f59e0b', label:'Week off' },
    'Not Started': { color:'#ef4444', label:'Not started' },
    'Off Shift':   { color:'#374151', label:'Off shift' },
  }[s] || { color:'#6b7280', label:s })

  const hourLabel = (h) => {
    const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
    const suf  = (n) => n >= 12 ? 'PM' : 'AM'
    return `${to12(h)}:00 ${suf(h)}`
  }

  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <>
      <Head><title>Cautio CRM — Admin</title></Head>
      <div style={{minHeight:'100vh', background:'#0a0a0a'}}>
        <Navbar user={user} />
        <div style={s.body}>

          <div style={s.tabs}>
            {[
              { k:'overview',   label:'Overview' },
              { k:'fullday',    label:'Full Day View' },
              { k:'progress',   label:'Employee Progress' },
              { k:'footage',    label:`Footage (${footage.pending.length})` },
              { k:'followups',  label:`Follow-ups (${footage.followups.length})` },
              { k:'redistribution', label:`Redistribution (${redistribution.length})` },
            ].map(t => (
              <button key={t.k} style={activeTab===t.k ? {...s.tab,...s.tabActive} : s.tab} onClick={() => setActiveTab(t.k)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* ══════════ OVERVIEW ══════════ */}
          {activeTab === 'overview' && (
            <>
              <div style={s.kpiStrip}>
                {[
                  { label:'Total Employees', val:kpis.total,       color:'#fff'    },
                  { label:'Active Now',      val:kpis.active,      color:'#4ade80' },
                  { label:'Week Off',        val:kpis.weekOff,     color:'#fbbf24' },
                  { label:'Not Started',     val:kpis.notStarted,  color:'#f87171' },
                  { label:'Footage Pending', val:footage.pending.length, color:'#60a5fa' },
                  { label:'Follow-ups',      val:footage.followups.length, color:'#f59e0b' },
                ].map(k => (
                  <div key={k.label} style={s.kpiPill}>
                    <span style={{color:k.color, fontSize:'20px', fontWeight:'700'}}>{k.val}</span>
                    <span style={{color:'#6b7280', fontSize:'11px'}}>{k.label}</span>
                  </div>
                ))}
              </div>

              <div style={s.empListCard}>
                {employees.map(emp => {
                  const meta = statusMeta(emp.statusLabel)
                  return (
                    <div key={emp.name} style={s.empRow}>
                      <div style={{...s.empDot, background:meta.color}}></div>
                      <div style={s.empNameCol}>
                        <div style={s.empNameTxt}>{emp.name}</div>
                        <div style={s.empSubTxt}>{emp.isNight?'Night':'Day'} · {emp.shiftStart}:00–{emp.shiftEnd}:00</div>
                      </div>
                      <div style={{...s.empStatusTag, color:meta.color}}>{meta.label}</div>
                      {(emp.statusLabel==='Active'||emp.statusLabel==='Ended') ? (
                        <>
                          <MiniStat label="Updates" val={emp.totalUpdates}/>
                          <MiniStat label="Pending" val={emp.pendingCount} warn={emp.pendingCount>0}/>
                          <div style={s.empDuration}>{emp.duration||(emp.startTime?'in progress':'—')}</div>
                        </>
                      ) : <div style={{flex:1}}></div>}
                      <button style={s.viewBtn} onClick={()=>{ setFullDayDate(todayISO()); setExpandedEmp(emp.name); setActiveTab('fullday') }}>
                        View day →
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {/* ══════════ FULL DAY VIEW (new — full visibility) ══════════ */}
          {activeTab === 'fullday' && (
            <div>
              <div style={s.filterBar}>
                <span style={s.filterLbl}>DATE</span>
                <input type="date" style={s.dateInp} value={fullDayDate} onChange={e => { setFullDayDate(e.target.value); setExpandedEmp(null) }}/>
                <button style={s.quickBtn} onClick={() => { setFullDayDate(todayISO()); setExpandedEmp(null) }}>Today</button>
                <span style={{color:'#6b7280',fontSize:'11px',marginLeft:'auto'}}>Click employee row to expand hours. Use "Mark Leave" to exclude from distribution.</span>
              </div>

              {fullDayLoading ? (
                <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
              ) : !fullDayData ? (
                <div style={{color:'#6b7280',textAlign:'center',padding:'3rem'}}>Loading...</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                  {fullDayData.employees.map(emp => {
                    const isExpanded = expandedEmp === emp.name
                    const totalMissed = emp.hours.reduce((s,h)=>s+h.missedClients,0)
                    const totalDone   = emp.hours.reduce((s,h)=>s+h.completedClients,0)
                    const totalAll    = emp.hours.reduce((s,h)=>s+h.totalClients,0)

                    return (
                      <div key={emp.name} style={{...s.fdEmpCard, ...(isExpanded?{borderColor:'#22c55e44'}:{})}}>
                        <div style={s.fdEmpHeader} onClick={()=>setExpandedEmp(isExpanded?null:emp.name)}>
                          <div style={{...s.empDot, background: emp.loggedIn ? '#22c55e' : emp.hours.some(h=>h.isOnLeave) ? '#f59e0b' : '#374151', flexShrink:0}}></div>
                          <div style={s.empNameCol}>
                            <div style={{color:'#fff',fontSize:'13px',fontWeight:'600'}}>{emp.name}</div>
                            <div style={{color:'#6b7280',fontSize:'10px'}}>
                              {emp.isNight?'Night':'Day'} {emp.shiftStart}:00–{emp.shiftEnd}:00
                              {emp.loggedIn && ` · Logged in ${emp.startTime}${emp.endTime ? ' → '+emp.endTime : ''}`}
                              {!emp.loggedIn && <span style={{color:'#f87171'}}> · Not logged in</span>}
                            </div>
                          </div>
                          <div style={{display:'flex',gap:'16px',alignItems:'center',marginLeft:'auto'}}>
                            <MiniStat label="Assigned" val={totalAll}/>
                            <MiniStat label="Done" val={totalDone}/>
                            <MiniStat label="Missed" val={totalMissed} warn={totalMissed>0}/>
                          </div>
                          <button
                            style={{...s.quickBtn, marginLeft:'12px', background:'#1a1200', borderColor:'#f59e0b33', color:'#fbbf24'}}
                            onClick={e => { e.stopPropagation(); setMarkLeaveModal(emp); setLeaveFromHour(emp.shiftStart); setLeaveToHour(emp.shiftEnd) }}
                          >
                            Mark Leave
                          </button>
                          <span style={{color:'#374151',fontSize:'16px',marginLeft:'8px'}}>{isExpanded?'▲':'▼'}</span>
                        </div>

                        {isExpanded && (
                          <div style={{borderTop:'1px solid #222',marginTop:'10px',paddingTop:'10px'}}>
                            {emp.hours.length === 0 ? (
                              <div style={{color:'#6b7280',fontSize:'12px',padding:'8px'}}>No scheduled hours with clients.</div>
                            ) : (
                              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                                {emp.hours.map(h => (
                                  <div key={h.hour} style={{
                                    background: h.isOnLeave ? '#1a1200' : '#161616',
                                    borderRadius:'8px', padding:'10px 14px',
                                    border:`1px solid ${h.isOnLeave?'#f59e0b33':'#2a2a2a'}`,
                                  }}>
                                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                                      <span style={{color:h.isOnLeave?'#fbbf24':'#fff',fontSize:'12px',fontWeight:'600'}}>
                                        {hourLabel(h.hour)} {h.isOnLeave && '· ON LEAVE'}
                                      </span>
                                      {!h.isOnLeave && (
                                        <span style={{color:h.completedClients===h.totalClients&&h.totalClients>0?'#22c55e':'#f59e0b',fontSize:'11px'}}>
                                          {h.completedClients}/{h.totalClients} done
                                        </span>
                                      )}
                                    </div>
                                    {!h.isOnLeave && (
                                      <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                                        {h.clients.length === 0 ? (
                                          <span style={{color:'#374151',fontSize:'11px'}}>No clients this hour</span>
                                        ) : h.clients.map((c,i) => (
                                          <div key={i} style={{
                                            fontSize:'10px', padding:'3px 9px', borderRadius:'5px', border:'1px solid',
                                            background: c.filled ? '#22c55e14' : '#f87171' + '14',
                                            borderColor: c.filled ? '#22c55e33' : '#f8717133',
                                            color: c.filled ? '#4ade80' : '#f87171',
                                          }} title={c.filled ? `Updated at ${c.updatedAt}` : 'Not updated'}>
                                            {c.filled ? '✓' : '○'} {c.client}
                                            {c.vehicleCount > 0 && <span style={{opacity:0.6}}> ({c.vehicleCount}v)</span>}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ══════════ EMPLOYEE PROGRESS ══════════ */}
          {activeTab === 'progress' && (
            <div>
              <div style={s.filterBar}>
                <span style={s.filterLbl}>FROM</span>
                <input type="date" style={s.dateInp} value={fromDate} onChange={e=>setFromDate(e.target.value)}/>
                <span style={s.filterLbl}>TO</span>
                <input type="date" style={s.dateInp} value={toDate} onChange={e=>setToDate(e.target.value)}/>
                <button style={s.quickBtn} onClick={()=>{setFromDate(todayISO());setToDate(todayISO())}}>Today</button>
                <button style={s.quickBtn} onClick={()=>{
                  const d=new Date();d.setDate(d.getDate()-6);
                  setFromDate(d.toISOString().split('T')[0]);setToDate(todayISO())
                }}>Last 7 days</button>
                {progress&&<span style={{color:'#6b7280',fontSize:'11px',marginLeft:'auto'}}>{progress.dates.length} day(s)</span>}
              </div>

              {!progress ? (
                <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                  {progress.progress.map(emp => (
                    <div key={emp.name} style={s.progRow}>
                      <div style={{...s.empDot,background:emp.isNight?'#a78bfa':'#4ade80'}}></div>
                      <div style={s.empNameCol}>
                        <div style={s.empNameTxt}>{emp.name}</div>
                        <div style={s.empSubTxt}>{emp.daysPresent}/{emp.totalDaysInRange} days present</div>
                      </div>
                      <AttendanceDots attendance={emp.attendance}/>
                      <MiniStat label="Clients" val={emp.rangeClientsCount}/>
                      <MiniStat label="Updates" val={emp.rangeUpdatesCount}/>
                      <MiniStat label="Footage done" val={emp.footageCompletedInRange}/>
                      <MiniStat label="Footage left" val={emp.footagePending} warn={emp.footagePending>0}/>
                      <MiniStat label="Days missed" val={emp.daysAbsent} warn={emp.daysAbsent>0}/>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════ FOOTAGE ══════════ */}
          {activeTab === 'footage' && (
            <div style={{maxWidth:'1000px'}}>
              <div style={s.filterBar}>
                <div style={s.footSumCard}><span style={{color:'#f59e0b',fontSize:'20px',fontWeight:'700'}}>{filteredPending.length}</span><span style={{color:'#6b7280',fontSize:'9px'}}>PENDING</span></div>
                <div style={s.footSumCard}><span style={{color:'#22c55e',fontSize:'20px',fontWeight:'700'}}>{filteredCompleted.length}</span><span style={{color:'#6b7280',fontSize:'9px'}}>COMPLETED</span></div>
                <input style={{...s.searchInp,flex:1,minWidth:'200px'}} placeholder="🔍 Search vehicle, issue ID, client, employee..." value={footageSearchInput} onChange={e=>setFootageSearchInput(e.target.value)}/>
                <input type="date" style={s.dateInp} value={dateFilter} onChange={e=>setDateFilter(e.target.value)}/>
                {dateFilter&&<button style={s.quickBtn} onClick={()=>setDateFilter('')}>✕ Clear</button>}
                <button onClick={()=>downloadCSV(
                  [['Issue ID','Client','Vehicle','Raised At','Details','Raised By','Location'],...filteredPending.map(i=>[i.issueId,i.client,i.vehicle,i.raisedAt,i.details,i.raisedBy,i.location])],
                  `Footage_Pending_${dateFilter||'all'}.csv`
                )} style={s.quickBtn}>⬇ Pending</button>
                <button onClick={()=>downloadCSV(
                  [['Issue ID','Client','Vehicle','Raised At','Details','Raised By','Resolved','Resolved At'],...[...filteredPending,...filteredCompleted].map(i=>[i.issueId,i.client,i.vehicle,i.raisedAt,i.details,i.raisedBy,i.resolved?'Yes':'No',i.resolvedAt])],
                  `Footage_All_${dateFilter||'all'}.csv`
                )} style={s.quickBtn}>⬇ All</button>
              </div>

              {filteredPending.length===0&&filteredCompleted.length===0&&<div style={{color:'#6b7280',textAlign:'center',padding:'3rem'}}>No footage requests found.</div>}

              {filteredPending.length>0&&<>
                <div style={s.sectionHd}>PENDING ({filteredPending.length})</div>
                {filteredPending.map(item=>(
                  <div key={item.issueId} style={s.footCard}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                      <div style={{flex:1,minWidth:'200px'}}>
                        <div style={{color:'#fff',fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}><span style={{color:'#60a5fa',marginRight:'6px'}}>▶</span>{item.client} · <span style={{color:'#22c55e'}}>{item.vehicle}</span></div>
                        <div style={{color:'#6b7280',fontSize:'11px',lineHeight:'1.6'}}>
                          <span style={{color:'#9ca3af'}}>ID:</span> {item.issueId} &nbsp;·&nbsp;
                          <span style={{color:'#9ca3af'}}>By:</span> {item.raisedBy} &nbsp;·&nbsp;
                          <span style={{color:'#9ca3af'}}>Raised:</span> {item.raisedAt}
                          {item.location&&<> &nbsp;·&nbsp;<span style={{color:'#9ca3af'}}>Loc:</span> {item.location}</>}
                        </div>
                        {item.details&&<div style={{color:'#9ca3af',fontSize:'11px',marginTop:'4px',fontStyle:'italic'}}>{item.details}</div>}
                      </div>
                      <span className="badge badge-amber">PENDING</span>
                    </div>
                  </div>
                ))}
              </>}

              {filteredCompleted.length>0&&<>
                <div style={{...s.sectionHd,marginTop:'20px'}}>COMPLETED ({filteredCompleted.length})</div>
                {filteredCompleted.map(item=>(
                  <div key={item.issueId} style={{...s.footCard,opacity:0.6}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                      <div style={{flex:1,minWidth:'200px'}}>
                        <div style={{color:'#fff',fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}><span style={{color:'#22c55e',marginRight:'6px'}}>✓</span>{item.client} · <span style={{color:'#22c55e'}}>{item.vehicle}</span></div>
                        <div style={{color:'#6b7280',fontSize:'11px'}}><span style={{color:'#9ca3af'}}>ID:</span> {item.issueId} &nbsp;·&nbsp;<span style={{color:'#9ca3af'}}>By:</span> {item.raisedBy} &nbsp;·&nbsp;<span style={{color:'#9ca3af'}}>Done:</span> {item.resolvedAt}</div>
                      </div>
                      <span className="badge badge-green">DONE</span>
                    </div>
                  </div>
                ))}
              </>}
            </div>
          )}

          {/* ══════════ FOLLOW-UPS ══════════ */}
          {activeTab === 'followups' && (
            <div style={{maxWidth:'900px'}}>
              <div style={s.sectionHd}>OPEN FOLLOW-UPS — Admin can close these</div>
              {footage.followups.length===0 ? (
                <div style={{color:'#6b7280',textAlign:'center',padding:'3rem'}}>No open follow-ups.</div>
              ) : (
                footage.followups.map(item => (
                  <div key={item.issueId} style={{...s.footCard,borderColor:'#f59e0b33'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                      <div style={{flex:1,minWidth:'200px'}}>
                        <div style={{color:'#fff',fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}>
                          <span style={{color:'#fbbf24',marginRight:'6px'}}>↩</span>
                          {item.client} · <span style={{color:'#22c55e'}}>{item.vehicle}</span>
                        </div>
                        <div style={{color:'#6b7280',fontSize:'11px',lineHeight:'1.6'}}>
                          <span style={{color:'#9ca3af'}}>ID:</span> {item.issueId} &nbsp;·&nbsp;
                          <span style={{color:'#9ca3af'}}>Original:</span> {item.originalEmployee} &nbsp;·&nbsp;
                          <span style={{color:'#9ca3af'}}>Forwarded to:</span> <strong style={{color:'#fff'}}>{item.forwardedTo}</strong> &nbsp;·&nbsp;
                          <span style={{color:'#9ca3af'}}>At:</span> {item.forwardedAt}
                        </div>
                        {item.details&&<div style={{color:'#9ca3af',fontSize:'11px',marginTop:'4px',fontStyle:'italic'}}>{item.details}</div>}
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:'6px',alignItems:'flex-end'}}>
                        <span className="badge badge-amber">FOLLOW-UP</span>
                        <button
                          style={{background:'#1a0808',border:'1px solid #3a1515',borderRadius:'6px',color:'#f87171',fontSize:'10px',padding:'5px 10px',cursor:'pointer'}}
                          onClick={()=>{ setCloseFollowupModal(item); setCloseReason('') }}
                        >
                          Close follow-up
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* ══════════ REDISTRIBUTION ══════════ */}
          {activeTab === 'redistribution' && (
            <div style={{maxWidth:'900px'}}>
              <div style={s.sectionHd}>TODAY'S REDISTRIBUTION LOG</div>
              {redistribution.length===0 ? (
                <div style={{color:'#6b7280',textAlign:'center',padding:'3rem'}}>No redistributions today.</div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={{background:'#161616'}}>
                      {['From','To','Client','Hour','Reason'].map(h=><th key={h} style={s.tableHd}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {redistribution.map((r,i)=>(
                      <tr key={i} style={{borderBottom:'1px solid #1a1a1a'}}>
                        <td style={{...s.tableTd,color:'#f87171'}}>{r.from}</td>
                        <td style={{...s.tableTd,color:'#22c55e'}}>{r.to}</td>
                        <td style={s.tableTd}>{r.client}</td>
                        <td style={s.tableTd}>{r.hour}:00</td>
                        <td style={{...s.tableTd,color:'#6b7280'}}>Early End</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ══════════ MARK LEAVE MODAL ══════════ */}
      {markLeaveModal && (
        <div style={modal.overlay} onClick={()=>setMarkLeaveModal(null)}>
          <div style={modal.box} onClick={e=>e.stopPropagation()}>
            <div style={modal.title}>Mark Leave — {markLeaveModal.name}</div>
            <div style={modal.row}>
              <div style={{flex:1}}>
                <label style={modal.lbl}>FROM HOUR</label>
                <select style={modal.sel} value={leaveFromHour} onChange={e=>setLeaveFromHour(parseInt(e.target.value))}>
                  {hours.map(h=><option key={h} value={h}>{h}:00</option>)}
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={modal.lbl}>TO HOUR</label>
                <select style={modal.sel} value={leaveToHour} onChange={e=>setLeaveToHour(parseInt(e.target.value))}>
                  {hours.map(h=><option key={h} value={h}>{h}:00</option>)}
                </select>
              </div>
            </div>
            <label style={modal.lbl}>REASON</label>
            <input style={modal.inp} placeholder="Optional reason" value={leaveReason} onChange={e=>setLeaveReason(e.target.value)}/>
            <div style={modal.btnRow}>
              <button style={modal.cancelBtn} onClick={()=>setMarkLeaveModal(null)}>Cancel</button>
              <button style={modal.confirmBtn} onClick={handleMarkLeave} disabled={markingLeave}>
                {markingLeave?'Marking...':'Mark Leave'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════ CLOSE FOLLOW-UP MODAL ══════════ */}
      {closeFollowupModal && (
        <div style={modal.overlay} onClick={()=>setCloseFollowupModal(null)}>
          <div style={modal.box} onClick={e=>e.stopPropagation()}>
            <div style={modal.title}>Close Follow-up</div>
            <div style={{color:'#6b7280',fontSize:'13px',marginBottom:'16px'}}>
              Issue ID: <strong style={{color:'#fff'}}>{closeFollowupModal.issueId}</strong> · {closeFollowupModal.client} · {closeFollowupModal.vehicle}
            </div>
            <label style={modal.lbl}>REASON FOR CLOSING</label>
            <input style={modal.inp} placeholder="e.g. Footage not available, already resolved..." value={closeReason} onChange={e=>setCloseReason(e.target.value)}/>
            <div style={modal.btnRow}>
              <button style={modal.cancelBtn} onClick={()=>setCloseFollowupModal(null)}>Cancel</button>
              <button style={{...modal.confirmBtn,background:'#ef4444'}} onClick={handleCloseFollowup} disabled={closingFollowup}>
                {closingFollowup?'Closing...':'Close Follow-up'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function MiniStat({ label, val, warn }) {
  return (
    <div style={{textAlign:'center',minWidth:'60px'}}>
      <div style={{color:warn?'#f59e0b':'#fff',fontSize:'14px',fontWeight:'700'}}>{val}</div>
      <div style={{color:'#6b7280',fontSize:'8px',letterSpacing:'0.3px'}}>{label}</div>
    </div>
  )
}

function AttendanceDots({ attendance }) {
  return (
    <div style={{display:'flex',gap:'3px'}}>
      {attendance.map((a,i)=>(
        <div key={i} title={`${a.date}: ${a.status}`} style={{
          width:'10px',height:'10px',borderRadius:'3px',
          background:a.status==='active'?'#22c55e':a.status==='completed'?'#3b82f6':'#3a1515',
        }}></div>
      ))}
    </div>
  )
}

const s = {
  body: { padding:'20px', maxWidth:'1400px', margin:'0 auto' },
  tabs: { display:'flex', gap:'4px', borderBottom:'1px solid #222', marginBottom:'20px', overflowX:'auto' },
  tab: { background:'transparent', border:'none', borderBottom:'2px solid transparent', color:'#6b7280', padding:'10px 16px', fontSize:'13px', cursor:'pointer', marginBottom:'-1px', whiteSpace:'nowrap' },
  tabActive: { color:'#22c55e', borderBottomColor:'#22c55e', fontWeight:'600' },
  kpiStrip: { display:'flex', gap:'8px', marginBottom:'20px', flexWrap:'wrap' },
  kpiPill: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'10px 16px', display:'flex', alignItems:'center', gap:'8px' },
  empListCard: { background:'#111', border:'1px solid #222', borderRadius:'12px', overflow:'hidden' },
  empRow: { display:'flex', alignItems:'center', gap:'12px', padding:'12px 16px', borderBottom:'1px solid #1a1a1a', flexWrap:'wrap' },
  empDot: { width:'8px', height:'8px', borderRadius:'50%', flexShrink:0 },
  empNameCol: { minWidth:'140px' },
  empNameTxt: { color:'#fff', fontSize:'13px', fontWeight:'600' },
  empSubTxt: { color:'#6b7280', fontSize:'10px', marginTop:'2px' },
  empStatusTag: { fontSize:'11px', fontWeight:'600', minWidth:'80px' },
  empDuration: { color:'#6b7280', fontSize:'12px', minWidth:'70px', textAlign:'center' },
  viewBtn: { background:'transparent', border:'1px solid #2a2a2a', borderRadius:'6px', color:'#6b7280', fontSize:'11px', padding:'6px 12px', cursor:'pointer', whiteSpace:'nowrap', marginLeft:'auto' },
  filterBar: { display:'flex', gap:'10px', alignItems:'center', marginBottom:'16px', flexWrap:'wrap', background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 16px' },
  filterLbl: { color:'#6b7280', fontSize:'10px', letterSpacing:'0.5px', fontWeight:'600' },
  dateInp: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', fontSize:'13px', padding:'8px 10px' },
  quickBtn: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#9ca3af', fontSize:'11px', padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  fdEmpCard: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 16px' },
  fdEmpHeader: { display:'flex', alignItems:'center', gap:'12px', cursor:'pointer', flexWrap:'wrap' },
  progRow: { display:'flex', alignItems:'center', gap:'12px', background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 16px', flexWrap:'wrap' },
  sectionHd: { color:'#22c55e', fontSize:'10px', letterSpacing:'1.5px', fontWeight:'600', marginBottom:'12px' },
  footSumCard: { background:'#161616', borderRadius:'8px', padding:'8px 14px', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px' },
  footCard: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'14px', marginBottom:'8px' },
  searchInp: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', fontSize:'13px', padding:'9px 12px', boxSizing:'border-box' },
  table: { width:'100%', borderCollapse:'collapse', background:'#111', borderRadius:'10px', overflow:'hidden', border:'1px solid #222' },
  tableHd: { color:'#6b7280', fontSize:'10px', letterSpacing:'0.5px', padding:'10px 14px', textAlign:'left', fontWeight:'600' },
  tableTd: { color:'#fff', fontSize:'12px', padding:'10px 14px' },
}

const modal = {
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'blur(2px)' },
  box: { background:'#111', border:'1px solid #222', borderRadius:'16px', padding:'1.5rem', width:'360px', maxWidth:'90vw' },
  title: { color:'#fff', fontSize:'16px', fontWeight:'700', marginBottom:'16px' },
  row: { display:'flex', gap:'10px', marginBottom:'14px' },
  lbl: { display:'block', color:'#22c55e', fontSize:'10px', letterSpacing:'1px', fontWeight:'600', marginBottom:'5px' },
  sel: { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', padding:'8px 10px', fontSize:'13px' },
  inp: { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', padding:'9px 12px', fontSize:'13px', marginBottom:'16px', boxSizing:'border-box' },
  btnRow: { display:'flex', gap:'8px' },
  cancelBtn: { flex:1, background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#6b7280', fontSize:'13px', padding:'10px', cursor:'pointer' },
  confirmBtn: { flex:1, background:'#22c55e', border:'none', borderRadius:'8px', color:'#000', fontSize:'13px', fontWeight:'700', padding:'10px', cursor:'pointer' },
}
