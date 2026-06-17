import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Navbar from '../components/Navbar'

const STATUS_OPTIONS  = ['', 'Updated', 'No New Misalignment', 'All Vehicles are Offline', 'No Misalignment']
const FATIGUE_OPTIONS = ['No', 'Yes']

export default function Dashboard() {
  const router = useRouter()
  const [user,         setUser]         = useState(null)
  const [shiftStatus,  setShiftStatus]  = useState('loading')
  const [startTime,    setStartTime]    = useState('')
  const [currentHour,  setCurrentHour]  = useState(new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getHours())
  const [clients,      setClients]      = useState([])
  const [filled,       setFilled]       = useState({})
  const [footage,      setFootage]      = useState({ pending: [], completed: [] })
  const [footageSearchInput, setFootageSearchInput] = useState('')
  const [footageSearch, setFootageSearch] = useState('')
  const [dateFilter,   setDateFilter]   = useState('')
  const [myDay,        setMyDay]        = useState(null)
  const [activeTab,    setActiveTab]    = useState('clients')
  const [saving,       setSaving]       = useState({})
  const [showReport,   setShowReport]   = useState(false)
  const [report,       setReport]       = useState(null)
  const hourRef    = useRef(currentHour)
  const autoRef    = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setFootageSearch(footageSearchInput), 300)
    return () => clearTimeout(debounceRef.current)
  }, [footageSearchInput])

  useEffect(() => {
    async function init() {
      const meRes  = await fetch('/api/auth/me')
      const meData = await meRes.json()
      if (!meData.user) { router.replace('/login'); return }
      setUser(meData.user)

      const statusRes  = await fetch('/api/shift/status')
      const statusData = await statusRes.json()

      if (statusData.status === 'active') {
        setShiftStatus('active')
        setStartTime(statusData.startTime)
      } else {
        setShiftStatus('not_started')
      }
    }
    init().catch(() => router.replace('/login'))
  }, [])

  const loadClients = useCallback(async () => {
    const res  = await fetch('/api/clients/current')
    const data = await res.json()
    if (data.clients) setClients(data.clients)
    if (data.filled)  setFilled(data.filled)
    setCurrentHour(data.hour)
    hourRef.current = data.hour
  }, [])

  const loadFootage = useCallback(async () => {
    const res  = await fetch('/api/footage/list')
    const data = await res.json()
    setFootage({ pending: data.pending || [], completed: data.completed || [] })
  }, [])

  const loadMyDay = useCallback(async () => {
    const res  = await fetch('/api/dashboard/my-day')
    const data = await res.json()
    setMyDay(data)
  }, [])

  useEffect(() => {
    if (shiftStatus !== 'active') return
    loadClients()
    loadFootage()
    autoRef.current = setInterval(() => {
      const h = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getHours()
      if (h !== hourRef.current) { loadClients(); loadMyDay() }
      loadFootage()
      if (activeTab === 'myday') loadMyDay()
    }, 60000)
    return () => clearInterval(autoRef.current)
  }, [shiftStatus, activeTab])

  useEffect(() => {
    if (activeTab === 'myday' && shiftStatus === 'active') loadMyDay()
  }, [activeTab, shiftStatus])

  async function handleStartShift() {
    const res  = await fetch('/api/shift/start', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setShiftStatus('active')
      setStartTime(data.startTime)
      loadClients()
      loadFootage()
    }
  }

  async function handleEndShift() {
    if (!confirm('Are you sure you want to end your shift?')) return
    const res  = await fetch('/api/shift/end', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setShiftStatus('ended')
      setReport(data.report)
      setShowReport(true)
      clearInterval(autoRef.current)
    }
  }

  async function saveUpdate(client, field, value) {
    const key = `${client}_${field}`
    setSaving(p => ({...p, [key]: true}))
    const current = filled[client] || {}
    const updated = { ...current, [field]: value }
    if (field === 'fatigue' && value === 'No') updated.fatigueCount = ''
    setFilled(p => ({ ...p, [client]: updated }))

    await fetch('/api/crm/update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client, slot: currentHour, ...updated }),
    })
    setSaving(p => { const n = {...p}; delete n[key]; return n })
  }

  function downloadReport() {
    if (!report) return
    const rows = [
      ['Cautio CRM — Shift Report'],
      ['Employee', report.employee],
      ['Date', report.date],
      ['Shift Start', report.shiftStart],
      ['Shift End', report.shiftEnd],
      ['Duration', report.duration],
      [],
      ['Clients Handled', report.clientsHandled],
      ['Total Updates', report.totalUpdates],
      ['Misalignments', report.misalignCount],
      ['Total Alerts', report.alertTotal],
      ['Fatigue Alerts', report.fatigueCount],
      ['Clients Redistributed', report.redistributed],
      ['Footage Completed Today', report.footageCompletedToday],
      ['Footage Still Pending', report.footagePending],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `CRM_Report_${report.employee}_${report.date}.csv`
    a.click()
  }

  function downloadFootageCSV(list, filename) {
    const rows = [
      ['Issue ID','Client','Vehicle','Raised At','Details','Location','Resolved','Resolved At'],
      ...list.map(i => [i.issueId, i.client, i.vehicle, i.raisedAt, i.details, i.location, i.resolved?'Yes':'No', i.resolvedAt])
    ]
    const csv  = rows.map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  const hourLabel = (h) => {
    const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
    const suf  = (n) => n >= 12 ? 'PM' : 'AM'
    return `${to12(h)}:00 ${suf(h)} – ${to12((h+1)%24)}:00 ${suf((h+1)%24)}`
  }

  function matchDateFlexible(raisedAtStr, isoDate) {
    if (!isoDate) return true
    const [y, m, d] = isoDate.split('-')
    const ddmmyyyy = `${d}/${m}/${y}`
    return (raisedAtStr || '').includes(ddmmyyyy)
  }

  const filteredPending = useMemo(() => {
    let list = footage.pending
    if (dateFilter) list = list.filter(item => matchDateFlexible(item.raisedAt, dateFilter))
    if (footageSearch.trim()) {
      const q = footageSearch.trim().toLowerCase()
      list = list.filter(item =>
        (item.vehicle || '').toLowerCase().includes(q) ||
        (item.issueId || '').toString().toLowerCase().includes(q) ||
        (item.client  || '').toLowerCase().includes(q)
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
        (item.vehicle || '').toLowerCase().includes(q) ||
        (item.issueId || '').toString().toLowerCase().includes(q) ||
        (item.client  || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [footage.completed, footageSearch, dateFilter])

  if (shiftStatus === 'loading') return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}><div className="spinner"></div></div>

  return (
    <>
      <Head><title>Cautio CRM — Dashboard</title></Head>
      <div style={{minHeight:'100vh', background:'#0a0a0a'}}>
        <Navbar user={user} shiftStatus={shiftStatus} onEndShift={handleEndShift} />
        <div style={s.body}>

          {shiftStatus === 'not_started' && (
            <div style={s.startWrap}>
              <div style={s.startCard}>
                <img src="/cautio_shield.webp" alt="Cautio" style={{width:'56px',height:'56px',objectFit:'contain',margin:'0 auto 1.5rem',display:'block'}} onError={e=>e.target.style.display='none'}/>
                <h2 style={{color:'#fff',fontSize:'22px',fontWeight:'700',marginBottom:'8px',textAlign:'center'}}>
                  Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.name}
                </h2>
                <p style={{color:'#6b7280',fontSize:'14px',marginBottom:'2rem',textAlign:'center'}}>
                  Click Start Shift to begin. Clients will auto-load based on current time.
                </p>
                <div style={s.currentHourBanner}>
                  <span style={{color:'#22c55e',fontWeight:'600'}}>Current slot:</span>
                  <span style={{color:'#fff',marginLeft:'8px'}}>{hourLabel(currentHour)}</span>
                </div>
                <button onClick={handleStartShift} style={s.bigStartBtn}>▶ Start Shift</button>
              </div>
            </div>
          )}

          {shiftStatus === 'active' && (
            <>
              <div style={s.headerRow}>
                <div>
                  <div style={s.greeting}>
                    {user?.name}
                    <span style={s.startedAt}>Started at {startTime}</span>
                  </div>
                  <div style={s.slotLabel}>
                    <span className="live-dot" style={{width:7,height:7,marginRight:6}}></span>
                    Current Slot: <strong style={{color:'#fff',marginLeft:4}}>{hourLabel(currentHour)}</strong>
                    <span style={{color:'#374151',margin:'0 8px'}}>·</span>
                    <span style={{color:'#6b7280'}}>{clients.length} clients</span>
                  </div>
                </div>
              </div>

              <div style={s.tabs}>
                <button style={activeTab==='clients' ? {...s.tab,...s.tabActive} : s.tab} onClick={() => setActiveTab('clients')}>
                  Clients<span style={s.tabCount}>{clients.length}</span>
                </button>
                <button style={activeTab==='myday' ? {...s.tab,...s.tabActive} : s.tab} onClick={() => setActiveTab('myday')}>
                  My Day
                </button>
                <button style={activeTab==='footage' ? {...s.tab,...s.tabActive} : s.tab} onClick={() => setActiveTab('footage')}>
                  Footage Requests
                  {footage.pending.length > 0 && <span style={{...s.tabCount, background:'#ef444422', color:'#f87171', border:'1px solid #ef444433'}}>{footage.pending.length}</span>}
                </button>
              </div>

              {activeTab === 'clients' && (
                <div style={s.tableWrap}>
                  {clients.length === 0 ? (
                    <div style={s.emptyMsg}>No clients assigned for this slot.</div>
                  ) : (
                    <>
                      <div style={s.tHead}>
                        <div style={{...s.th, flex:1.8}}>CLIENT</div>
                        <div style={{...s.th, flex:0.6, textAlign:'center'}}>VEH</div>
                        <div style={{...s.th, flex:1.2}}>STATUS</div>
                        <div style={{...s.th, flex:1.5}}>MISALIGN VEHICLES</div>
                        <div style={{...s.th, flex:0.8}}>ALERTS</div>
                        <div style={{...s.th, flex:1.2}}>FATIGUE</div>
                        <div style={{...s.th, flex:0.6, textAlign:'center'}}>SAVE</div>
                      </div>
                      {clients.map(({ client, vehicleCount, isRedistributed, fromEmployee }) => {
                        const f   = filled[client] || {}
                        const key = (field) => `${client}_${field}`
                        const fatigueIsYes = (f.fatigue || 'No') === 'Yes'
                        return (
                          <div key={client} style={{...s.tRow, ...(isRedistributed ? s.redistributedRow : {})}}>
                            <div style={{...s.td, flex:1.8}}>
                              <div style={s.clientName}>{client}</div>
                              {isRedistributed && <div style={s.redistTag}>↩ from {fromEmployee}</div>}
                            </div>
                            <div style={{...s.td, flex:0.6, justifyContent:'center'}}>
                              <span style={s.vehBadge}>{vehicleCount || 0}</span>
                            </div>
                            <div style={{...s.td, flex:1.2}}>
                              <select style={s.sel} value={f.status || ''} onChange={e => saveUpdate(client, 'status', e.target.value)}>
                                {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o || '— select —'}</option>)}
                              </select>
                            </div>
                            <div style={{...s.td, flex:1.5}}>
                              <input style={s.inp} placeholder="VH1234, VH5678" value={f.misalignVehicles || ''} onChange={e => saveUpdate(client, 'misalignVehicles', e.target.value)} />
                            </div>
                            <div style={{...s.td, flex:0.8}}>
                              <input style={{...s.inp, textAlign:'center'}} type="number" min="0" placeholder="0" value={f.alertCount || ''} onChange={e => saveUpdate(client, 'alertCount', e.target.value)} />
                            </div>
                            <div style={{...s.td, flex:1.2, gap:'6px'}}>
                              <select style={{...s.sel, flex: fatigueIsYes ? '0 0 60px' : '1'}} value={f.fatigue || 'No'} onChange={e => saveUpdate(client, 'fatigue', e.target.value)}>
                                {FATIGUE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                              </select>
                              {fatigueIsYes && (
                                <input style={{...s.inp, flex:1, textAlign:'center'}} type="number" min="0" placeholder="Count" value={f.fatigueCount || ''} onChange={e => saveUpdate(client, 'fatigueCount', e.target.value)} />
                              )}
                            </div>
                            <div style={{...s.td, flex:0.6, justifyContent:'center'}}>
                              {saving[key('status')] || saving[key('alertCount')] || saving[key('fatigueCount')]
                                ? <span className="spinner" style={{width:14,height:14,borderWidth:2}}></span>
                                : <span style={{color:'#22c55e',fontSize:'16px'}}>✓</span>}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'myday' && (
                <div style={{maxWidth:'900px'}}>
                  {!myDay ? (
                    <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
                  ) : (
                    <>
                      <div style={s.dayStatsRow}>
                        <div style={s.dayStat}><span style={{color:'#fff',fontSize:'20px',fontWeight:'700'}}>{myDay.totalClients}</span><span style={{color:'#6b7280',fontSize:'10px'}}>TOTAL TODAY</span></div>
                        <div style={s.dayStat}><span style={{color:'#22c55e',fontSize:'20px',fontWeight:'700'}}>{myDay.totalCompleted}</span><span style={{color:'#6b7280',fontSize:'10px'}}>COMPLETED</span></div>
                        <div style={s.dayStat}><span style={{color:'#f87171',fontSize:'20px',fontWeight:'700'}}>{myDay.totalMissed}</span><span style={{color:'#6b7280',fontSize:'10px'}}>MISSED</span></div>
                      </div>

                      {myDay.timeline.length === 0 ? (
                        <div style={s.emptyMsg}>No activity yet today.</div>
                      ) : (
                        myDay.timeline.map(slot => (
                          <div key={slot.hour} style={s.timelineSlot}>
                            <div style={s.timelineSlotHead}>
                              <span style={{color:'#fff',fontSize:'13px',fontWeight:'700'}}>{hourLabel(slot.hour)}</span>
                              <span style={{color: slot.completedClients === slot.totalClients ? '#22c55e' : '#f59e0b', fontSize:'11px'}}>
                                {slot.completedClients}/{slot.totalClients} done
                              </span>
                            </div>
                            <div style={s.timelineClients}>
                              {slot.clients.map((c, i) => (
                                <div key={i} style={{...s.timelineClientChip, ...(c.filled ? s.chipDone : s.chipPending)}}>
                                  {c.filled ? '✓' : c.isRedistributed ? '↩' : '○'} {c.client}
                                  {c.isRedistributed && <span style={{opacity:0.6}}> (from {c.fromEmployee})</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))
                      )}

                      {myDay.redistributedAway?.length > 0 && (
                        <div style={s.redistAwayBox}>
                          ↪ You passed {myDay.redistributedAway.length} client(s) to other employees today (early shift end or reassignment).
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'footage' && (
                <div style={s.footageWrap}>
                  <div style={s.footSummary}>
                    <div style={s.footStat}>
                      <span style={{color:'#f59e0b',fontSize:'22px',fontWeight:'700'}}>{filteredPending.length}</span>
                      <span style={{color:'#6b7280',fontSize:'10px',letterSpacing:'0.5px'}}>PENDING</span>
                    </div>
                    <div style={s.footStat}>
                      <span style={{color:'#22c55e',fontSize:'22px',fontWeight:'700'}}>{filteredCompleted.length}</span>
                      <span style={{color:'#6b7280',fontSize:'10px',letterSpacing:'0.5px'}}>COMPLETED</span>
                    </div>
                    <div style={{flex:1, minWidth:'200px'}}>
                      <input style={s.searchInp} placeholder="🔍 Search by vehicle no. or issue ID..." value={footageSearchInput} onChange={e => setFootageSearchInput(e.target.value)} />
                    </div>
                    <div>
                      <input type="date" style={s.dateInp} value={dateFilter} onChange={e => setDateFilter(e.target.value)} title="Filter by Raised date" />
                    </div>
                    {dateFilter && (
                      <button style={s.clearBtn} onClick={() => setDateFilter('')}>✕ Clear date</button>
                    )}
                    <button style={s.dlBtnSmall} onClick={() => downloadFootageCSV([...filteredPending, ...filteredCompleted], `Footage_${user.name}_${new Date().toLocaleDateString('en-IN').replace(/\//g,'-')}.csv`)}>⬇ CSV</button>
                  </div>

                  {filteredPending.length === 0 && filteredCompleted.length === 0 && (
                    <div style={s.emptyMsg}>No footage requests found{dateFilter || footageSearch ? ' for this filter' : ' assigned to you'}.</div>
                  )}

                  {filteredPending.map(item => (
                    <div key={item.issueId} style={s.footCard}>
                      <div style={s.footTop}>
                        <div>
                          <div style={s.footClient}><span style={{color:'#60a5fa',marginRight:'6px'}}>▶</span>{item.client} · {item.vehicle}</div>
                          <div style={s.footMeta}>Issue ID: {item.issueId} &nbsp;·&nbsp; Raised: {item.raisedAt} &nbsp;·&nbsp; {item.location && `Location: ${item.location}`}</div>
                          {item.details && <div style={s.footDetails}>{item.details}</div>}
                        </div>
                        <span className="badge badge-amber">PENDING</span>
                      </div>
                    </div>
                  ))}

                  {filteredCompleted.length > 0 && (
                    <>
                      <div style={{color:'#374151',fontSize:'10px',letterSpacing:'1px',margin:'16px 0 8px',fontWeight:'600'}}>COMPLETED</div>
                      {filteredCompleted.map(item => (
                        <div key={item.issueId} style={{...s.footCard, opacity:0.6}}>
                          <div style={s.footTop}>
                            <div>
                              <div style={s.footClient}><span style={{color:'#22c55e',marginRight:'6px'}}>✓</span>{item.client} · {item.vehicle}</div>
                              <div style={s.footMeta}>Completed: {item.resolvedAt} &nbsp;·&nbsp; Issue: {item.issueId}</div>
                            </div>
                            <span className="badge badge-green">DONE</span>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          {shiftStatus === 'ended' && showReport && report && (
            <div style={s.reportWrap}>
              <div style={s.reportCard}>
                <img src="/cautio_shield.webp" alt="Cautio" style={{width:'40px',height:'40px',objectFit:'contain',display:'block',margin:'0 auto 8px'}} onError={e=>e.target.style.display='none'}/>
                <h2 style={{color:'#fff',textAlign:'center',marginBottom:'4px'}}>Shift Complete</h2>
                <p style={{color:'#6b7280',textAlign:'center',fontSize:'13px',marginBottom:'2rem'}}>
                  {report.date} · {report.shiftStart} → {report.shiftEnd} · {report.duration}
                </p>
                <div style={s.reportGrid}>
                  <div style={s.repStat}><span style={{color:'#22c55e',fontSize:'24px',fontWeight:'700'}}>{report.clientsHandled}</span><span style={{color:'#6b7280',fontSize:'10px'}}>CLIENTS</span></div>
                  <div style={s.repStat}><span style={{color:'#22c55e',fontSize:'24px',fontWeight:'700'}}>{report.totalUpdates}</span><span style={{color:'#6b7280',fontSize:'10px'}}>UPDATES</span></div>
                  <div style={s.repStat}><span style={{color:'#f59e0b',fontSize:'24px',fontWeight:'700'}}>{report.misalignCount}</span><span style={{color:'#6b7280',fontSize:'10px'}}>MISALIGNS</span></div>
                  <div style={s.repStat}><span style={{color:'#f87171',fontSize:'24px',fontWeight:'700'}}>{report.alertTotal}</span><span style={{color:'#6b7280',fontSize:'10px'}}>ALERTS</span></div>
                </div>
                <div style={s.reportGrid}>
                  <div style={s.repStat}><span style={{color:'#a78bfa',fontSize:'24px',fontWeight:'700'}}>{report.fatigueCount}</span><span style={{color:'#6b7280',fontSize:'10px'}}>FATIGUE</span></div>
                  <div style={s.repStat}><span style={{color:'#22c55e',fontSize:'24px',fontWeight:'700'}}>{report.footageCompletedToday}</span><span style={{color:'#6b7280',fontSize:'10px'}}>FOOTAGE DONE</span></div>
                  <div style={s.repStat}><span style={{color:'#f59e0b',fontSize:'24px',fontWeight:'700'}}>{report.footagePending}</span><span style={{color:'#6b7280',fontSize:'10px'}}>FOOTAGE PENDING</span></div>
                  <div style={s.repStat}><span style={{color:'#fff',fontSize:'24px',fontWeight:'700'}}>{report.redistributed}</span><span style={{color:'#6b7280',fontSize:'10px'}}>REDISTRIBUTED</span></div>
                </div>
                {report.redistributed > 0 && (
                  <div style={s.redistInfo}>↩ {report.redistributed} clients redistributed to: {[...new Set(report.redistributedTo)].join(', ')}</div>
                )}
                <button onClick={downloadReport} style={s.downloadBtn}>⬇ Download CSV Report</button>
                <button onClick={() => { fetch('/api/auth/logout',{method:'POST'}); router.push('/login') }} style={s.logoutFinalBtn}>Logout</button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}

const s = {
  body:         { padding: '20px', maxWidth: '1400px', margin: '0 auto' },
  startWrap:    { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'80vh' },
  startCard:    { background:'#111', border:'1px solid #222', borderRadius:'16px', padding:'3rem 2rem', maxWidth:'420px', width:'100%', textAlign:'center' },
  currentHourBanner: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'10px 16px', marginBottom:'1.5rem', fontSize:'13px' },
  bigStartBtn:  { width:'100%', background:'#22c55e', border:'none', borderRadius:'10px', color:'#000', fontWeight:'700', fontSize:'16px', padding:'14px', cursor:'pointer' },
  headerRow:    { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'16px' },
  greeting:     { color:'#fff', fontSize:'18px', fontWeight:'700', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' },
  startedAt:    { color:'#6b7280', fontSize:'12px', fontWeight:'400' },
  slotLabel:    { color:'#6b7280', fontSize:'13px', marginTop:'4px', display:'flex', alignItems:'center', flexWrap:'wrap' },
  tabs:         { display:'flex', gap:'4px', borderBottom:'1px solid #222', marginBottom:'16px', overflowX:'auto' },
  tab:          { background:'transparent', border:'none', borderBottom:'2px solid transparent', color:'#6b7280', padding:'8px 16px', fontSize:'13px', fontWeight:'500', cursor:'pointer', marginBottom:'-1px', display:'flex', alignItems:'center', gap:'6px', whiteSpace:'nowrap' },
  tabActive:    { color:'#22c55e', borderBottomColor:'#22c55e', fontWeight:'600' },
  tabCount:     { background:'#22c55e22', border:'1px solid #22c55e33', borderRadius:'10px', padding:'1px 7px', fontSize:'10px', color:'#22c55e', fontWeight:'700' },
  tableWrap:    { background:'#111', border:'1px solid #222', borderRadius:'12px', overflow:'hidden', overflowX:'auto' },
  tHead:        { display:'flex', gap:'8px', padding:'10px 16px', background:'#161616', borderBottom:'1px solid #222', minWidth:'860px' },
  th:           { color:'#6b7280', fontSize:'9px', letterSpacing:'1px', fontWeight:'600', flex:1 },
  tRow:         { display:'flex', gap:'8px', padding:'10px 16px', borderBottom:'1px solid #1a1a1a', alignItems:'center', minWidth:'860px' },
  redistributedRow: { borderLeft:'3px solid #f59e0b', background:'#1a1400' },
  td:           { flex:1, display:'flex', alignItems:'center' },
  clientName:   { color:'#fff', fontSize:'12px', fontWeight:'600' },
  redistTag:    { color:'#f59e0b', fontSize:'10px', marginTop:'2px' },
  vehBadge:     { background:'#16161688', border:'1px solid #2a2a2a', borderRadius:'6px', padding:'2px 8px', color:'#9ca3af', fontSize:'11px', fontWeight:'600' },
  sel:          { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'6px', color:'#22c55e', fontSize:'11px', padding:'5px 6px' },
  inp:          { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'6px', color:'#fff', fontSize:'11px', padding:'5px 8px' },
  searchInp:    { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', fontSize:'13px', padding:'10px 14px', boxSizing:'border-box' },
  dateInp:      { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', fontSize:'13px', padding:'9px 10px', boxSizing:'border-box' },
  clearBtn:     { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#6b7280', fontSize:'11px', padding:'9px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  dlBtnSmall:   { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#6b7280', fontSize:'11px', padding:'9px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  emptyMsg:     { color:'#6b7280', textAlign:'center', padding:'3rem', fontSize:'14px' },
  footageWrap:  { maxWidth:'1000px' },
  footSummary:  { display:'flex', gap:'10px', marginBottom:'16px', flexWrap:'wrap', alignItems:'center' },
  footStat:     { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 20px', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px', minWidth:'90px' },
  footCard:     { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'14px', marginBottom:'8px' },
  footTop:      { display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px' },
  footClient:   { color:'#fff', fontSize:'13px', fontWeight:'600', marginBottom:'4px' },
  footMeta:     { color:'#6b7280', fontSize:'11px' },
  footDetails:  { color:'#9ca3af', fontSize:'11px', marginTop:'4px', fontStyle:'italic' },
  reportWrap:   { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'80vh' },
  reportCard:   { background:'#111', border:'1px solid #222', borderRadius:'16px', padding:'2.5rem 2rem', maxWidth:'520px', width:'100%' },
  reportGrid:   { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px', marginBottom:'12px' },
  repStat:      { background:'#161616', borderRadius:'10px', padding:'12px', display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' },
  redistInfo:   { background:'#1a1200', border:'1px solid #f59e0b33', borderRadius:'8px', padding:'10px 14px', color:'#fbbf24', fontSize:'12px', margin:'1rem 0' },
  downloadBtn:  { width:'100%', background:'#22c55e', border:'none', borderRadius:'8px', color:'#000', fontWeight:'700', fontSize:'14px', padding:'12px', cursor:'pointer', marginBottom:'8px', marginTop:'1rem' },
  logoutFinalBtn: { width:'100%', background:'transparent', border:'1px solid #222', borderRadius:'8px', color:'#6b7280', fontSize:'14px', padding:'10px', cursor:'pointer' },
  dayStatsRow:  { display:'flex', gap:'10px', marginBottom:'16px' },
  dayStat:      { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 24px', display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' },
  timelineSlot: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 14px', marginBottom:'8px' },
  timelineSlotHead: { display:'flex', justifyContent:'space-between', marginBottom:'8px' },
  timelineClients: { display:'flex', flexWrap:'wrap', gap:'6px' },
  timelineClientChip: { fontSize:'11px', padding:'4px 10px', borderRadius:'6px', border:'1px solid' },
  chipDone:    { background:'#22c55e14', borderColor:'#22c55e33', color:'#4ade80' },
  chipPending: { background:'#f59e0b14', borderColor:'#f59e0b33', color:'#fbbf24' },
  redistAwayBox: { background:'#1a1200', border:'1px solid #f59e0b33', borderRadius:'8px', padding:'10px 14px', color:'#fbbf24', fontSize:'12px', marginTop:'10px' },
}
