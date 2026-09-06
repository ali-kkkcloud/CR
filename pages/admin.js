import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { fetchJSON, isAuthFailure, retryDelayMs } from '../lib/fetchJson'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Sidebar, { TAB_SECTION } from '../components/Sidebar'
import LogoutModal from '../components/LogoutModal'
import Icon from '../components/Icons'
import { C, Donut, parseSheetDate } from '../components/Widgets'
import { TopBar, PageBody, AccountButton, NotifyButton } from '../components/Shell'
import {
  Card, CardHead, Button, Pill, Tag, Field, Stat, Meter, Segmented, PageHead, Section, PickList,
  EmptyState, Modal, Table, T, R, SP, SURF, fmtRange, istBusinessDateLabel,
} from '../components/ui'
import FullDayTab from '../components/tabs/FullDayTab'
import ProgressTab from '../components/tabs/ProgressTab'
import FootageTab from '../components/tabs/FootageTab'
import BreaksTab, { liveBreakMinutes } from '../components/tabs/BreaksTab'
import FloorPanel from '../components/tabs/FloorPanel'
import StalePanel from '../components/tabs/StalePanel'
import AttendancePanel from '../components/tabs/AttendancePanel'
import HistoryPanel from '../components/tabs/HistoryPanel'
import ErrorBoundary from '../components/ErrorBoundary'
import WorkloadPanel from '../components/tabs/WorkloadPanel'
import ScoresPanel from '../components/tabs/ScoresPanel'
import ReportsPanel from '../components/tabs/ReportsPanel'
import ClientRulesPanel from '../components/tabs/ClientRulesPanel'
import IntegrityPanel from '../components/tabs/IntegrityPanel'

// "7pm", for listing hours compactly inside a sentence.
function fmtHourShort(h) {
  if (h == null) return '—'
  const to12 = h % 12 === 0 ? 12 : h % 12
  return `${to12}${h >= 12 ? 'pm' : 'am'}`
}

// The operating day, not the calendar one: it turns over at 07:00 IST, so at
// three in the morning the day still in progress is the previous date. Every
// date the server writes follows the same rule, and a date picker that
// disagreed with it would ask for a day the sheet has nothing under.
//
// toISOString is deliberately not used — it converts to UTC, which shifts the
// date backwards for any IST time before 05:30 and produced the wrong day for
// exactly the early hours this rule exists for.
function todayISO() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  if (d.getHours() < 7) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const TAB_META = {
  overview:       { title: 'Dashboard',           sub: 'The floor right now, and how much of today is done' },
  fullday:        { title: 'Hour by hour',        sub: 'Every hour of today, for every employee' },
  redistribution: { title: 'Hour by hour',        sub: "Where today's work moved, and why" },
  stale:          { title: 'Hour by hour',        sub: 'Clients no one has filled since 7am — whoever they belonged to' },
  footage:        { title: 'Requests',            sub: 'Footage requests raised by the floor' },
  followups:      { title: 'Requests',            sub: 'Requests handed on at the end of a shift' },
  progress:       { title: 'Team',                sub: 'Attendance and output across a date range' },
  breaks:         { title: 'Team',                sub: 'Who is away, for how long, and how often' },
  leaves:         { title: 'Team',                sub: 'Leave calendar — coming soon' },
  reports:        { title: 'More',                sub: 'The Daily_Summary record, per day, week or month' },
  analytics:      { title: 'More',                sub: 'Deeper trends across your fleet — coming soon' },
  alerts:         { title: 'More',                sub: 'All system and AI alerts in one place — coming soon' },
  settings:       { title: 'More',                sub: 'Workspace and account preferences — coming soon' },
}

