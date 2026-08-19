import { useState, useEffect, useMemo, useRef } from 'react'
import Icon from '../Icons'
import { C, MiniStat, ScoreBadge } from '../Widgets'
import { Card, Button, SearchInput, Tag, PageHead, PickList, T, R, SP, SURF, istDayISO } from '../ui'

function hourLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)}`
}
function hourLabelShort(h) { return h.toString().padStart(2,'0') }

// Builds a readable shift-time string. When the employee used Early Start
// and/or OT, this shows BOTH the originally scheduled window and the
// actual (effective) one, so admin can see exactly what changed.
function shiftLabel(emp) {
  const sched = `${emp.shiftStart}:00–${emp.shiftEnd}:00`
  const hasOverride = emp.usedEarlyStart || emp.usedOT
  if (!hasOverride || emp.effectiveStart == null) return sched
  const actual = `${emp.effectiveStart}:00–${emp.effectiveEnd}:00`
  const otTag = emp.usedOT ? ' (+3 OT)' : ''
  return `Scheduled ${sched} → Actual ${actual}${otTag}`
}

function statusOf(emp) {
  if (!emp) return { label:'—', color:C.muted }
  // Called with rows from outside the normalised list too, so it guards itself.
  const leaveHour = (emp.hours || []).find(h => h.isOnLeave)
  if (leaveHour && !emp.loggedIn) {
    if (leaveHour.leaveReason === 'Week Off') return { label:'Week Off', color:C.purple }
    return { label:'On Leave', color:C.purple }
  }
  if (!emp.loggedIn) return { label:'Not Started', color:C.red }
  if (emp.endTime) return { label:'Shift Ended', color:C.blue }
  // Clocked in, never clocked out, and too long ago to still be believed. It
  // used to read "Working", which is how a forgotten row from this morning went
  // on presenting itself as somebody standing on the floor all evening.
  if (emp.shiftStale) return { label:'Shift Left Open', color:C.amber }
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
  const [showFilters, setShowFilters] = useState(false)
  const [drawer, setDrawer] = useState(null) // { type:'client'|'employee'|'vehicle'|'hour', payload }

  // Playback / Replay Day
  const [isPlaying, setIsPlaying] = useState(false)
  const [playHour, setPlayHour] = useState(0)
  const playRef = useRef(null)

  // ── Every list this screen walks is guaranteed to be a list ──────────
  //
  // This component reaches three deep — employee → hour → clients — in about
  // twenty places, and every one of them assumed the arrays were there. One
  // hour arriving without its `clients` was enough to throw inside a render
  // and take the WHOLE admin page down to "Application error: a client-side
  // exception has occurred", white screen, nothing to click. A missing array
  // is a hiccup; it must never be an outage.
  //
  // Normalised once here so the rest of the file can stay readable, rather
  // than sprinkling `|| []` down twenty call sites and missing the twenty-first.
  const employees = useMemo(() => (data?.employees || []).map(e => ({
    ...e,
    leaves: Array.isArray(e?.leaves) ? e.leaves : [],
    hours: (Array.isArray(e?.hours) ? e.hours : []).map(h => ({
      ...h,
      clients: Array.isArray(h?.clients) ? h.clients : [],
    })),
  })), [data])

  // How many filters are narrowing what is on screen. Shown on the Filters
  // button so a filter left on behind the fold can never quietly hide people.
  const activeFilterCount =
    (shiftFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) +
    (clientFilter !== 'all' ? 1 : 0) + (onlyPending ? 1 : 0) + (onlyRedistributed ? 1 : 0)

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

  // Drives the smart search banner — client match is checked first (this is
  // the primary use case per the spec's "search RedBus" example); footage/
  // vehicle search is only offered as a fallback when nothing else matches.
  const searchClientMatches = useMemo(() => {
    if (!search.trim()) return []
    const q = search.trim().toLowerCase()
    return allClientsToday.filter(c => c.toLowerCase().includes(q))
  }, [search, allClientsToday])

  const searchHasEmployeeMatch = useMemo(() => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return employees.some(e => e.name.toLowerCase().includes(q))
  }, [search, employees])

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
      {/* ── Control bar ──
          One row: the date, and a search box. Everything else — the three
          filters, the two toggles, export, replay — is real and still here,
          folded behind "Filters" and opened when it is wanted.
          Eleven controls stacked across two permanent rows is what made this
          screen feel like a form to fill in before it would tell you anything.
          The count on the button says how many are on, so nothing can be
          quietly filtering the page from behind a fold. */}
      <Card style={{ marginBottom:SP[3] }}>
        <div style={{ display:'flex', gap:SP[2], alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
            <Button size="sm" variant="ghost" title="Previous day"
              onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()-1); setDate(d.toISOString().split('T')[0]) }}>‹</Button>
            <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={{ width:'auto' }} />
            <Button size="sm" variant="ghost" title="Next day"
              onClick={()=>{ const d=new Date(date); d.setDate(d.getDate()+1); setDate(d.toISOString().split('T')[0]) }}>›</Button>
          </div>
          <Button size="sm" variant="subtle" onClick={()=>setDate(todayISO())}>Today</Button>

          <div style={{ flex:1, minWidth:'180px' }}>
            <SearchInput value={search} onChange={setSearch} placeholder="Search employee or client…" />
          </div>

          <Button size="sm" variant={activeFilterCount ? 'primary' : 'subtle'} icon="settings" onClick={()=>setShowFilters(v=>!v)}>
            Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </Button>
        </div>

        {showFilters && (
          <div style={{
            display:'flex', gap:SP[2], alignItems:'center', flexWrap:'wrap',
            marginTop:SP[3], paddingTop:SP[3], borderTop:`1px solid ${C.border}`,
          }}>
            <select value={shiftFilter} onChange={e=>setShiftFilter(e.target.value)} style={{ width:'auto', fontSize:T.sm }}>
              <option value="all">All shifts</option><option value="day">Day shift</option><option value="night">Night shift</option>
            </select>
            <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={{ width:'auto', fontSize:T.sm }}>
              <option value="all">All status</option><option value="working">Working</option><option value="ended">Shift ended</option>
              <option value="leave">On leave</option><option value="not_started">Not started</option>
            </select>
            <select value={clientFilter} onChange={e=>setClientFilter(e.target.value)} style={{ width:'auto', maxWidth:'220px', fontSize:T.sm }}>
              <option value="all">All clients</option>
              {allClientsToday.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button size="sm" variant={onlyPending ? 'primary' : 'subtle'} onClick={()=>setOnlyPending(v=>!v)}>Only pending</Button>
            <Button size="sm" variant={onlyRedistributed ? 'primary' : 'subtle'} onClick={()=>setOnlyRedistributed(v=>!v)}>Only redistributed</Button>
            <span style={{ flex:1 }} />
            <Button size="sm" variant="subtle" onClick={()=>setDate(istDayISO(-1))}>Yesterday</Button>
            <Button size="sm" variant="ghost" icon="download" onClick={exportReport}>Export</Button>
            {!playbackOn && <Button size="sm" variant="subtle" onClick={startPlayback}>▶ Replay day</Button>}
            {activeFilterCount > 0 && (
              <Button size="sm" variant="ghost" onClick={()=>{
                setShiftFilter('all'); setStatusFilter('all'); setClientFilter('all')
                setOnlyPending(false); setOnlyRedistributed(false)
              }}>Clear</Button>
            )}
          </div>
        )}

        {playbackOn && (
          <div style={{
            display:'flex', alignItems:'center', gap:SP[3],
            background:C.bg, border:`1px solid ${C.accent}55`, borderRadius:R.md,
            padding:'9px 14px', marginTop:SP[3],
          }}>
            <button onClick={()=> isPlaying ? stopPlayback() : setIsPlaying(true)}
              style={{ background:'transparent', border:'none', color:C.accent, fontSize:'15px' }}>{isPlaying?'⏸':'▶'}</button>
            <span style={{ color:C.accent, fontSize:T.sm, fontWeight:700, whiteSpace:'nowrap', minWidth:'68px' }}>{hourLabel(playHour)}</span>
            <input type="range" min={minHour} max={maxHour} value={playHour}
              onChange={e=>{ setIsPlaying(false); setPlayHour(parseInt(e.target.value)) }} style={{ flex:1, padding:0, border:'none', background:'transparent' }} />
            <Button size="sm" variant="subtle" onClick={()=>{ setIsPlaying(false); setPlayHour(minHour) }}>Exit replay</Button>
          </div>
        )}
      </Card>

      {/* Smart search result banner — client/employee first, footage/vehicle only as a fallback */}
      {search.trim() && (
        <div style={{ marginBottom:'14px' }}>
          {searchClientMatches.length > 0 ? (
            <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', background:C.accentSoft, border:`1px solid ${C.accent}40`, borderRadius:'10px', padding:'10px 14px' }}>
              <Icon name="overview" size={14} color={C.accent}/>
              <span style={{ color:C.text2, fontSize:'11.5px' }}>
                Client match: <strong style={{color:C.accent}}>{searchClientMatches[0]}</strong>
                {searchClientMatches.length>1 ? ` (+${searchClientMatches.length-1} more matching)` : ''} — {filtered.length} employee(s) touched it today.
              </span>
              <button onClick={()=>setDrawer({type:'client', payload:searchClientMatches[0]})} style={{...quickBtnStyle, background:C.accentDark, borderColor:C.accent, color:C.accent, marginLeft:'auto'}}>Open Client Investigation →</button>
            </div>
          ) : !searchHasEmployeeMatch ? (
            <div style={{ display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'10px 14px' }}>
              <span style={{ color:C.muted, fontSize:'11.5px' }}>No employee or client matched "{search}" today.</span>
              <button onClick={()=>setDrawer({type:'vehicle', payload:search.trim()})} style={{...quickBtnStyle, marginLeft:'auto'}}>Search footage requests for this instead →</button>
            </div>
          ) : null}
        </div>
      )}

      {/* The day in one line.
          This was nine stat tiles across the top — "39288 Total Vehicles" among
          them, which nobody acts on — and they pushed the employees themselves
          below the fold on every screen size. The three that change what you do
          here are still clickable, and they still filter. */}
      <PageHead
        title={`${filtered.length} employee${filtered.length===1?'':'s'} on this day`}
        sub={kpis.pending > 0
          ? `${kpis.completed} of ${kpis.completed + kpis.pending} client slots updated`
          : kpis.completed > 0 ? 'Every assigned slot was updated.' : 'Nothing recorded yet.'}
        facts={[
          { label:'on shift now', value:kpis.active, tone:'good', onClick:()=>setStatusFilter('working') },
          { label:'on leave',     value:kpis.onLeave, tone: kpis.onLeave ? 'warn' : undefined, onClick:()=>setStatusFilter('leave') },
          { label:'done',         value:kpis.completed, tone:'good' },
          { label:'pending',      value:kpis.pending, tone: kpis.pending ? 'warn' : undefined, onClick:()=>setOnlyPending(v=>!v) },
          kpis.footagePendingToday > 0 && { label:'footage open', value:kpis.footagePendingToday, tone:'warn' },
          kpis.redistCount > 0 && { label:'moved', value:kpis.redistCount, onClick:()=>setOnlyRedistributed(v=>!v) },
        ]}
      />

      {!selectedEmp ? (
        <div style={{color:C.muted,textAlign:'center',padding:'2rem'}}>No employees match this filter.</div>
      ) : (
        <div className="day-split">
          {/* Who — always on screen, so picking somebody never means scrolling
              past their own day to find the list again. One line each: the
              seven numbers that used to sit on every row said nothing you could
              act on without opening the person anyway. */}
          <Card pad={false} style={{ position:'sticky', top:'12px' }}>
            <div style={{ padding:`${SP[3]} ${SP[3]} ${SP[2]}` }}>
              <span className="eyebrow">Employees — {filtered.length}</span>
            </div>
            <PickList
              value={selectedEmp?.name}
              onPick={(name)=>{ setSelectedEmpName(name); setDrawerClient(null) }}
              empty="Nobody matches this filter."
              maxHeight="70vh"
              items={filtered.map(e => {
                const es = statusOf(e)
                const pct = e.totalAssigned > 0 ? Math.round((e.totalCompleted / e.totalAssigned) * 100) : 0
                return {
                  key: e.name,
                  label: e.name,
                  sub: `${es.label} · ${e.totalCompleted}/${e.totalAssigned}`,
                  subColor: es.color,
                  badge: <span style={{ width:8, height:8, borderRadius:'50%', background:es.color, flexShrink:0 }} />,
                  right: (
                    <span style={{ textAlign:'right', flexShrink:0 }}>
                      <span style={{
                        display:'block',
                        color: e.totalMissed > 0 ? C.amber : e.totalAssigned > 0 ? C.accent : C.dim,
                        fontSize:T.base, fontWeight:800,
                      }}>{pct}%</span>
                      {e.totalMissed > 0 && (
                        <span style={{ display:'block', color:C.muted, fontSize:'9px', marginTop:'1px' }}>{e.totalMissed} left</span>
                      )}
                    </span>
                  ),
                }
              })}
            />
          </Card>

          <div style={{ minWidth:0 }}>
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
                    {selectedEmp.isNight?'Night':'Day'} shift · {shiftLabel(selectedEmp)}
                    {selectedEmp.loggedIn && ` · In ${selectedEmp.startTime}${selectedEmp.endTime?` → Out ${selectedEmp.endTime}`:''}`}
                  </div>
                </div>
                {/* Their day in a sentence, not six labelled numbers. The other
                    three — redistributions, footage, completion percent — are on
                    the person's own drawer, one click away, where there is room
                    to say what they mean. */}
                <div style={{ display:'flex', alignItems:'center', gap:SP[3], marginLeft:'auto', flexWrap:'wrap' }}>
                  <span style={{ color:C.text2, fontSize:T.base }}>
                    <strong style={{ color: selectedEmp.totalCompleted ? C.accent : C.text, fontSize:T.lg, fontWeight:800 }}>
                      {selectedEmp.totalCompleted}
                    </strong>
                    {' '}of {selectedEmp.totalAssigned} done
                    {selectedEmp.totalMissed > 0 && <span style={{ color:C.amber }}> · {selectedEmp.totalMissed} left</span>}
                    {footageCountFor(selectedEmp.name) > 0 && <span style={{ color:C.muted }}> · {footageCountFor(selectedEmp.name)} footage</span>}
                  </span>
                  <Button size="sm" variant="subtle" icon="leaves" onClick={()=>onMarkLeave(selectedEmp)}>Mark leave</Button>
                </div>
              </div>

              {/* ── The shift, hour by hour ──
                  Each hour says what it holds and how much of it is done, as
                  "18/24" with a bar underneath, and the colour says the state
                  at a glance: green finished, amber still open, purple leave,
                  grey nothing scheduled. It used to read "28 clients" with a
                  clock icon and no sense of progress, so nine hours of a shift
                  looked identical whether they were finished or untouched. */}
              <div style={{ display:'flex', gap:'6px', overflowX:'auto', marginTop:'14px', paddingBottom:'4px' }} className="no-scrollbar">
                {selectedEmp.hours.map(h => {
                  const active = h.hour === selectedHour
                  const future = playbackOn && h.hour > playHour
                  const total  = h.totalClients || 0
                  const done   = h.completedClients || 0
                  // A custom duty is not an empty hour. An employee named
                  // against something in Employee_Hours — "Night Fleet Update"
                  // at four in the morning — sees that instruction on their own
                  // board, but this screen drew the hour as a grey dash, so the
                  // admin read it as nothing scheduled and could not tell it
                  // apart from an hour with no work at all.
                  const state  = h.isOnLeave ? 'leave'
                    : h.isCustom ? 'custom'
                    : total === 0 ? 'empty'
                    : done === total ? 'done' : 'open'
                  const tone = { leave:C.purple, custom:C.blue, empty:C.dim, done:C.accent, open:C.amber }[state]
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0
                  return (
                    <button key={h.hour} disabled={future} onClick={()=>{setSelectedHour(h.hour); setDrawerClient(null)}} style={{
                      minWidth:'82px', flexShrink:0,
                      background: active ? C.accentDark : SURF.sunken, opacity: future ? 0.35 : 1,
                      border:`1px solid ${active ? C.accent : C.border}`, borderRadius:R.md, padding:'9px 8px',
                      cursor: future ? 'not-allowed' : 'pointer', textAlign:'left',
                    }}>
                      <div style={{ color: active ? C.accent : C.text2, fontSize:'10px', fontWeight:800, letterSpacing:'0.02em' }}>
                        {hourLabel(h.hour)}
                      </div>
                      <div style={{ display:'flex', alignItems:'baseline', gap:'3px', marginTop:'4px' }}>
                        {h.isOnLeave ? (
                          <span style={{ color:tone, fontSize:'11px', fontWeight:700 }}>Leave</span>
                        ) : h.isCustom ? (
                          <span style={{ color:tone, fontSize:'11px', fontWeight:700 }}>Duty</span>
                        ) : total === 0 ? (
                          <span style={{ color:tone, fontSize:'11px' }}>—</span>
                        ) : (
                          <>
                            <span style={{ color:tone, fontSize:T.md, fontWeight:800, lineHeight:1 }}>{done}</span>
                            <span style={{ color: active ? C.text2 : C.muted, fontSize:'10px', fontWeight:700 }}>/{total}</span>
                          </>
                        )}
                      </div>
                      {total > 0 && !h.isOnLeave && !h.isCustom && (
                        <div style={{ height:'3px', borderRadius:'2px', background:'#2a2a2a', marginTop:'6px', overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${pct}%`, background:tone }} />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Client grid for selected hour */}
            {activeHourData && (!playbackOn || activeHourData.hour <= playHour) && (
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginBottom:'12px' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
                  <div className="eyebrow">
                    {hourLabel(activeHourData.hour)} · {activeHourData.isOnLeave ? 'ON LEAVE' : activeHourData.isCustom ? 'ASSIGNED DUTY' : `${activeHourData.totalClients} CLIENT(S) ASSIGNED`}
                  </div>
                  <label style={{ display:'flex', alignItems:'center', gap:'5px', color:C.muted, fontSize:'10px', cursor:'pointer' }}>
                    <input type="checkbox" checked={compact} onChange={e=>setCompact(e.target.checked)} /> Compact View
                  </label>
                </div>
                {activeHourData.isOnLeave ? (
                  <div style={{ color:C.amber, fontSize:'12px' }}>On leave{activeHourData.leaveReason?` — ${activeHourData.leaveReason}`:''}.</div>
                ) : activeHourData.isCustom ? (
                  // What Employee_Hours names them to, word for word — the same
                  // instruction that appears on their own board this hour.
                  <div style={{
                    display:'flex', alignItems:'center', gap:'9px',
                    background:C.blue+'12', border:`1px solid ${C.blue}33`,
                    borderRadius:R.md, padding:'11px 13px',
                  }}>
                    <span style={{ width:'5px', height:'5px', borderRadius:'50%', background:C.blue, flexShrink:0 }} />
                    <span style={{ color:C.blue, fontSize:'12px', fontWeight:700 }}>{activeHourData.customText}</span>
                    <span style={{ color:C.muted, fontSize:'11px' }}>
                      assigned duty this hour — no clients go to them while it runs
                    </span>
                  </div>
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
                          <span style={{ color: c.filled ? ((c.liveVehicles||0) >= (c.vehicleCount||0) ? C.accent : C.amber) : C.muted, fontSize:'10px' }}>
                            {c.filled ? `${c.liveVehicles||0}/${c.vehicleCount||0}v seen` : `${c.vehicleCount}v`}
                          </span>
                          <span style={{ color:C.text2, fontSize:'10px' }}>A:{c.alertCount||0} F:{c.fatigueCount||0} M:{c.misalignVehicles||0}</span>
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
                          {/* Vehicles watched against the client's fleet is
                              the first thing here, because it is the whole
                              point of the hour: 41 of 52 seen is a different
                              day from 52 of 52, and until the employee started
                              recording it there was no way to tell them apart. */}
                          <div style={{ display:'flex', gap:'12px', marginTop:'10px', flexWrap:'wrap' }}>
                            <div>
                              <div style={{ fontSize:'12px', fontWeight:700, color: c.filled ? ((c.liveVehicles||0) >= (c.vehicleCount||0) ? C.accent : C.amber) : C.dim }}>
                                {c.filled ? `${c.liveVehicles||0}/${c.vehicleCount||0}` : '—'}
                              </div>
                              <div style={{color:C.muted,fontSize:'8.5px'}}>VEHICLES SEEN</div>
                            </div>
                            <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.alertCount||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>ALERTS</div></div>
                            <div><div style={{color:C.text,fontSize:'12px',fontWeight:700}}>{c.fatigueCount||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>FATIGUE</div></div>
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

            {/* A client's own hour-by-hour trail — shown only once one is
                picked. It used to be a permanent panel holding the sentence
                "Select View Timeline on any client card", which is a third of
                the screen spent explaining itself. */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', gap:'14px' }}>
            {drawerClient && (
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
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
            </div>
            )}

            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
              <div className="eyebrow" style={{ marginBottom:'10px' }}>RECENT ACTIVITIES{playbackOn?' (up to '+hourLabel(playHour)+')':''}</div>
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
      <div className="eyebrow" style={{ marginBottom:'8px' }}>HOUR-WISE TIMELINE</div>
      <div style={{ display:'flex', flexDirection:'column', gap:'6px', marginBottom:'16px' }}>
        {stats.touches.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No activity today.</div> : stats.touches.map((t,i) => (
          <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px', background:C.s2, borderRadius:'7px', padding:'6px 10px' }}>
            <span style={{ color:C.muted, fontSize:'10px', width:'56px' }}>{hourLabel(t.hour)}</span>
            <span style={{ color:C.text, fontSize:'11px', flex:1 }}>{t.emp}{t.redistributed?' (redistributed)':''}</span>
            <span style={{ background:(t.filled?C.accent:C.amber)+'1f', color:t.filled?C.accent:C.amber, borderRadius:'5px', padding:'2px 7px', fontSize:'9px', fontWeight:700 }}>{t.filled?'DONE':'PENDING'}</span>
          </div>
        ))}
      </div>
      <div className="eyebrow" style={{ marginBottom:'8px' }}>FOOTAGE REQUESTS TODAY ({stats.footageForClient.length})</div>
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
      <div style={{ color:C.muted, fontSize:'11px', marginBottom:'14px' }}>{emp.isNight?'Night':'Day'} shift · {shiftLabel(emp)}{emp.loggedIn && ` · In ${emp.startTime}${emp.endTime?` → Out ${emp.endTime}`:''}`}</div>
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
      {(emp.leaves||[]).length>0 && (
        <div style={{ background:C.purple+'14', border:`1px solid ${C.purple}33`, borderRadius:'8px', padding:'10px 12px', marginBottom:'14px' }}>
          <div style={{ color:C.purple, fontSize:'10px', fontWeight:700, marginBottom:'4px' }}>ON LEAVE TODAY</div>
          {(emp.leaves||[]).map((l,i) => <div key={i} style={{ color:C.text2, fontSize:'11px' }}>{hourLabel(l.fromHour)} → {hourLabel(l.toHour)}{l.reason?` — ${l.reason}`:''}</div>)}
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

const quickBtnStyle = { background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md, color:C.text2, fontSize:T.sm, fontWeight:600, padding:'7px 11px', cursor:'pointer', whiteSpace:'nowrap' }
