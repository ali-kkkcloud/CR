import { useState, useEffect, useMemo } from 'react'
import Icon from '../Icons'
import { C, KpiCard, MiniStat, AttendanceDots, ScoreBadge, HBarList } from '../Widgets'

function initials(name) { return (name||'?').split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase() }

// Heuristic 0-100 performance score. Weighs attendance most heavily since
// it's the most reliable signal we have; the rest are penalty-based off
// real counters already returned by /api/admin/employee-progress.
function computeScore(emp) {
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
  const selectedDayHours = selected && dayData ? dayData.employees.find(e => e.name === selected.name)?.hours : null

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
      <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 16px', marginBottom:'14px' }}>
        <span style={{ color:C.muted, fontSize:'10px', fontWeight:700 }}>FROM</span>
        <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} style={dateInpStyle} />
        <span style={{ color:C.muted, fontSize:'10px', fontWeight:700 }}>TO</span>
        <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} style={dateInpStyle} />
        <button style={quickBtnStyle} onClick={()=>{setFromDate(todayISO());setToDate(todayISO())}}>Today</button>
        <button style={quickBtnStyle} onClick={()=>{ const d=new Date(); d.setDate(d.getDate()-1); const s=d.toISOString().split('T')[0]; setFromDate(s); setToDate(s) }}>Yesterday</button>
        <button style={quickBtnStyle} onClick={()=>{ const d=new Date(); d.setDate(d.getDate()-6); setFromDate(d.toISOString().split('T')[0]); setToDate(todayISO()) }}>Last 7 Days</button>
        <button style={quickBtnStyle} onClick={()=>{ const d=new Date(); d.setDate(d.getDate()-29); setFromDate(d.toISOString().split('T')[0]); setToDate(todayISO()) }}>Last 30 Days</button>
        <input placeholder="🔍 Search employee..." value={search} onChange={e=>setSearch(e.target.value)} style={{...dateInpStyle, flex:1, minWidth:'160px'}} />
        <button style={outlineBtnStyle} onClick={exportPerformance}><Icon name="download" size={12} color={C.text2}/> Export</button>
      </div>

      {/* KPI strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(140px, 1fr))', gap:'10px', marginBottom:'14px' }}>
        <KpiCard icon="users" label="Employees" value={kpis.employees} sub={`${kpis.days} day(s) in range`} />
        <KpiCard icon="shield" label="Avg Attendance" value={`${kpis.avgAttendance}%`} sub="Present vs range days" />
        <KpiCard icon="check-circle" label="Updates Recorded" value={kpis.updates} sub="Across selected range" />
        <KpiCard icon="analytics" label="Misaligns Found" value={kpis.misaligns} subColor={kpis.misaligns>0?C.amber:C.muted} />
        <KpiCard icon="alerts" label="Alerts" value={kpis.alerts} subColor={kpis.alerts>0?C.amber:C.muted} />
        <KpiCard icon="camera" label="Footage Pending" value={kpis.footagePending} subColor={kpis.footagePending>0?C.amber:C.muted} />
        <KpiCard icon="check-circle" label="Footage Completed" value={kpis.footageDone} />
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'300px 1.4fr 1fr', gap:'14px', alignItems:'start' }}>
        {/* Employee list */}
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'14px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>EMPLOYEES ({filtered.length})</div>
          <input placeholder="Search employee..." value={search} onChange={e=>setSearch(e.target.value)} style={{ ...dateInpStyle, width:'100%', boxSizing:'border-box', marginBottom:'10px' }} />
          <div style={{ display:'flex', flexDirection:'column', gap:'6px', maxHeight:'560px', overflowY:'auto' }}>
            {filtered.map(e => {
              const score = computeScore(e)
              const live = isToday ? overviewEmployees?.find(o=>o.name===e.name) : null
              const active = e.name === (selected && selected.name)
              return (
                <div key={e.name} onClick={()=>setSelectedEmpName(e.name)} style={{
                  display:'flex', alignItems:'center', gap:'10px', padding:'9px 10px', borderRadius:'9px', cursor:'pointer',
                  background: active ? C.accentDark+'55' : 'transparent', border:`1px solid ${active?C.accent+'55':'transparent'}`,
                }}>
                  <div style={{ width:'30px', height:'30px', borderRadius:'50%', background:C.accentDark, color:C.accent, display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10.5px', fontWeight:700, flexShrink:0 }}>{initials(e.name)}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ color:C.text, fontSize:'12px', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.name}</div>
                    <div style={{ color:C.muted, fontSize:'9.5px' }}>{live ? live.statusLabel : `${e.daysPresent}/${e.totalDaysInRange}d present`}</div>
                  </div>
                  <div style={{ textAlign:'right' }}>
                    <div style={{ color: score>=85?C.accent:score>=70?C.amber:C.red, fontSize:'12.5px', fontWeight:800 }}>{score}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

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
              <div style={{ marginLeft:'auto' }}><ScoreBadge score={computeScore(selected)} /></div>
            </div>

            <div style={{ display:'flex', gap:'20px', flexWrap:'wrap', marginBottom:'16px', paddingBottom:'14px', borderBottom:`1px solid ${C.border}` }}>
              <MiniStat label="CLIENTS TOUCHED" val={selected.rangeClientsCount} />
              <MiniStat label="UPDATES DONE" val={selected.rangeUpdatesCount} />
              <MiniStat label="PENDING" val={selected.rangePendingCount} warn={selected.rangePendingCount>0} />
              <MiniStat label="MISALIGNS" val={selected.rangeMisaligns} warn={selected.rangeMisaligns>0} />
              <MiniStat label="ALERTS" val={selected.rangeAlerts} warn={selected.rangeAlerts>0} />
              <MiniStat label="FOOTAGE PENDING" val={selected.footagePending} warn={selected.footagePending>0} />
              <MiniStat label="FOOTAGE DONE" val={selected.footageCompletedInRange} />
              <MiniStat label="DAYS ABSENT" val={selected.daysAbsent} warn={selected.daysAbsent>0} />
            </div>

            <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'8px' }}>ATTENDANCE — {progress.from} to {progress.to}</div>
            <div style={{ marginBottom:'16px' }}><AttendanceDots attendance={selected.attendance} /></div>

            {isSingleDay ? (
              <>
                <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'8px' }}>CLIENTS ASSIGNED — {fromDate}</div>
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
              <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>SCORE BREAKDOWN</div>
              <HBarList items={[
                { label:'Attendance', value:Math.round((selected.daysPresent/(selected.totalDaysInRange||1))*40), color:C.accent },
                { label:'Alignment', value:Math.max(0,20-Math.min(20,selected.rangeMisaligns*2)), color:C.blue },
                { label:'Alert control', value:Math.max(0,20-Math.min(20,selected.rangeAlerts)), color:C.purple },
                { label:'Footage upkeep', value:Math.max(0,20-Math.min(20,selected.footagePending*4)), color:C.amber },
              ]} max={40} />
              <div style={{ marginTop:'10px', color:C.muted, fontSize:'9.5px', lineHeight:1.5 }}>
                Heuristic score out of 100 — weighted from attendance, data alignment, alert control and footage upkeep. Tune weights anytime in ProgressTab.js.
              </div>
            </div>

            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
              <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>NOTES</div>
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
        <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'12px' }}>TOP ALERT + MISALIGN LOAD (this range)</div>
        <HBarList items={[...list].sort((a,b)=>(b.rangeAlerts+b.rangeMisaligns)-(a.rangeAlerts+a.rangeMisaligns)).slice(0,8).map(e=>({ label:e.name, value:e.rangeAlerts+e.rangeMisaligns, color:C.amber }))} />
      </div>
    </div>
  )
}

const dateInpStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'12.5px', padding:'7px 10px' }
const quickBtnStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11px', padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const outlineBtnStyle = { display:'flex', alignItems:'center', gap:'5px', background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11.5px', fontWeight:600, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