// The switch at the top of a section. One row of plain choices beats five more
// items in the sidebar, and it puts the sibling screens where you can see they
// exist at all.
const SECTION_TABS = {
  day: [
    { value:'fullday',        label:'Hour by hour' },
    { value:'redistribution', label:'Work moved' },
    { value:'stale',          label:'Still not updated' },
    { value:'clientrules',    label:'Client rules' },
  ],
  requests: [
    { value:'footage',   label:'Footage' },
    { value:'followups', label:'Follow-ups' },
  ],
  people: [
    { value:'progress', label:'Attendance & output' },
    { value:'breaks',   label:'Breaks' },
    { value:'leaves',   label:'Leaves' },
  ],
  more: [
    { value:'reports',   label:'Reports' },
    { value:'analytics', label:'Analytics' },
    { value:'alerts',    label:'Alerts' },
    { value:'settings',  label:'Settings' },
  ],
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
  // Ticks once a second purely so an open break's minutes climb on screen
  // between server refreshes. A running timer that only moves when the page
  // reloads reads as a broken clock.
  const [liveTick, setLiveTick] = useState(0)
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
  // Set when the page cannot reach the server at all, so it can say so
  // rather than spinning with nothing behind it.
  const [bootError, setBootError] = useState(null)
  const [clock, setClock] = useState('')
  // { title, rows } — roster drill-down opened from an Overview KPI card
  const [rosterModal, setRosterModal] = useState(null)
  const [gapModal, setGapModal] = useState(null)
  // { title, sub, rows:[{primary, secondary, tone}] } — the detail behind an
  // alert that is about data rather than about a screen.
  const [listModal, setListModal] = useState(null)

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

  // Getting in, and staying in.
  //
  // This had no failure path at all: one attempt, no catch, no timeout. If the
  // call did not come back the promise simply never settled, `loading` stayed
  // true, and the Command Center sat on its spinner until somebody reloaded
  // the site by hand. A rejection was worse — an unhandled one, with the page
  // stuck the same way.
  //
  // Only an answer that actually says "not an admin" sends anybody to the
  // login screen. Anything else is the server being unreachable, which is
  // temporary, and is retried.
  useEffect(() => {
    let cancelled = false
    let attempt = 0
    let timer = null

    async function boot() {
      if (cancelled) return
      const me = await fetchJSON('/api/auth/me')
      if (cancelled) return

      if (isAuthFailure(me) || (me.ok && me.data?.user && me.data.user.role !== 'admin')) {
        router.replace('/login'); return
      }
      if (!me.ok || !me.data?.user) {
        setBootError(me.error || 'Could not reach the server')
        timer = setTimeout(boot, retryDelayMs(attempt++))
        return
      }
      setBootError(null)
      setUser(me.data.user)
      loadData()
      setLoading(false)
    }

    boot()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  const loadData = useCallback(async () => {
    // Every loader below keeps the last good state on failure rather than
    // storing an error payload — a 500 body written into state would be
    // read as real data downstream and crash the page on render.
    try {
      const [ovR, ftR] = await Promise.all([
        fetchJSON('/api/admin/overview'),
        fetchJSON('/api/footage/list'),
      ])
      const ov = ovR.data, ft = ftR.data
      if (ov && ov.employees) setOverview(ov)
      if (ft && Array.isArray(ft.pending)) {
        setFootage({ pending: ft.pending, completed: ft.completed || [], followups: ft.followups || [] })
      }
    } catch (e) { console.error('loadData failed:', e) }
  }, [])

  const loadBreaks = useCallback(async (range, from, to) => {
    const qs = range === 'today' ? '' : `?from=${from}&to=${to}`
    try {
      const { data } = await fetchJSON(`/api/admin/breaks${qs}`)
      if (data && data.employees) setBreaks(data)
    } catch (e) { console.error('loadBreaks failed:', e) }
  }, [])

  // One-second heartbeat, only while the break tab is open.
  useEffect(() => {
    if (activeTab !== 'breaks') return
    const id = setInterval(() => setLiveTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [activeTab])

  useEffect(() => {
    if (breakRange === 'today') loadBreaks('today')
    else if (breakRange === 'all') loadBreaks('all', '2000-01-01', todayISO())
    else loadBreaks('custom', breakFrom, breakTo)
  }, [breakRange, breakFrom, breakTo])

  const loadProgress = useCallback(async (from, to) => {
    try {
      const { data } = await fetchJSON(`/api/admin/employee-progress?from=${from}&to=${to}`)
      if (data && data.progress) setProgress(data)
    } catch (e) { console.error('loadProgress failed:', e) }
  }, [])

  // Which date's data is on screen, so a slow response for a date the admin has
  // already moved off cannot land on top of a newer one.
  const fullDayReqRef = useRef('')

  const loadFullDay = useCallback(async (dateISO, { silent = false } = {}) => {
    // A background refresh keeps what is on screen.
    //
    // This used to clear the whole day and raise the loading flag every time —
    // including on its own 45-second poll — so the Full Day View wiped itself
    // to a spinner and rebuilt, twice a minute, while the admin was reading it.
    // Any drawer open at that moment lost its numbers with it. Only the first
    // load of a date announces itself now.
    if (!silent) {
      setFullDayLoading(true)
      setFullDayData(null)
    }
    fullDayReqRef.current = dateISO
    const ddmmyyyy = dateISO.split('-').reverse().join('/')
    try {
      const { data } = await fetchJSON(`/api/admin/full-day-view?date=${ddmmyyyy}`, { timeoutMs: 30000 })
      if (fullDayReqRef.current !== dateISO) return   // the admin moved on
      if (data && Array.isArray(data.employees)) setFullDayData(data)
      else if (!silent) setFullDayData({ employees: [] })
    } catch (e) {
      console.error('loadFullDay failed:', e)
      if (!silent) setFullDayData({ employees: [] })
    } finally {
      if (fullDayReqRef.current === dateISO) setFullDayLoading(false)
    }
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

  // Refresh whatever the admin is actually looking at, not only the overview.
  // Every other tab used to sit frozen on whatever it loaded first — the break
  // list in particular, which shows people currently on a break and so has to
  // keep up or it reads as a stuck clock.
  useEffect(() => {
    const REFRESH_MS = { overview: 30000, breaks: 20000, fullday: 45000, progress: 60000, footage: 45000 }
    const every = REFRESH_MS[activeTab]
    if (!every) return
    const id = setInterval(() => {
      if (activeTab === 'overview') loadData()
      else if (activeTab === 'breaks') {
        if (breakRange === 'today') loadBreaks('today')
        else if (breakRange === 'all') loadBreaks('all', '2000-01-01', todayISO())
        else loadBreaks('custom', breakFrom, breakTo)
      }
      else if (activeTab === 'fullday') loadFullDay(fullDayDate, { silent: true })
      else if (activeTab === 'progress') loadProgress(fromDate, toDate)
      else if (activeTab === 'footage') loadData()
    }, every)
    return () => clearInterval(id)
  }, [activeTab, fullDayDate, fromDate, toDate, breakRange, breakFrom, breakTo])

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

  // A spinner is right while it is still trying, and wrong once it is not —
  // one that never resolves is indistinguishable from a dead site, and the
  // only thing left to try is reloading by hand. Both cases keep retrying in
  // the background; this just says so.
  if (loading || !overview) return (
    <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',background:C.bg,gap:'18px',padding:'24px',textAlign:'center'}}>
      <div className="spinner"></div>
      {(bootError || !loading) && (
        <>
          <div style={{ color:C.text2, fontSize:'13px', maxWidth:'360px', lineHeight:1.7 }}>
            {bootError
              ? `Could not reach the server (${bootError}). Still trying — you do not need to do anything.`
              : 'Waiting for the floor to load. Still trying — you do not need to do anything.'}
          </div>
          <button
            onClick={() => typeof window !== 'undefined' && window.location.reload()}
            style={{
              background:C.accentDark, color:C.accent, border:'none', borderRadius:'8px',
              padding:'9px 16px', fontSize:'12.5px', fontWeight:700, cursor:'pointer',
            }}
          >Try now</button>
        </>
      )}
    </div>
  )

  const { employees, kpis, redistribution } = overview
  const rosterIssues = overview?.rosterIssues || []
  const clientIssues = overview?.clientIssues || []

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

  // Straight from the shared day plan, so the header, the hour strip and the
  // per-employee table below it all say the same thing. Summing per-employee
  // counters gave a third answer again.
  const workload = overview?.workload || null
  const totalUpdatesToday = workload ? workload.fullDay.clientsDone
    : employees.reduce((s,e)=>s+(e.totalUpdates||0),0)
  const totalPendingToday = workload ? Math.max(0, workload.fullDay.clients - workload.fullDay.clientsDone)
    : employees.reduce((s,e)=>s+(e.pendingCount||0),0)
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
  // Clocked in with the window already over. Nothing closes a shift by itself,
  // so these rows sit open with no end time and no duration until somebody
  // acts — and the platform keeps counting them as on the floor.
  const overdueEmployees    = employees.filter(e => e.shiftOverdue)
  // Rows still marked Active from long enough ago that nobody is coming back.
  const staleShiftEmployees = employees.filter(e => e.shiftStale)
  // Hours where clients are due and the roster has nobody at all.
  const coverageGaps = overview?.coverageGaps || []
  const gapClients   = coverageGaps.reduce((s,g) => s + (g.clients||0), 0)
  // An hour that has already gone with nobody on it is work that was missed.
  // One still ahead is a roster gap worth fixing, not an emergency — saying
  // both in the same red made the screen shout at seven in the morning about a
  // day that had not happened yet.
  const gapsAreLive  = coverageGaps.some(g => g.past)
  // Away long enough that the split has stopped giving them work.
  const longBreakEmployees  = (breaks?.employees || [])
    .filter(e => e.currentlyOnBreak && liveBreakMinutes(e, breaks?.asOf) >= 20)

  const statusCounts = employees.reduce((acc,e)=>{ acc[e.statusLabel]=(acc[e.statusLabel]||0)+1; return acc }, {})
  const statusDonutSegs = [
    { label:'Active',      value:statusCounts['Active']||0,      color:C.accent },
    { label:'Ended',       value:statusCounts['Ended']||0,       color:C.blue },
    { label:'Left open',   value:statusCounts['Left Open']||0,   color:C.amber },
    { label:'Week Off',    value:statusCounts['Week Off']||0,    color:C.amber },
    { label:'Not Started', value:statusCounts['Not Started']||0, color:C.red },
    { label:'Off Shift',   value:statusCounts['Off Shift']||0,   color:C.dim },
  ].filter(s=>s.value>0)

  const topPerformers = [...employees].sort((a,b)=>(b.totalUpdates||0)-(a.totalUpdates||0)).slice(0,5)
  const maxUpdates = Math.max(1, ...topPerformers.map(e=>e.totalUpdates||0))

  // Each one carries the tab it is about, so the row itself is the way in
  // rather than a separate "View details" button at the bottom of the card
  // that only ever pointed at one of them.
  // Every row is a way in. Each one carries the thing it is about — a tab to
  // open, a roster to list, or the items themselves — so nothing on this card
  // is a dead end. Two of them used to be: the client and roster warnings had
  // no target at all and simply did nothing when clicked, and "Clients nobody
  // can be given" pointed at a tab named 'unassigned' that does not exist,
  // which blanked the screen.
  const aiAlerts = []
  if (coverageGaps.length>0) aiAlerts.push({
    sev:'high', icon:'alerts', title:'Clients nobody can be given',
    desc:`${gapClients} client slot${gapClients===1?'':'s'} across ${coverageGaps.length} hour${coverageGaps.length===1?'':'s'} (${coverageGaps.map(g=>fmtHourShort(g.hour)).join(', ')}) — no one is rostered, so they are on nobody's board`,
    act:()=>setGapModal(coverageGaps),
  })
  if (kpis.notStarted>0) aiAlerts.push({
    sev:'high', icon:'offline', title:'Not started',
    desc:`${kpis.notStarted} employee${kpis.notStarted===1?' has':'s have'} not clocked in yet`,
    act:()=>setRosterModal({ title:'Not started', empty:'Everyone scheduled has clocked in.', rows:notStartedEmployees }),
  })
  // Somebody who can log in but is on no roster gets no clients and shows on
  // no screen. Nothing else would ever mention them.
  // A client with no hours in the sheet is never scheduled, never assigned and
  // never counted as missed — invisible unless something says so.
  if (clientIssues.length>0) aiAlerts.push({
    sev:'high', icon:'alerts', title:'Clients the sheet cannot deliver',
    desc:`${clientIssues.length} client${clientIssues.length===1?'':'s'} are missing hours or a vehicle list: ${clientIssues.slice(0,3).map(c=>c.client).join(', ')}${clientIssues.length>3?` and ${clientIssues.length-3} more`:''}`,
    act:()=>setListModal({
      title:'Clients the sheet cannot deliver',
      sub:'Each of these needs a change in the spreadsheet — the platform cannot guess it',
      rows: clientIssues.map(c => ({ primary:c.client, secondary:c.reason, tone:C.red })),
    }),
  })
  if (rosterIssues.length>0) aiAlerts.push({
    sev:'high', icon:'users', title:'Invisible to the roster',
    desc:`${rosterIssues.map(r=>r.name).join(', ')} can sign in, but get no clients and appear in no total`,
    act:()=>setListModal({
      title:'Invisible to the roster',
      sub:'They can sign in, but the roster skips their Credentials row, so they are given no clients and counted in no total',
      rows: rosterIssues.map(r => ({ primary:`${r.name}${r.empId?` · ${r.empId}`:''}`, secondary:r.reason, tone:C.red })),
    }),
  })
  if (staleShiftEmployees.length>0) aiAlerts.push({
    sev:'warn', icon:'clock', title:'Shift rows left open',
    desc:`${staleShiftEmployees.map(e=>e.name).join(', ')} — clocked in and never clocked out, so the attendance row has no end time`,
    act:()=>setRosterModal({ title:'Shift rows left open', empty:'No open rows.', rows:staleShiftEmployees }),
  })
  if (overdueEmployees.length>0) aiAlerts.push({
    sev:'high', icon:'clock', title:'Shift not closed',
    desc:`${overdueEmployees.map(e=>e.name).join(', ')} ${overdueEmployees.length===1?'is':'are'} past the end of the shift and still clocked in`,
    act:()=>setRosterModal({ title:'Past the end of their shift', empty:'Nobody is overdue.', rows:overdueEmployees }),
  })
  if (longBreakEmployees.length>0) aiAlerts.push({ sev:'high', icon:'clock', title:'Away a long time', desc:`${longBreakEmployees.map(e=>{const m=liveBreakMinutes(e, breaks?.asOf);return `${e.name} (${Math.floor(m/60)>0?`${Math.floor(m/60)}h `:''}${m%60}m)`}).join(', ')} — their clients are still on their board, waiting`, tab:'breaks' })
  if (breaks?.onBreakNow>0) aiAlerts.push({ sev:'warn', icon:'clock', title:'On break', desc:`${breaks.onBreakNow} employee${breaks.onBreakNow===1?' is':'s are'} away right now`, tab:'breaks' })
  if (footage.followups.length>0) aiAlerts.push({ sev:'warn', icon:'followups', title:'Follow-ups open', desc:`${footage.followups.length} follow-up${footage.followups.length===1?'':'s'} waiting to be closed`, tab:'followups' })
  if (footage.pending.length>0) aiAlerts.push({ sev:'info', icon:'footage', title:'Footage queue', desc:`${footage.pending.length} request${footage.pending.length===1?'':'s'} still open`, tab:'footage' })
  if (totalPendingToday>0) aiAlerts.push({ sev:'info', icon:'clock', title:'Updates outstanding', desc:`${totalPendingToday} client slot${totalPendingToday===1?'':'s'} not yet updated today`, tab:'fullday' })
  if (redistribution.length>0) aiAlerts.push({ sev:'success', icon:'shuffle', title:'Work moved', desc:`${redistribution.length} slot${redistribution.length===1?'':'s'} redistributed today`, tab:'redistribution' })

  // The headline. Severity is whatever is worst on the floor: somebody who
  // should be here and isn't outranks a queue that is merely long.
  const headline = (() => {
    const bits = []
    if (gapClients > 0) bits.push(`${gapClients} slots in unstaffed hours`)
    if (kpis.notStarted > 0) bits.push(`${kpis.notStarted} not clocked in`)
    if (overdueEmployees.length > 0) bits.push(`${overdueEmployees.length} shift${overdueEmployees.length===1?'':'s'} not closed`)
    if (breaks?.onBreakNow > 0) bits.push(`${breaks.onBreakNow} on break`)
    if (totalPendingToday > 0) bits.push(`${totalPendingToday} updates outstanding`)
    if (footage.pending.length > 0) bits.push(`${footage.pending.length} footage requests open`)

    if (kpis.notStarted > 0) return {
      tone:'error', color:C.red, icon:'offline',
      title: `${kpis.notStarted} employee${kpis.notStarted === 1 ? '' : 's'} should be on shift and ${kpis.notStarted === 1 ? 'is' : 'are'}n't`,
      detail: bits.slice(1).join(' · ') || 'Everything else is running normally.',
    }
    if (overdueEmployees.length > 0) return {
      tone:'warn', color:C.amber, icon:'clock',
      title: `${overdueEmployees.length} shift${overdueEmployees.length === 1 ? '' : 's'} still open past the end of the window`,
      detail: bits.filter(b => !b.includes('not closed')).join(' · ') || 'Everything else is running normally.',
    }
    if (totalPendingToday > 0 || footage.pending.length > 0) return {
      tone:'warn', color:C.amber, icon:'clock',
      title: `${activeNowCnt} of ${onDutyNow.length} clocked in this hour`,
      detail: bits.join(' · '),
    }
    return {
      tone:'good', color:C.accent, icon:'check-circle',
      title: 'The floor is clear',
      detail: bits.length ? bits.join(' · ') : `${activeNowCnt} of ${onDutyNow.length} clocked in · nothing outstanding`,
    }
  })()

  const tabMeta = TAB_META[activeTab] || TAB_META.overview
  const notifCount = footage.pending.length + footage.followups.length

  return (
    <>
      <Head><title>Cautio CRM — Admin</title></Head>
      <div style={{minHeight:'100vh', background:C.bg, display:'flex'}}>

        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          counts={{
            requests: footage.pending.length + footage.followups.length,
            people:   breaks?.onBreakNow || 0,
            live:     aiAlerts.filter(a => a.sev === 'high').length,
          }}
          employeesMonitored={kpis.total}
        />

        <div style={{flex:1, minWidth:0}}>

          <TopBar
            title={tabMeta.title}
            sub={tabMeta.sub}
            right={
              <>
                <Pill icon="calendar">{istBusinessDateLabel()}</Pill>
                <Pill icon="clock">{clock} <span style={{ color:C.dim }}>IST</span></Pill>
                <NotifyButton count={notifCount} onClick={()=>setActiveTab('footage')} />
                <AccountButton name={user?.name || 'Admin'} sub="Super Admin" onClick={()=>setShowLogout(true)} />
              </>
            }
          />

          <PageBody>

          {/* The section's own screens, as one row of choices. Sections with a
              single screen show nothing here. */}
          {(SECTION_TABS[TAB_SECTION[activeTab]] || []).length > 1 && (
            <div style={{ marginBottom:SP[4] }}>
              <Segmented
                value={activeTab}
                onChange={setActiveTab}
                options={(SECTION_TABS[TAB_SECTION[activeTab]] || []).map(t => ({
                  ...t,
                  count: t.value === 'footage'   ? footage.pending.length
                       : t.value === 'followups' ? footage.followups.length
                       : t.value === 'breaks'    ? (breaks?.onBreakNow || 0)
                       : t.value === 'redistribution' ? redistribution.length
                       : undefined,
                }))}
              />
            </div>
          )}

          {/* ══════════ OVERVIEW ══════════ */}
          {activeTab === 'overview' && (
            <>
              {/* ── One sentence, then the numbers that change what you do ──
                  This screen used to open with two stacked alert banners, a
                  six-number grid, and a queue that repeated both of them in
                  words — the same handful of facts said three times before any
                  of the floor was visible. It is one line now, with the figures
                  beside it, and the floor itself starts at the top of the
                  screen instead of below the fold. */}
              <PageHead
                title={headline.title}
                sub={headline.detail}
                facts={[
                  // "clocked in", not "on duty" — it counts everyone with a
                  // live shift row, including the people away on a break, and
                  // the floor list right beside it separates the two. Calling
                  // it "on duty" put seven next to a list that said one person
                  // was at a desk.
                  { label:'clocked in',  value:`${activeNowCnt}/${onDutyNow.length}`, tone: commandHealthPct < 80 ? 'warn' : 'good',
                    onClick:()=>setRosterModal({ title:'Clocked in now', empty:'Nobody is clocked in right now.', rows:activeEmployees }) },
                  { label:'done',     value:totalUpdatesToday, tone:'good' },
                  { label:'pending',  value:totalPendingToday, tone: totalPendingToday ? 'warn' : undefined },
                  kpis.notStarted > 0 && { label:'not in', value:kpis.notStarted, tone:'bad',
                    onClick:()=>setRosterModal({ title:'Not started', empty:'Everyone scheduled has clocked in.', rows:notStartedEmployees }) },
                  breaks?.onBreakNow > 0 && { label:'on break', value:breaks.onBreakNow, tone:'warn', onClick:()=>setActiveTab('breaks') },
                  { label:'footage open', value:footage.pending.length, tone: footage.pending.length ? 'warn' : undefined,
                    onClick:()=>setActiveTab('footage') },
                  redistribution.length > 0 && { label:'moved', value:redistribution.length, onClick:()=>setActiveTab('redistribution') },
                ]}
                actions={
                  <>
                    <Button size="sm" variant="ghost" icon="download" onClick={downloadDailyReport}>Daily report</Button>
                    <Button size="sm" variant="primary" iconRight="arrow-right" onClick={()=>setActiveTab('fullday')}>Full day</Button>
                  </>
                }
              />

              {/* ── How the floor is scoring today ──
                  The score lived only on each employee's own screen, so the
                  one person whose job is to compare them could not see it.
                  Same function behind both, so the numbers agree. */}
              {/* ── Browsers whose story the sheet does not back up ──
                  Reported, never acted on: see the panel's own note. */}
              <IntegrityPanel flags={overview?.integrityFlags || []} watchlist={overview?.watchlist} />

              <ScoresPanel scores={overview?.scores || []} today={overview?.operatingDate || ''} />

              {/* ── Who turned up, when, and how long they were away ──
                  Top of the screen, before anything analytical: the register
                  a supervisor reads first. Clock-in, clock-out and total break
                  used to live on three different screens. */}
              <AttendancePanel
                employees={employees}
                onPick={()=>setActiveTab('breaks')}
              />

              {/* ── Clients nobody can be given ──
                  Kept, because work reaching no board is the one failure
                  nothing else would report. Made small: it used to be a block
                  of twenty-three red chips that filled the fold and shouted the
                  same alarm whether one hour or the whole day was affected. */}
              {coverageGaps.length > 0 && (
                <div style={{
                  display:'flex', alignItems:'center', gap:SP[3], flexWrap:'wrap',
                  background: gapsAreLive ? '#FF4D4D0d' : '#FFC1070d',
                  border:`1px solid ${(gapsAreLive ? C.red : C.amber)}33`,
                  borderRadius:R.md, padding:'11px 15px', marginBottom:SP[4],
                }}>
                  <Icon name="alerts" size={15} color={gapsAreLive ? C.red : C.amber} />
                  <span style={{ color: gapsAreLive ? C.red : C.amber, fontSize:T.base, fontWeight:700 }}>
                    {gapClients} client slot{gapClients===1?'':'s'} on nobody's board
                  </span>
                  <span className="ellip" style={{ color:C.muted, fontSize:T.sm, flex:1, minWidth:'160px' }}>
                    {gapsAreLive
                      ? `${coverageGaps.filter(g=>g.past).length} hour${coverageGaps.filter(g=>g.past).length===1?'':'s'} already gone · no shift covered them`
                      : `${coverageGaps.length} hour${coverageGaps.length===1?'':'s'} later today have no shift covering them`}
                  </span>
                  <Button size="sm" variant={gapsAreLive ? 'danger' : 'subtle'} onClick={()=>setGapModal(coverageGaps)}>See which</Button>
                </div>
              )}

              {/* ── What needs doing, and who is on the floor ── */}
              <div className="floor-split" style={{ marginBottom:SP[5] }}>
                <Card pad={false} style={{ display:'flex', flexDirection:'column' }}>
                  <div style={{ padding:`${SP[4]} ${SP[4]} ${SP[2]}` }}>
                    <span className="eyebrow">Needs you</span>
                  </div>
                  {aiAlerts.length === 0 ? (
                    <EmptyState icon="check-circle" tone="good" title="All clear." detail="Nothing on the floor needs you right now." />
                  ) : (
                    <div style={{ padding:'6px 6px 10px' }}>
                      {aiAlerts.map((a,i) => <AlertRow key={i} alert={a} onClick={()=>{ if (a.act) a.act(); else if (a.tab) setActiveTab(a.tab) }} />)}
                    </div>
                  )}
                </Card>

                <FloorPanel
                  employees={employees}
                  breaks={breaks}
                  workload={overview?.workload}
                  onPick={()=>setActiveTab('fullday')}
                />
              </div>

              {/* ── The months worked before the platform existed ──
                  Beneath today's figures, clearly separated: those are monthly
                  totals from the old spreadsheets and are not part of today. */}
              <HistoryPanel history={overview?.history} />

              {/* ── What the day holds, and how much of it is done ──
                  Everything below is measured against the schedule itself:
                  clients due so far vs filled, vehicles due vs actually
                  watched, alerts entered, and the same reading again for the
                  whole 7am–7am day. Then the same question per person. */}
              <WorkloadPanel
                workload={overview?.workload}
                onPickEmployee={()=>setActiveTab('fullday')}
              />

              {/* Output */}
              {/* ── The two queues ──
                  This row used to carry four cards, and two of them repeated
                  the screen they were already on: "Completion" restated the
                  clients-done figure that Today-so-far measures properly, and
                  "Top performers" restated the per-employee table, which sorts
                  by Most done. Neither is gone — they are the same numbers,
                  read once instead of three times. What is left is the two
                  things that are genuinely queues: work waiting on somebody,
                  and work that changed hands. */}
              <Section title="Queues" sub="Requests waiting, and work that moved between people today">
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:SP[3], alignItems:'start' }}>
                <Card>
                  <CardHead
                    title="Footage queue" icon="camera"
                    right={footage.pending.length > 0 ? <Tag color={C.amber}>{footage.pending.length} OPEN</Tag> : <Tag color={C.accent}>CLEAR</Tag>}
                  />
                  {recentPendingFootage.length === 0 ? (
                    <div style={{ color:C.muted, fontSize:T.base, padding:'14px 0' }}>No pending requests.</div>
                  ) : (
                    <>
                      {recentPendingFootage.slice(0,4).map(item => (
                        <div key={item.issueId} style={{ display:'flex', alignItems:'center', gap:SP[2], marginBottom:'9px' }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div className="ellip" style={{ color:C.text, fontSize:T.base, fontWeight:600 }}>{item.vehicle}</div>
                            <div className="ellip" style={{ color:C.muted, fontSize:T.xs }}>{item.client}</div>
                          </div>
                          <Tag color={C.amber}>PENDING</Tag>
                        </div>
                      ))}
                      <Button size="sm" variant="subtle" full onClick={()=>setActiveTab('footage')}>View all →</Button>
                    </>
                  )}
                </Card>

                <Card>
                  <CardHead title="Redistribution" icon="shuffle" />
                  {redistribution.length === 0 ? (
                    <div style={{ color:C.muted, fontSize:T.base, padding:'14px 0' }}>No redistribution today.</div>
                  ) : (
                    <>
                      {redistribution.slice(0,4).map((r,i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:'7px', fontSize:T.base, marginBottom:'9px' }}>
                          <span className="ellip" style={{ color:C.red, maxWidth:'80px' }}>{r.from}</span>
                          <Icon name="arrow-right" size={12} color={C.dim} />
                          <span className="ellip" style={{ color:C.accent, maxWidth:'80px' }}>{r.to}</span>
                          <span style={{ color:C.muted, marginLeft:'auto', fontSize:T.xs }}>{r.hour}:00</span>
                        </div>
                      ))}
                      <Button size="sm" variant="subtle" full onClick={()=>setActiveTab('redistribution')}>View all →</Button>
                    </>
                  )}
                </Card>
              </div>
              </Section>

              {/* Activity */}
              <Card>
                <CardHead title="Live activity" icon="clock" right={<Tag color={C.accent} dot>LIVE</Tag>} />
                {activityFeed.length === 0 ? (
                  <div style={{ color:C.muted, fontSize:T.base, padding:'10px 0' }}>No activity recorded yet today.</div>
                ) : (
                  <div style={{ display:'flex', gap:SP[4], overflowX:'auto', paddingBottom:'6px' }}>
                    {activityFeed.map((a,i) => (
                      <div key={i} style={{ display:'flex', gap:'9px', minWidth:'196px', flexShrink:0 }}>
                        <div style={{ width:'28px', height:'28px', borderRadius:R.md, background:a.color+'1a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                          <Icon name={a.icon} size={13} color={a.color} />
                        </div>
                        <div style={{ minWidth:0 }}>
                          <div className="ellip" style={{ color:C.text, fontSize:T.base, fontWeight:600 }}>{a.name}</div>
                          <div style={{ color:C.muted, fontSize:T.xs, lineHeight:1.5 }}>{a.action}</div>
                          {a.time && <div style={{ color:C.dim, fontSize:'9.5px', marginTop:'2px' }}>{a.time}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}

          {/* ══════════ BREAKS ══════════ */}
          {activeTab === 'breaks' && (
            <ErrorBoundary label={'Breaks'}>
            <BreaksTab
              breaks={breaks} liveTick={liveTick}
              range={breakRange} setRange={setBreakRange}
              from={breakFrom} to={breakTo} setFrom={setBreakFrom} setTo={setBreakTo}
            />
                      </ErrorBoundary>
)}

          {/* ══════════ FULL DAY VIEW ══════════ */}
          {activeTab === 'fullday' && (
            <ErrorBoundary label={'Hour by hour'}>
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
                      </ErrorBoundary>
)}

          {/* ══════════ EMPLOYEE PROGRESS ══════════ */}
          {activeTab === 'progress' && (
            <ErrorBoundary label={'Team'}>
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
                      </ErrorBoundary>
)}

          {/* ══════════ FOOTAGE ══════════ */}
          {activeTab === 'footage' && (
            <ErrorBoundary label={'Requests'}>
            <FootageTab
              footageAll={footage}
              downloadCSV={downloadCSV}
              onCloseFollowup={(item)=>{ setCloseFollowupModal(item); setCloseReason('') }}
              todayISO={todayISO}
            />
                      </ErrorBoundary>
)}

          {/* ══════════ FOLLOW-UPS ══════════ */}
          {activeTab === 'followups' && (
            <div style={{ maxWidth:'940px', margin:'0 auto' }}>
              {footage.followups.length === 0 ? (
                <Card pad={false}>
                  <EmptyState icon="followups" tone="good" title="No open follow-ups." detail="A follow-up appears here when an employee hands a footage request to a colleague at the end of their shift." />
                </Card>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:SP[2] }}>
                  {footage.followups.map(item => (
                    <Card key={item.issueId} style={{ borderColor:C.amber+'33' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', gap:SP[4], flexWrap:'wrap' }}>
                        <div style={{ flex:1, minWidth:'220px' }}>
                          <div style={{ display:'flex', alignItems:'center', gap:SP[2], flexWrap:'wrap', marginBottom:'7px' }}>
                            <span style={{ color:C.text, fontSize:T.md, fontWeight:700 }}>{item.client}</span>
                            <span style={{ color:C.accent, fontSize:T.md, fontWeight:700 }}>{item.vehicle}</span>
                            <Tag color={C.amber}>FOLLOW-UP</Tag>
                          </div>
                          <div style={{ display:'flex', gap:SP[4], flexWrap:'wrap', color:C.muted, fontSize:T.sm }}>
                            <span>ID <span style={{ color:C.text2 }}>{item.issueId}</span></span>
                            <span>From <span style={{ color:C.text2 }}>{item.originalEmployee}</span></span>
                            <span>To <span style={{ color:C.text, fontWeight:600 }}>{item.forwardedTo}</span></span>
                            <span>At <span style={{ color:C.text2 }}>{item.forwardedAt}</span></span>
                          </div>
                          {item.details && (
                            <div style={{ color:C.text2, fontSize:T.sm, marginTop:'7px', fontStyle:'italic' }}>{item.details}</div>
                          )}
                        </div>
                        <Button
                          variant="danger" size="sm"
                          onClick={()=>{ setCloseFollowupModal(item); setCloseReason('') }}
                        >Close follow-up</Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════ REDISTRIBUTION ══════════ */}
          {activeTab === 'redistribution' && (
            <div style={{ maxWidth:'940px', margin:'0 auto' }}>
              <Card pad={false} style={{ overflow:'hidden' }}>
                <Table
                  cols={[
                    { key:'from',   label:'From',   render:r => <span style={{ color:C.red, fontWeight:600 }}>{r.from}</span> },
                    { key:'to',     label:'To',     render:r => <span style={{ color:C.accent, fontWeight:600 }}>{r.to}</span> },
                    { key:'client', label:'Client', render:r => <span style={{ color:C.text }}>{r.client}</span> },
                    { key:'hour',   label:'Hour',   width:'90px', render:r => `${r.hour}:00` },
                    { key:'reason', label:'Reason', width:'120px', render:() => <span style={{ color:C.muted }}>Early end</span> },
                  ]}
                  rows={redistribution}
                  rowKey={(r,i)=>i}
                  empty={<EmptyState icon="shuffle" title="No redistributions today." detail="Work moves between people when somebody ends their shift with clients unfinished, or an admin marks leave." />}
                />
              </Card>
            </div>
          )}

          {activeTab === 'stale' && (
            <div style={{ maxWidth:'940px', margin:'0 auto' }}>
              <StalePanel clients={overview?.staleClients || []} />
            </div>
          )}

          {/* ══════════ REPORTS ══════════ */}
          {activeTab === 'reports' && <ReportsPanel />}

          {/* ══════════ CLIENT RULES ══════════ */}
          {activeTab === 'clientrules' && <ClientRulesPanel />}

          {/* ══════════ NOT YET LIVE ══════════ */}
          {['leaves','analytics','alerts','settings'].includes(activeTab) && (
            <Card pad={false} style={{ maxWidth:'560px', margin:'40px auto' }}>
              <EmptyState
                icon={activeTab}
                title={`${tabMeta.title} — coming soon`}
                detail="This module isn't wired up to live data yet."
              />
            </Card>
          )}

          </PageBody>
        </div>
      </div>

      {/* ══════════ MARK LEAVE ══════════ */}
      <Modal
        open={!!markLeaveModal}
        onClose={()=>setMarkLeaveModal(null)}
        icon="leaves" iconColor={C.amber}
        title={markLeaveModal ? `Mark leave — ${markLeaveModal.name}` : ''}
        sub="Their clients for these hours move to whoever else is on shift, straight away."
        footer={
          <>
            <Button variant="ghost" full onClick={()=>setMarkLeaveModal(null)}>Cancel</Button>
            <Button variant="primary" full loading={markingLeave} onClick={handleMarkLeave}>Mark leave</Button>
          </>
        }
      >
        <div style={{ display:'flex', gap:SP[3], marginBottom:SP[4] }}>
          <Field label="From hour" style={{ flex:1 }}>
            <select value={leaveFromHour} onChange={e=>setLeaveFromHour(parseInt(e.target.value))}>
              {hours.map(h=><option key={h} value={h}>{h}:00</option>)}
            </select>
          </Field>
          <Field label="To hour" style={{ flex:1 }}>
            <select value={leaveToHour} onChange={e=>setLeaveToHour(parseInt(e.target.value))}>
              {hours.map(h=><option key={h} value={h}>{h}:00</option>)}
            </select>
          </Field>
        </div>
        <Field label="Reason" hint="Optional — shown in the Leaves tab.">
          <input placeholder="e.g. Medical, personal" value={leaveReason} onChange={e=>setLeaveReason(e.target.value)} />
        </Field>
      </Modal>

      {/* ══════════ CLOSE FOLLOW-UP ══════════ */}
      <Modal
        open={!!closeFollowupModal}
        onClose={()=>setCloseFollowupModal(null)}
        icon="followups" iconColor={C.red}
        title="Close follow-up"
        sub={closeFollowupModal
          ? `${closeFollowupModal.issueId} · ${closeFollowupModal.client} · ${closeFollowupModal.vehicle}`
          : ''}
        footer={
          <>
            <Button variant="ghost" full onClick={()=>setCloseFollowupModal(null)}>Cancel</Button>
            <Button variant="danger" full loading={closingFollowup} onClick={handleCloseFollowup}>Close follow-up</Button>
          </>
        }
      >
        <Field label="Reason for closing">
          <input placeholder="e.g. Footage not available, already resolved" value={closeReason} onChange={e=>setCloseReason(e.target.value)} />
        </Field>
      </Modal>

      {/* ══════════ UNASSIGNED CLIENTS ══════════ */}
      <Modal
        open={!!gapModal}
        onClose={()=>setGapModal(null)}
        width={520}
        icon="alerts" iconColor={C.red}
        title="Clients nobody can be given"
        sub="These hours have clients scheduled and no employee rostered to take them, so the work reaches no board at all."
        footer={<Button variant="ghost" full onClick={()=>setGapModal(null)}>Close</Button>}
      >
        {gapModal && (
          <div style={{ maxHeight:'54vh', overflowY:'auto' }}>
            {gapModal.map(g => (
              <div key={g.hour} style={{ padding:'11px 0', borderBottom:`1px solid ${C.border}` }}>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:SP[2] }}>
                  <span style={{ color:C.text, fontSize:T.md, fontWeight:700 }}>{fmtHourShort(g.hour)}</span>
                  <span style={{ color:C.red, fontSize:T.base, fontWeight:700 }}>
                    {g.clients} of {g.due} unassigned
                  </span>
                </div>
                <div style={{ color:C.muted, fontSize:T.sm, marginTop:'4px', lineHeight:1.6 }}>
                  {g.reason === 'no-staff'
                    ? 'Nobody is rostered for this hour, or everybody who is has been marked on leave.'
                    : 'Everybody available this hour is set to another duty in Employee_Hours.'}
                </div>
                {g.sample?.length > 0 && (
                  <div style={{ color:C.text2, fontSize:T.xs, marginTop:'6px', lineHeight:1.7 }}>
                    {g.sample.join(' · ')}{g.clients > g.sample.length ? ` … +${g.clients - g.sample.length} more` : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ══════════ ROSTER DRILL-DOWN ══════════ */}
      <Modal
        open={!!rosterModal}
        onClose={()=>setRosterModal(null)}
        width={460}
        title={rosterModal?.title}
        sub={rosterModal ? `${rosterModal.rows.length} employee${rosterModal.rows.length===1?'':'s'} · timings in IST` : ''}
        footer={<Button variant="ghost" full onClick={()=>setRosterModal(null)}>Close</Button>}
      >
        {rosterModal && (rosterModal.rows.length === 0 ? (
          <div style={{ color:C.muted, fontSize:T.base, padding:'18px 0', textAlign:'center' }}>{rosterModal.empty}</div>
        ) : (
          <div style={{ maxHeight:'52vh', overflowY:'auto' }}>
            {rosterModal.rows.map(e => (
              <div key={e.name} style={{ display:'flex', alignItems:'center', gap:'11px', padding:'11px 0', borderBottom:`1px solid ${C.border}` }}>
                <div style={{
                  width:'32px', height:'32px', borderRadius:'50%', background:C.accentDark, color:C.accent,
                  fontSize:'11px', fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
                }}>{e.name.slice(0,2).toUpperCase()}</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div className="ellip" style={{ color:C.text, fontSize:T.base, fontWeight:700 }}>{e.name}</div>
                  <div className="ellip" style={{ color:C.muted, fontSize:T.xs, marginTop:'2px' }}>
                    {shiftLabel(e)}
                    {e.isAdjusted && <span style={{ color:C.amber }}> · adjusted today</span>}
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  {e.startTime
                    ? <div style={{ color:C.accent, fontSize:T.xs, fontWeight:700 }}>In {e.startTime}</div>
                    : <div style={{ color:C.red, fontSize:T.xs, fontWeight:700 }}>Not clocked in</div>}
                  {e.endTime && <div style={{ color:C.muted, fontSize:'9.5px', marginTop:'2px' }}>Out {e.endTime}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </Modal>

      <Modal
        open={!!listModal}
        onClose={()=>setListModal(null)}
        icon="alerts" iconColor={C.red}
        title={listModal?.title}
        sub={listModal?.sub}
        width={560}
      >
        {listModal && (
          <div style={{ maxHeight:'56vh', overflowY:'auto' }}>
            {listModal.rows.map((r,i) => (
              <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:'10px', padding:'10px 0', borderBottom:`1px solid ${C.border}` }}>
                <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:r.tone||C.muted, marginTop:'6px', flexShrink:0 }} />
                <span style={{ minWidth:0, flex:1 }}>
                  <span className="ellip" style={{ display:'block', color:C.text, fontSize:T.base, fontWeight:700 }}>{r.primary}</span>
                  <span style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'2px' }}>{r.secondary}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <LogoutModal show={showLogout} onConfirm={handleLogoutConfirm} onCancel={()=>setShowLogout(false)} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Presentational helpers (Overview-tab specific — shared ones live in Widgets.js)
// ─────────────────────────────────────────────────────────────────────────

function AlertRow({ alert, onClick }) {
  const sevColor = { high:C.red, warn:C.amber, info:C.blue, success:C.accent }[alert.sev] || C.muted
  return (
    <button
      onClick={onClick}
      className="row-hover"
      style={{
        display:'flex', gap:'11px', alignItems:'center', width:'100%',
        background:'transparent', border:'none', borderRadius:R.md,
        padding:'9px 8px', textAlign:'left',
      }}
    >
      <span style={{
        width:'28px', height:'28px', borderRadius:R.md, background:sevColor+'1a',
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
      }}>
        <Icon name={alert.icon} size={14} color={sevColor} />
      </span>
      <span style={{ flex:1, minWidth:0 }}>
        <span className="ellip" style={{ display:'block', color:sevColor, fontSize:T.base, fontWeight:700 }}>{alert.title}</span>
        <span className="ellip" style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'1px' }}>{alert.desc}</span>
      </span>
      <Icon name="arrow-right" size={14} color={C.dim} />
    </button>
  )
}

