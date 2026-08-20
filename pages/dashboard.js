import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import BreakOverlay from '../components/BreakOverlay'
import LogoutModal from '../components/LogoutModal'
import Icon from '../components/Icons'
import { C, parseSheetDate } from '../components/Widgets'
import { AccountButton, NotifyButton } from '../components/Shell'
import { Card, Button, Pill, Tag, Field, Segmented, Banner, EmptyState, Modal, T, R, SP, SURF, businessDayOf, istBusinessDateLabel } from '../components/ui'
import CautioWordmark from '../components/Wordmark'
import HourRail from '../components/HourRail'
import TodayRail from '../components/TodayRail'
import EmpDashboardTab from '../components/tabs/EmpDashboardTab'
import MyClientsTab from '../components/tabs/MyClientsTab'
import EmpFootageTab from '../components/tabs/EmpFootageTab'
import EmpFollowupTab from '../components/tabs/EmpFollowupTab'

function hourLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)} – ${to12((h+1)%24)}:00 ${suf((h+1)%24)}`
}
// shiftDateStr is "DD/MM/YYYY" — the OPERATING day this shift belongs to.
//
// Compared as operating days, not calendar days: a request raised at two in
// the morning carries the next calendar date but belongs to the shift that
// began the evening before, and comparing the raw calendar dates dropped
// exactly those requests out of the end-of-shift hand-over prompt — the ones a
// night shift most needs to pass on.
function sameDayAsShift(raisedAt, shiftDateStr) {
  if (!shiftDateStr) return true // shift date unknown — don't hide anything
  const raisedD = parseSheetDate(raisedAt)
  if (!raisedD) return false
  const raisedDay = businessDayOf(raisedD)
  if (!raisedDay) return false
  const [rd, rm, ry] = raisedDay.split('/').map(Number)
  const [d, m, y]    = shiftDateStr.split('/').map(Number)
  return rd === d && rm === m && ry === y
}
function greeting() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone:'Asia/Kolkata' })).getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}
// The OPERATING day, read in IST — see istBusinessDateLabel. At two in the
// morning this still reads as the previous date, which is the day every row
// the shift writes is filed under.
function istDateLabel() { return istBusinessDateLabel() }
// Whether the clock has passed the end of this shift's window.
//
// The window is the EFFECTIVE one — clocking in early or late moves it — and
// the server always sets it so that the hour somebody arrived in is inside it.
// So for a shift that is still open, "the current hour is not in the window"
// can only mean the window has run out.
function windowHasEnded(startHour, endHour, nowHour) {
  if (startHour == null || endHour == null) return false
  const wraps = endHour <= startHour
  const inWindow = wraps
    ? (nowHour >= startHour || nowHour < endHour)
    : (nowHour >= startHour && nowHour < endHour)
  return !inWindow
}
function fmtHour12(h) {
  if (h == null) return '—'
  const to12 = h % 12 === 0 ? 12 : h % 12
  return `${to12}:00 ${h >= 12 ? 'PM' : 'AM'}`
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
  // Lands on the Board — the work — rather than on charts. An operator
  // clocking in wants their clients, not a trend line.
  const [activeTab, setActiveTab] = useState('board')
  // A request from the rail to put one client in the board's detail pane.
  const [focusRequest, setFocusRequest] = useState(null)
  const [showMore, setShowMore]   = useState(false)
  // Which hour the board is showing. Follows the clock until the operator
  // picks another one from the rail, then stays where they put it.
  const [viewHour, setViewHour] = useState(null)
  // { [hour]: { [client]: record } } — what has been saved into an earlier
  // hour this session, so the board reflects it before the next my-day poll.
  const [pastEdits, setPastEdits] = useState({})
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

  const followRef = useRef(true)   // is the board tracking the clock?
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
    // Only announce loading when there is nothing on screen yet. This runs on
    // the 30-second poll too, and flipping the flag every time collapsed the
    // whole Dashboard into skeletons twice a minute — the charts, the
    // calendar and the targets all blinked out and back for no reason.
    if (!summaryRef.current) setSummaryLoading(true)
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

  const loadBreakStatus = useCallback(async () => {
    try {
      const agoMs = Math.max(0, Date.now() - lastInputRef.current)
      const res  = await fetch(`/api/break/status?activeAgoMs=${agoMs}`)
      const data = await res.json()
      if (!res.ok || data.error) return
      setBreakStatus(data)
    } catch (e) { console.error('loadBreakStatus failed:', e) }
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

    // ── A tab that cannot see is not a person who is not there ────────────
    //
    // None of the events above reach this page while its tab is in the
    // background or its window is behind another one. The browser stops
    // delivering them, and it throttles the poll as well — so the page learns
    // nothing at all about that stretch.
    //
    // It was reporting that stretch as idleness anyway. An operator who spent
    // forty-five minutes in the fleet monitoring window — which IS the work —
    // came back to the CRM and was immediately shown a forty-five minute
    // automatic break, backdated to the moment they had switched away. They
    // had been working the entire time. On nights, where almost everything is
    // watched in the other window, people were being put on breaks over and
    // over for doing their job.
    //
    // Coming back is the first thing this page can actually observe, so that
    // is where the mark goes. Not knowing is not the same as knowing somebody
    // was away, and it must never be recorded as if it were.
    //
    // The case the automatic break is really for is untouched: an employee who
    // leaves this page open and in front of them and walks away sends no
    // events, no visibility change and no focus change, and their idle time
    // grows exactly as before.
    const onBack = () => {
      if (document.visibilityState === 'hidden') return
      last = Date.now()
      lastInputRef.current = last
      // Ask again straight away, so an overlay that should not be there goes
      // rather than sitting on screen until the next poll.
      loadBreakStatus()
    }
    window.addEventListener('focus', onBack)
    document.addEventListener('visibilitychange', onBack)

    return () => {
      events.forEach(e => window.removeEventListener(e, onInput))
      window.removeEventListener('focus', onBack)
      document.removeEventListener('visibilitychange', onBack)
    }
  }, [loadBreakStatus])

  useEffect(() => {
    if (!user) return
    loadClients()
    loadFootage()
    loadMyDay()
    loadSummary(summaryRange)
    loadBreakStatus()
    // Everything on the screen refreshes, every thirty seconds.
    //
    // The board and the hour strip used to refresh ONLY when the clock rolled
    // into a new hour. Everything else on the page moved and those two sat
    // still, so the work itself — the one thing an operator is looking at —
    // was the single most stale thing on screen: up to a full hour behind. A
    // colleague clocking in or going home reshapes who holds what immediately,
    // and none of it appeared until the hour turned or somebody pressed reload.
    //
    // Both are safe to poll: loadClients merges rather than clobbers, so
    // anything typed in the last two minutes survives, and loadMyDay keeps the
    // last good payload if the response is not well-formed.
    autoRef.current = setInterval(() => {
      loadClients()
      loadMyDay()
      loadFootage()
      loadBreakStatus()
      loadSummary(summaryRangeRef.current)
    }, 30000)
    return () => clearInterval(autoRef.current)
  }, [user])

  useEffect(() => {
    if (user) loadSummary(summaryRange)
  }, [summaryRange])

  // The board starts on the hour in progress and moves with it, until the
  // operator selects another one — after which it stays put, because being
  // yanked to a different hour mid-edit is worse than a stale header.
  useEffect(() => {
    if (followRef.current) setViewHour(currentHour)
  }, [currentHour])

  function selectHour(h) {
    followRef.current = h === currentHour
    setViewHour(h)
  }

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

  // Save a client's whole record in ONE request.
  //
  // The screen this replaced saved per field, on every onChange — so typing a
  // vehicle number into the misalignment box was one Google Sheets write per
  // letter. That is what made the platform feel slow, and it spent quota the
  // whole team shares on work that was thrown away a keystroke later. The
  // client screen now holds a draft and posts it once.
  //
  // /api/crm/update rewrites the entire row, so the record passed in must
  // carry every field — which is exactly what the draft is.
  const saveClient = useCallback(async (client, record, hourOverride) => {
    const targetHour = hourOverride ?? currentHour
    const isCurrentHourEdit = targetHour === currentHour
    editingRef.current[client] = Date.now()   // protect from background refresh
    try {
      // Saving retries itself before it ever says no.
      //
      // The spreadsheet's quota is measured per minute, and at the top of an
      // hour thirty people press Save inside the same few seconds. One of them
      // gets refused — and used to be told "Could not save — try again", with
      // the client still marked UNSAVED, as though their work had been
      // rejected. It had not; the platform simply gave up first.
      //
      // Three goes, spread over about twelve seconds, which is long enough for
      // a per-minute burst to clear. Only worth repeating when the server says
      // it is busy or the network dropped the request — a real rejection is
      // reported at once rather than tried three times.
      let res, data
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 2500 : 9000))
        try {
          res = await fetch('/api/crm/update', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client, slot: targetHour, ...record }),
          })
          data = await res.json().catch(() => ({}))
        } catch (netErr) {
          res = null; data = {}
        }
        if (res && res.ok && data.success) break
        const worthRetrying = !res || res.status === 503 || res.status >= 500 || data.retryable
        if (!worthRetrying) break
      }
      // Only accept the new values once the server has them. Applying them
      // optimistically would make a failed save look identical to a
      // successful one, because the draft is compared against exactly this.
      if (!res || !res.ok || !data.success) return false
      if (isCurrentHourEdit) {
        setFilled(p => ({ ...p, [client]: { ...(p[client] || {}), ...record, updatedAt: data.updatedAt || '' } }))
      } else {
        // An earlier hour is served from the day's record, which is refetched
        // on its own schedule. Hold what was just written so the board shows
        // it immediately rather than reverting until the next poll.
        setPastEdits(p => ({
          ...p,
          [targetHour]: { ...(p[targetHour] || {}), [client]: { ...record, updatedAt: data.updatedAt || '' } },
        }))
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
        // Enter the break from THIS response, not from a follow-up fetch.
        //
        // The overlay used to appear only once loadBreakStatus came back. When
        // that second request failed the break was already written to the
        // sheet, so the employee carried on working on a board the platform
        // considered abandoned — and the admin saw them on a break. The state
        // the server just confirmed is enough to show the overlay; the refresh
        // below only fills in the day's history.
        setBreakStatus(prev => ({
          ...prev,
          onBreak: true,
          startTime: data.startTime || prev.startTime,
          startDate: data.startDate || prev.startDate,
          isAuto: !!data.isAuto,
        }))
        loadBreakStatus().catch(() => {})
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
        // a second tab. There is nothing left to resume from, so clear the
        // overlay instead of warning about a problem that has already
        // resolved itself.
        //
        // Cleared from this response for the same reason the overlay is opened
        // from its own: if the refresh failed, the break was closed in the
        // sheet but the employee stayed trapped behind an overlay with no way
        // back to their board.
        setBreakStatus(prev => ({ ...prev, onBreak: false, startTime: null, startDate: null, isAuto: false }))
        loadBreakStatus().catch(() => {})
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
  const isActive = shiftStatus === 'active'

  // Clocked in, but the shift window has already run out. Nothing closes a
  // shift by itself — the end time in Shift_Log is the employee's own click —
  // so a forgotten one stays open, the attendance row never gets an end time
  // or a duration, and the platform goes on counting that person as on the
  // floor. Saying so, loudly, is what stops it going unnoticed for hours.
  const shiftOverdue = isActive && windowHasEnded(summary?.shiftStart, summary?.shiftEnd, currentHour)

  // ── The board's hour ──
  // The rail can select any hour of the shift. The hour in progress is served
  // by the live split (/api/clients/current); any other hour comes from the
  // day's own record, which is what My Day always read. Same data, same save
  // path — it is just no longer behind a separate navigation item.
  const timeline   = myDay?.timeline || []
  const shownHour  = viewHour == null ? currentHour : viewHour
  const viewEntry  = timeline.find(t => t.hour === shownHour)
  const isNowHour  = shownHour === currentHour

  const boardClients = isNowHour
    ? clients
    : (viewEntry?.clients || [])
        // Nothing is filtered out here any more. The redistribution log
        // annotates a board, it does not empty one — see /api/dashboard/my-day.
        // isRedistributed/fromEmployee come through too. An earlier hour can
        // contain clients handed over by a colleague who went home, and
        // dropping those two fields here lost the only sign of where the work
        // came from.
        .map(c => ({
          client:c.client, vehicleCount:c.vehicleCount, isSpecific:c.isSpecific, isCustom:c.isCustom,
          isRedistributed:c.isRedistributed, fromEmployee:c.fromEmployee,
        }))

  const boardFilled = isNowHour
    ? filled
    : Object.fromEntries((viewEntry?.clients || []).map(c => [c.client, {
        status: c.status || '', misalignVehicles: c.misalignVehicles || '',
        alertCount: c.alertCount || '', fatigue: c.fatigue || 'No',
        fatigueCount: c.fatigueCount || '', notes: c.notes || '',
        updatedAt: c.updatedAt || '',
      }]))

  // Merged with anything saved into a past hour this session, so a tile turns
  // "done" straight away instead of waiting for the next my-day poll.
  const mergedFilled = isNowHour
    ? boardFilled
    : { ...boardFilled, ...(pastEdits[shownHour] || {}) }

  const realBoard = boardClients.filter(c => !c.isCustom)

  // The rail's "This hour" card is about the hour in progress, always — not
  // about whichever hour the board happens to be showing. Deriving it from
  // the board put the live hour's label above an earlier hour's counts.
  const liveClients = clients.filter(c => !c.isCustom)
  const liveDone    = liveClients.filter(c => (filled[c.client]?.status || '').toString().trim()).length

  // The next client of the hour in progress with nothing recorded against it —
  // My Day's "Current task", now in the rail beside the board.
  const upNext = isActive
    ? liveClients.find(c => !(filled[c.client]?.status || '').toString().trim()) || null
    : null

  // Every update saved today, newest first. Same source and same eight-row
  // window as the panel this replaces.
  //
  // Ordered by hour first, then by the clock inside that hour. The old version
  // took whatever order the clients happened to sit in, which put 9:53am above
  // 4:20am above 5:46pm — a list of timestamps in no order at all. Sorting on
  // the hour rather than on the raw time is what keeps a night shift right:
  // its 11pm updates belong before its 1am ones, not after.
  const secsOfDay = (s) => {
    const m = (s || '').toString().trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?$/i)
    if (!m) return 0
    let h = parseInt(m[1], 10)
    const ap = (m[4] || '').toLowerCase()
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    return h * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10)
  }
  const recentActivity = []
  timeline.forEach((t, order) => {
    const inHour = (t.clients || [])
      .filter(c => c.filled && c.updatedAt)
      .map(c => ({ time: c.updatedAt, hour: t.hour, client: c.client, order, at: secsOfDay(c.updatedAt) }))
      .sort((a, b) => a.at - b.at)
    recentActivity.push(...inHour)
  })
  const recent = recentActivity.slice(-8).reverse()

  const TITLES = {
    board:'Board', dashboard:'Dashboard',
    footage:'Footage Requests', followup:'Follow-ups',
    performance:'My Performance', notifications:'Notifications',
    help:'Help & Support', settings:'Settings',
  }

  // Every destination the sidebar used to hold. The four that carry real work
  // sit in the switch; the four that are still placeholders sit behind More,
  // so nothing is unreachable and the bar stays readable.
  //
  // My Day is gone as a destination, not as a feature: the hour strip, the
  // whole-shift board, the day's totals, the next hour, the current task and
  // the day's activity all sit on the Board now, which is where the work is.
  const MAIN_TABS = [
    { value:'board',     label:'Board',      count: realBoard.length },
    { value:'dashboard', label:'Dashboard' },
    { value:'footage',   label:'Footage',    count: footage.pending.length },
    { value:'followup',  label:'Follow-ups', count: footage.followups.length },
  ]
  const MORE_TABS = ['performance', 'notifications', 'help', 'settings']

  return (
    <>
      <Head><title>Cautio CRM — {TITLES[activeTab] || 'Dashboard'}</title></Head>

      <div style={{ minHeight:'100vh', background:C.bg }}>

        {/* ══════════ COMMAND BAR ══════════ */}
        <header style={{
          position:'sticky', top:0, zIndex:60,
          background:'rgba(0,0,0,0.86)', backdropFilter:'blur(12px)',
          borderBottom:`1px solid ${C.border}`,
        }}>
          <div style={{
            maxWidth:'var(--content-max)', margin:'0 auto',
            display:'flex', alignItems:'center', gap:SP[4], flexWrap:'wrap',
            padding:`${SP[3]} ${SP[5]}`,
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', flexShrink:0 }}>
              <img
                src="/cautio_shield.webp" alt="Cautio"
                style={{ width:'30px', height:'30px', objectFit:'contain' }}
                onError={e => (e.target.style.display = 'none')}
              />
              {/* The wordmark the sidebar used to carry. Dropped below 1120px,
                  where the operator's own name matters more than the brand. */}
              <div className="hide-narrow" style={{ flexDirection:'column', gap:'2px', paddingRight:'4px' }}>
                <CautioWordmark size={15} color={C.text} weight={800} letterSpacing="0.3px" />
                <span style={{ color:C.dim, fontSize:'8.5px', letterSpacing:'0.5px' }}>OPERATIONS</span>
              </div>
              <div style={{ minWidth:0, borderLeft:`1px solid ${C.border2}`, paddingLeft:'10px' }}>
                <div className="ellip" style={{ color:C.text, fontSize:T.md, fontWeight:800, lineHeight:1.25, display:'flex', alignItems:'center', gap:'6px' }}>
                  {user?.name}
                  {isActive && <span className="live-dot" style={{ width:'5px', height:'5px', background:C.accent }} />}
                </div>
                <div style={{ color:C.muted, fontSize:'10px', lineHeight:1.3 }}>
                  {user?.empId} · {fmtShift(summary?.shiftStart, summary?.shiftEnd)}
                </div>
              </div>
            </div>

            <div style={{ flex:1, minWidth:'12px' }} />

            <div style={{ display:'flex', alignItems:'center', gap:SP[2], flexWrap:'wrap' }}>
              {isActive
                ? <Pill icon="check-circle" color={summary?.attendanceStatus==='Late' ? C.amber : C.accent}>In {startTime}</Pill>
                : <Pill icon="clock" color={C.amber}>{shiftStatus === 'ended' ? 'Shift ended' : 'Not started'}</Pill>}
              {/* Today's date. It was a top-bar pill before the redesign and
                  it matters on a night shift, where the calendar day rolls
                  over mid-shift and the clock alone doesn't say which day
                  the work is being filed against. */}
              <span className="hide-narrow">
                <Pill icon="calendar">{istDateLabel()}</Pill>
              </span>
              <Pill icon="clock">{clock}</Pill>
              <NotifyButton
                count={footage.pending.length + footage.followups.length}
                onClick={()=>setActiveTab('footage')}
              />

              {isActive ? (
                <>
                  {/* Past the window, ending the shift is the one thing left to
                      do, so it stops looking like a quiet secondary action. */}
                  {shiftOverdue && (
                    <Button variant="primary" onClick={handleEndShiftClick}>End shift now</Button>
                  )}
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
            </div>
          </div>

          <div style={{
            maxWidth:'var(--content-max)', margin:'0 auto',
            display:'flex', alignItems:'center', gap:SP[2], flexWrap:'wrap',
            padding:`0 ${SP[5]} ${SP[3]}`,
          }}>
            <Segmented value={activeTab} onChange={setActiveTab} options={MAIN_TABS} />

            {/* The four modules that aren't wired to live data yet. Reachable,
                without taking a slot from the five that are. */}
            <div style={{ position:'relative' }}>
              <Button
                variant={MORE_TABS.includes(activeTab) ? 'primary' : 'subtle'}
                size="sm"
                iconRight="chevron-down"
                onClick={()=>setShowMore(v => !v)}
              >More</Button>
              {showMore && (
                <>
                  <div onClick={()=>setShowMore(false)} style={{ position:'fixed', inset:0, zIndex:70 }} />
                  <div className="fade-in" style={{
                    position:'absolute', top:'calc(100% + 6px)', left:0, zIndex:71,
                    minWidth:'190px', background:SURF.raised,
                    border:`1px solid ${C.border2}`, borderRadius:R.md,
                    boxShadow:'0 14px 36px rgba(0,0,0,0.6)', overflow:'hidden',
                  }}>
                    {MORE_TABS.map(t => (
                      <button
                        key={t}
                        onClick={()=>{ setActiveTab(t); setShowMore(false) }}
                        className="row-hover"
                        style={{
                          display:'block', width:'100%', textAlign:'left',
                          background: activeTab===t ? C.accentSoft : 'transparent',
                          border:'none', borderBottom:`1px solid ${C.border}`,
                          padding:'10px 14px',
                          color: activeTab===t ? C.accent : C.text2,
                          fontSize:T.base, fontWeight: activeTab===t ? 700 : 500,
                        }}
                      >{TITLES[t]}</button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main style={{ padding:`${SP[4]} ${SP[5]} ${SP[8]}` }}>
          <div style={{ maxWidth:'var(--content-max)', margin:'0 auto', minWidth:0 }}>
            {shiftOverdue && (
              <div style={{ marginBottom:SP[3] }}>
                <Banner
                  tone="warn" icon="clock"
                  action={<Button size="sm" variant="primary" onClick={handleEndShiftClick}>End shift</Button>}
                >
                  Your shift ended at {fmtHour12(summary?.shiftEnd)} — you clocked in at {startTime} and
                  the shift is still open. End it so your hours are recorded, or use OT if you are staying on.
                </Banner>
              </div>
            )}

            {!isActive && (
              <div style={{ marginBottom:SP[3] }}>
                <Banner
                  tone="warn" icon="clock"
                  action={shiftStatus === 'not_started'
                    ? <Button size="sm" variant="primary" onClick={handleStartShiftClick} loading={startingShift}>Start shift</Button>
                    : null}
                >
                  {shiftStatus === 'ended'
                    ? 'Your shift has ended for today — everything below is read-only.'
                    : 'Your shift hasn’t started yet — you’re viewing today’s assignments in read-only mode.'}
                </Banner>
              </div>
            )}

            {/* ── Board: the hour in front of you ── */}
            {activeTab === 'board' && (
              <>
                {/* The greeting the old top bar opened with. One line, above
                    the work rather than in place of it. */}
                <div style={{
                  display:'flex', alignItems:'baseline', justifyContent:'space-between',
                  gap:SP[3], flexWrap:'wrap', marginBottom:SP[3],
                }}>
                  <div style={{ color:C.text, fontSize:T.lg, fontWeight:800, letterSpacing:'-0.3px' }}>
                    {greeting()}, {user?.name?.split(' ')[0] || 'there'}
                  </div>
                  <div style={{ color:C.muted, fontSize:T.sm }}>
                    {isActive
                      ? liveClients.length === 0
                        ? 'Nothing assigned this hour.'
                        : liveClients.length - liveDone === 0
                          ? 'This hour is fully updated — nice work.'
                          : `${liveClients.length - liveDone} client${liveClients.length - liveDone === 1 ? '' : 's'} still to update this hour.`
                      : 'Start your shift to begin updating.'}
                  </div>
                </div>

                <div style={{ marginBottom:SP[3] }}>
                  <HourRail
                    timeline={timeline}
                    currentHour={currentHour}
                    value={shownHour}
                    onChange={selectHour}
                    liveCounts={{ total: liveClients.length, done: liveDone }}
                  />
                </div>

                <div className="board-split">
                  <div style={{ minWidth:0 }}>
                    <MyClientsTab
                      clients={boardClients}
                      filled={mergedFilled}
                      saveClient={saveClient}
                      currentHour={currentHour}
                      hour={shownHour}
                      hourState={viewEntry?.state || (isNowHour ? 'current' : 'done')}
                      canEdit={isActive}
                      focusRequest={focusRequest}
                      {...(isNowHour ? clientContext : {})}
                    />
                  </div>
                  <TodayRail
                    summary={summary} myDay={myDay} breakStatus={breakStatus} footage={footage}
                    currentHour={currentHour}
                    hourDone={liveDone} hourTotal={liveClients.length}
                    onGoToTab={setActiveTab}
                    onOpenStats={()=>setActiveTab('dashboard')}
                    isActive={isActive}
                    upNext={upNext}
                    recent={recent}
                    onFocusClient={(client) => {
                      // Asking for a client only makes sense against the hour
                      // it belongs to, so the board comes back to the live hour
                      // first if it had been moved.
                      if (!isNowHour) selectHour(currentHour)
                      setFocusRequest({ client, at: Date.now() })
                    }}
                  />
                </div>
              </>
            )}

            {activeTab === 'dashboard' && (
              <EmpDashboardTab
                summary={summary} range={summaryRange} setRange={setSummaryRange}
                loading={summaryLoading} onGoToTab={setActiveTab} breakStatus={breakStatus}
              />
            )}

            {activeTab === 'footage'  && <EmpFootageTab footage={footage} />}
            {activeTab === 'followup' && <EmpFollowupTab followups={footage.followups} />}

            {MORE_TABS.includes(activeTab) && (
              <Card pad={false} style={{ maxWidth:'520px', margin:'40px auto' }}>
                <EmptyState
                  icon={activeTab==='performance'?'analytics':activeTab==='notifications'?'alerts':activeTab==='help'?'sparkles':'settings'}
                  title={`${TITLES[activeTab]} — coming soon`}
                  detail="This module isn't wired up to live data yet."
                  action={activeTab==='performance'
                    ? <Button variant="primary" onClick={()=>setActiveTab('dashboard')}>See my dashboard instead</Button>
                    : null}
                />
              </Card>
            )}

            {/* The sidebar's footer line. Small, but it was there. */}
            <div style={{ color:'#4a4a4a', fontSize:'9.5px', textAlign:'center', marginTop:SP[6], lineHeight:1.6 }}>
              © {new Date().getFullYear()} Cautio Telematics. All rights reserved.
            </div>
          </div>
        </main>
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
