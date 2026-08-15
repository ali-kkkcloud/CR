import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import EmployeeSidebar from '../components/EmployeeSidebar'
import BreakOverlay from '../components/BreakOverlay'
import LogoutModal from '../components/LogoutModal'
import Icon from '../components/Icons'
import { C, parseSheetDate } from '../components/Widgets'
import { TopBar, PageBody, AccountButton, NotifyButton } from '../components/Shell'
import { Card, Button, Pill, Tag, Field, Banner, EmptyState, Modal, T, R, SP, SURF } from '../components/ui'
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
// shiftDateStr is "DD/MM/YYYY" (todayStr() format, the date this shift
// started on). Compares calendar day, not raw string, so single- vs
// zero-padded sheet dates still match correctly.
function sameDayAsShift(raisedAt, shiftDateStr) {
  if (!shiftDateStr) return true // shift date unknown — don't hide anything
  const raisedD = parseSheetDate(raisedAt)
  if (!raisedD) return false
  const [d, m, y] = shiftDateStr.split('/').map(Number)
  return raisedD.getFullYear() === y && raisedD.getMonth() === m - 1 && raisedD.getDate() === d
}
function greeting() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Kolkata' })).getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
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
  const [shiftDate, setShiftDate] = useState('') // DD/MM/YYYY — the calendar date THIS shift started on (not "today", for night shifts crossing midnight)
  const [currentHour, setCurrentHour] = useState(new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getHours())
  const [clients, setClients] = useState([])
  const [filled, setFilled] = useState({})
  const [clientContext, setClientContext] = useState({})
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

  const [breakStatus, setBreakStatus] = useState({ onBreak:false, startTime:null, history:[], totalMinutesToday:0, isAuto:false, idleMinutes:10 })
  const [breakActionLoading, setBreakActionLoading] = useState(false)

  const [startingShift, setStartingShift] = useState(false)
  const [showOTConfirm, setShowOTConfirm] = useState(false)
  const [otLoading, setOtLoading] = useState(false)
  const [shiftStartedInfo, setShiftStartedInfo] = useState(null) // { start, end } | null — what the window became, shown after clocking in

  const hourRef = useRef(currentHour)
  const autoRef = useRef(null)
  const summaryRefreshRef = useRef(null)
  // Tracks whether we've ever successfully loaded a summary, so a transient
  // server error doesn't wipe out a dashboard that's already showing data.
  const summaryRef = useRef(null)
  // { clientName: lastEditedTimestamp } — protects in-progress edits from
  // being overwritten by the 30s background refresh.
  const editingRef = useRef({})
  // When this employee was last actually at the screen. Only genuine input
  // counts — the 30s poll itself must never look like activity, or nobody
  // would ever go idle.
  const lastInputRef = useRef(Date.now())

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
        setShiftDate(statusData.shiftDate || '')
      } else if (statusData.status === 'ended') {
        setShiftStatus('ended')
        setStartTime(statusData.startTime || '')
        setShiftDate(statusData.shiftDate || '')
      } else {
        setShiftStatus('not_started')
      }
    }
    init().catch(() => router.replace('/login'))
  }, [])

  const loadClients = useCallback(async () => {
    try {
      const res  = await fetch('/api/clients/current')
      const data = await res.json()
      if (!res.ok || data.error) return   // keep last good state, retry on next poll
      if (data.clients) setClients(data.clients)
      // Why the list looks the way it does — an empty one needs explaining.
      setClientContext({
        scheduledThisHour: data.scheduledThisHour,
        clockedOut: data.clockedOut,
        myWindow: data.myWindow || null,
      })
      if (data.filled) {
        // Merge, don't clobber: a background refresh must never wipe out
        // what the employee is part-way through typing. Any client they've
        // touched in the last 2 minutes keeps its local value.
        setFilled(prev => {
          const merged = { ...data.filled }
          const cutoff = Date.now() - 120000
          Object.entries(editingRef.current).forEach(([client, at]) => {
            if (at > cutoff && prev[client]) merged[client] = { ...merged[client], ...prev[client] }
          })
          return merged
        })
      }
      if (typeof data.hour === 'number') { setCurrentHour(data.hour); hourRef.current = data.hour }
    } catch (e) { console.error('loadClients failed:', e) }
  }, [])

  const loadFootage = useCallback(async () => {
    try {
      const res  = await fetch('/api/footage/list')
      const data = await res.json()
      if (!res.ok || data.error) return
      setFootage({ pending: data.pending || [], completed: data.completed || [], followups: data.followups || [] })
    } catch (e) { console.error('loadFootage failed:', e) }
  }, [])

  const loadMyDay = useCallback(async () => {
    try {
      const res  = await fetch('/api/dashboard/my-day')
      const data = await res.json()
      if (!res.ok || data.error || !Array.isArray(data.timeline)) return
      setMyDay(data)
    } catch (e) { console.error('loadMyDay failed:', e) }
  }, [])

  const loadSummary = useCallback(async (range) => {
    setSummaryLoading(true)
    try {
      const res  = await fetch(`/api/dashboard/summary?range=${range}`)
      const data = await res.json()
      // Only accept a well-formed payload; a 500 body would otherwise be
      // stored as "summary" and crash the dashboard on first render.
      if (res.ok && !data.error && data.trend) { setSummary(data); summaryRef.current = data }
      else if (!summaryRef.current) setSummary({ error: data.error || 'Server is busy, retrying…' })
    } catch (e) {
      console.error('loadSummary failed:', e)
      if (!summaryRef.current) setSummary({ error: 'Could not reach the server, retrying…' })
    } finally {
      setSummaryLoading(false)
    }
  }, [])

  // Mouse, keys, scroll, touch — throttled, because mousemove fires
  // constantly and we only need the timestamp, not every event.
  useEffect(() => {
    const events = ['mousemove','mousedown','keydown','wheel','scroll','touchstart']
    let last = 0
    const onInput = () => {
      const n = Date.now()
      if (n - last < 5000) return
      last = n
      lastInputRef.current = n
    }
    events.forEach(e => window.addEventListener(e, onInput, { passive: true }))
    return () => events.forEach(e => window.removeEventListener(e, onInput))
  }, [])

  const loadBreakStatus = useCallback(async () => {
    try {
      const agoMs = Math.max(0, Date.now() - lastInputRef.current)
      const res  = await fetch(`/api/break/status?activeAgoMs=${agoMs}`)
      const data = await res.json()
      if (!res.ok || data.error) return
      setBreakStatus(data)
    } catch (e) { console.error('loadBreakStatus failed:', e) }
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
    doStartShift()
  }

  async function doStartShift() {
    setStartingShift(true)
    try {
      const res  = await fetch('/api/shift/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.success) {
        setShiftStatus('active')
        setStartTime(data.startTime)
        setShiftDate(data.shiftDate || '')
        loadClients(); loadMyDay(); loadSummary(summaryRangeRef.current)
        // Tell them the window that is actually in force now. The server
        // applies it either way — arriving early or late — so this is a
        // statement of what happened, never a question.
        const adjusted = data.earlyStart || data.lateStart
        const empSchedule = adjusted
          ? {
              start: adjusted.start, end: adjusted.end, actualStart: data.startTime,
              isAdjusted: true, isEarlyAdjustment: !!data.earlyStart,
              hoursShifted: adjusted.hoursShifted, extraHour: adjusted.extraHour,
            }
          : (summary && summary.scheduledStart != null
              ? { start: summary.scheduledStart, end: summary.scheduledEnd, actualStart: data.startTime }
              : null)
        if (empSchedule) setShiftStartedInfo(empSchedule)
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

  // Only the requests raised on the day THIS shift started — not the
  // employee's entire pending backlog — belong in the end-of-shift
  // follow-up prompt. Works for night shifts crossing midnight too, since
  // shiftDate is the calendar day the shift actually started on.
  const todaysPendingFootage = useMemo(
    () => footage.pending.filter(item => sameDayAsShift(item.raisedAt, shiftDate)),
    [footage.pending, shiftDate]
  )

  async function handleEndShiftClick() {
    if (!confirm('Are you sure you want to end your shift?')) return
    if (todaysPendingFootage.length > 0) {
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
    for (const item of todaysPendingFootage) {
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
    editingRef.current[client] = Date.now()   // protect from background refresh
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

  // Save a client's whole record in ONE request.
  //
  // saveUpdate above fires per field, and the grid it was written for called
  // it on every onChange — so typing a vehicle number into the misalignment
  // box was one Google Sheets write per letter. That is what made the
  // platform feel slow, and it spent quota the whole team shares on work
  // that was thrown away a keystroke later. The client screen now holds a
  // draft and posts it once.
  //
  // /api/crm/update rewrites the entire row, so the record passed in must
  // carry every field — which is exactly what the draft is.
  const saveClient = useCallback(async (client, record, hourOverride) => {
    const targetHour = hourOverride ?? currentHour
    const isCurrentHourEdit = targetHour === currentHour
    editingRef.current[client] = Date.now()   // protect from background refresh
    try {
      const res = await fetch('/api/crm/update', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client, slot: targetHour, ...record }),
      })
      const data = await res.json()
      // Only accept the new values once the server has them. Applying them
      // optimistically would make a failed save look identical to a
      // successful one, because the draft is compared against exactly this.
      if (!res.ok || !data.success) return false
      if (isCurrentHourEdit) {
        setFilled(p => ({ ...p, [client]: { ...(p[client] || {}), ...record, updatedAt: data.updatedAt || '' } }))
      }
      // "status" is what actually marks a client done — refresh the summary
      // shortly after so My Targets and the trend don't sit stale until the
      // next 30s poll.
      if ((record.status || '').toString().trim()) {
        clearTimeout(summaryRefreshRef.current)
        summaryRefreshRef.current = setTimeout(() => { loadSummary(summaryRangeRef.current); loadMyDay() }, 1200)
      }
      return true
    } catch (err) {
      console.error('saveClient failed:', err)
      return false
    }
  }, [currentHour, loadSummary, loadMyDay])

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
      if (data.success || res.status === 404) {
        // 404 means the break was already closed — by ending the shift, or by
        // a second tab. There is nothing left to resume from, so refresh and
        // let the overlay clear instead of warning about a problem that
        // has already resolved itself.
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
      <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:SP[5] }}>
        <Card style={{ maxWidth:'620px', width:'100%', padding:SP[6] }}>
          <div style={{ display:'flex', alignItems:'center', gap:SP[3], marginBottom:SP[3] }}>
            <div style={{
              width:'42px', height:'42px', borderRadius:R.lg, background:C.amber+'18',
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
            }}>
              <Icon name="footage" size={20} color={C.amber} />
            </div>
            <div>
              <div style={{ color:C.text, fontSize:T.lg, fontWeight:800 }}>
                {todaysPendingFootage.length} footage request{todaysPendingFootage.length===1?'':'s'} still open
              </div>
              <div style={{ color:C.muted, fontSize:T.base, marginTop:'3px' }}>
                Raised during this shift. Hand each one to a colleague, or leave it in your own queue.
              </div>
            </div>
          </div>

          <div style={{ maxHeight:'46vh', overflowY:'auto', display:'flex', flexDirection:'column', gap:SP[2], margin:`${SP[4]} 0` }}>
            {todaysPendingFootage.map(item => (
              <div key={item.issueId} style={{
                background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md, padding:SP[3],
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:SP[2], flexWrap:'wrap', marginBottom:'4px' }}>
                  <span style={{ color:C.text, fontSize:T.md, fontWeight:700 }}>{item.vehicle}</span>
                  <span style={{ color:C.muted, fontSize:T.base }}>{item.client}</span>
                </div>
                <div style={{ color:C.muted, fontSize:T.xs, marginBottom:'10px' }}>
                  {item.issueId} · raised {item.raisedAt}
                </div>
                <Field label="Forward to">
                  <select
                    value={forwardSelections[item.issueId] || ''}
                    onChange={e => setForwardSelections(p => ({ ...p, [item.issueId]: e.target.value }))}
                  >
                    <option value="">— Keep it with me —</option>
                    {forwardOptions.active.length > 0 && (
                      <optgroup label="On shift now">
                        {forwardOptions.active.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
                      </optgroup>
                    )}
                    {forwardOptions.others.length > 0 && (
                      <optgroup label="Everyone else">
                        {forwardOptions.others.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
                      </optgroup>
                    )}
                  </select>
                </Field>
              </div>
            ))}
          </div>

          <div style={{ display:'flex', gap:SP[2], flexWrap:'wrap' }}>
            <Button variant="subtle" onClick={() => setEndShiftStep(null)}>Cancel</Button>
            <Button variant="primary" style={{ flex:2, minWidth:'180px' }} loading={forwarding} onClick={handleForwardAndEnd}>
              Forward &amp; end shift
            </Button>
            <Button variant="danger" style={{ flex:1, minWidth:'140px' }} onClick={doEndShift}>End without forwarding</Button>
          </div>
        </Card>
      </div>
    </>
  )

  // ── SHIFT ENDED REPORT ──
  if (shiftStatus === 'ended' && showReport && report) return (
    <>
      <Head><title>Cautio CRM — Shift Report</title></Head>
      <div style={{ minHeight:'100vh', background:C.bg, display:'flex', alignItems:'center', justifyContent:'center', padding:SP[5] }}>
        <Card style={{ maxWidth:'540px', width:'100%', padding:SP[6] }}>
          <div style={{ textAlign:'center', marginBottom:SP[5] }}>
            <img
              src="/cautio_shield.webp" alt="Cautio"
              style={{ width:'38px', height:'38px', objectFit:'contain', display:'block', margin:'0 auto 12px' }}
              onError={e=>e.target.style.display='none'}
            />
            <div style={{ color:C.text, fontSize:T.xl, fontWeight:800, letterSpacing:'-0.4px' }}>Shift complete</div>
            <div style={{ color:C.muted, fontSize:T.base, marginTop:'6px' }}>
              {report.date} · {report.shiftStart} → {report.shiftEnd} · {report.duration}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:SP[2], marginBottom:SP[2] }}>
            <RepStat val={report.clientsHandled} label="CLIENTS" color={C.accent}/>
            <RepStat val={report.totalUpdates} label="UPDATES" color={C.accent}/>
            <RepStat val={report.misalignCount} label="MISALIGNS" color={C.amber}/>
            <RepStat val={report.alertTotal} label="ALERTS" color={C.red}/>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:SP[2], marginBottom:SP[5] }}>
            <RepStat val={report.fatigueCount} label="FATIGUE" color={C.purple}/>
            <RepStat val={report.footageCompletedToday} label="FOOTAGE DONE" color={C.accent}/>
            <RepStat val={report.footagePending} label="FOOTAGE OPEN" color={C.amber}/>
            <RepStat val={report.redistributed} label="HANDED ON" color={C.text}/>
          </div>

          {report.redistributed > 0 && (
            <div style={{ marginBottom:SP[4] }}>
              <Banner tone="info" icon="shuffle">
                {report.redistributed} client{report.redistributed===1?'':'s'} handed to {[...new Set(report.redistributedTo)].join(', ')}
              </Banner>
            </div>
          )}

          <div style={{ display:'flex', flexDirection:'column', gap:SP[2] }}>
            <Button variant="ghost" full icon="download" onClick={downloadReport}>Download CSV report</Button>
            <Button variant="subtle" full onClick={()=>{ fetch('/api/auth/logout',{method:'POST'}); router.push('/login') }}>Log out</Button>
          </div>
        </Card>
      </div>
    </>
  )

  // ── BREAK OVERLAY ──
  if (breakStatus.onBreak) return (
    <>
      <Head><title>Cautio CRM — On Break</title></Head>
      <BreakOverlay
        startTime={breakStatus.startTime}
        startDate={breakStatus.startDate}
        isAuto={breakStatus.isAuto}
        idleMinutes={breakStatus.idleMinutes}
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

          <TopBar
            title={`${greeting()}, ${user?.name || ''}`}
            sub={isActive
              ? 'You’re clocked in. Your board updates itself every hour.'
              : shiftStatus === 'ended'
                ? 'Your shift has ended for today.'
                : 'Start your shift to begin working.'}
            right={
              <>
                <Pill icon="calendar">{new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</Pill>
                <Pill icon="clock">{fmtShift(summary?.shiftStart, summary?.shiftEnd)}</Pill>
                {isActive && (
                  <Pill icon="check-circle" color={summary?.attendanceStatus==='Late' ? C.amber : C.accent}>
                    In {startTime}
                  </Pill>
                )}
                <NotifyButton
                  count={footage.pending.length + footage.followups.length}
                  onClick={()=>setActiveTab('footage')}
                />
                {isActive ? (
                  <>
                    <Button variant="danger" icon="clock" onClick={startBreak} disabled={breakActionLoading}>Break</Button>
                    <Button
                      variant="ghost" icon="clock"
                      onClick={()=>setShowOTConfirm(true)}
                      disabled={summary?.usedOT}
                      title={summary?.usedOT ? 'Overtime already used today' : 'Extend your shift by 3 hours'}
                      style={summary?.usedOT ? undefined : { color:C.accent, borderColor:C.accent+'55', background:C.accentSoft }}
                    >OT</Button>
                    <Button variant="subtle" onClick={handleEndShiftClick}>End shift</Button>
                  </>
                ) : shiftStatus === 'not_started' ? (
                  <Button variant="primary" onClick={handleStartShiftClick} loading={startingShift}>▶ Start shift</Button>
                ) : null}
                <AccountButton name={user?.name} sub={user?.empId || '—'} onClick={()=>setShowLogout(true)} />
              </>
            }
          />

          <PageBody>
            {!isActive && (
              <div style={{ marginBottom:SP[4] }}>
                <Banner tone="warn" icon="clock">
                  {shiftStatus === 'ended'
                    ? 'Your shift has ended for today — everything below is read-only.'
                    : 'Your shift hasn’t started yet — you’re viewing today’s assignments in read-only mode.'}
                </Banner>
              </div>
            )}

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
              <MyClientsTab clients={clients} filled={filled} saveClient={saveClient} saving={saving} currentHour={currentHour} canEdit={isActive} {...clientContext} />
            )}
            {activeTab === 'footage' && <EmpFootageTab footage={footage} />}
            {activeTab === 'followup' && <EmpFollowupTab followups={footage.followups} />}

            {['performance','notifications','help','settings'].includes(activeTab) && (
              <Card pad={false} style={{ maxWidth:'520px', margin:'40px auto' }}>
                <EmptyState
                  icon={activeTab==='performance'?'analytics':activeTab==='notifications'?'alerts':activeTab==='help'?'sparkles':'settings'}
                  title={`${tabTitle} — coming soon`}
                  detail="This module isn't wired up to live data yet."
                />
              </Card>
            )}
          </PageBody>
        </div>
      </div>
      <LogoutModal show={showLogout} onConfirm={handleLogoutConfirm} onCancel={()=>setShowLogout(false)} />

      {/* Shift started — a statement of the window now in force, never a question */}
      {(() => {
        if (!shiftStartedInfo) return null
        const isAdj    = !!shiftStartedInfo.isAdjusted
        const isEarly  = !!shiftStartedInfo.isEarlyAdjustment
        const isLate   = isAdj && !isEarly
        const moved    = isLate && (shiftStartedInfo.hoursShifted || 0) > 0
        const owesHour = shiftStartedInfo.extraHour === 1
        const accent   = isLate ? C.amber : C.accent
        return (
          <Modal
            open onClose={()=>setShiftStartedInfo(null)}
            icon="check-circle" iconColor={accent}
            title="Shift started"
            footer={<Button variant="primary" full onClick={()=>setShiftStartedInfo(null)}>Got it</Button>}
          >
            <div style={{ color:C.muted, fontSize:T.base, lineHeight:1.7 }}>
              You clocked in at <strong style={{ color:accent }}>{shiftStartedInfo.actualStart}</strong>.
            </div>
            <div style={{
              background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md,
              padding:'13px 15px', margin:`${SP[3]} 0`,
            }}>
              <div className="eyebrow" style={{ marginBottom:'5px' }}>
                {isEarly ? 'Your shift now runs' : isLate ? (moved ? 'Moved to' : 'Runs to') : 'Your shift'}
              </div>
              <div style={{ color:accent, fontSize:T.lg, fontWeight:800 }}>
                {fmtShift(shiftStartedInfo.start, shiftStartedInfo.end)}
              </div>
            </div>
            <div style={{ color:C.muted, fontSize:T.sm, lineHeight:1.7 }}>
              {isEarly && <div>Your clients for this hour are on your board now.</div>}
              {owesHour && <div>That includes one extra hour at the end, because you clocked in past the half hour.</div>}
              {moved && <div>The hours before you arrived are marked Week Off and won’t be counted.</div>}
            </div>
          </Modal>
        )
      })()}

      {/* OT confirmation */}
      <Modal
        open={showOTConfirm}
        onClose={()=>setShowOTConfirm(false)}
        icon="clock"
        title="Extend shift by 3 hours?"
        sub="This can only be used once per day."
        footer={
          <>
            <Button variant="ghost" full onClick={()=>setShowOTConfirm(false)}>Cancel</Button>
            <Button variant="primary" full loading={otLoading} onClick={confirmOT}>Confirm OT</Button>
          </>
        }
      >
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'center', gap:SP[4],
          background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md, padding:'15px',
        }}>
          <div style={{ textAlign:'center' }}>
            <div className="eyebrow" style={{ marginBottom:'5px' }}>Now ends</div>
            <div style={{ color:C.text2, fontSize:T.md, fontWeight:700 }}>
              {summary?.shiftEnd != null ? fmtShift(summary.shiftStart, summary.shiftEnd).split(' - ')[1] : '—'}
            </div>
          </div>
          <Icon name="arrow-right" size={16} color={C.dim} />
          <div style={{ textAlign:'center' }}>
            <div className="eyebrow" style={{ marginBottom:'5px' }}>Will end</div>
            <div style={{ color:C.accent, fontSize:T.md, fontWeight:800 }}>
              {summary?.shiftEnd != null ? fmtShift(summary.shiftStart, (summary.shiftEnd+3)%24).split(' - ')[1] : '—'}
            </div>
          </div>
        </div>
      </Modal>
    </>
  )
}

function RepStat({ val, label, color }) {
  return (
    <div style={{
      display:'flex', flexDirection:'column', alignItems:'center',
      background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md, padding:'12px 8px',
    }}>
      <span style={{ color, fontSize:'21px', fontWeight:800, lineHeight:1 }}>{val}</span>
      <span style={{ color:C.muted, fontSize:'9px', marginTop:'5px', letterSpacing:'0.4px', textAlign:'center' }}>{label}</span>
    </div>
  )
}
