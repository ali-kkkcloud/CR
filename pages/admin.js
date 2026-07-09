import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Sidebar from '../components/Sidebar'
import LogoutModal from '../components/LogoutModal'
import Icon from '../components/Icons'

// ─────────────────────────────────────────────────────────────────────────
// CAUTIO Command Center — brand tokens (Design Bible v1)
// ─────────────────────────────────────────────────────────────────────────
const C = {
  bg:         '#000000',
  card:       '#1E1E1E',
  border:     '#171717',
  borderRow:  '#262626',
  border2:    '#2a2a2a',
  s2:         '#262626',
  accent:     '#94EC8E',
  accentSoft: '#94EC8E14',
  accentDark: '#215B3B',
  text:       '#FFFFFF',
  text2:      '#D8D8D8',
  muted:      '#9E9E9E',
  dim:        '#3f3f3f',
  red:        '#f87171',
  redBg:      '#3a1515',
  amber:      '#fbbf24',
  amberBg:    '#1a1200',
  blue:       '#60a5fa',
  purple:     '#a78bfa',
}

function todayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return d.toISOString().split('T')[0]
}

const TAB_META = {
  overview:       { title: 'Overview',           tag: 'Command Center', sub: "Real-time visibility of your entire fleet operations" },
  fullday:        { title: 'Full Day View',       tag: 'Command Center', sub: 'Hour-by-hour visibility for every employee' },
  progress:       { title: 'Employee Progress',   tag: 'Command Center', sub: 'Attendance and output across a date range' },
  footage:        { title: 'Footage Requests',    tag: 'Command Center', sub: 'Pending and completed footage requests' },
  followups:      { title: 'Follow-ups',          tag: 'Command Center', sub: 'Open follow-ups awaiting resolution' },
  redistribution: { title: 'Redistribution Log',  tag: 'Command Center', sub: "Today's workload redistribution across employees" },
  leaves:         { title: 'Leaves',              tag: 'Command Center', sub: 'Leave calendar — coming soon' },
  reports:        { title: 'Reports',             tag: 'Command Center', sub: 'Scheduled and downloadable reports — coming soon' },
  analytics:      { title: 'Analytics',           tag: 'Command Center', sub: 'Deeper trends across your fleet — coming soon' },
  alerts:         { title: 'Alerts',              tag: 'Command Center', sub: 'All system and AI alerts in one place — coming soon' },
  settings:       { title: 'Settings',            tag: 'Command Center', sub: 'Workspace and account preferences — coming soon' },
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
  const [showLogout, setShowLogout] = useState(false)
  const [clock, setClock] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true,
      }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

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
    const dateStr = fullDayDate.split('-').reverse().join('/')

    // Step 1: Mark leave in sheet
    await fetch('/api/admin/mark-leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empName: markLeaveModal.name,
        date: dateStr,
        fromHour: leaveFromHour,
        toHour: leaveToHour,
        reason: leaveReason || 'Admin marked',
      }),
    })

    // Step 2: Apply redistribution immediately
    const redistRes = await fetch('/api/admin/apply-leave-redistribution', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empName: markLeaveModal.name,
        date: dateStr,
        fromHour: leaveFromHour,
        toHour: leaveToHour,
      }),
    })
    const redistData = await redistRes.json()

    setMarkingLeave(false)
    setMarkLeaveModal(null)
    setLeaveReason('')
    loadFullDay(fullDayDate)
    loadData()

    if (redistData.redistributed > 0) {
      alert(`✓ Leave marked. ${redistData.redistributed} client slots redistributed across ${redistData.hours} hours.`)
    }
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

  async function handleLogoutConfirm() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setShowLogout(false)
    router.push('/login')
  }

  function downloadCSV(rows, filename) {
    const csv  = rows.map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = filename; a.click()
  }

  function downloadDailyReport() {
    if (!overview) return
    const rows = [
      ['Employee', 'Status', 'Shift', 'Start', 'End', 'Duration', 'Updates', 'Pending'],
      ...overview.employees.map(e => [e.name, e.statusLabel, `${e.shiftStart}:00-${e.shiftEnd}:00`, e.startTime, e.endTime, e.duration, e.totalUpdates, e.pendingCount]),
    ]
    downloadCSV(rows, `Daily_Report_${todayISO()}.csv`)
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

  // ── Derived, real-data widgets for the Overview tab ──────────────────────
  const clientDistribution = useMemo(() => {
    const all = [...footage.pending, ...footage.completed]
    const counts = {}
    all.forEach(i => { const c = i.client || 'Unknown'; counts[c] = (counts[c]||0)+1 })
    const sorted = Object.entries(counts).sort((a,b)=>b[1]-a[1])
    const top = sorted.slice(0,5)
    const othersTotal = sorted.slice(5).reduce((s,[,v])=>s+v,0)
    const palette = [C.red, C.blue, C.purple, C.amber, C.accent]
    const segs = top.map(([name,val],i) => ({ label:name, value:val, color:palette[i%palette.length] }))
    if (othersTotal>0) segs.push({ label:'Others', value:othersTotal, color:C.dim })
    return segs
  }, [footage.pending, footage.completed])

  const activityFeed = useMemo(() => {
    if (!overview) return []
    const items = []
    overview.employees.forEach(e => {
      if (e.startTime) items.push({ icon:'check-circle', color:C.accent, name:e.name, action:'started shift', time:e.startTime })
      if (e.endTime)   items.push({ icon:'check-circle', color:C.muted, name:e.name, action:'ended shift', time:e.endTime })
    })
    footage.completed.slice(0,4).forEach(i => {
      items.push({ icon:'footage', color:C.blue, name:i.raisedBy||'Team', action:`completed footage for ${i.vehicle}`, time:i.resolvedAt||'' })
    })
    overview.redistribution.slice(0,4).forEach(r => {
      items.push({ icon:'shuffle', color:C.purple, name:r.from, action:`redistributed ${r.client} to ${r.to}`, time:`${r.hour}:00` })
    })
    return items.slice(0,8)
  }, [overview, footage.completed])

  if (loading || !overview) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:C.bg}}>
      <div className="spinner"></div>
    </div>
  )

  const { employees, kpis, redistribution } = overview

  const statusMeta = (st) => ({
    'Active':      { color:C.accent, label:'Active' },
    'Ended':       { color:C.muted,  label:'Shift ended' },
    'Week Off':    { color:C.amber,  label:'Week off' },
    'Not Started': { color:C.red,    label:'Not started' },
    'Off Shift':   { color:C.dim,    label:'Off shift' },
  }[st] || { color:C.muted, label:st })

  const hourLabel = (h) => {
    const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
    const suf  = (n) => n >= 12 ? 'PM' : 'AM'
    return `${to12(h)}:00 ${suf(h)}`
  }

  const hours = Array.from({ length: 24 }, (_, i) => i)

  const totalUpdatesToday = employees.reduce((s,e)=>s+(e.totalUpdates||0),0)
  const totalPendingToday = employees.reduce((s,e)=>s+(e.pendingCount||0),0)
  const completionPct = totalUpdatesToday+totalPendingToday>0
    ? Math.round((totalUpdatesToday/(totalUpdatesToday+totalPendingToday))*100) : 100
  const fleetHealthPct = kpis.total>0 ? Math.round((kpis.active/kpis.total)*100) : 0
  const activePct = kpis.total>0 ? Math.round((kpis.active/kpis.total)*100) : 0

  const statusCounts = employees.reduce((acc,e)=>{ acc[e.statusLabel]=(acc[e.statusLabel]||0)+1; return acc }, {})
  const statusDonutSegs = [
    { label:'Active',      value:statusCounts['Active']||0,      color:C.accent },
    { label:'Ended',       value:statusCounts['Ended']||0,       color:C.blue },
    { label:'Week Off',    value:statusCounts['Week Off']||0,    color:C.amber },
    { label:'Not Started', value:statusCounts['Not Started']||0, color:C.red },
    { label:'Off Shift',   value:statusCounts['Off Shift']||0,   color:C.dim },
  ].filter(s=>s.value>0)

  const topPerformers = [...employees].sort((a,b)=>(b.totalUpdates||0)-(a.totalUpdates||0)).slice(0,5)
  const maxUpdates = Math.max(1, ...topPerformers.map(e=>e.totalUpdates||0))

  const aiAlerts = []
  if (kpis.notStarted>0) aiAlerts.push({ sev:'high', icon:'alerts', title:'Not Started', desc:`${kpis.notStarted} employee(s) have not started their shift yet` })
  if (footage.followups.length>0) aiAlerts.push({ sev:'warn', icon:'followups', title:'Follow-up Pending', desc:`${footage.followups.length} follow-up(s) require attention` })
  if (footage.pending.length>0) aiAlerts.push({ sev:'info', icon:'footage', title:'Footage Requests', desc:`${footage.pending.length} pending footage request(s)` })
  if (redistribution.length>0) aiAlerts.push({ sev:'success', icon:'shuffle', title:'Redistribution Done', desc:`${redistribution.length} slot(s) redistributed across employees today` })

  const tabMeta = TAB_META[activeTab] || TAB_META.overview
  const notifCount = footage.pending.length + footage.followups.length

  return (
    <>
      <Head><title>Cautio CRM — Admin</title></Head>
      <div style={{minHeight:'100vh', background:C.bg, display:'flex'}}>

        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          counts={{ footage: footage.pending.length, followups: footage.followups.length, redistribution: redistribution.length }}
          employeesMonitored={kpis.total}
        />

        <div style={{flex:1, minWidth:0}}>

          {/* ══════════ TOPBAR ══════════ */}
          <div style={s.topbar}>
            <div>
              <div style={{display:'flex', alignItems:'baseline', gap:'10px'}}>
                <span style={s.topTitle}>{tabMeta.title}</span>
                <span style={s.topTag}>{tabMeta.tag}</span>
              </div>
              <div style={s.topSub}>{tabMeta.sub}</div>
            </div>
            <div style={s.topRight}>
              <div style={s.pill}><Icon name="calendar" size={13} color={C.muted}/> {new Date().toLocaleDateString('en-GB',{ day:'2-digit', month:'short', year:'numeric' })}</div>
              <div style={s.pill}><Icon name="clock" size={13} color={C.muted}/> {clock} <span style={{color:C.dim, marginLeft:2}}>IST</span></div>
              <button style={s.bellBtn} onClick={()=>setActiveTab('overview')}>
                <Icon name="bell" size={16} color={C.text2}/>
                {notifCount>0 && <span style={s.bellBadge}>{notifCount>9?'9+':notifCount}</span>}
              </button>
              <button style={s.profilePill} onClick={()=>setShowLogout(true)}>
                <div style={s.avatar}>{(user?.name||'U').slice(0,2).toUpperCase()}</div>
                <div style={{textAlign:'left'}}>
                  <div style={s.profileName}>{user?.name||'Admin User'}</div>
                  <div style={s.profileRole}>Super Admin</div>
                </div>
                <Icon name="chevron-down" size={13} color={C.muted}/>
              </button>
            </div>
          </div>

          {activeTab === 'overview' && (
            <div style={{padding:'0 24px 8px'}}>
              <div style={s.actionRow}>
                <button style={s.outlineBtn} onClick={downloadDailyReport}><Icon name="download" size={13} color={C.text2}/> Download Daily Report</button>
                <button style={s.accentBtn} onClick={()=>setActiveTab('fullday')}>View Full Day <Icon name="arrow-right" size={13} color="#06120a"/></button>
              </div>
            </div>
          )}

          <div style={s.body}>

          {/* ══════════ OVERVIEW ══════════ */}
          {activeTab === 'overview' && (
            <>
              <div style={s.kpiGrid}>
                <KpiCard icon="shield" label="Fleet Health" value={`${fleetHealthPct}%`} sub="Active vs total workforce" />
                <KpiCard icon="users" label="Active Employees" value={kpis.active} sub={`${activePct}% of total`} progress={activePct} />
                <KpiCard icon="check-circle" label="Updates Completed" value={totalUpdatesToday} sub="Across all employees today" />
                <KpiCard icon="clock" label="Pending Updates" value={totalPendingToday} sub="Awaiting completion" subColor={totalPendingToday>0?C.amber:C.muted} />
                <KpiCard icon="leaves" label="Week Off" value={kpis.weekOff} sub="Scheduled off today" />
                <KpiCard icon="offline" label="Not Started" value={kpis.notStarted} sub="Should be active by now" subColor={kpis.notStarted>0?C.red:C.muted} />
                <KpiCard icon="camera" label="Footage Queue" value={footage.pending.length} sub={`${footage.followups.length} follow-up(s) open`} subColor={footage.pending.length>0?C.amber:C.muted} />
                <KpiCard icon="shuffle" label="Redistribution Today" value={redistribution.length} sub="Slots reassigned" />
              </div>

              <div style={s.row1}>
                {/* Live Fleet Map — preview placeholder (needs vehicle GPS feed) */}
                <div style={{...s.card, gridColumn:'span 2', minHeight:'320px'}}>
                  <div style={s.cardHeadRow}>
                    <div style={s.cardHead}><span className="live-dot" style={{width:7,height:7}}></span> LIVE FLEET MAP</div>
                    <span style={s.previewTag}>PREVIEW</span>
                  </div>
                  <div style={s.mapArea}>
                    <MapIllustration />
                    <div style={s.mapOverlayNote}>
                      Vehicle GPS feed not connected yet — this panel will light up with live vehicle
                      locations once the tracking API is wired in.
                    </div>
                  </div>
                </div>

                {/* Employee Status donut */}
                <div style={s.card}>
                  <div style={s.cardHeadRow}>
                    <div style={s.cardHead}>EMPLOYEE STATUS <span style={{color:C.muted, fontWeight:400}}>(Live)</span></div>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:'14px', marginBottom:'14px'}}>
                    <Donut segments={statusDonutSegs} size={110} thickness={15} centerLabel={kpis.total} centerSub="Employees" />
                    <div style={{display:'flex', flexDirection:'column', gap:'7px', flex:1}}>
                      {statusDonutSegs.map(seg => (
                        <div key={seg.label} style={{display:'flex', alignItems:'center', gap:'7px'}}>
                          <span style={{width:8,height:8,borderRadius:'50%',background:seg.color,flexShrink:0}}></span>
                          <span style={{color:C.text2, fontSize:'11px', flex:1}}>{seg.label}</span>
                          <span style={{color:C.text, fontSize:'11px', fontWeight:600}}>{seg.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{borderTop:`1px solid ${C.border}`, paddingTop:'12px'}}>
                    <div style={{...s.cardHead, marginBottom:'8px'}}>TOP PERFORMERS <span style={{color:C.muted, fontWeight:400}}>(Today)</span></div>
                    {topPerformers.length===0 ? (
                      <div style={{color:C.muted, fontSize:'11px'}}>No updates recorded yet.</div>
                    ) : topPerformers.map((e,i) => (
                      <div key={e.name} style={{display:'flex', alignItems:'center', gap:'8px', marginBottom:'6px'}}>
                        <span style={{color:C.muted, fontSize:'10px', width:'12px'}}>{i+1}</span>
                        <span style={{color:C.text, fontSize:'11px', width:'80px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{e.name}</span>
                        <div style={{flex:1, height:'5px', background:C.border2, borderRadius:'3px', overflow:'hidden'}}>
                          <div style={{height:'100%', width:`${Math.round((e.totalUpdates/maxUpdates)*100)}%`, background:C.accent, borderRadius:'3px'}}></div>
                        </div>
                        <span style={{color:C.muted, fontSize:'10px', width:'26px', textAlign:'right'}}>{e.totalUpdates}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* AI Alerts */}
                <div style={s.card}>
                  <div style={s.cardHeadRow}>
                    <div style={s.cardHead}>AI ALERTS &amp; NOTIFICATIONS</div>
                  </div>
                  <div style={{display:'flex', flexDirection:'column', gap:'10px', marginBottom:'12px'}}>
                    {aiAlerts.length===0 ? (
                      <div style={{color:C.muted, fontSize:'11px', padding:'8px 0'}}>All clear — no active alerts.</div>
                    ) : aiAlerts.map((a,i) => <AlertRow key={i} alert={a} />)}
                  </div>
                  {aiAlerts.length>0 && (
                    <div style={s.aiRecBox}>
                      <div style={{flex:1}}>
                        <div style={{color:C.text, fontSize:'11px', fontWeight:600, marginBottom:'2px'}}>AI Recommendation</div>
                        <div style={{color:C.muted, fontSize:'10.5px'}}>
                          {kpis.notStarted>0
                            ? `Follow up with employees who haven't started their shift.`
                            : `Clear the ${footage.pending.length} pending footage request(s) to keep response time low.`}
                        </div>
                      </div>
                      <button style={s.miniAccentBtn} onClick={()=>setActiveTab(kpis.notStarted>0?'fullday':'footage')}>View Details</button>
                    </div>
                  )}
                </div>
              </div>

              <div style={s.row2}>
                {/* Client distribution */}
                <div style={s.card}>
                  <div style={s.cardHead}>CLIENT DISTRIBUTION <span style={{color:C.muted, fontWeight:400}}>(Footage Requests)</span></div>
                  {clientDistribution.length===0 ? (
                    <div style={{color:C.muted, fontSize:'11px', padding:'20px 0', textAlign:'center'}}>No footage requests yet.</div>
                  ) : (
                    <div style={{display:'flex', alignItems:'center', gap:'12px', marginTop:'10px'}}>
                      <Donut segments={clientDistribution} size={92} thickness={13} centerLabel={clientDistribution.reduce((s,x)=>s+x.value,0)} centerSub="Total" small/>
                      <div style={{display:'flex', flexDirection:'column', gap:'5px', flex:1}}>
                        {clientDistribution.map(seg => (
                          <div key={seg.label} style={{display:'flex', alignItems:'center', gap:'6px'}}>
                            <span style={{width:7,height:7,borderRadius:'50%',background:seg.color,flexShrink:0}}></span>
                            <span style={{color:C.text2, fontSize:'10.5px', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{seg.label}</span>
                            <span style={{color:C.text, fontSize:'10.5px', fontWeight:600}}>{seg.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Today's progress */}
                <div style={s.card}>
                  <div style={s.cardHead}>TODAY'S PROGRESS</div>
                  <div style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'10px 0'}}>
                    <Donut segments={[{label:'Completed',value:totalUpdatesToday||0,color:C.accent},{label:'Pending',value:totalPendingToday||0,color:C.border2}]} size={100} thickness={14} centerLabel={`${completionPct}%`} centerSub="Done" />
                  </div>
                  <div style={{display:'flex', justifyContent:'space-around', marginTop:'8px'}}>
                    <div style={{textAlign:'center'}}>
                      <div style={{color:C.accent, fontSize:'15px', fontWeight:700}}>{totalUpdatesToday}</div>
                      <div style={{color:C.muted, fontSize:'9px'}}>COMPLETED</div>
                    </div>
                    <div style={{textAlign:'center'}}>
                      <div style={{color:C.amber, fontSize:'15px', fontWeight:700}}>{totalPendingToday}</div>
                      <div style={{color:C.muted, fontSize:'9px'}}>PENDING</div>
                    </div>
                  </div>
                </div>

                {/* Redistribution summary */}
                <div style={s.card}>
                  <div style={s.cardHead}>REDISTRIBUTION SUMMARY</div>
                  {redistribution.length===0 ? (
                    <div style={{color:C.muted, fontSize:'11px', padding:'20px 0', textAlign:'center'}}>No redistribution today.</div>
                  ) : (
                    <div style={{display:'flex', flexDirection:'column', gap:'8px', marginTop:'10px'}}>
                      {redistribution.slice(0,4).map((r,i) => (
                        <div key={i} style={{display:'flex', alignItems:'center', gap:'6px', fontSize:'11px'}}>
                          <span style={{color:C.red}}>{r.from}</span>
                          <Icon name="arrow-right" size={11} color={C.muted}/>
                          <span style={{color:C.accent}}>{r.to}</span>
                          <span style={{color:C.muted, marginLeft:'auto'}}>{r.hour}:00</span>
                        </div>
                      ))}
                      <button style={{...s.outlineBtn, marginTop:'4px', justifyContent:'center'}} onClick={()=>setActiveTab('redistribution')}>View all →</button>
                    </div>
                  )}
                </div>

                {/* Recent footage requests */}
                <div style={s.card}>
                  <div style={s.cardHead}>RECENT FOOTAGE REQUESTS</div>
                  {footage.pending.length===0 ? (
                    <div style={{color:C.muted, fontSize:'11px', padding:'20px 0', textAlign:'center'}}>No pending requests.</div>
                  ) : (
                    <div style={{display:'flex', flexDirection:'column', gap:'8px', marginTop:'10px'}}>
                      {footage.pending.slice(0,4).map(item => (
                        <div key={item.issueId} style={{display:'flex', alignItems:'center', gap:'8px'}}>
                          <div style={{flex:1, minWidth:0}}>
                            <div style={{color:C.text, fontSize:'11px', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{item.vehicle}</div>
                            <div style={{color:C.muted, fontSize:'9.5px'}}>{item.client}</div>
                          </div>
                          <span className="badge badge-amber">PENDING</span>
                        </div>
                      ))}
                      <button style={{...s.outlineBtn, marginTop:'4px', justifyContent:'center'}} onClick={()=>setActiveTab('footage')}>View all →</button>
                    </div>
                  )}
                </div>
              </div>

              {/* Live activity feed */}
              <div style={{...s.card, marginTop:'14px'}}>
                <div style={s.cardHeadRow}>
                  <div style={s.cardHead}>LIVE ACTIVITY FEED</div>
                </div>
                {activityFeed.length===0 ? (
                  <div style={{color:C.muted, fontSize:'11px', padding:'12px 0'}}>No activity recorded yet today.</div>
                ) : (
                  <div style={{display:'flex', gap:'18px', overflowX:'auto', paddingBottom:'4px'}}>
                    {activityFeed.map((a,i) => (
                      <div key={i} style={{display:'flex', gap:'8px', minWidth:'190px', flexShrink:0}}>
                        <div style={{width:'26px', height:'26px', borderRadius:'50%', background:C.s2, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                          <Icon name={a.icon} size={13} color={a.color} />
                        </div>
                        <div>
                          <div style={{color:C.text, fontSize:'11px', fontWeight:600}}>{a.name}</div>
                          <div style={{color:C.muted, fontSize:'10px'}}>{a.action}</div>
                          {a.time && <div style={{color:C.dim, fontSize:'9.5px', marginTop:'2px'}}>{a.time}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ══════════ FULL DAY VIEW ══════════ */}
          {activeTab === 'fullday' && (
            <div>
              <div style={s.filterBar}>
                <span style={s.filterLbl}>DATE</span>
                <input type="date" style={s.dateInp} value={fullDayDate} onChange={e => { setFullDayDate(e.target.value); setExpandedEmp(null) }}/>
                <button style={s.quickBtn} onClick={() => { setFullDayDate(todayISO()); setExpandedEmp(null) }}>Today</button>
                <span style={{color:C.muted,fontSize:'11px',marginLeft:'auto'}}>Click employee row to expand hours. Use "Mark Leave" to exclude from distribution.</span>
              </div>

              {fullDayLoading ? (
                <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
              ) : !fullDayData ? (
                <div style={{color:C.muted,textAlign:'center',padding:'3rem'}}>Loading...</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
                  {fullDayData.employees.map(emp => {
                    const isExpanded = expandedEmp === emp.name
                    const totalMissed = emp.hours.reduce((s,h)=>s+h.missedClients,0)
                    const totalDone   = emp.hours.reduce((s,h)=>s+h.completedClients,0)
                    const totalAll    = emp.hours.reduce((s,h)=>s+h.totalClients,0)

                    return (
                      <div key={emp.name} style={{...s.fdEmpCard, ...(isExpanded?{borderColor:C.accent+'44'}:{})}}>
                        <div style={s.fdEmpHeader} onClick={()=>setExpandedEmp(isExpanded?null:emp.name)}>
                          <div style={{...s.empDot, background: emp.loggedIn ? C.accent : emp.hours.some(h=>h.isOnLeave) ? C.amber : C.dim, flexShrink:0}}></div>
                          <div style={s.empNameCol}>
                            <div style={{color:C.text,fontSize:'13px',fontWeight:'600'}}>{emp.name}</div>
                            <div style={{color:C.muted,fontSize:'10px'}}>
                              {emp.isNight?'Night':'Day'} {emp.shiftStart}:00–{emp.shiftEnd}:00
                              {emp.loggedIn && ` · Logged in ${emp.startTime}${emp.endTime ? ' → '+emp.endTime : ''}`}
                              {!emp.loggedIn && <span style={{color:C.red}}> · Not logged in</span>}
                            </div>
                          </div>
                          <div style={{display:'flex',gap:'16px',alignItems:'center',marginLeft:'auto'}}>
                            <MiniStat label="Assigned" val={totalAll}/>
                            <MiniStat label="Done" val={totalDone}/>
                            <MiniStat label="Missed" val={totalMissed} warn={totalMissed>0}/>
                          </div>
                          <button
                            style={{...s.quickBtn, marginLeft:'12px', background:C.amberBg, borderColor:C.amber+'33', color:C.amber}}
                            onClick={e => { e.stopPropagation(); setMarkLeaveModal(emp); setLeaveFromHour(emp.shiftStart); setLeaveToHour(emp.shiftEnd) }}
                          >
                            Mark Leave
                          </button>
                          <span style={{color:C.dim,fontSize:'16px',marginLeft:'8px'}}>{isExpanded?'▲':'▼'}</span>
                        </div>

                        {isExpanded && (
                          <div style={{borderTop:`1px solid ${C.border}`,marginTop:'10px',paddingTop:'10px'}}>
                            {emp.hours.length === 0 ? (
                              <div style={{color:C.muted,fontSize:'12px',padding:'8px'}}>No scheduled hours with clients.</div>
                            ) : (
                              <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                                {emp.hours.map(h => (
                                  <div key={h.hour} style={{
                                    background: h.isOnLeave ? C.amberBg : C.s2,
                                    borderRadius:'8px', padding:'10px 14px',
                                    border:`1px solid ${h.isOnLeave?C.amber+'33':C.border2}`,
                                  }}>
                                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:'6px'}}>
                                      <span style={{color:h.isOnLeave?C.amber:C.text,fontSize:'12px',fontWeight:'600'}}>
                                        {hourLabel(h.hour)} {h.isOnLeave && '· ON LEAVE'}
                                      </span>
                                      {!h.isOnLeave && (
                                        <span style={{color:h.completedClients===h.totalClients&&h.totalClients>0?C.accent:C.amber,fontSize:'11px'}}>
                                          {h.completedClients}/{h.totalClients} done
                                        </span>
                                      )}
                                    </div>
                                    {!h.isOnLeave && (
                                      <div style={{display:'flex',flexWrap:'wrap',gap:'5px'}}>
                                        {h.clients.length === 0 ? (
                                          <span style={{color:C.dim,fontSize:'11px'}}>No clients this hour</span>
                                        ) : h.clients.map((c,i) => (
                                          <div key={i} style={{
                                            fontSize:'10px', padding:'3px 9px', borderRadius:'5px', border:'1px solid',
                                            background: c.filled ? C.accent+'14' : C.red+'14',
                                            borderColor: c.filled ? C.accent+'33' : C.red+'33',
                                            color: c.filled ? C.accent : C.red,
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
                {progress&&<span style={{color:C.muted,fontSize:'11px',marginLeft:'auto'}}>{progress.dates.length} day(s)</span>}
              </div>

              {!progress ? (
                <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'6px'}}>
                  {progress.progress.map(emp => (
                    <div key={emp.name} style={s.progRow}>
                      <div style={{...s.empDot,background:emp.isNight?C.purple:C.accent}}></div>
                      <div style={s.empNameCol}>
                        <div style={{color:C.text,fontSize:'13px',fontWeight:'600'}}>{emp.name}</div>
                        <div style={{color:C.muted,fontSize:'10px'}}>{emp.daysPresent}/{emp.totalDaysInRange} days present</div>
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
                <div style={s.footSumCard}><span style={{color:C.amber,fontSize:'20px',fontWeight:'700'}}>{filteredPending.length}</span><span style={{color:C.muted,fontSize:'9px'}}>PENDING</span></div>
                <div style={s.footSumCard}><span style={{color:C.accent,fontSize:'20px',fontWeight:'700'}}>{filteredCompleted.length}</span><span style={{color:C.muted,fontSize:'9px'}}>COMPLETED</span></div>
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

              {filteredPending.length===0&&filteredCompleted.length===0&&<div style={{color:C.muted,textAlign:'center',padding:'3rem'}}>No footage requests found.</div>}

              {filteredPending.length>0&&<>
                <div style={s.sectionHd}>PENDING ({filteredPending.length})</div>
                {filteredPending.map(item=>(
                  <div key={item.issueId} style={s.footCard}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                      <div style={{flex:1,minWidth:'200px'}}>
                        <div style={{color:C.text,fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}><span style={{color:C.blue,marginRight:'6px'}}>▶</span>{item.client} · <span style={{color:C.accent}}>{item.vehicle}</span></div>
                        <div style={{color:C.muted,fontSize:'11px',lineHeight:'1.6'}}>
                          <span style={{color:C.text2}}>ID:</span> {item.issueId} &nbsp;·&nbsp;
                          <span style={{color:C.text2}}>By:</span> {item.raisedBy} &nbsp;·&nbsp;
                          <span style={{color:C.text2}}>Raised:</span> {item.raisedAt}
                          {item.location&&<> &nbsp;·&nbsp;<span style={{color:C.text2}}>Loc:</span> {item.location}</>}
                        </div>
                        {item.details&&<div style={{color:C.text2,fontSize:'11px',marginTop:'4px',fontStyle:'italic'}}>{item.details}</div>}
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
                        <div style={{color:C.text,fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}><span style={{color:C.accent,marginRight:'6px'}}>✓</span>{item.client} · <span style={{color:C.accent}}>{item.vehicle}</span></div>
                        <div style={{color:C.muted,fontSize:'11px'}}><span style={{color:C.text2}}>ID:</span> {item.issueId} &nbsp;·&nbsp;<span style={{color:C.text2}}>By:</span> {item.raisedBy} &nbsp;·&nbsp;<span style={{color:C.text2}}>Done:</span> {item.resolvedAt}</div>
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
                <div style={{color:C.muted,textAlign:'center',padding:'3rem'}}>No open follow-ups.</div>
              ) : (
                footage.followups.map(item => (
                  <div key={item.issueId} style={{...s.footCard,borderColor:C.amber+'33'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                      <div style={{flex:1,minWidth:'200px'}}>
                        <div style={{color:C.text,fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}>
                          <span style={{color:C.amber,marginRight:'6px'}}>↩</span>
                          {item.client} · <span style={{color:C.accent}}>{item.vehicle}</span>
                        </div>
                        <div style={{color:C.muted,fontSize:'11px',lineHeight:'1.6'}}>
                          <span style={{color:C.text2}}>ID:</span> {item.issueId} &nbsp;·&nbsp;
                          <span style={{color:C.text2}}>Original:</span> {item.originalEmployee} &nbsp;·&nbsp;
                          <span style={{color:C.text2}}>Forwarded to:</span> <strong style={{color:C.text}}>{item.forwardedTo}</strong> &nbsp;·&nbsp;
                          <span style={{color:C.text2}}>At:</span> {item.forwardedAt}
                        </div>
                        {item.details&&<div style={{color:C.text2,fontSize:'11px',marginTop:'4px',fontStyle:'italic'}}>{item.details}</div>}
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:'6px',alignItems:'flex-end'}}>
                        <span className="badge badge-amber">FOLLOW-UP</span>
                        <button
                          style={{background:C.redBg,border:'1px solid #3a1515',borderRadius:'6px',color:C.red,fontSize:'10px',padding:'5px 10px',cursor:'pointer'}}
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
                <div style={{color:C.muted,textAlign:'center',padding:'3rem'}}>No redistributions today.</div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={{background:C.s2}}>
                      {['From','To','Client','Hour','Reason'].map(h=><th key={h} style={s.tableHd}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {redistribution.map((r,i)=>(
                      <tr key={i} style={{borderBottom:`1px solid ${C.borderRow}`}}>
                        <td style={{...s.tableTd,color:C.red}}>{r.from}</td>
                        <td style={{...s.tableTd,color:C.accent}}>{r.to}</td>
                        <td style={s.tableTd}>{r.client}</td>
                        <td style={s.tableTd}>{r.hour}:00</td>
                        <td style={{...s.tableTd,color:C.muted}}>Early End</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ══════════ PLACEHOLDER TABS (coming soon) ══════════ */}
          {['leaves','reports','analytics','alerts','settings'].includes(activeTab) && (
            <div style={{...s.card, maxWidth:'560px', margin:'40px auto', textAlign:'center', padding:'40px 24px'}}>
              <div style={{width:'44px',height:'44px',borderRadius:'12px',background:C.accentDark,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}>
                <Icon name={activeTab} size={20} color={C.accent}/>
              </div>
              <div style={{color:C.text,fontSize:'15px',fontWeight:700,marginBottom:'6px'}}>{tabMeta.title} — coming soon</div>
              <div style={{color:C.muted,fontSize:'12px',lineHeight:1.6}}>
                This module isn't wired up to live data yet. It'll be built out in the next Design Bible chapter.
              </div>
            </div>
          )}

          </div>
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
            <div style={{color:C.muted,fontSize:'13px',marginBottom:'16px'}}>
              Issue ID: <strong style={{color:C.text}}>{closeFollowupModal.issueId}</strong> · {closeFollowupModal.client} · {closeFollowupModal.vehicle}
            </div>
            <label style={modal.lbl}>REASON FOR CLOSING</label>
            <input style={modal.inp} placeholder="e.g. Footage not available, already resolved..." value={closeReason} onChange={e=>setCloseReason(e.target.value)}/>
            <div style={modal.btnRow}>
              <button style={modal.cancelBtn} onClick={()=>setCloseFollowupModal(null)}>Cancel</button>
              <button style={{...modal.confirmBtn,background:C.red}} onClick={handleCloseFollowup} disabled={closingFollowup}>
                {closingFollowup?'Closing...':'Close Follow-up'}
              </button>
            </div>
          </div>
        </div>
      )}

      <LogoutModal show={showLogout} onConfirm={handleLogoutConfirm} onCancel={()=>setShowLogout(false)} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Presentational helpers
// ─────────────────────────────────────────────────────────────────────────

function MiniStat({ label, val, warn }) {
  return (
    <div style={{textAlign:'center',minWidth:'60px'}}>
      <div style={{color:warn?C.amber:C.text,fontSize:'14px',fontWeight:'700'}}>{val}</div>
      <div style={{color:C.muted,fontSize:'8px',letterSpacing:'0.3px'}}>{label}</div>
    </div>
  )
}

function AttendanceDots({ attendance }) {
  return (
    <div style={{display:'flex',gap:'3px'}}>
      {attendance.map((a,i)=>(
        <div key={i} title={`${a.date}: ${a.status}`} style={{
          width:'10px',height:'10px',borderRadius:'3px',
          background:a.status==='active'?C.accent:a.status==='completed'?C.blue:'#3a1515',
        }}></div>
      ))}
    </div>
  )
}

function KpiCard({ icon, label, value, sub, subColor, progress }) {
  return (
    <div style={s.kpiCard}>
      <div style={s.kpiIconWrap}><Icon name={icon} size={15} color={C.accent}/></div>
      <div style={s.kpiLabel}>{label}</div>
      <div style={s.kpiValue}>{value}</div>
      {sub && <div style={{fontSize:'10px', color:subColor||C.muted, marginTop:'2px'}}>{sub}</div>}
      {typeof progress === 'number' && (
        <div style={{height:'4px', background:C.border2, borderRadius:'3px', overflow:'hidden', marginTop:'8px'}}>
          <div style={{height:'100%', width:`${progress}%`, background:C.accent, borderRadius:'3px'}}></div>
        </div>
      )}
    </div>
  )
}

function Donut({ segments, size = 120, thickness = 15, centerLabel, centerSub }) {
  const total = segments.reduce((a,seg)=>a+seg.value,0) || 1
  const r = (size - thickness) / 2
  const circ = 2 * Math.PI * r
  let acc = 0
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size/2},${size/2}) rotate(-90)`}>
          <circle r={r} fill="none" stroke={C.border2} strokeWidth={thickness} />
          {segments.map((seg,i) => {
            const len = (seg.value/total) * circ
            const dashoffset = -acc
            acc += len
            return (
              <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${circ-len}`} strokeDashoffset={dashoffset} strokeLinecap="butt" />
            )
          })}
        </g>
      </svg>
      {(centerLabel!==undefined) && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
          <div style={{ color:C.text, fontSize: size>100?'20px':'14px', fontWeight:800, lineHeight:1 }}>{centerLabel}</div>
          {centerSub && <div style={{ color:C.muted, fontSize:'9px', marginTop:'3px' }}>{centerSub}</div>}
        </div>
      )}
    </div>
  )
}

function AlertRow({ alert }) {
  const sevColor = { high:C.red, warn:C.amber, info:C.blue, success:C.accent }[alert.sev] || C.muted
  return (
    <div style={{ display:'flex', gap:'10px', alignItems:'flex-start' }}>
      <div style={{ width:'26px', height:'26px', borderRadius:'8px', background:sevColor+'1a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        <Icon name={alert.icon} size={13} color={sevColor} />
      </div>
      <div style={{flex:1}}>
        <div style={{ color:sevColor, fontSize:'11.5px', fontWeight:700 }}>{alert.title}</div>
        <div style={{ color:C.muted, fontSize:'10.5px', marginTop:'1px' }}>{alert.desc}</div>
      </div>
    </div>
  )
}

function MapIllustration() {
  // Decorative static illustration — replace with a real map once vehicle
  // GPS coordinates are exposed by a backend API.
  const dots = [
    [60,40,C.accent],[110,70,C.accent],[150,50,C.amber],[190,90,C.accent],[230,60,C.red],
    [90,120,C.accent],[140,140,C.accent],[200,130,C.amber],[250,110,C.accent],[120,180,C.accent],
    [170,190,C.red],[220,170,C.accent],[70,160,C.amber],[260,150,C.accent],
  ]
  return (
    <svg viewBox="0 0 300 220" width="100%" height="100%" style={{maxHeight:'220px'}}>
      <rect x="0" y="0" width="300" height="220" fill="none" />
      {dots.map(([x,y,c],i) => (
        <circle key={i} cx={x} cy={y} r={i%3===0?4:3} fill={c} opacity={0.85}>
          {c===C.accent && <animate attributeName="opacity" values="0.85;0.3;0.85" dur="2s" repeatCount="indefinite" begin={`${i*0.15}s`} />}
        </circle>
      ))}
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────

const s = {
  topbar: { display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'20px 24px 14px', flexWrap:'wrap', gap:'12px' },
  topTitle: { color:C.text, fontSize:'24px', fontWeight:800 },
  topTag: { color:C.accent, fontSize:'12px', fontWeight:600 },
  topSub: { color:C.muted, fontSize:'12px', marginTop:'4px' },
  topRight: { display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' },
  pill: { display:'flex', alignItems:'center', gap:'6px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'7px 12px', color:C.text2, fontSize:'12px', whiteSpace:'nowrap' },
  bellBtn: { position:'relative', background:C.card, border:`1px solid ${C.border}`, borderRadius:'8px', width:'34px', height:'34px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' },
  bellBadge: { position:'absolute', top:'-4px', right:'-4px', background:C.red, color:'#fff', fontSize:'9px', fontWeight:700, borderRadius:'10px', minWidth:'16px', height:'16px', display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px' },
  profilePill: { display:'flex', alignItems:'center', gap:'8px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'5px 10px 5px 5px', cursor:'pointer' },
  avatar: { width:'28px', height:'28px', borderRadius:'50%', background:C.accent, color:'#06120a', fontSize:'11px', fontWeight:'700', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 },
  profileName: { color:C.text, fontSize:'12px', fontWeight:600, lineHeight:1.3 },
  profileRole: { color:C.muted, fontSize:'10px', lineHeight:1.3 },
  actionRow: { display:'flex', gap:'10px', justifyContent:'flex-end', flexWrap:'wrap' },
  outlineBtn: { display:'flex', alignItems:'center', gap:'6px', background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'12px', fontWeight:600, padding:'9px 14px', cursor:'pointer' },
  accentBtn: { display:'flex', alignItems:'center', gap:'6px', background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'12px', fontWeight:700, padding:'9px 14px', cursor:'pointer' },
  miniAccentBtn: { background:'transparent', border:`1px solid ${C.accent}55`, borderRadius:'7px', color:C.accent, fontSize:'10.5px', fontWeight:600, padding:'7px 10px', cursor:'pointer', whiteSpace:'nowrap' },

  body: { padding:'8px 24px 32px' },

  kpiGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'10px', marginBottom:'16px' },
  kpiCard: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'14px' },
  kpiIconWrap: { width:'28px', height:'28px', borderRadius:'8px', background:C.accentSoft, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'10px' },
  kpiLabel: { color:C.muted, fontSize:'10.5px', marginBottom:'4px' },
  kpiValue: { color:C.text, fontSize:'22px', fontWeight:800, lineHeight:1 },

  row1: { display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:'12px', marginBottom:'14px' },
  row2: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'12px' },

  card: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' },
  cardHeadRow: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' },
  cardHead: { color:C.accent, fontSize:'10.5px', letterSpacing:'1px', fontWeight:'700', display:'flex', alignItems:'center', gap:'6px' },
  previewTag: { background:C.border2, color:C.muted, fontSize:'8.5px', fontWeight:700, letterSpacing:'0.5px', borderRadius:'4px', padding:'2px 6px' },
  mapArea: { position:'relative', height:'250px', background:'#0a0a0a', borderRadius:'8px', border:`1px solid ${C.border}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', overflow:'hidden' },
  mapOverlayNote: { position:'absolute', bottom:0, left:0, right:0, background:'linear-gradient(0deg, rgba(0,0,0,0.9), transparent)', color:C.muted, fontSize:'10.5px', padding:'22px 14px 10px', textAlign:'center', lineHeight:1.5 },
  aiRecBox: { display:'flex', alignItems:'center', gap:'10px', background:C.accentSoft, border:`1px solid ${C.accent}33`, borderRadius:'8px', padding:'10px 12px' },

  tabs: { display:'flex', gap:'4px', borderBottom:`1px solid ${C.border}`, marginBottom:'20px', overflowX:'auto' },
  empListCard: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', overflow:'hidden' },
  empRow: { display:'flex', alignItems:'center', gap:'12px', padding:'12px 16px', borderBottom:`1px solid ${C.borderRow}`, flexWrap:'wrap' },
  empDot: { width:'8px', height:'8px', borderRadius:'50%', flexShrink:0 },
  empNameCol: { minWidth:'140px' },
  empDuration: { color:C.muted, fontSize:'12px', minWidth:'70px', textAlign:'center' },
  viewBtn: { background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'6px', color:C.muted, fontSize:'11px', padding:'6px 12px', cursor:'pointer', whiteSpace:'nowrap', marginLeft:'auto' },
  filterBar: { display:'flex', gap:'10px', alignItems:'center', marginBottom:'16px', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 16px' },
  filterLbl: { color:C.muted, fontSize:'10px', letterSpacing:'0.5px', fontWeight:'600' },
  dateInp: { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'13px', padding:'8px 10px' },
  quickBtn: { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11px', padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  fdEmpCard: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 16px' },
  fdEmpHeader: { display:'flex', alignItems:'center', gap:'12px', cursor:'pointer', flexWrap:'wrap' },
  progRow: { display:'flex', alignItems:'center', gap:'12px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 16px', flexWrap:'wrap' },
  sectionHd: { color:C.accent, fontSize:'10px', letterSpacing:'1.5px', fontWeight:'600', marginBottom:'12px' },
  footSumCard: { background:C.s2, borderRadius:'8px', padding:'8px 14px', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px' },
  footCard: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'14px', marginBottom:'8px' },
  searchInp: { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'13px', padding:'9px 12px', boxSizing:'border-box' },
  table: { width:'100%', borderCollapse:'collapse', background:C.card, borderRadius:'10px', overflow:'hidden', border:`1px solid ${C.border}` },
  tableHd: { color:C.muted, fontSize:'10px', letterSpacing:'0.5px', padding:'10px 14px', textAlign:'left', fontWeight:'600' },
  tableTd: { color:C.text, fontSize:'12px', padding:'10px 14px' },
}

const modal = {
  overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, backdropFilter:'blur(2px)' },
  box: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'16px', padding:'1.5rem', width:'360px', maxWidth:'90vw' },
  title: { color:C.text, fontSize:'16px', fontWeight:'700', marginBottom:'16px' },
  row: { display:'flex', gap:'10px', marginBottom:'14px' },
  lbl: { display:'block', color:C.accent, fontSize:'10px', letterSpacing:'1px', fontWeight:'600', marginBottom:'5px' },
  sel: { width:'100%', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, padding:'8px 10px', fontSize:'13px' },
  inp: { width:'100%', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, padding:'9px 12px', fontSize:'13px', marginBottom:'16px', boxSizing:'border-box' },
  btnRow: { display:'flex', gap:'8px' },
  cancelBtn: { flex:1, background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.muted, fontSize:'13px', padding:'10px', cursor:'pointer' },
  confirmBtn: { flex:1, background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'13px', fontWeight:'700', padding:'10px', cursor:'pointer' },
}
