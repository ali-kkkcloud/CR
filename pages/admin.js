import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Navbar from '../components/Navbar'

export default function Admin() {
  const router = useRouter()
  const [user, setUser] = useState(null)
  const [overview, setOverview] = useState(null)
  const [footage, setFootage] = useState({ pending: [], completed: [] })
  const [activeTab, setActiveTab] = useState('overview')
  const [footageSearch, setFootageSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user || d.user.role !== 'admin') { router.replace('/login'); return }
      setUser(d.user)
      loadData()
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

  useEffect(() => {
    const id = setInterval(loadData, 60000)
    return () => clearInterval(id)
  }, [loadData])

  function downloadFootageCSV() {
    const all = [...(footage.pending || []), ...(footage.completed || [])]
    const rows = [
      ['Issue ID','Client','Vehicle','Raised At','Details','Raised By','Resolved','Resolved At','Location'],
      ...all.map(i => [i.issueId, i.client, i.vehicle, i.raisedAt, i.details, i.raisedBy, i.resolved?'Yes':'No', i.resolvedAt, i.location])
    ]
    const csv  = rows.map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `Footage_All_${new Date().toLocaleDateString('en-IN').replace(/\//g,'-')}.csv`
    a.click()
  }

  function downloadPendingCSV() {
    const rows = [
      ['Issue ID','Client','Vehicle','Raised At','Details','Raised By','Location'],
      ...(footage.pending || []).map(i => [i.issueId, i.client, i.vehicle, i.raisedAt, i.details, i.raisedBy, i.location])
    ]
    const csv  = rows.map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `Footage_Pending_${new Date().toLocaleDateString('en-IN').replace(/\//g,'-')}.csv`
    a.click()
  }

  const filterFootage = (list) => {
    if (!footageSearch.trim()) return list
    const q = footageSearch.trim().toLowerCase()
    return list.filter(item =>
      (item.vehicle  || '').toLowerCase().includes(q) ||
      (item.issueId  || '').toString().toLowerCase().includes(q) ||
      (item.client   || '').toLowerCase().includes(q) ||
      (item.raisedBy || '').toLowerCase().includes(q)
    )
  }

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
            {['overview','footage','redistribution'].map(t => (
              <button key={t} style={activeTab===t ? {...s.tab,...s.tabActive} : s.tab} onClick={() => setActiveTab(t)}>
                {t === 'overview' ? 'Employee Overview' :
                 t === 'footage'  ? `Footage Requests (${footage.pending.length} pending)` :
                                    `Redistribution Log (${redistribution.length})`}
              </button>
            ))}
          </div>

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

          {activeTab === 'footage' && (
            <div style={{maxWidth:'900px'}}>
              <div style={{display:'flex',gap:'10px',marginBottom:'16px',flexWrap:'wrap',alignItems:'center'}}>
                <div style={s.footSumCard}><span style={{color:'#f59e0b',fontSize:'22px',fontWeight:'700'}}>{footage.pending.length}</span><span style={{color:'#6b7280',fontSize:'10px'}}>PENDING</span></div>
                <div style={s.footSumCard}><span style={{color:'#22c55e',fontSize:'22px',fontWeight:'700'}}>{footage.completed.length}</span><span style={{color:'#6b7280',fontSize:'10px'}}>COMPLETED</span></div>
                <div style={{flex:1, minWidth:'220px'}}>
                  <input style={s.searchInp} placeholder="🔍 Search vehicle no., issue ID, client, employee..." value={footageSearch} onChange={e => setFootageSearch(e.target.value)} />
                </div>
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
                  <button onClick={downloadPendingCSV} style={s.dlBtn}>⬇ Pending CSV</button>
                  <button onClick={downloadFootageCSV} style={s.dlBtn}>⬇ All CSV</button>
                </div>
              </div>

              {footage.pending.length === 0 && footage.completed.length === 0 && (
                <div style={{color:'#6b7280',textAlign:'center',padding:'3rem'}}>No footage requests found.</div>
              )}

              {filterFootage(footage.pending).length > 0 && (
                <>
                  <div style={s.sectionHd}>PENDING ({filterFootage(footage.pending).length})</div>
                  {filterFootage(footage.pending).map(item => (
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

              {filterFootage(footage.completed).length > 0 && (
                <>
                  <div style={{...s.sectionHd, marginTop:'20px'}}>COMPLETED ({filterFootage(footage.completed).length})</div>
                  {filterFootage(footage.completed).map(item => (
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
  dlBtn: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#6b7280', fontSize:'11px', padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  table: { width:'100%', borderCollapse:'collapse', background:'#111', borderRadius:'10px', overflow:'hidden', border:'1px solid #222' },
  tableHd: { color:'#6b7280', fontSize:'10px', letterSpacing:'0.5px', padding:'10px 14px', textAlign:'left', fontWeight:'600' },
  tableTd: { color:'#fff', fontSize:'12px', padding:'10px 14px' },
}
