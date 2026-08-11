import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Sidebar from '../components/Sidebar'
import LogoutModal from '../components/LogoutModal'
import Icon from '../components/Icons'
import { C, Donut, KpiCard, MiniStat, AttendanceDots, parseSheetDate } from '../components/Widgets'
import FullDayTab from '../components/tabs/FullDayTab'
import ProgressTab from '../components/tabs/ProgressTab'
import FootageTab from '../components/tabs/FootageTab'

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
  const [fromDate, setFromDate] = useState(todayISO())
  const [toDate, setToDate] = useState(todayISO())
  const [loading, setLoading] = useState(true)
  const [breaks, setBreaks] = useState(null)
  const [breakRange, setBreakRange] = useState('today')
  const [breakFrom, setBreakFrom] = useState(todayISO())
  const [breakTo, setBreakTo] = useState(todayISO())
  const [expandedBreakEmp, setExpandedBreakEmp] = useState(null)
  const [markLeaveModal, setMarkLeaveModal] = useState(null)
  const [leaveFromHour, setLeaveFromHour] = useState(8)
  const [leaveToHour, setLeaveToHour] = useState(17)
  const [leaveReason, setLeaveReason] = useState('')
  const [markingLeave, setMarkingLeave] = useState(false)
  const [closeFollowupModal, setCloseFollowupModal] = useState(null)
  const [closeReason, setCloseReason] = useState('')
  const [closingFollowup, setClosingFollowup] = useState(false)
  const [showLogout, setShowLogout] = useState(false)
  const [clock, setClock] = useState('')
  // { title, rows } — roster drill-down opened from an Overview KPI card
  const [rosterModal, setRosterModal] = useState(null)

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
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.role !== 'admin') { router.replace('/login'); return }
      setUser(d.user)
      loadData()
      setLoading(false)
    })
  }, [])

  const loadData = useCallback(async () => {
    // Every loader below keeps the last good state on failure rather than
    // storing an error payload — a 500 body written into state would be
    // read as real data downstream and crash the page on render.
    try {
      const [ov, ft] = await Promise.all([
        fetch('/api/admin/overview').then(r => r.json()).catch(() => ({})),
        fetch('/api/footage/list').then(r => r.json()).catch(() => ({})),
      ])
      if (ov && ov.employees) setOverview(ov)
      if (ft && Array.isArray(ft.pending)) {
        setFootage({ pending: ft.pending, completed: ft.completed || [], followups: ft.followups || [] })
      }
    } catch (e) { console.error('loadData failed:', e) }
  }, [])

  const loadBreaks = useCallback(async (range, from, to) => {
    const qs = range === 'today' ? '' : `?from=${from}&to=${to}`
    try {
      const data = await fetch(`/api/admin/breaks${qs}`).then(r => r.json())
      if (data && data.employees) setBreaks(data)
    } catch (e) { console.error('loadBreaks failed:', e) }
  }, [])

  useEffect(() => {
    if (breakRange === 'today') loadBreaks('today')
    else if (breakRange === 'all') loadBreaks('all', '2000-01-01', todayISO())
    else loadBreaks('custom', breakFrom, breakTo)
  }, [breakRange, breakFrom, breakTo])

  const loadProgress = useCallback(async (from, to) => {
    try {
      const data = await fetch(`/api/admin/employee-progress?from=${from}&to=${to}`).then(r => r.json())
      if (data && data.progress) setProgress(data)
    } catch (e) { console.error('loadProgress failed:', e) }
  }, [])

  const loadFullDay = useCallback(async (dateISO) => {
    setFullDayLoading(true)
    setFullDayData(null)
    const ddmmyyyy = dateISO.split('-').reverse().join('/')
    try {
      const data = await fetch(`/api/admin/full-day-view?date=${ddmmyyyy}`).then(r => r.json())
      setFullDayData(data && Array.isArray(data.employees) ? data : { employees: [] })
    } catch (e) {
      console.error('loadFullDay failed:', e)
      setFullDayData({ employees: [] })
    }
    setFullDayLoading(false)
  }, [])

  // Generic, promise-returning day-view fetch (used by ProgressTab to drill
  // into a single day without disturbing the Full Day View tab's own state).
  const loadDayView = useCallback(async (dateISO) => {
    const ddmmyyyy = dateISO.split('-').reverse().join('/')
    // Always resolve to a valid shape — callers index into .employees
    return fetch(`/api/admin/full-day-view?date=${ddmmyyyy}`)
      .then(r => r.json())
      .then(d => (d && Array.isArray(d.employees)) ? d : { employees: [] })
      .catch(() => ({ employees: [] }))
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

  // footage.pending/completed arrive in raw sheet-row order, not
  // chronological — sort newest-first before any widget claims to show
  // "recent" requests.
  const recentPendingFootage = useMemo(() => {
    return [...footage.pending].sort((a,b) => {
      const at = parseSheetDate(a.raisedAt)?.getTime() ?? 0
      const bt = parseSheetDate(b.raisedAt)?.getTime() ?? 0
      return bt - at
    })
  }, [footage.pending])

  const recentCompletedFootage = useMemo(() => {
    return [...footage.completed].sort((a,b) => {
      const at = parseSheetDate(a.resolvedAt)?.getTime() ?? parseSheetDate(a.raisedAt)?.getTime() ?? 0
      const bt = parseSheetDate(b.resolvedAt)?.getTime() ?? parseSheetDate(b.raisedAt)?.getTime() ?? 0
      return bt - at
    })
  }, [footage.completed])

  const activityFeed = useMemo(() => {
    if (!overview) return []
    const items = []
    overview.employees.forEach(e => {
      if (e.startTime) items.push({ icon:'check-circle', color:C.accent, name:e.name, action:'started shift', time:e.startTime })
      if (e.endTime)   items.push({ icon:'check-circle', color:C.muted, name:e.name, action:'ended shift', time:e.endTime })
    })
    recentCompletedFootage.slice(0,4).forEach(i => {
      items.push({ icon:'footage', color:C.blue, name:i.raisedBy||'Team', action:`completed footage for ${i.vehicle}`, time:i.resolvedAt||'' })
    })
    overview.redistribution.slice(0,4).forEach(r => {
      items.push({ icon:'shuffle', color:C.purple, name:r.from, action:`redistributed ${r.client} to ${r.to}`, time:`${r.hour}:00` })
    })
    return items.slice(0,8)
  }, [overview, recentCompletedFootage])

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
  const activePct = kpis.total>0 ? Math.round((kpis.active/kpis.total)*100) : 0

  // Command Center Health — a live "right now" reading for today, not a
  // whole-day average: of the people whose shift window covers THIS hour
  // (week-off excluded), how many are actually clocked in. Previously this
  // was active/total, i.e. the exact same number as Active Employees %,
  // so two cards showed identical values and neither reflected the
  // current hour.
  const onDutyNow    = employees.filter(e => e.isScheduledNow && !e.isWeekOff)
  const activeNowCnt = onDutyNow.filter(e => e.statusLabel === 'Active').length
  const commandHealthPct = onDutyNow.length>0 ? Math.round((activeNowCnt/onDutyNow.length)*100) : 100

  const shiftLabel = (e) => {
    const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
    const suf  = (n) => n >= 12 ? 'PM' : 'AM'
    const s = e.effStart ?? e.shiftStart, en = e.effEnd ?? e.shiftEnd
    if (s == null || en == null) return '—'
    return `${to12(s)}:00 ${suf(s)} – ${to12(en)}:00 ${suf(en)}`
  }

  const activeEmployees     = employees.filter(e => e.statusLabel === 'Active')
  const notStartedEmployees = employees.filter(e => e.statusLabel === 'Not Started')

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
              <div style={s.sectionLabel}>WORKFORCE &amp; WORKLOAD — TODAY</div>
              <div style={s.kpiGrid}>
                <KpiCard icon="shield" label="Command Center Health" value={`${commandHealthPct}%`} sub={`${activeNowCnt}/${onDutyNow.length} on duty this hour`} />
                <KpiCard
                  icon="users" label="Active Employees" value={kpis.active} sub={`${activePct}% of total`} progress={activePct}
                  onClick={()=>setRosterModal({ title:'Active Employees', empty:'Nobody is clocked in right now.', rows:activeEmployees })}
                />
                <KpiCard icon="check-circle" label="Updates Completed" value={totalUpdatesToday} sub="Across all employees today" />
                <KpiCard icon="clock" label="Pending Updates" value={totalPendingToday} sub="Awaiting completion" subColor={totalPendingToday>0?C.amber:C.muted} />
                <KpiCard icon="leaves" label="Week Off" value={kpis.weekOff} sub="Scheduled off today" />
                <KpiCard
                  icon="offline" label="Not Started" value={kpis.notStarted} sub="Should be active by now" subColor={kpis.notStarted>0?C.red:C.muted}
                  onClick={()=>setRosterModal({ title:'Not Started', empty:'Everyone scheduled has clocked in.', rows:notStartedEmployees })}
                />
                <KpiCard icon="camera" label="Footage Queue" value={footage.pending.length} sub={`${footage.followups.length} follow-up(s) open`} subColor={footage.pending.length>0?C.amber:C.muted} />
                <KpiCard icon="shuffle" label="Redistribution Today" value={redistribution.length} sub="Slots reassigned" />
              </div>

              <div style={s.row1}>
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

              <div style={{...s.sectionLabel, marginTop:'4px'}}>BREAKDOWN</div>
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
                  {recentPendingFootage.length===0 ? (
                    <div style={{color:C.muted, fontSize:'11px', padding:'20px 0', textAlign:'center'}}>No pending requests.</div>
                  ) : (
                    <div style={{display:'flex', flexDirection:'column', gap:'8px', marginTop:'10px'}}>
                      {recentPendingFootage.slice(0,4).map(item => (
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

              {/* Break analytics */}
              <div style={{...s.card, marginTop:'14px'}}>
                <div style={{...s.cardHeadRow, flexWrap:'wrap', gap:'10px'}}>
                  <div style={s.cardHead}>
                    <Icon name="clock" size={13} color={C.accent}/> BREAK ANALYTICS
                    {breaks?.onBreakNow>0 && <span style={{background:C.red+'22', color:C.red, borderRadius:'20px', padding:'2px 8px', fontSize:'9.5px', fontWeight:700, marginLeft:'8px'}}>{breaks.onBreakNow} on break now</span>}
                  </div>
                  <div style={{ display:'flex', gap:'8px', alignItems:'center', flexWrap:'wrap' }}>
                    {['today','all','custom'].map(r => (
                      <button key={r} onClick={()=>setBreakRange(r)} style={{
                        background: breakRange===r?C.accentDark:C.s2, border:`1px solid ${breakRange===r?C.accent:C.border2}`,
                        borderRadius:'7px', color: breakRange===r?C.accent:C.text2, fontSize:'10.5px', fontWeight:600, padding:'6px 11px', cursor:'pointer',
                      }}>{r==='today'?'Today':r==='all'?'All Time':'Custom'}</button>
                    ))}
                    {breakRange==='custom' && (
                      <>
                        <input type="date" value={breakFrom} onChange={e=>setBreakFrom(e.target.value)} style={{background:C.s2,border:`1px solid ${C.border2}`,borderRadius:'7px',color:C.text,fontSize:'11px',padding:'6px 8px'}} />
                        <span style={{color:C.muted,fontSize:'11px'}}>to</span>
                        <input type="date" value={breakTo} onChange={e=>setBreakTo(e.target.value)} style={{background:C.s2,border:`1px solid ${C.border2}`,borderRadius:'7px',color:C.text,fontSize:'11px',padding:'6px 8px'}} />
                      </>
                    )}
                  </div>
                </div>

                {!breaks ? (
                  <div style={{display:'flex',justifyContent:'center',padding:'2rem'}}><div className="spinner"></div></div>
                ) : breaks.employees.length===0 ? (
                  <div style={{color:C.muted, fontSize:'11px', padding:'12px 0'}}>No breaks recorded in this range.</div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:'10px', marginTop:'6px', alignItems:'start' }}>
                    {breaks.employees.map(e => {
                      const isOpen = expandedBreakEmp === e.name
                      const mySessions = breaks.sessions.filter(s => s.name === e.name)
                      return (
                        <div key={e.name} style={{ background:C.s2, border:`1px solid ${e.currentlyOnBreak?C.red+'55':C.border2}`, borderRadius:'10px', padding:'12px' }}>
                          <div onClick={()=>setExpandedBreakEmp(isOpen?null:e.name)} style={{ cursor:'pointer' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                              <span style={{ color:C.text, fontSize:'12px', fontWeight:600 }}>{e.name}</span>
                              {e.currentlyOnBreak && <span style={{ color:C.red, fontSize:'9px', fontWeight:700, display:'flex', alignItems:'center', gap:'4px' }}><span className="live-dot" style={{width:5,height:5,background:C.red}}></span>ON BREAK</span>}
                            </div>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline' }}>
                              <span style={{ color:C.accent, fontSize:'18px', fontWeight:800 }}>{Math.floor(e.totalMinutes/60)}h {e.totalMinutes%60}m</span>
                              <span style={{ color:C.muted, fontSize:'10px', display:'flex', alignItems:'center', gap:'4px' }}>{e.sessions} session{e.sessions!==1?'s':''} <Icon name="chevron-down" size={10} color={C.muted}/></span>
                            </div>
                            {e.currentlyOnBreak && <div style={{ color:C.muted, fontSize:'9.5px', marginTop:'3px' }}>Since {e.activeSince}</div>}
                          </div>
                          {isOpen && (
                            <div style={{ borderTop:`1px solid ${C.border2}`, marginTop:'10px', paddingTop:'10px', display:'flex', flexDirection:'column', gap:'6px' }}>
                              {mySessions.map((sess,i) => (
                                <div key={i} style={{ background:C.bg, borderRadius:'7px', padding:'7px 9px' }}>
                                  <div style={{ display:'flex', justifyContent:'space-between' }}>
                                    <span style={{ color:C.text2, fontSize:'10px' }}>{sess.date}</span>
                                    <span style={{ color: sess.status==='Active'?C.red:C.accent, fontSize:'10px', fontWeight:700 }}>{sess.minutes}m</span>
                                  </div>
                                  <div style={{ color:C.muted, fontSize:'10px', marginTop:'2px' }}>
                                    {sess.startTime} → {sess.endTime || (sess.status==='Active'?'ongoing':'—')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ══════════ FULL DAY VIEW ══════════ */}
          {activeTab === 'fullday' && (
            <FullDayTab
              date={fullDayDate}
              setDate={(d)=>setFullDayDate(d)}
              data={fullDayData}
              loading={fullDayLoading}
              onMarkLeave={(emp)=>{ setMarkLeaveModal(emp); setLeaveFromHour(emp.shiftStart); setLeaveToHour(emp.shiftEnd) }}
              footageAll={footage}
              matchDateFlexible={matchDateFlexible}
              downloadCSV={downloadCSV}
              todayISO={todayISO}
              onGoToTab={setActiveTab}
            />
          )}

          {/* ══════════ EMPLOYEE PROGRESS ══════════ */}
          {activeTab === 'progress' && (
            <ProgressTab
              progress={progress}
              fromDate={fromDate}
              toDate={toDate}
              setFromDate={setFromDate}
              setToDate={setToDate}
              overviewEmployees={employees}
              todayISO={todayISO}
              loadDayView={loadDayView}
              downloadCSV={downloadCSV}
            />
          )}

          {/* ══════════ FOOTAGE ══════════ */}
          {activeTab === 'footage' && (
            <FootageTab
              footageAll={footage}
              downloadCSV={downloadCSV}
              onCloseFollowup={(item)=>{ setCloseFollowupModal(item); setCloseReason('') }}
              todayISO={todayISO}
            />
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

      {/* Roster drill-down — opened from the Active / Not Started KPI cards */}
      {rosterModal && (
        <div style={modal.overlay} onClick={()=>setRosterModal(null)}>
          <div style={{...modal.box, maxWidth:'460px'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'4px'}}>
              <div style={modal.title}>{rosterModal.title}</div>
              <button onClick={()=>setRosterModal(null)} style={{background:'transparent',border:'none',color:C.muted,fontSize:'20px',cursor:'pointer',lineHeight:1}}>×</button>
            </div>
            <div style={{color:C.muted, fontSize:'12px', marginBottom:'14px'}}>
              {rosterModal.rows.length} employee(s) · shift timings shown in IST
            </div>
            {rosterModal.rows.length === 0 ? (
              <div style={{color:C.muted, fontSize:'12.5px', padding:'18px 0', textAlign:'center'}}>{rosterModal.empty}</div>
            ) : (
              <div style={{maxHeight:'50vh', overflowY:'auto'}}>
                {rosterModal.rows.map(e => (
                  <div key={e.name} style={{display:'flex', alignItems:'center', gap:'10px', padding:'10px 0', borderBottom:`1px solid ${C.borderRow}`}}>
                    <div style={{width:'30px', height:'30px', borderRadius:'50%', background:C.accentDark, color:C.accent, fontSize:'11px', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0}}>
                      {e.name.slice(0,2).toUpperCase()}
                    </div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{color:C.text, fontSize:'12.5px', fontWeight:600}}>{e.name}</div>
                      <div style={{color:C.muted, fontSize:'10.5px'}}>
                        {shiftLabel(e)}
                        {e.isAdjusted && <span style={{color:C.amber, marginLeft:'6px'}}>· adjusted today</span>}
                      </div>
                    </div>
                    <div style={{textAlign:'right', flexShrink:0}}>
                      {e.startTime
                        ? <div style={{color:C.accent, fontSize:'10.5px', fontWeight:600}}>In {e.startTime}</div>
                        : <div style={{color:C.red, fontSize:'10.5px', fontWeight:600}}>Not clocked in</div>}
                      {e.endTime && <div style={{color:C.muted, fontSize:'9.5px'}}>Out {e.endTime}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <LogoutModal show={showLogout} onConfirm={handleLogoutConfirm} onCancel={()=>setShowLogout(false)} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Presentational helpers (Overview-tab specific — shared ones live in Widgets.js)
// ─────────────────────────────────────────────────────────────────────────

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

  sectionLabel: { color:C.muted, fontSize:'10px', fontWeight:700, letterSpacing:'1.2px', marginBottom:'10px' },
  kpiGrid: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'10px', marginBottom:'16px' },
  kpiCard: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'14px' },
  kpiIconWrap: { width:'28px', height:'28px', borderRadius:'8px', background:C.accentSoft, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'10px' },
  kpiLabel: { color:C.muted, fontSize:'10.5px', marginBottom:'4px' },
  kpiValue: { color:C.text, fontSize:'22px', fontWeight:800, lineHeight:1 },

  row1: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'14px' },
  row2: { display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'12px' },

  card: { background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' },
  cardHeadRow: { display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'12px' },
  cardHead: { color:C.accent, fontSize:'10.5px', letterSpacing:'1px', fontWeight:'700', display:'flex', alignItems:'center', gap:'6px' },
  previewTag: { background:C.border2, color:C.muted, fontSize:'8.5px', fontWeight:700, letterSpacing:'0.5px', borderRadius:'4px', padding:'2px 6px' },
  mapArea: { position:'relative', height:'250px', background:C.bg, borderRadius:'8px', border:`1px solid ${C.border}`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', overflow:'hidden' },
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
