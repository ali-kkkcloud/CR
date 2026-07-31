import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import EmployeeSidebar from '../components/EmployeeSidebar'
import BreakOverlay from '../components/BreakOverlay'
import LogoutModal from '../components/LogoutModal'
import Icon from '../components/Icons'
import { C } from '../components/Widgets'
import { computeEarlyStart } from '../lib/schedule'
import EmpDashboardTab from '../components/tabs/EmpDashboardTab'
import MyDayTab from '../components/tabs/MyDayTab'
import MyClientsTab from '../components/tabs/MyClientsTab'
import EmpFootageTab from '../components/tabs/EmpFootageTab'
import EmpFollowupTab from '../components/tabs/EmpFollowupTab'

function hourLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)} – ${to12((h+1)%24)}:00 ${suf((h+1)%24)}`
}
function fmtShift(startHour, endHour) {
  if (startHour==null || endHour==null) return '—'
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${String(to12(startHour)).padStart(2,'0')}:00 ${suf(startHour)} - ${String(to12(endHour)).padStart(2,'0')}:00 ${suf(endHour)}`
}

export default function Dashboard() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [shiftStatus, setShiftStatus] = useState('loading')
  const [startTime, setStartTime] = useState('')
  const [currentHour, setCurrentHour] = useState(new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getHours())
  const [clients, setClients] = useState([])
  const [filled, setFilled] = useState({})
  const [footage, setFootage] = useState({ pending: [], completed: [], followups: [] })
  const [myDay, setMyDay] = useState(null)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [saving, setSaving] = useState({})
  const [showReport, setShowReport] = useState(false)
  const [report, setReport] = useState(null)
  const [endShiftStep, setEndShiftStep] = useState(null)
  const [forwardSelections, setForwardSelections] = useState({})
  const [forwardOptions, setForwardOptions] = useState({ active: [], others: [] })
  const [forwarding, setForwarding] = useState(false)
  const [clock, setClock] = useState('')
  const [showLogout, setShowLogout] = useState(false)

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryRange, setSummaryRange] = useState('month')
  const summaryRangeRef = useRef('month')
  useEffect(() => { summaryRangeRef.current = summaryRange }, [summaryRange])

  const [breakStatus, setBreakStatus] = useState({ onBreak:false, startTime:null, history:[], totalMinutesToday:0 })
  const [breakActionLoading, setBreakActionLoading] = useState(false)

  const [earlyStartPreview, setEarlyStartPreview] = useState(null) // { start, end, hoursShifted } | null
  const [startingShift, setStartingShift] = useState(false)
  const [showOTConfirm, setShowOTConfirm] = useState(false)
  const [otLoading, setOtLoading] = useState(false)
  const [shiftStartedInfo, setShiftStartedInfo] = useState(null) // { start, end } | null — shown after a normal (non-early) start

  const hourRef = useRef(currentHour)
  const autoRef = useRef(null)
  const summaryRefreshRef = useRef(null)

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleString('en-IN', { timeZone:'Asia/Kolkata', hour:'2-digit', minute:'2-digit', hour12:true }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

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
      } else if (statusData.status === 'ended') {
        setShiftStatus('ended')
        setStartTime(statusData.startTime || '')
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
    setFootage({ pending: data.pending || [], completed: data.completed || [], followups: data.followups || [] })
  }, [])

  const loadMyDay = useCallback(async () => {
    const res  = await fetch('/api/dashboard/my-day')
    const data = await res.json()
    setMyDay(data)
  }, [])

  const loadSummary = useCallback(async (range) => {
    setSummaryLoading(true)
    const res  = await fetch(`/api/dashboard/summary?range=${range}`)
    const data = await res.json()
    setSummary(data)
    setSummaryLoading(false)
  }, [])

  const loadBreakStatus = useCallback(async () => {
    const res  = await fetch('/api/break/status')
    const data = await res.json()
    setBreakStatus(data)
  }, [])

  useEffect(() => {
    if (!user) return
    loadClients()
    loadFootage()
    loadMyDay()
    loadSummary(summaryRange)
    loadBreakStatus()
    autoRef.current = setInterval(() => {
      const h = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getHours()
      if (h !== hourRef.current) { loadClients(); loadMyDay() }
      loadFootage()
      loadBreakStatus()
      loadSummary(summaryRangeRef.current)
    }, 30000)
    return () => clearInterval(autoRef.current)
  }, [user])

  useEffect(() => {
    if (user) loadSummary(summaryRange)
  }, [summaryRange])

  function handleStartShiftClick() {
    if (startingShift) return
    const empSchedule = summary && summary.scheduledStart != null
      ? { start: summary.scheduledStart, end: summary.scheduledEnd, isNight: summary.isNight }
      : null
    if (empSchedule) {
      const preview = computeEarlyStart(empSchedule, new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })))
      if (preview) { setEarlyStartPreview(preview); return }
    }
    doStartShift(false)
  }

  async function doStartShift(confirmEarly) {
    setStartingShift(true)
    try {
      const res  = await fetch('/api/shift/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmEarlyStart: confirmEarly }),
      })
      const data = await res.json()
      if (data.success) {
        setShiftStatus('active')
        setStartTime(data.startTime)
        setEarlyStartPreview(null)
        loadClients(); loadMyDay(); loadSummary(summaryRangeRef.current)
        // Normal (non-early) start — the early-start path already showed its
        // own confirmation before this call, so only pop this up here.
        // If the server auto-applied a Late Start adjustment, show THAT
        // (the actual, now-effective shift) instead of the static schedule.
        if (!confirmEarly) {
          const adjusted = data.lateStart
          const empSchedule = adjusted
            ? { start: adjusted.start, end: adjusted.end, actualStart: data.startTime, isLateAdjustment: true }
            : (summary && summary.scheduledStart != null
                ? { start: summary.scheduledStart, end: summary.scheduledEnd, actualStart: data.startTime }
                : null)
          if (empSchedule) setShiftStartedInfo(empSchedule)
        }
      } else {
        alert(data.error || 'Could not start shift. Please try again.')
      }
    } catch (err) {
      console.error('Start shift failed:', err)
      alert('Could not start shift — check your connection and try again.')
    } finally {
      setStartingShift(false)
    }
  }

  async function confirmOT() {
    setOtLoading(true)
    try {
      const res  = await fetch('/api/shift/ot', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setShowOTConfirm(false)
        loadSummary(summaryRangeRef.current); loadMyDay()
      } else {
        alert(data.error || 'Could not apply overtime.')
      }
    } catch (err) {
      console.error('OT failed:', err)
      alert('Could not apply overtime — check your connection and try again.')
    } finally {
      setOtLoading(false)
    }
  }

  async function handleEndShiftClick() {
    if (!confirm('Are you sure you want to end your shift?')) return
    if (footage.pending.length > 0) {
      const res = await fetch('/api/footage/followup-options')
      const data = await res.json()
      setForwardOptions(data)
      setEndShiftStep('footage')
    } else {
      await doEndShift()
    }
  }

  async function doEndShift() {
    const res  = await fetch('/api/shift/end', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setShiftStatus('ended')
      setReport(data.report)
      setShowReport(true)
      setEndShiftStep(null)
      clearInterval(autoRef.current)
    }
  }

  async function handleForwardAndEnd() {
    setForwarding(true)
    for (const item of footage.pending) {
      const forwardTo = forwardSelections[item.issueId]
      if (forwardTo) {
        await fetch('/api/footage/forward', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ issueId: item.issueId, client: item.client, vehicle: item.vehicle, forwardedTo: forwardTo }),
        })
      }
    }
    setForwarding(false)
    await doEndShift()
  }

  async function saveUpdate(client, field, value, hourOverride) {
    const key = `${client}_${field}`
    const targetHour = hourOverride ?? currentHour
    const isCurrentHourEdit = targetHour === currentHour
    setSaving(p => ({...p, [key]: true}))
    let updated
    if (isCurrentHourEdit) {
      const current = filled[client] || {}
      updated = { ...current, [field]: value }
      if (field === 'fatigue' && value === 'No') updated.fatigueCount = ''
      setFilled(p => ({ ...p, [client]: updated }))
    } else {
      updated = { [field]: value }
    }
    const res = await fetch('/api/crm/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client, slot: targetHour, ...updated }),
    })
    const data = await res.json()
    if (isCurrentHourEdit && data.updatedAt) setFilled(p => ({ ...p, [client]: { ...p[client], updatedAt: data.updatedAt } }))
    setSaving(p => { const n = {...p}; delete n[key]; return n })
    // "status" is what actually marks a client as done — refresh the
    // dashboard summary shortly after so My Targets / trend don't sit stale
    // until the next 30s poll. Debounced since other fields (alerts, etc.)
    // can fire several saves in quick succession.
    if (field === 'status' && data.success) {
      clearTimeout(summaryRefreshRef.current)
      summaryRefreshRef.current = setTimeout(() => { loadSummary(summaryRangeRef.current); loadMyDay() }, 1200)
    }
    return data
  }

  async function startBreak() {
    setBreakActionLoading(true)
    try {
      const res  = await fetch('/api/break/start', { method:'POST' })
      const data = await res.json()
      if (data.success) {
        await loadBreakStatus()
      } else {
        alert(data.error || 'Could not start break. Please try again.')
      }
    } catch (err) {
      console.error('Start break failed:', err)
      alert('Could not start break — check your connection and try again.')
    } finally {
      setBreakActionLoading(false)
    }
  }

  async function resumeFromBreak() {
    setBreakActionLoading(true)
    try {
      const res  = await fetch('/api/break/end', { method:'POST' })
      const data = await res.json()
      if (data.success) {
        await loadBreakStatus()
      } else {
        alert(data.error || 'Could not resume — please try again.')
      }
    } catch (err) {
      console.error('Resume from break failed:', err)
      alert('Could not resume — check your connection and try again.')
    } finally {
      setBreakActionLoading(false)
    }
  }

  async function handleLogoutConfirm() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setShowLogout(false)
    router.push('/login')
  }

  function downloadReport() {
    if (!report) return
    const rows = [
      ['Cautio CRM — Shift Report'],
      ['Employee', report.employee], ['Date', report.date],
      ['Shift Start', report.shiftStart], ['Shift End', report.shiftEnd], ['Duration', report.duration],
      [], ['Clients Handled', report.clientsHandled], ['Total Updates', report.totalUpdates],
      ['Misalignments', report.misalignCount], ['Total Alerts', report.alertTotal],
      ['Fatigue Alerts', report.fatigueCount], ['Clients Redistributed', report.redistributed],
      ['Footage Completed Today', report.footageCompletedToday], ['Footage Pending', report.footagePending],
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = `CRM_Report_${report.employee}_${report.date}.csv`; a.click()
  }

  if (!user) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:C.bg}}>
      <div className="spinner"></div>
    </div>
  )

  // ── END SHIFT FOOTAGE FORWARD SCREEN ──
  if (endShiftStep === 'footage') return (
    <>
      <Head><title>Cautio CRM — End Shift</title></Head>
      <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:'16px',padding:'2rem',maxWidth:'600px',width:'100%'}}>
          <div style={{color:C.amber,fontSize:'20px',fontWeight:'700',marginBottom:'8px'}}>⚠ Pending Footage Requests</div>
          <div style={{color:C.muted,fontSize:'13px',marginBottom:'24px'}}>
            You have {footage.pending.length} pending footage request(s). Forward them to another employee before ending shift, or skip forwarding.
          </div>
          {footage.pending.map(item => (
            <div key={item.issueId} style={{background:C.s2,border:`1px solid ${C.border2}`,borderRadius:'10px',padding:'14px',marginBottom:'10px'}}>
              <div style={{color:C.text,fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}>
                <span style={{color:C.blue,marginRight:'6px'}}>▶</span>{item.client} · {item.vehicle}
              </div>
              <div style={{color:C.muted,fontSize:'11px',marginBottom:'10px'}}>ID: {item.issueId} &nbsp;·&nbsp; Raised: {item.raisedAt}</div>
              <label style={{color:C.accent,fontSize:'10px',letterSpacing:'1px',fontWeight:'600',display:'block',marginBottom:'5px'}}>FORWARD TO</label>
              <select
                style={{width:'100%',background:C.bg,border:`1px solid ${C.border2}`,borderRadius:'8px',color:C.text,padding:'8px 10px',fontSize:'13px'}}
                value={forwardSelections[item.issueId] || ''}
                onChange={e => setForwardSelections(p => ({...p, [item.issueId]: e.target.value}))}
              >
                <option value="">— Skip (don't forward) —</option>
                {forwardOptions.active.length > 0 && (
                  <optgroup label="Currently Active">{forwardOptions.active.map(e => <option key={e.name} value={e.name}>{e.name} (active)</option>)}</optgroup>
                )}
                {forwardOptions.others.length > 0 && (
                  <optgroup label="Other Employees">{forwardOptions.others.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}</optgroup>
                )}
              </select>
            </div>
          ))}
          <div style={{display:'flex',gap:'10px',marginTop:'20px'}}>
            <button onClick={() => setEndShiftStep(null)} style={{flex:1,background:C.s2,border:`1px solid ${C.border2}`,borderRadius:'8px',color:C.muted,fontSize:'13px',padding:'12px',cursor:'pointer'}}>Cancel</button>
            <button onClick={handleForwardAndEnd} disabled={forwarding} style={{flex:2,background:C.accent,border:'none',borderRadius:'8px',color:'#06120a',fontSize:'13px',fontWeight:'700',padding:'12px',cursor:'pointer'}}>{forwarding ? 'Forwarding...' : 'Forward & End Shift'}</button>
            <button onClick={doEndShift} style={{flex:1,background:C.red,border:'none',borderRadius:'8px',color:'#fff',fontSize:'13px',fontWeight:'700',padding:'12px',cursor:'pointer'}}>End Without Forwarding</button>
          </div>
        </div>
      </div>
    </>
  )

  // ── SHIFT ENDED REPORT ──
  if (shiftStatus === 'ended' && showReport && report) return (
    <>
      <Head><title>Cautio CRM — Shift Report</title></Head>
      <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:'16px',padding:'2.5rem',maxWidth:'520px',width:'100%'}}>
          <img src="/cautio_shield.webp" alt="Cautio" style={{width:'40px',height:'40px',objectFit:'contain',display:'block',margin:'0 auto 8px'}} onError={e=>e.target.style.display='none'}/>
          <h2 style={{color:C.text,textAlign:'center',marginBottom:'4px'}}>Shift Complete</h2>
          <p style={{color:C.muted,textAlign:'center',fontSize:'13px',marginBottom:'2rem'}}>{report.date} · {report.shiftStart} → {report.shiftEnd} · {report.duration}</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'10px'}}>
            <RepStat val={report.clientsHandled} label="CLIENTS" color={C.accent}/>
            <RepStat val={report.totalUpdates} label="UPDATES" color={C.accent}/>
            <RepStat val={report.misalignCount} label="MISALIGNS" color={C.amber}/>
            <RepStat val={report.alertTotal} label="ALERTS" color={C.red}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'10px',marginBottom:'20px'}}>
            <RepStat val={report.fatigueCount} label="FATIGUE" color={C.purple}/>
            <RepStat val={report.footageCompletedToday} label="FOOTAGE DONE" color={C.accent}/>
            <RepStat val={report.footagePending} label="FOOTAGE PENDING" color={C.amber}/>
            <RepStat val={report.redistributed} label="REDISTRIBUTED" color={C.text}/>
          </div>
          {report.redistributed > 0 && (
            <div style={{background:C.s2,borderRadius:'8px',padding:'10px 14px',fontSize:'11.5px',color:C.text2,marginBottom:'16px'}}>
              ↩ {report.redistributed} clients redistributed to: {[...new Set(report.redistributedTo)].join(', ')}
            </div>
          )}
          <button onClick={downloadReport} style={{width:'100%',background:C.s2,border:`1px solid ${C.border2}`,borderRadius:'8px',color:C.text2,fontSize:'13px',padding:'12px',cursor:'pointer',marginBottom:'10px'}}>⬇ Download CSV Report</button>
          <button onClick={()=>{fetch('/api/auth/logout',{method:'POST'});router.push('/login')}} style={{width:'100%',background:'transparent',border:`1px solid ${C.border2}`,borderRadius:'8px',color:C.muted,fontSize:'13px',padding:'12px',cursor:'pointer'}}>Logout</button>
        </div>
      </div>
    </>
  )

  // ── BREAK OVERLAY ──
  if (breakStatus.onBreak) return (
    <>
      <Head><title>Cautio CRM — On Break</title></Head>
      <BreakOverlay
        startTime={breakStatus.startTime}
        history={breakStatus.history}
        totalMinutesToday={breakStatus.totalMinutesToday}
        onResume={resumeFromBreak}
        resuming={breakActionLoading}
      />
    </>
  )

  // ── MAIN APP ──
  const tabTitle = {
    dashboard: 'Dashboard', myday: 'My Day', clients: 'My Clients', footage: 'Footage Requests',
    followup: 'Follow-ups', performance: 'My Performance', notifications: 'Notifications',
    help: 'Help & Support', settings: 'Settings',
  }[activeTab]

  const isActive = shiftStatus === 'active'

  return (
    <>
      <Head><title>Cautio CRM — {tabTitle}</title></Head>
      <div style={{minHeight:'100vh', background:C.bg, display:'flex'}}>
        <EmployeeSidebar
          activeTab={activeTab} setActiveTab={setActiveTab} user={user}
          counts={{ footage: footage.pending.length, followup: footage.followups.length }}
          shiftTime={fmtShift(summary?.shiftStart, summary?.shiftEnd)}
          loginTime={startTime}
          onlineStatus={isActive ? 'Online' : 'Offline'}
        />

        <div style={{flex:1, minWidth:0}}>
          {/* Not-active banner */}
          {!isActive && (
            <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', background:C.amberBg||'#1a1200', borderBottom:`1px solid ${C.amber}33`, padding:'12px 24px' }}>
              <Icon name="clock" size={16} color={C.amber} />
              <span style={{ color:C.amber, fontSize:'12.5px', fontWeight:600, flex:1 }}>
                {shiftStatus==='ended' ? "Your shift has ended for today — you're viewing everything in read-only mode." : "Your shift hasn't started yet — you're viewing today's assignments in read-only mode."}
              </span>
              {shiftStatus==='not_started' && (
                <button onClick={handleStartShiftClick} disabled={startingShift} style={{ background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'12.5px', fontWeight:700, padding:'8px 16px', cursor:'pointer' }}>
                  {startingShift ? 'Starting...' : '▶ Start Shift'}
                </button>
              )}
            </div>
          )}

          {/* Topbar */}
          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', padding:'20px 24px 14px', flexWrap:'wrap', gap:'12px' }}>
            <div>
              <div style={{ color:C.text, fontSize:'22px', fontWeight:800 }}>
                Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'}, {user?.name} 👋
              </div>
              <div style={{ color:C.muted, fontSize:'12px', marginTop:'4px' }}>Stay focused and keep up the great work.</div>
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
              <TopPill icon="calendar" text={new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})} />
              <TopPill icon="clock" text={`Shift: ${fmtShift(summary?.shiftStart, summary?.shiftEnd)}`} />
              {isActive && <TopPill icon="check-circle" text={`In: ${startTime}`} color={summary?.attendanceStatus==='Late'?C.amber:C.accent} />}
              <button onClick={()=>setActiveTab('notifications')} style={{ position:'relative', background:C.card, border:`1px solid ${C.border}`, borderRadius:'8px', width:'36px', height:'36px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                <Icon name="bell" size={16} color={C.text2}/>
                {(footage.pending.length+footage.followups.length)>0 && (
                  <span style={{ position:'absolute', top:'-4px', right:'-4px', background:C.red, color:'#fff', fontSize:'9px', fontWeight:700, borderRadius:'10px', minWidth:'16px', height:'16px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {footage.pending.length+footage.followups.length}
                  </span>
                )}
              </button>
              {isActive && (
                <>
                  <button onClick={startBreak} disabled={breakActionLoading} style={{ display:'flex', alignItems:'center', gap:'8px', background:C.red, border:'none', borderRadius:'10px', color:'#fff', fontSize:'13px', fontWeight:800, padding:'9px 18px', cursor:'pointer' }}>
                    <Icon name="clock" size={15} color="#fff"/> BREAK
                  </button>
                  <button
                    onClick={()=>setShowOTConfirm(true)}
                    disabled={summary?.usedOT}
                    title={summary?.usedOT ? 'Overtime already used today' : 'Extend your shift by 3 hours'}
                    style={{ display:'flex', alignItems:'center', gap:'6px', background: summary?.usedOT?C.s2:C.accentDark, border:`1px solid ${summary?.usedOT?C.border2:C.accent}55`, borderRadius:'10px', color: summary?.usedOT?C.muted:C.accent, fontSize:'12.5px', fontWeight:700, padding:'9px 14px', cursor: summary?.usedOT?'not-allowed':'pointer', opacity: summary?.usedOT?0.6:1 }}
                  >
                    <Icon name="clock" size={14} color={summary?.usedOT?C.muted:C.accent}/> OT
                  </button>
                  <button onClick={handleEndShiftClick} style={{ background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'10px', color:C.muted, fontSize:'12px', fontWeight:600, padding:'9px 14px', cursor:'pointer' }}>End Shift</button>
                </>
              )}
              <button onClick={()=>setShowLogout(true)} style={{ display:'flex', alignItems:'center', gap:'8px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'5px 10px 5px 5px', cursor:'pointer' }}>
                <div style={{ width:'28px', height:'28px', borderRadius:'50%', background:C.accent, color:'#06120a', fontSize:'11px', fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{(user?.name||'U').slice(0,2).toUpperCase()}</div>
                <div style={{ textAlign:'left' }}>
                  <div style={{ color:C.text, fontSize:'12px', fontWeight:600, lineHeight:1.3 }}>{user?.name||'Employee'}</div>
                  <div style={{ color:C.muted, fontSize:'10px', lineHeight:1.3 }}>EMP-{user?.empId||'—'}</div>
                </div>
                <Icon name="chevron-down" size={13} color={C.muted}/>
              </button>
            </div>
          </div>

          <div style={{ padding:'0 24px 32px' }}>
            {activeTab === 'dashboard' && (
              <EmpDashboardTab summary={summary} range={summaryRange} setRange={setSummaryRange} loading={summaryLoading} onGoToTab={setActiveTab} breakStatus={breakStatus} />
            )}
            {activeTab === 'myday' && (
              <MyDayTab
                currentHour={currentHour} currentClients={clients} filled={filled} myDay={myDay}
                saveUpdate={saveUpdate} saving={saving}
                footagePending={footage.pending.length} followupsPending={footage.followups.length}
                onGoToTab={setActiveTab} canEdit={isActive}
              />
            )}
            {activeTab === 'clients' && (
              <MyClientsTab clients={clients} filled={filled} saveUpdate={saveUpdate} saving={saving} currentHour={currentHour} canEdit={isActive} />
            )}
            {activeTab === 'footage' && <EmpFootageTab footage={footage} />}
            {activeTab === 'followup' && <EmpFollowupTab followups={footage.followups} />}

            {['performance','notifications','help','settings'].includes(activeTab) && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', maxWidth:'520px', margin:'40px auto', textAlign:'center', padding:'40px 24px' }}>
                <div style={{ width:'44px', height:'44px', borderRadius:'12px', background:C.accentDark, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
                  <Icon name={activeTab==='performance'?'analytics':activeTab==='notifications'?'alerts':activeTab==='help'?'sparkles':'settings'} size={20} color={C.accent}/>
                </div>
                <div style={{ color:C.text, fontSize:'15px', fontWeight:700, marginBottom:'6px' }}>{tabTitle} — coming soon</div>
                <div style={{ color:C.muted, fontSize:'12px', lineHeight:1.6 }}>This module isn't wired up to live data yet.</div>
              </div>
            )}
          </div>
        </div>
      </div>
      <LogoutModal show={showLogout} onConfirm={handleLogoutConfirm} onCancel={()=>setShowLogout(false)} />

      {/* Shift started (normal, non-early) confirmation */}
      {shiftStartedInfo && (() => {
        const isLate = !!shiftStartedInfo.isLateAdjustment
        return (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={()=>setShiftStartedInfo(null)}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'16px', padding:'1.75rem', width:'380px', maxWidth:'90vw', textAlign:'center' }} onClick={e=>e.stopPropagation()}>
            <div style={{ width:'52px', height:'52px', borderRadius:'50%', background: isLate?C.amberBg:C.accentDark, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <Icon name="check-circle" size={22} color={isLate?C.amber:C.accent} />
            </div>
            <div style={{ color:C.text, fontSize:'16px', fontWeight:700, marginBottom:'8px' }}>Shift started ✓</div>
            <div style={{ color:C.muted, fontSize:'12.5px', lineHeight:1.6, marginBottom:'18px' }}>
              You clocked in at <strong style={{color:isLate?C.amber:C.accent}}>{shiftStartedInfo.actualStart}</strong>.<br/>
              {isLate ? 'Since you missed your grace hour, your shift has been updated to' : 'Your scheduled shift is'}<br/>
              <strong style={{ color: isLate?C.amber:C.text2, fontSize:'14px' }}>{fmtShift(shiftStartedInfo.start, shiftStartedInfo.end)}</strong>
              {isLate && <><br/><span style={{color:C.muted}}>Your earlier hours today are marked Week Off and won't be counted.</span></>}
            </div>
            <button onClick={()=>setShiftStartedInfo(null)} style={{ width:'100%', background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'12.5px', fontWeight:700, padding:'11px', cursor:'pointer' }}>Got it</button>
          </div>
        </div>
        )
      })()}

      {/* Early Start confirmation */}
      {earlyStartPreview && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={()=>setEarlyStartPreview(null)}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'16px', padding:'1.75rem', width:'380px', maxWidth:'90vw', textAlign:'center' }} onClick={e=>e.stopPropagation()}>
            <div style={{ width:'52px', height:'52px', borderRadius:'50%', background:C.accentDark, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <Icon name="clock" size={22} color={C.accent} />
            </div>
            <div style={{ color:C.text, fontSize:'16px', fontWeight:700, marginBottom:'8px' }}>Start shift early?</div>
            <div style={{ color:C.muted, fontSize:'12.5px', lineHeight:1.6, marginBottom:'16px' }}>
              You're early — your shift will be updated to<br/>
              <strong style={{ color:C.accent, fontSize:'14px' }}>{fmtShift(earlyStartPreview.start, earlyStartPreview.end)}</strong>
              <br/>instead of {fmtShift(summary?.scheduledStart, summary?.scheduledEnd)}.
            </div>
            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={()=>{ setEarlyStartPreview(null); doStartShift(false) }} style={{ flex:1, background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'12.5px', fontWeight:600, padding:'11px', cursor:'pointer' }}>Keep Normal Time</button>
              <button onClick={()=>doStartShift(true)} disabled={startingShift} style={{ flex:1, background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'12.5px', fontWeight:700, padding:'11px', cursor:'pointer' }}>{startingShift?'Starting...':'Confirm'}</button>
            </div>
          </div>
        </div>
      )}

      {/* OT confirmation */}
      {showOTConfirm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={()=>setShowOTConfirm(false)}>
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'16px', padding:'1.75rem', width:'380px', maxWidth:'90vw', textAlign:'center' }} onClick={e=>e.stopPropagation()}>
            <div style={{ width:'52px', height:'52px', borderRadius:'50%', background:C.accentDark, display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px' }}>
              <Icon name="clock" size={22} color={C.accent} />
            </div>
            <div style={{ color:C.text, fontSize:'16px', fontWeight:700, marginBottom:'8px' }}>Extend shift by 3 hours?</div>
            <div style={{ color:C.muted, fontSize:'12.5px', lineHeight:1.6, marginBottom:'16px' }}>
              Your shift end will move from <strong style={{color:C.text2}}>{summary?.shiftEnd!=null ? fmtShift(summary.shiftStart, summary.shiftEnd).split(' - ')[1] : '—'}</strong> to{' '}
              <strong style={{ color:C.accent }}>{summary?.shiftEnd!=null ? fmtShift(summary.shiftStart, (summary.shiftEnd+3)%24).split(' - ')[1] : '—'}</strong>.
              <br/>This can only be used once per day.
            </div>
            <div style={{ display:'flex', gap:'10px' }}>
              <button onClick={()=>setShowOTConfirm(false)} style={{ flex:1, background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'12.5px', fontWeight:600, padding:'11px', cursor:'pointer' }}>Cancel</button>
              <button onClick={confirmOT} disabled={otLoading} style={{ flex:1, background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'12.5px', fontWeight:700, padding:'11px', cursor:'pointer' }}>{otLoading?'Applying...':'Confirm OT'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function TopPill({ icon, text, color }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'6px', background:C.card, border:`1px solid ${C.border}`, borderRadius:'8px', padding:'7px 12px', color: color||C.text2, fontSize:'12px', whiteSpace:'nowrap' }}>
      <Icon name={icon} size={13} color={color||C.muted}/> {text}
    </div>
  )
}

function RepStat({ val, label, color }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', background:C.s2, borderRadius:'8px', padding:'10px' }}>
      <span style={{ color, fontSize:'20px', fontWeight:700 }}>{val}</span>
      <span style={{ color:C.muted, fontSize:'9px', marginTop:'2px' }}>{label}</span>
    </div>
  )
}
