import { useState, useEffect, useMemo } from 'react'
import Icon from '../Icons'
import { C, MiniStat, AttendanceDots, ScoreBadge, HBarList } from '../Widgets'
import { Card, Button, SearchInput, Stat, PageHead, PickList, T, R, SP, SURF, istDayISO } from '../ui'
import HistoryPanel from './HistoryPanel'

// One date format on this screen. It had three: 17/08/2026 in one heading,
// 2026-08-17 in the next, and the pickers' own format above both.
function fmtDay(iso) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
}

function initials(name) { return (name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase() }

// Heuristic 0-100 performance score. Weighs attendance most heavily since
// it's the most reliable signal we have; the rest are penalty-based off
// real counters already returned by /api/admin/employee-progress.
// Has anything happened for this person in this range at all? A day that has
// not been worked yet has nothing to judge, and scoring it anyway rated every
// employee "Critical" at half past seven in the morning — an alarming red
// verdict on a day that had not started.
export function hasDataInRange(emp) {
  return (emp.daysPresent || 0) > 0
      || (emp.rangeUpdatesCount || 0) > 0
      || (emp.rangeClientsCount || 0) > 0
      || (emp.rangeAlerts || 0) > 0
      || (emp.rangeMisaligns || 0) > 0
}

function computeScore(emp) {
  if (!hasDataInRange(emp)) return null
  const totalDays = emp.totalDaysInRange || 1
  const attendance = (emp.daysPresent / totalDays) * 40
  const misalignPenalty = Math.min(20, emp.rangeMisaligns * 2)
  const alertPenalty    = Math.min(20, emp.rangeAlerts)
  const footagePenalty  = Math.min(20, emp.footagePending * 4)
  return Math.max(0, Math.min(100, Math.round(attendance + (20-misalignPenalty) + (20-alertPenalty) + (20-footagePenalty))))
}

function hourLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)}`
}

export default function ProgressTab({ progress, fromDate, toDate, setFromDate, setToDate, overviewEmployees, todayISO, loadDayView, downloadCSV }) {
  const [search, setSearch] = useState('')
  const [selectedEmpName, setSelectedEmpName] = useState(null)
  const [notes, setNotes] = useState({})   // local-only, does not persist to backend
  const [noteDraft, setNoteDraft] = useState('')
  const [dayData, setDayData] = useState(null)
  const [dayLoading, setDayLoading] = useState(false)

  const isSingleDay = fromDate === toDate
  const isToday = isSingleDay && fromDate === todayISO()

  useEffect(() => {
    if (!isSingleDay) { setDayData(null); return }
    setDayLoading(true)
    loadDayView(fromDate).then(d => { setDayData(d); setDayLoading(false) })
  }, [fromDate, isSingleDay])

  const list = progress?.progress || []

  const filtered = useMemo(() => {
    if (!search.trim()) return list
    const q = search.trim().toLowerCase()
    return list.filter(e => e.name.toLowerCase().includes(q))
  }, [list, search])

  useEffect(() => {
    if (filtered.length === 0) { setSelectedEmpName(null); return }
    if (!filtered.some(e => e.name === selectedEmpName)) setSelectedEmpName(filtered[0].name)
  }, [filtered])

  const selected = filtered.find(e => e.name === selectedEmpName) || filtered[0] || null
  const liveStatus = selected && isToday ? overviewEmployees?.find(e => e.name === selected.name) : null
  const selectedDayHours = selected && dayData && Array.isArray(dayData.employees)
    ? dayData.employees.find(e => e.name === selected.name)?.hours
    : null

  const kpis = useMemo(() => {
    if (list.length === 0) return null
    const sum = (fn) => list.reduce((s,e)=>s+fn(e),0)
    const avgAttendance = Math.round((sum(e=>e.daysPresent/(e.totalDaysInRange||1)) / list.length) * 100)
    return {
      employees: list.length,
      days: progress.dates.length,
      updates: sum(e=>e.rangeUpdatesCount),
      misaligns: sum(e=>e.rangeMisaligns),
      alerts: sum(e=>e.rangeAlerts),
      footagePending: sum(e=>e.footagePending),
      footageDone: sum(e=>e.footageCompletedInRange),
      avgAttendance,
    }
  }, [list, progress])

  function exportPerformance() {
    const rows = [
      ['Employee','Days Present','Days Absent','Updates Done','Pending','Clients Touched','Misaligns','Alerts','Footage Pending','Footage Completed','Score'],
      ...list.map(e => [e.name, e.daysPresent, e.daysAbsent, e.rangeUpdatesCount, e.rangePendingCount, e.rangeClientsCount, e.rangeMisaligns, e.rangeAlerts, e.footagePending, e.footageCompletedInRange, computeScore(e)]),
    ]
    downloadCSV(rows, `Employee_Performance_${fromDate}_to_${toDate}.csv`)
  }

  if (!progress || !kpis) return <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>

  return (
    <div>
      {/* Control bar */}
      <Card style={{ marginBottom:SP[4] }}>
        <div style={{ display:'flex', gap:SP[2], alignItems:'center', flexWrap:'wrap' }}>
          <span className="eyebrow">From</span>
          <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={{ width:'auto' }} />
          <span className="eyebrow">To</span>
          <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={{ width:'auto' }} />
          <Button size="sm" variant="subtle" onClick={()=>{setFromDate(todayISO());setToDate(todayISO())}}>Today</Button>
          <Button size="sm" variant="subtle" onClick={()=>{ const x=istDayISO(-1); setFromDate(x); setToDate(x) }}>Yesterday</Button>
          <Button size="sm" variant="subtle" onClick={()=>{ setFromDate(istDayISO(-6)); setToDate(istDayISO()) }}>Last 7 days</Button>
          <Button size="sm" variant="subtle" onClick={()=>{ setFromDate(istDayISO(-29)); setToDate(istDayISO()) }}>Last 30 days</Button>
          <div style={{ flex:1 }} />
          <Button size="sm" variant="ghost" icon="download" onClick={exportPerformance}>Export</Button>
        </div>
      </Card>

      {/* Seven stat tiles became one line.
          Three of them arrived with no sub-line at all, so the row read as a
          set of empty boxes; all seven together cost the top third of the
          screen to say things you glance at once. */}
      <PageHead
        title={`${kpis.employees} employee${kpis.employees===1?'':'s'} · ${fmtDay(fromDate)}${fromDate===toDate?'':` – ${fmtDay(toDate)}`}`}
        sub={`${kpis.days} day${kpis.days===1?'':'s'} in range`}
        facts={[
          { label:'avg attendance', value:`${kpis.avgAttendance}%`, tone: kpis.avgAttendance >= 80 ? 'good' : 'warn' },
          { label:'updates',        value:kpis.updates, tone:'good' },
          { label:'misaligns',      value:kpis.misaligns, tone: kpis.misaligns ? 'warn' : undefined },
          { label:'alerts',         value:kpis.alerts, tone: kpis.alerts ? 'warn' : undefined },
          { label:'footage open',   value:kpis.footagePending, tone: kpis.footagePending ? 'warn' : undefined },
          { label:'footage done',   value:kpis.footageDone },
        ]}
      />

      {/* The months worked before the platform existed. Its own block, not
          folded into the range above — those are monthly lump sums and cannot
          be cut into days. See components/tabs/HistoryPanel.js. */}
      <HistoryPanel history={progress?.history} />

      {/* Three fixed tracks overflowed the page below about 1250px — the
          300px list plus two columns whose contents have their own minimum
          widths added up to more than the content column had. */}
      <div className="progress-split">
        {/* Employee list */}
        <Card pad={false} style={{ position:'sticky', top:'12px' }}>
          <div style={{ padding:`${SP[3]} ${SP[3]} ${SP[2]}`, display:'flex', flexDirection:'column', gap:SP[2] }}>
            <span className="eyebrow">Employees — {filtered.length}</span>
            <SearchInput value={search} onChange={setSearch} placeholder="Search employee…" />
          </div>
          <PickList
            value={selected && selected.name}
            onPick={setSelectedEmpName}
            empty="Nobody matches that search."
            maxHeight="60vh"
            items={filtered.map(e => {
              const score = computeScore(e)
              const live = isToday ? overviewEmployees?.find(o=>o.name===e.name) : null
              return {
                key: e.name,
                label: e.name,
                sub: live ? live.statusLabel : `${e.daysPresent}/${e.totalDaysInRange} days present`,
                badge: (
                  <span style={{
                    width:'30px', height:'30px', borderRadius:'50%', flexShrink:0,
                    background:C.accentDark, color:C.accent,
                    display:'flex', alignItems:'center', justifyContent:'center',
                    fontSize:'10.5px', fontWeight:700,
                  }}>{initials(e.name)}</span>
                ),
                right: (
                  <span style={{
                    color: score == null ? C.dim : score>=85?C.accent:score>=70?C.amber:C.red,
                    fontSize: score == null ? T.xs : T.base, fontWeight:800, flexShrink:0,
                  }}>{score == null ? '—' : score}</span>
                ),
              }
            })}
          />
        </Card>

        {/* Selected employee detail */}
        {!selected ? (
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'30px', color:C.muted, textAlign:'center' }}>Select an employee.</div>
        ) : (
          <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap', marginBottom:'14px' }}>
              <div style={{ width:'42px', height:'42px', borderRadius:'50%', background:C.accentDark, color:C.accent, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700, fontSize:'13px' }}>{initials(selected.name)}</div>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ color:C.text, fontSize:'15px', fontWeight:700 }}>{selected.name}</span>
                  {liveStatus && <span style={{ background:C.accentSoft, color:C.accent, borderRadius:'20px', padding:'2px 9px', fontSize:'10px', fontWeight:700 }}>{liveStatus.statusLabel}</span>}
                </div>
                <div style={{ color:C.muted, fontSize:'11px', marginTop:'2px' }}>
                  {selected.isNight?'Night':'Day'} shift · {selected.shiftStart}:00–{selected.shiftEnd}:00
                </div>
              </div>
              <div style={{ marginLeft:'auto' }}>
                {computeScore(selected) == null
                  ? <span style={{ color:C.muted, fontSize:T.sm }}>No activity in this range yet</span>
                  : <ScoreBadge score={computeScore(selected)} />}
              </div>
            </div>

            <div style={{ display:'flex', gap:'20px', flexWrap:'wrap', marginBottom:'16px', paddingBottom:'14px', borderBottom:`1px solid ${C.border}` }}>
              <MiniStat label="UPDATES DONE" val={selected.rangeUpdatesCount} />
              <MiniStat label="PENDING" val={selected.rangePendingCount} warn={selected.rangePendingCount>0} />
              <MiniStat label="MISALIGNS" val={selected.rangeMisaligns} warn={selected.rangeMisaligns>0} />
              <MiniStat label="ALERTS" val={selected.rangeAlerts} warn={selected.rangeAlerts>0} />
              <MiniStat label="FOOTAGE OPEN" val={selected.footagePending} warn={selected.footagePending>0} />
              <MiniStat label="DAYS ABSENT" val={selected.daysAbsent} warn={selected.daysAbsent>0} />
            </div>

            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:SP[2], marginBottom:'8px', flexWrap:'wrap' }}>
              <span className="eyebrow">Attendance — {fmtDay(fromDate)}{fromDate===toDate?'':` to ${fmtDay(toDate)}`}</span>
              {/* A row of unlabelled coloured squares is a puzzle, not a chart. */}
              <span style={{ display:'flex', alignItems:'center', gap:SP[3], color:C.muted, fontSize:'9.5px' }}>
                <span style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:C.accent }} /> present
                </span>
                <span style={{ display:'flex', alignItems:'center', gap:'5px' }}>
                  <span style={{ width:8, height:8, borderRadius:2, background:C.red }} /> absent
                </span>
              </span>
            </div>
            <div style={{ marginBottom:'16px' }}><AttendanceDots attendance={selected.attendance} /></div>

            {isSingleDay ? (
              <>
                <div className="eyebrow" style={{ marginBottom:'8px' }}>Clients assigned — {fmtDay(fromDate)}</div>
                {dayLoading ? (
                  <div style={{display:'flex',justifyContent:'center',padding:'1.5rem'}}><div className="spinner"></div></div>
                ) : !selectedDayHours ? (
                  <div style={{ color:C.muted, fontSize:'11.5px' }}>No hour-wise data for this employee on this date.</div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:'6px', maxHeight:'320px', overflowY:'auto' }}>
                    {selectedDayHours.filter(h=>!h.isOnLeave && h.clients.length>0).flatMap(h => h.clients.map((c,ci) => (
                      <div key={`${h.hour}-${ci}`} style={{ display:'flex', alignItems:'center', gap:'10px', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', padding:'8px 12px' }}>
                        <span style={{ color:C.muted, fontSize:'10px', width:'62px', flexShrink:0 }}>{hourLabel(h.hour)}</span>
                        <span style={{ color:C.text, fontSize:'11.5px', fontWeight:600, flex:1 }}>{c.client}</span>
                        <span style={{ color:C.muted, fontSize:'10px' }}>{c.vehicleCount}v</span>
                        <span style={{ color:C.text2, fontSize:'10px' }}>A:{c.alertCount||0}</span>
                        <span style={{ color:C.text2, fontSize:'10px' }}>M:{c.misalignVehicles||0}</span>
                        <span style={{ background:(c.filled?C.accent:C.amber)+'1f', color:c.filled?C.accent:C.amber, borderRadius:'5px', padding:'2px 7px', fontSize:'9px', fontWeight:700 }}>{c.filled?'DONE':'PENDING'}</span>
                      </div>
                    )))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ color:C.muted, fontSize:'11.5px' }}>Pick a single date (From = To) to see the hour-by-hour client breakdown for that day.</div>
            )}
          </div>
        )}

        {/* Right: score breakdown + notes */}
        {selected && (
          <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
              <div className="eyebrow" style={{ marginBottom:'10px' }}>Score breakdown</div>
              {!hasDataInRange(selected) && (
                <div style={{ color:C.muted, fontSize:T.sm, marginBottom:'10px', lineHeight:1.6 }}>
                  Nothing has been recorded for {selected.name} in this range, so there is
                  nothing to score yet. The bars below show what each part would contribute.
                </div>
              )}
              <HBarList items={[
                { label:'Attendance', value:Math.round((selected.daysPresent/(selected.totalDaysInRange||1))*40), color:C.accent },
                { label:'Alignment', value:Math.max(0,20-Math.min(20,selected.rangeMisaligns*2)), color:C.blue },
                { label:'Alert control', value:Math.max(0,20-Math.min(20,selected.rangeAlerts)), color:C.purple },
                { label:'Footage upkeep', value:Math.max(0,20-Math.min(20,selected.footagePending*4)), color:C.amber },
              ]} max={40} />
              <div style={{ marginTop:'10px', color:C.muted, fontSize:'9.5px', lineHeight:1.5 }}>
                Score out of 100 — weighted from attendance, data alignment, alert control and footage upkeep.
              </div>
            </div>

            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
              <div className="eyebrow" style={{ marginBottom:'10px' }}>Notes — not saved yet</div>
              {notes[selected.name] && notes[selected.name].map((n,i) => (
                <div key={i} style={{ background:C.s2, borderRadius:'8px', padding:'8px 10px', marginBottom:'6px' }}>
                  <div style={{ color:C.text2, fontSize:'11px' }}>{n.text}</div>
                  <div style={{ color:C.dim, fontSize:'9px', marginTop:'3px' }}>{n.time}</div>
                </div>
              ))}
              <textarea value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} placeholder="Add a private note..." style={{ width:'100%', boxSizing:'border-box', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'11.5px', padding:'8px 10px', minHeight:'60px', resize:'vertical', fontFamily:'inherit' }} />
              <button onClick={()=>{
                if (!noteDraft.trim()) return
                setNotes(prev => ({ ...prev, [selected.name]: [...(prev[selected.name]||[]), { text:noteDraft.trim(), time:new Date().toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}) }] }))
                setNoteDraft('')
              }} style={{ marginTop:'8px', width:'100%', background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontWeight:700, fontSize:'11.5px', padding:'9px', cursor:'pointer' }}>Add Note</button>
              <div style={{ color:C.dim, fontSize:'9px', marginTop:'6px' }}>Notes are session-only for now — they aren't saved to a sheet yet.</div>
            </div>
          </div>
        )}
      </div>

      {/* Team comparison */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginTop:'14px' }}>
        <div className="eyebrow" style={{ marginBottom:'12px' }}>Most alerts and misalignments in this range</div>
        {list.every(e => (e.rangeAlerts||0) + (e.rangeMisaligns||0) === 0) ? (
          <div style={{ color:C.muted, fontSize:T.base }}>
            Nothing flagged in this range — no alerts and no misalignments recorded.
          </div>
        ) : (
          <HBarList items={[...list].sort((a,b)=>(b.rangeAlerts+b.rangeMisaligns)-(a.rangeAlerts+a.rangeMisaligns)).slice(0,8).map(e=>({ label:e.name, value:e.rangeAlerts+e.rangeMisaligns, color:C.amber }))} />
        )}
      </div>
    </div>
  )
}

const quickBtnStyle = { background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md, color:C.text2, fontSize:T.sm, fontWeight:600, padding:'7px 11px', cursor:'pointer', whiteSpace:'nowrap' }
