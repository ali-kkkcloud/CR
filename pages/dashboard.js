import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import EmployeeSidebar from '../components/EmployeeSidebar'
import BreakOverlay from '../components/BreakOverlay'
import Icon from '../components/Icons'
import { C } from '../components/Widgets'
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

  const [summary, setSummary] = useState(null)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [summaryRange, setSummaryRange] = useState('month')

  const [breakStatus, setBreakStatus] = useState({ onBreak:false, startTime:null, history:[], totalMinutesToday:0 })
  const [breakActionLoading, setBreakActionLoading] = useState(false)

  const hourRef = useRef(currentHour)
  const autoRef = useRef(null)

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
    if (shiftStatus !== 'active') return
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
    }, 30000)
    return () => clearInterval(autoRef.current)
  }, [shiftStatus])

  useEffect(() => {
    if (shiftStatus === 'active') loadSummary(summaryRange)
  }, [summaryRange])

  async function handleStartShift() {
    const res  = await fetch('/api/shift/start', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setShiftStatus('active')
      setStartTime(data.startTime)
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

  async function saveUpdate(client, field, value) {
    const key = `${client}_${field}`
    setSaving(p => ({...p, [key]: true}))
    const current = filled[client] || {}
    const updated = { ...current, [field]: value }
    if (field === 'fatigue' && value === 'No') updated.fatigueCount = ''
    setFilled(p => ({ ...p, [client]: updated }))
    const res = await fetch('/api/crm/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client, slot: currentHour, ...updated }),
    })
    const data = await res.json()
    if (data.updatedAt) setFilled(p => ({ ...p, [client]: { ...p[client], updatedAt: data.updatedAt } }))
    setSaving(p => { const n = {...p}; delete n[key]; return n })
  }

  async function startBreak() {
    setBreakActionLoading(true)
    const res = await fetch('/api/break/start', { method:'POST' })
    const data = await res.json()
    setBreakActionLoading(false)
    if (data.success) loadBreakStatus()
  }

  async function resumeFromBreak() {
    setBreakActionLoading(true)
    const res = await fetch('/api/break/end', { method:'POST' })
    const data = await res.json()
    setBreakActionLoading(false)
    if (data.success) loadBreakStatus()
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

  if (shiftStatus === 'loading') return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh',background:C.bg}}>
      <div className="spinner"></div>
    </div>
  )

  // ── NOT STARTED ──
  if (shiftStatus === 'not_started') return (
    <>
      <Head><title>Cautio CRM — Dashboard</title></Head>
      <div style={{minHeight:'100vh',background:C.bg,display:'flex',alignItems:'center',justifyContent:'center',padding:'20px'}}>
        <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:'16px',padding:'3rem 2rem',maxWidth:'420px',width:'100%',textAlign:'center'}}>
          <img src="/cautio_shield.webp" alt="Cautio" style={{width:'56px',height:'56px',objectFit:'contain',margin:'0 auto 1.5rem',display:'block'}} onError={e=>e.target.style.display='none'}/>
          <h2 style={{color:C.text,fontSize:'22px',fontWeight:'700',marginBottom:'8px'}}>
            Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.name} 👋
          </h2>
          <p style={{color:C.muted,fontSize:'14px',marginBottom:'2rem'}}>Click Start Shift to begin. Clients will auto-load based on current time.</p>
          <div style={{background:C.s2,border:`1px solid ${C.border2}`,borderRadius:'8px',padding:'10px 16px',marginBottom:'1.5rem',fontSize:'13px'}}>
            <span style={{color:C.accent,fontWeight:'600'}}>Current slot:</span> <span style={{color:C.text,marginLeft:'8px'}}>{hourLabel(currentHour)}</span>
          </div>
          <button onClick={handleStartShift} style={{width:'100%',background:C.accent,border:'none',borderRadius:'10px',color:'#06120a',fontWeight:'700',fontSize:'16px',padding:'14px',cursor:'pointer'}}>▶ Start Shift</button>
        </div>
      </div>
    </>
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

  return (
    <>
      <Head><title>Cautio CRM — {tabTitle}</title></Head>
      <div style={{minHeight:'100vh', background:C.bg, display:'flex'}}>
        <EmployeeSidebar
          activeTab={activeTab} setActiveTab={setActiveTab} user={user}
          counts={{ footage: footage.pending.length, followup: footage.followups.length }}
          shiftTime={fmtShift(summary?.shiftStart, summary?.shiftEnd)}
          loginTime={startTime}
        />

        <div style={{flex:1, minWidth:0}}>
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
              <TopPill icon="check-circle" text={`In: ${startTime}`} color={summary?.attendanceStatus==='Late'?C.amber:C.accent} />
              <button onClick={()=>setActiveTab('notifications')} style={{ position:'relative', background:C.card, border:`1px solid ${C.border}`, borderRadius:'8px', width:'36px', height:'36px', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer' }}>
                <Icon name="bell" size={16} color={C.text2}/>
                {(footage.pending.length+footage.followups.length)>0 && (
                  <span style={{ position:'absolute', top:'-4px', right:'-4px', background:C.red, color:'#fff', fontSize:'9px', fontWeight:700, borderRadius:'10px', minWidth:'16px', height:'16px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    {footage.pending.length+footage.followups.length}
                  </span>
                )}
              </button>
              <button onClick={startBreak} disabled={breakActionLoading} style={{ display:'flex', alignItems:'center', gap:'8px', background:C.red, border:'none', borderRadius:'10px', color:'#fff', fontSize:'13px', fontWeight:800, padding:'9px 18px', cursor:'pointer' }}>
                <Icon name="clock" size={15} color="#fff"/> BREAK
              </button>
              <button onClick={handleEndShiftClick} style={{ background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'10px', color:C.muted, fontSize:'12px', fontWeight:600, padding:'9px 14px', cursor:'pointer' }}>End Shift</button>
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
                onGoToTab={setActiveTab}
              />
            )}
            {activeTab === 'clients' && (
              <MyClientsTab clients={clients} filled={filled} saveUpdate={saveUpdate} saving={saving} currentHour={currentHour} />
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
