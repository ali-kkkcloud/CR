import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Navbar from '../components/Navbar'

export default function Admin() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [overview, setOverview] = useState(null)
  const [progress, setProgress] = useState(null)
  const [footage, setFootage] = useState({ pending: [], completed: [] })
  const [activeTab, setActiveTab] = useState('overview')
  const [footageSearchInput, setFootageSearchInput] = useState('')
  const [footageSearch, setFootageSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const debounceRef = useRef(null)

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
      loadProgress()
      setLoading(false)
    })
  }, [])

  const loadData = useCallback(async () => {
    const [ov, ft] = await Promise.all([
      fetch('/api/admin/overview').then(r => r.json()),
      fetch('/api/footage/list').then(r => r.json()),
    ])
    if (ov.employees) setOverview(ov)
    setFootage({ pending: ft.pending || [], completed: ft.completed || [] })
  }, [])

  const loadProgress = useCallback(async () => {
    const data = await fetch('/api/admin/employee-progress').then(r => r.json())
    if (data.progress) setProgress(data)
  }, [])

  useEffect(() => {
    const id = setInterval(() => { loadData(); loadProgress() }, 60000)
    return () => clearInterval(id)
  }, [loadData, loadProgress])

  function downloadCSV(rows, filename) {
    const csv  = rows.map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  function matchDateFlexible(raisedAtStr, isoDate) {
    if (!isoDate) return true
    const [y, m, d] = isoDate.split('-')
    const ddmmyyyy = `${d}/${m}/${y}`
    return (raisedAtStr || '').includes(ddmmyyyy)
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

  if (loading || !overview) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}>
      <div className="spinner"></div>
    </div>
  )

  const { employees, kpis, redistribution } = overview

  const statusColor = (s) => ({
    'Active':      '#22c55e',
    'Ended':       '#6b7280',
    'Week Off':    '#f59e0b',
    'Not Started': '#ef4444',
    'Off Shift':   '#374151',
  }[s] || '#6b7280')

  return (
    <>
      <Head><title>Cautio CRM — Admin</title></Head>
      <div style={{minHeight:'100vh', background:'#0a0a0a'}}>
        <Navbar user={user} />
        <div style={s.body}>

          <div style={s.tabs}>
            {['overview','progress','footage','redistribution'].map(t => (
              <button key={t} style={activeTab===t ? {...s.tab,...s.tabActive} : s.tab} onClick={() => setActiveTab(t)}>
                {t === 'overview'        ? 'Employee Overview' :
                 t === 'progress'        ? 'Employee Progress' :
                 t === 'footage'         ? `Footage Requests (${footage.pending.length} pending)` :
                                           `Redistribution Log (${redistribution.length})`}
              </button>
            ))}
          </div>

          {/* ══════════ OVERVIEW TAB ══════════ */}
          {activeTab === 'overview' && (
            <>
              <div style={s.kpiGrid}>
                {[
                  { label:'TOTAL', val: kpis.total, color:'#22c55e' },
                  { label:'ACTIVE', val: kpis.active, color:'#22c55e' },
                  { label:'WEEK OFF', val: kpis.weekOff, color:'#f59e0b' },
                  { label:'NOT STARTED', val: kpis.notStarted, color:'#ef4444' },
                  { label:'FOOTAGE PENDING', val: footage.pending.length, color:'#3b82f6' },
                ].map(k => (
                  <div key={k.label} style={s.kpi}>
                    <div style={{...s.kpiNum, color: k.color}}>{k.val}</div>
                    <div style={s.kpiLbl}>{k.label}</div>
                  </div>
                ))}
              </div>

              <div style={s.sectionHd}>EMPLOYEE STATUS — LIVE
                <span style={{color:'#374151',fontWeight:'400',letterSpacing:'0',fontSize:'11px',marginLeft:'8px'}}>Auto-refreshes every 60s</span>
              </div>

              <div style={s.empGrid}>
                {employees.map(emp => (
                  <div key={emp.name} style={{
                    ...s.empCard,
                    ...(emp.statusLabel === 'Not Started' ? s.empCardAbsent : {}),
                    ...(emp.isWeekOff ? s.empCardWeekOff : {}),
                  }}>
                    <div style={s.empTop}>
                      <div style={{...s.empAva, background: emp.isNight ? '#7c3aed' : emp.isWeekOff ? '#92400e' : '#16a34a'}}>
                        {emp.name.slice(0,2).toUpperCase()}
                      </div>
                      <div style={{flex:1, minWidth:0}}>
                        <div style={{color: emp.statusLabel==='Not Started' ? '#f87171' : '#fff', fontSize:'13px', fontWeight:'600', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{emp.name}</div>
                        <div style={{color:'#6b7280', fontSize:'10px'}}>
                          {emp.isNight ? 'Night' : 'Day'} {emp.shiftStart}:00–{emp.shiftEnd}:00
                          {emp.startTime && ` · Started ${emp.startTime}`}
                        </div>
                      </div>
                      <div style={{...s.statusDot, background: statusColor(emp.statusLabel), flexShrink:0}}></div>
                    </div>

                    {(emp.statusLabel === 'Active' || emp.statusLabel === 'Ended') ? (
                      <div style={s.empStats}>
                        <div style={s.empStat}><div style={{color:'#22c55e',fontSize:'16px',fontWeight:'700'}}>{emp.totalUpdates}</div><div style={{color:'#6b7280',fontSize:'9px'}}>Updates</div></div>
                        <div style={s.empStat}><div style={{color: emp.pendingCount>0 ? '#f59e0b' : '#22c55e', fontSize:'16px', fontWeight:'700'}}>{emp.pendingCount}</div><div style={{color:'#6b7280',fontSize:'9px'}}>Pending</div></div>
                        <div style={s.empStat}><div style={{color:'#6b7280',fontSize:'13px',fontWeight:'600'}}>{emp.duration || '—'}</div><div style={{color:'#6b7280',fontSize:'9px'}}>Duration</div></div>
                      </div>
                    ) : emp.isWeekOff ? (
                      <div style={{background:'#1a1200',borderRadius:'6px',padding:'8px',textAlign:'center',color:'#fbbf24',fontSize:'11px',marginTop:'8px'}}>Week off — no clients assigned</div>
                    ) : emp.statusLabel === 'Not Started' ? (
                      <div style={{background:'#200808',border:'1px solid #3a1515',borderRadius:'6px',padding:'8px',textAlign:'center',color:'#f87171',fontSize:'11px',marginTop:'8px'}}>Has not started shift</div>
                    ) : (
                      <div style={{background:'#161616',borderRadius:'6px',padding:'8px',textAlign:'center',color:'#374151',fontSize:'11px',marginTop:'8px'}}>Off shift hours</div>
                    )}

                    <div style={{...s.statusBadge, color: statusColor(emp.statusLabel), borderColor: statusColor(emp.statusLabel)+'33', background: statusColor(emp.statusLabel)+'11'}}>{emp.statusLabel}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ══════════ EMPLOYEE PROGRESS TAB ══════════ */}
          {activeTab === 'progress' && (
            <div>
              <div style={s.sectionHd}>
                EMPLOYEE PROGRESS — LAST 7 DAYS
                <span style={{color:'#374151',fontWeight:'400',letterSpacing:'0',fontSize:'11px',marginLeft:'8px'}}>Attendance, work output, footage</span>
              </div>

              {!progress ? (
                <div style={{display:'flex',justifyContent:'center',padding:'3rem'}}><div className="spinner"></div></div>
              ) : (
                <div style={s.progressGrid}>
                  {progress.progress.map(emp => (
                    <div key={emp.name} style={s.progCard}>
                      <div style={s.progHeader}>
                        <div style={{...s.empAva, background: emp.isNight ? '#7c3aed' : '#16a34a'}}>{emp.name.slice(0,2).toUpperCase()}</div>
                        <div style={{flex:1}}>
                          <div style={{color:'#fff', fontSize:'14px', fontWeight:'700'}}>{emp.name}</div>
                          <div style={{color:'#6b7280', fontSize:'10px'}}>{emp.isNight ? 'Night' : 'Day'} {emp.shiftStart}:00–{emp.shiftEnd}:00</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{color:'#22c55e', fontSize:'16px', fontWeight:'700'}}>{emp.daysPresent}/7</div>
                          <div style={{color:'#6b7280', fontSize:'9px'}}>days present</div>
                        </div>
                      </div>

                      <div style={s.attendanceStrip}>
                        {emp.attendance.slice().reverse().map((a, i) => (
                          <div key={i} style={s.attendanceDay} title={`${a.date}: ${a.status}${a.startTime ? ' · ' + a.startTime : ''}${a.endTime ? ' → ' + a.endTime : ''}`}>
                            <div style={{
                              ...s.attendanceDot,
                              background: a.status === 'active' ? '#22c55e' : a.status === 'completed' ? '#3b82f6' : '#ef4444',
                            }}></div>
                            <div style={s.attendanceDate}>{a.date.split('/')[0]}/{a.date.split('/')[1]}</div>
                          </div>
                        ))}
                      </div>

                      <div style={s.progStatsGrid}>
                        <div style={s.progStat}><div style={{color:'#22c55e',fontSize:'15px',fontWeight:'700'}}>{emp.todayClientsCount}</div><div style={{color:'#6b7280',fontSize:'8px'}}>CLIENTS TODAY</div></div>
                        <div style={s.progStat}><div style={{color:'#a78bfa',fontSize:'15px',fontWeight:'700'}}>{emp.todayUpdatesCount}</div><div style={{color:'#6b7280',fontSize:'8px'}}>UPDATES</div></div>
                        <div style={s.progStat}><div style={{color:'#f59e0b',fontSize:'15px',fontWeight:'700'}}>{emp.todayMisaligns}</div><div style={{color:'#6b7280',fontSize:'8px'}}>MISALIGNS</div></div>
                        <div style={s.progStat}><div style={{color:'#f87171',fontSize:'15px',fontWeight:'700'}}>{emp.todayAlerts}</div><div style={{color:'#6b7280',fontSize:'8px'}}>ALERTS</div></div>
                      </div>
                      <div style={s.progStatsGrid}>
                        <div style={s.progStat}><div style={{color:'#22c55e',fontSize:'15px',fontWeight:'700'}}>{emp.footageCompletedToday}</div><div style={{color:'#6b7280',fontSize:'8px'}}>FOOTAGE DONE TODAY</div></div>
                        <div style={s.progStat}><div style={{color:'#f59e0b',fontSize:'15px',fontWeight:'700'}}>{emp.footagePending}</div><div style={{color:'#6b7280',fontSize:'8px'}}>FOOTAGE PENDING</div></div>
                        <div style={s.progStat}><div style={{color: emp.daysAbsent > 0 ? '#f87171' : '#22c55e',fontSize:'15px',fontWeight:'700'}}>{emp.daysAbsent}</div><div style={{color:'#6b7280',fontSize:'8px'}}>DAYS MISSED</div></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ══════════ FOOTAGE TAB ══════════ */}
          {activeTab === 'footage' && (
            <div style={{maxWidth:'1000px'}}>
              <div style={{display:'flex',gap:'10px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
                <div style={s.footSumCard}><span style={{color:'#f59e0b',fontSize:'22px',fontWeight:'700'}}>{filteredPending.length}</span><span style={{color:'#6b7280',fontSize:'10px'}}>PENDING</span></div>
                <div style={s.footSumCard}><span style={{color:'#22c55e',fontSize:'22px',fontWeight:'700'}}>{filteredCompleted.length}</span><span style={{color:'#6b7280',fontSize:'10px'}}>COMPLETED</span></div>
                <div style={{flex:1, minWidth:'220px'}}>
                  <input style={s.searchInp} placeholder="🔍 Search vehicle no., issue ID, client, employee..." value={footageSearchInput} onChange={e => setFootageSearchInput(e.target.value)} />
                </div>
                <input type="date" style={s.dateInp} value={dateFilter} onChange={e => setDateFilter(e.target.value)} title="Filter by Raised date" />
                {dateFilter && <button style={s.clearBtn} onClick={() => setDateFilter('')}>✕ Clear</button>}
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                  <button onClick={() => downloadCSV(
                    [['Issue ID','Client','Vehicle','Raised At','Details','Raised By','Location'], ...filteredPending.map(i => [i.issueId, i.client, i.vehicle, i.raisedAt, i.details, i.raisedBy, i.location])],
                    `Footage_Pending_${dateFilter || 'all'}.csv`
                  )} style={s.dlBtn}>⬇ Pending CSV</button>
                  <button onClick={() => downloadCSV(
                    [['Issue ID','Client','Vehicle','Raised At','Details','Raised By','Resolved','Resolved At','Location'], ...[...filteredPending, ...filteredCompleted].map(i => [i.issueId, i.client, i.vehicle, i.raisedAt, i.details, i.raisedBy, i.resolved?'Yes':'No', i.resolvedAt, i.location])],
                    `Footage_All_${dateFilter || 'all'}.csv`
                  )} style={s.dlBtn}>⬇ All CSV</button>
                </div>
              </div>

              {filteredPending.length === 0 && filteredCompleted.length === 0 && (
                <div style={{color:'#6b7280',textAlign:'center',padding:'3rem'}}>No footage requests found{dateFilter || footageSearch ? ' for this filter' : ''}.</div>
              )}

              {filteredPending.length > 0 && (
                <>
                  <div style={s.sectionHd}>PENDING ({filteredPending.length})</div>
                  {filteredPending.map(item => (
                    <div key={item.issueId} style={s.footCard}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
                        <div style={{flex:1, minWidth:'200px'}}>
                          <div style={{color:'#fff',fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}><span style={{color:'#60a5fa',marginRight:'6px'}}>▶</span>{item.client} · <span style={{color:'#22c55e'}}>{item.vehicle}</span></div>
                          <div style={{color:'#6b7280',fontSize:'11px',lineHeight:'1.6'}}>
                            <span style={{color:'#9ca3af'}}>ID:</span> {item.issueId} &nbsp;·&nbsp;
                            <span style={{color:'#9ca3af'}}>Raised:</span> {item.raisedAt} &nbsp;·&nbsp;
                            <span style={{color:'#9ca3af'}}>By:</span> {item.raisedBy}
                            {item.location && <> &nbsp;·&nbsp; <span style={{color:'#9ca3af'}}>Loc:</span> {item.location}</>}
                          </div>
                          {item.details && <div style={{color:'#9ca3af',fontSize:'11px',marginTop:'4px',fontStyle:'italic'}}>{item.details}</div>}
                        </div>
                        <span className="badge badge-amber">PENDING</span>
                      </div>
                    </div>
                  ))}
                </>
              )}

              {filteredCompleted.length > 0 && (
                <>
                  <div style={{...s.sectionHd, marginTop:'20px'}}>COMPLETED ({filteredCompleted.length})</div>
                  {filteredCompleted.map(item => (
                    <div key={item.issueId} style={{...s.footCard, opacity:0.6}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
                        <div style={{flex:1, minWidth:'200px'}}>
                          <div style={{color:'#fff',fontSize:'13px',fontWeight:'600',marginBottom:'4px'}}><span style={{color:'#22c55e',marginRight:'6px'}}>✓</span>{item.client} · <span style={{color:'#22c55e'}}>{item.vehicle}</span></div>
                          <div style={{color:'#6b7280',fontSize:'11px'}}>
                            <span style={{color:'#9ca3af'}}>ID:</span> {item.issueId} &nbsp;·&nbsp;
                            <span style={{color:'#9ca3af'}}>By:</span> {item.raisedBy} &nbsp;·&nbsp;
                            <span style={{color:'#9ca3af'}}>Done:</span> {item.resolvedAt}
                          </div>
                        </div>
                        <span className="badge badge-green">DONE</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* ══════════ REDISTRIBUTION TAB ══════════ */}
          {activeTab === 'redistribution' && (
            <div style={{maxWidth:'900px'}}>
              <div style={s.sectionHd}>TODAY'S REDISTRIBUTION LOG</div>
              {redistribution.length === 0 ? (
                <div style={{color:'#6b7280',textAlign:'center',padding:'3rem'}}>No redistributions today.</div>
              ) : (
                <table style={s.table}>
                  <thead>
                    <tr style={{background:'#161616'}}>
                      {['From Employee','To Employee','Client','Hour','Reason'].map(h => <th key={h} style={s.tableHd}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {redistribution.map((r, i) => (
                      <tr key={i} style={{borderBottom:'1px solid #1a1a1a'}}>
                        <td style={{...s.tableTd, color:'#f87171'}}>{r.from}</td>
                        <td style={{...s.tableTd, color:'#22c55e'}}>{r.to}</td>
                        <td style={s.tableTd}>{r.client}</td>
                        <td style={s.tableTd}>{r.hour}:00</td>
                        <td style={{...s.tableTd, color:'#6b7280'}}>Auto - Early End</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

        </div>
      </div>
    </>
  )
}

const s = {
  body: { padding:'20px', maxWidth:'1400px', margin:'0 auto' },
  tabs: { display:'flex', gap:'4px', borderBottom:'1px solid #222', marginBottom:'20px', overflowX:'auto' },
  tab: { background:'transparent', border:'none', borderBottom:'2px solid transparent', color:'#6b7280', padding:'10px 16px', fontSize:'13px', cursor:'pointer', marginBottom:'-1px', whiteSpace:'nowrap' },
  tabActive: { color:'#22c55e', borderBottomColor:'#22c55e', fontWeight:'600' },
  kpiGrid: { display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'10px', marginBottom:'20px' },
  kpi: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'14px', textAlign:'center' },
  kpiNum: { fontSize:'24px', fontWeight:'700' },
  kpiLbl: { color:'#6b7280', fontSize:'9px', letterSpacing:'0.5px', marginTop:'4px' },
  sectionHd: { color:'#22c55e', fontSize:'10px', letterSpacing:'1.5px', fontWeight:'600', marginBottom:'12px', display:'flex', alignItems:'center' },
  empGrid: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'10px', marginBottom:'20px' },
  empCard: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px' },
  empCardAbsent: { borderColor:'#3a1515', background:'#120808' },
  empCardWeekOff: { borderColor:'#3a2a00', background:'#14100a' },
  empTop: { display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' },
  empAva: { width:'30px', height:'30px', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'10px', fontWeight:'700', color:'#fff', flexShrink:0 },
  statusDot: { width:'8px', height:'8px', borderRadius:'50%' },
  empStats: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'6px', marginBottom:'8px' },
  empStat: { background:'#161616', borderRadius:'6px', padding:'6px', textAlign:'center' },
  statusBadge: { display:'inline-block', borderRadius:'4px', padding:'2px 8px', fontSize:'9px', fontWeight:'700', border:'1px solid', marginTop:'6px', letterSpacing:'0.5px' },
  footCard: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'14px', marginBottom:'8px' },
  footSumCard: { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 20px', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px', minWidth:'90px' },
  searchInp: { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', fontSize:'13px', padding:'10px 14px', boxSizing:'border-box' },
  dateInp: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', fontSize:'13px', padding:'9px 10px', boxSizing:'border-box' },
  clearBtn: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#6b7280', fontSize:'11px', padding:'9px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  dlBtn: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#6b7280', fontSize:'11px', padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  table: { width:'100%', borderCollapse:'collapse', background:'#111', borderRadius:'10px', overflow:'hidden', border:'1px solid #222' },
  tableHd: { color:'#6b7280', fontSize:'10px', letterSpacing:'0.5px', padding:'10px 14px', textAlign:'left', fontWeight:'600' },
  tableTd: { color:'#fff', fontSize:'12px', padding:'10px 14px' },
  progressGrid: { display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:'12px' },
  progCard: { background:'#111', border:'1px solid #222', borderRadius:'12px', padding:'16px' },
  progHeader: { display:'flex', alignItems:'center', gap:'10px', marginBottom:'14px' },
  attendanceStrip: { display:'flex', gap:'4px', marginBottom:'14px', justifyContent:'space-between' },
  attendanceDay: { display:'flex', flexDirection:'column', alignItems:'center', gap:'3px', flex:1 },
  attendanceDot: { width:'18px', height:'18px', borderRadius:'5px' },
  attendanceDate: { color:'#6b7280', fontSize:'8px' },
  progStatsGrid: { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'6px', marginBottom:'6px' },
  progStat: { background:'#161616', borderRadius:'6px', padding:'7px', textAlign:'center' },
}
