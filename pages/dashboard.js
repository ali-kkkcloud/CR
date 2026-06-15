import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'
import Navbar from '../components/Navbar'

const STATUS_OPTIONS  = ['', 'Updated', 'No New Misalignment', 'All Vehicles are Offline', 'No Misalignment']
const FATIGUE_OPTIONS = ['No', 'Yes']

export default function Dashboard() {
  const router = useRouter()
  const [user,         setUser]         = useState(null)
  const [shiftStatus,  setShiftStatus]  = useState('not_started')
  const [startTime,    setStartTime]    = useState('')
  const [currentHour,  setCurrentHour]  = useState(new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getHours())
  const [clients,      setClients]      = useState([])
  const [filled,       setFilled]       = useState({})
  const [footage,      setFootage]      = useState({ pending: [], completed: [] })
  const [activeTab,    setActiveTab]    = useState('clients')
  const [saving,       setSaving]       = useState({})
  const [loading,      setLoading]      = useState(true)
  const [showReport,   setShowReport]   = useState(false)
  const [report,       setReport]       = useState(null)
  const hourRef  = useRef(currentHour)
  const autoRef  = useRef(null)

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => {
      if (!d.user) { router.replace('/login'); return }
      setUser(d.user)
      setLoading(false)
    }).catch(() => router.replace('/login'))
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
    setFootage({ pending: data.pending || [], completed: data.completed || [] })
  }, [])

  useEffect(() => {
    if (shiftStatus !== 'active') return
    loadClients()
    loadFootage()

    autoRef.current = setInterval(() => {
      const h = new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Kolkata'})).getHours()
      if (h !== hourRef.current) loadClients()
      loadFootage()
    }, 60000)

    return () => clearInterval(autoRef.current)
  }, [shiftStatus])

  async function handleStartShift() {
    const res  = await fetch('/api/shift/start', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setShiftStatus('active')
      setStartTime(data.startTime)
      loadClients()
      loadFootage()
    }
  }

  async function handleEndShift() {
    if (!confirm('Are you sure you want to end your shift?')) return
    const res  = await fetch('/api/shift/end', { method: 'POST' })
    const data = await res.json()
    if (data.success) {
      setShiftStatus('ended')
      setReport(data.report)
      setShowReport(true)
      clearInterval(autoRef.current)
    }
  }

  async function saveUpdate(client, field, value) {
    const key = `${client}_${field}`
    setSaving(p => ({...p, [key]: true}))

    const current = filled[client] || {}
    const updated = { ...current, [field]: value }
    setFilled(p => ({ ...p, [client]: updated }))

    await fetch('/api/crm/update', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client,
        slot: currentHour,
        ...updated,
      }),
    })

    setSaving(p => { const n = {...p}; delete n[key]; return n })
  }

  async function markFootageComplete(rowIndex) {
    await fetch('/api/footage/complete', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex }),
    })
    loadFootage()
  }

  function downloadReport() {
    if (!report) return
    const rows = [
      ['Cautio CRM — Shift Report'],
      ['Employee', report.employee],
      ['Date',     report.date],
      ['Shift Start', report.shiftStart],
      ['Shift End',   report.shiftEnd],
      ['Duration',    report.duration],
      [],
      ['Clients Handled', report.clientsHandled],
      ['Total Updates',   report.totalUpdates],
      ['Misalignments',   report.misalignCount],
      ['Total Alerts',    report.alertTotal],
      ['Fatigue Alerts',  report.fatigueCount],
      ['Clients Redistributed', report.redistributed],
      [],
      ['--- Detail ---'],
      ['Client', 'Slot', 'Status', 'Misalign Vehicles', 'Alerts', 'Fatigue'],
      ...(report.updates || []).map(r => [r[3], r[4], r[5], r[6], r[7], r[8]]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `CRM_Report_${report.employee}_${report.date}.csv`
    a.click()
  }

  const hourLabel = (h) => {
    const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
    const suf  = (n) => n >= 12 ? 'PM' : 'AM'
    return `${to12(h)}:00 ${suf(h)} – ${to12((h+1)%24)}:00 ${suf((h+1)%24)}`
  }

  if (loading) return <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}><div className="spinner"></div></div>

  return (
    <>
      <Head><title>Cautio CRM — Dashboard</title></Head>
      <div style={{minHeight:'100vh', background:'#0a0a0a'}}>
        <Navbar user={user} shiftStatus={shiftStatus} onEndShift={handleEndShift} />

        <div style={s.body}>

          {shiftStatus === 'not_started' && (
            <div style={s.startWrap}>
              <div style={s.startCard}>
                <div style={s.startIcon}>
                  <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <path d="M24 4L6 12v14c0 14 8 22 18 24C34 48 42 40 42 26V12L24 4z" fill="#22c55e" opacity="0.12"/>
                    <path d="M24 4L6 12v14c0 14 8 22 18 24C34 48 42 40 42 26V12L24 4z" fill="none" stroke="#22c55e" strokeWidth="2"/>
                  </svg>
                </div>
                <h2 style={{color:'#fff',fontSize:'22px',fontWeight:'700',marginBottom:'8px'}}>
                  Good {new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, {user?.name}
                </h2>
                <p style={{color:'#6b7280',fontSize:'14px',marginBottom:'2rem',textAlign:'center'}}>
                  Click Start Shift to begin. Clients will auto-load based on current time.
                </p>
                <div style={s.currentHourBanner}>
                  <span style={{color:'#22c55e',fontWeight:'600'}}>Current slot:</span>
                  <span style={{color:'#fff',marginLeft:'8px'}}>{hourLabel(currentHour)}</span>
                </div>
                <button onClick={handleStartShift} style={s.bigStartBtn}>
                  ▶ Start Shift
                </button>
              </div>
            </div>
          )}

          {shiftStatus === 'active' && (
            <>
              <div style={s.headerRow}>
                <div>
                  <div style={s.greeting}>
                    {user?.name}
                    <span style={s.startedAt}>Started at {startTime}</span>
                  </div>
                  <div style={s.slotLabel}>
                    <span className="live-dot" style={{width:7,height:7,marginRight:6}}></span>
                    Current Slot: <strong style={{color:'#fff',marginLeft:4}}>{hourLabel(currentHour)}</strong>
                    <span style={{color:'#374151',margin:'0 8px'}}>·</span>
                    <span style={{color:'#6b7280'}}>{clients.length} clients</span>
                  </div>
                </div>
              </div>

              <div style={s.tabs}>
                <button
                  style={activeTab==='clients' ? {...s.tab,...s.tabActive} : s.tab}
                  onClick={() => setActiveTab('clients')}
                >
                  Clients
                  <span style={s.tabCount}>{clients.length}</span>
                </button>
                <button
                  style={activeTab==='footage' ? {...s.tab,...s.tabActive} : s.tab}
                  onClick={() => setActiveTab('footage')}
                >
                  Footage Requests
                  {footage.pending.length > 0 && (
                    <span style={{...s.tabCount, background:'#ef444422', color:'#f87171', border:'1px solid #ef444433'}}>
                      {footage.pending.length}
                    </span>
                  )}
                </button>
              </div>

              {activeTab === 'clients' && (
                <div style={s.tableWrap}>
                  {clients.length === 0 ? (
                    <div style={s.emptyMsg}>No clients assigned for this slot.</div>
                  ) : (
                    <>
                      <div style={s.tHead}>
                        <div style={{...s.th, flex:2}}>CLIENT</div>
                        <div style={{...s.th, flex:1.2}}>STATUS</div>
                        <div style={{...s.th, flex:1.5}}>MISALIGN VEHICLES</div>
                        <div style={{...s.th, flex:0.8}}>ALERTS</div>
                        <div style={{...s.th, flex:0.8}}>FATIGUE</div>
                        <div style={{...s.th, flex:0.6, textAlign:'center'}}>SAVE</div>
                      </div>

                      {clients.map(({ client, isRedistributed, fromEmployee }) => {
                        const f   = filled[client] || {}
                        const key = (field) => `${client}_${field}`
                        return (
                          <div key={client} style={{
                            ...s.tRow,
                            ...(isRedistributed ? s.redistributedRow : {})
                          }}>
                            <div style={{...s.td, flex:2}}>
                              <div style={s.clientName}>{client}</div>
                              {isRedistributed && (
                                <div style={s.redistTag}>↩ from {fromEmployee}</div>
                              )}
                            </div>
                            <div style={{...s.td, flex:1.2}}>
                              <select
                                style={s.sel}
                                value={f.status || ''}
                                onChange={e => saveUpdate(client, 'status', e.target.value)}
                              >
                                {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o || '— select —'}</option>)}
                              </select>
                            </div>
                            <div style={{...s.td, flex:1.5}}>
                              <input
                                style={s.inp}
                                placeholder="VH1234, VH5678"
                                value={f.misalignVehicles || ''}
                                onChange={e => saveUpdate(client, 'misalignVehicles', e.target.value)}
                              />
                            </div>
                            <div style={{...s.td, flex:0.8}}>
                              <input
                                style={{...s.inp, textAlign:'center'}}
                                type="number"
                                min="0"
                                placeholder="0"
                                value={f.alertCount || ''}
                                onChange={e => saveUpdate(client, 'alertCount', e.target.value)}
                              />
                            </div>
                            <div style={{...s.td, flex:0.8}}>
                              <select
                                style={s.sel}
                                value={f.fatigue || 'No'}
                                onChange={e => saveUpdate(client, 'fatigue', e.target.value)}
                              >
                                {FATIGUE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                              </select>
                            </div>
                            <div style={{...s.td, flex:0.6, justifyContent:'center'}}>
                              {saving[key('status')] || saving[key('alertCount')] ? (
                                <span className="spinner" style={{width:14,height:14,borderWidth:2}}></span>
                              ) : (
                                <span style={{color:'#22c55e',fontSize:'16px'}}>✓</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </>
                  )}
                </div>
              )}

              {activeTab === 'footage' && (
                <div style={s.footageWrap}>
                  <div style={s.footSummary}>
                    <div style={s.footStat}>
                      <span style={{color:'#f59e0b',fontSize:'22px',fontWeight:'700'}}>{footage.pending.length}</span>
                      <span style={{color:'#6b7280',fontSize:'10px',letterSpacing:'0.5px'}}>PENDING</span>
                    </div>
                    <div style={s.footStat}>
                      <span style={{color:'#22c55e',fontSize:'22px',fontWeight:'700'}}>{footage.completed.length}</span>
                      <span style={{color:'#6b7280',fontSize:'10px',letterSpacing:'0.5px'}}>COMPLETED</span>
                    </div>
                  </div>

                  {footage.pending.length === 0 && footage.completed.length === 0 && (
                    <div style={s.emptyMsg}>No footage requests assigned to you.</div>
                  )}

                  {footage.pending.map(item => (
                    <div key={item.issueId} style={s.footCard}>
                      <div style={s.footTop}>
                        <div>
                          <div style={s.footClient}>
                            <span style={{color:'#60a5fa',marginRight:'6px'}}>▶</span>
                            {item.client} · {item.vehicle}
                          </div>
                          <div style={s.footMeta}>
                            Issue ID: {item.issueId} &nbsp;·&nbsp;
                            Raised: {item.raisedAt} &nbsp;·&nbsp;
                            {item.location && `Location: ${item.location}`}
                          </div>
                          {item.details && (
                            <div style={s.footDetails}>{item.details}</div>
                          )}
                        </div>
                        <span className="badge badge-amber">PENDING</span>
                      </div>
                      <div style={s.footActions}>
                        <button
                          onClick={() => markFootageComplete(item.rowIndex)}
                          style={s.completeBtn}
                        >
                          ✓ Mark Complete
                        </button>
                      </div>
                    </div>
                  ))}

                  {footage.completed.length > 0 && (
                    <>
                      <div style={{color:'#374151',fontSize:'10px',letterSpacing:'1px',margin:'16px 0 8px',fontWeight:'600'}}>
                        COMPLETED TODAY
                      </div>
                      {footage.completed.map(item => (
                        <div key={item.issueId} style={{...s.footCard, opacity:0.6}}>
                          <div style={s.footTop}>
                            <div>
                              <div style={s.footClient}>
                                <span style={{color:'#22c55e',marginRight:'6px'}}>✓</span>
                                {item.client} · {item.vehicle}
                              </div>
                              <div style={s.footMeta}>
                                Completed: {item.resolvedAt} &nbsp;·&nbsp; Issue: {item.issueId}
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
            </>
          )}

          {shiftStatus === 'ended' && showReport && report && (
            <div style={s.reportWrap}>
              <div style={s.reportCard}>
                <div style={{color:'#22c55e',fontSize:'32px',textAlign:'center',marginBottom:'8px'}}>✓</div>
                <h2 style={{color:'#fff',textAlign:'center',marginBottom:'4px'}}>Shift Complete</h2>
                <p style={{color:'#6b7280',textAlign:'center',fontSize:'13px',marginBottom:'2rem'}}>
                  {report.date} · {report.shiftStart} → {report.shiftEnd} · {report.duration}
                </p>

                <div style={s.reportGrid}>
                  <div style={s.repStat}><span style={{color:'#22c55e',fontSize:'24px',fontWeight:'700'}}>{report.clientsHandled}</span><span style={{color:'#6b7280',fontSize:'10px'}}>CLIENTS</span></div>
                  <div style={s.repStat}><span style={{color:'#22c55e',fontSize:'24px',fontWeight:'700'}}>{report.totalUpdates}</span><span style={{color:'#6b7280',fontSize:'10px'}}>UPDATES</span></div>
                  <div style={s.repStat}><span style={{color:'#f59e0b',fontSize:'24px',fontWeight:'700'}}>{report.misalignCount}</span><span style={{color:'#6b7280',fontSize:'10px'}}>MISALIGNS</span></div>
                  <div style={s.repStat}><span style={{color:'#f87171',fontSize:'24px',fontWeight:'700'}}>{report.alertTotal}</span><span style={{color:'#6b7280',fontSize:'10px'}}>ALERTS</span></div>
                </div>

                {report.redistributed > 0 && (
                  <div style={s.redistInfo}>
                    ↩ {report.redistributed} clients redistributed to: {[...new Set(report.redistributedTo)].join(', ')}
                  </div>
                )}

                <button onClick={downloadReport} style={s.downloadBtn}>
                  ⬇ Download CSV Report
                </button>
                <button onClick={() => { fetch('/api/auth/logout',{method:'POST'}); router.push('/login') }} style={s.logoutFinalBtn}>
                  Logout
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}

const s = {
  body:         { padding: '20px', maxWidth: '1400px', margin: '0 auto' },
  startWrap:    { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'80vh' },
  startCard:    { background:'#111', border:'1px solid #222', borderRadius:'16px', padding:'3rem 2rem', maxWidth:'420px', width:'100%', textAlign:'center' },
  startIcon:    { display:'flex', justifyContent:'center', marginBottom:'1.5rem' },
  currentHourBanner: { background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', padding:'10px 16px', marginBottom:'1.5rem', fontSize:'13px' },
  bigStartBtn:  { width:'100%', background:'#22c55e', border:'none', borderRadius:'10px', color:'#000', fontWeight:'700', fontSize:'16px', padding:'14px', cursor:'pointer' },
  headerRow:    { display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'16px' },
  greeting:     { color:'#fff', fontSize:'18px', fontWeight:'700', display:'flex', alignItems:'center', gap:'12px' },
  startedAt:    { color:'#6b7280', fontSize:'12px', fontWeight:'400' },
  slotLabel:    { color:'#6b7280', fontSize:'13px', marginTop:'4px', display:'flex', alignItems:'center' },
  tabs:         { display:'flex', gap:'4px', borderBottom:'1px solid #222', marginBottom:'16px' },
  tab:          { background:'transparent', border:'none', borderBottom:'2px solid transparent', color:'#6b7280', padding:'8px 16px', fontSize:'13px', fontWeight:'500', cursor:'pointer', marginBottom:'-1px', display:'flex', alignItems:'center', gap:'6px' },
  tabActive:    { color:'#22c55e', borderBottomColor:'#22c55e', fontWeight:'600' },
  tabCount:     { background:'#22c55e22', border:'1px solid #22c55e33', borderRadius:'10px', padding:'1px 7px', fontSize:'10px', color:'#22c55e', fontWeight:'700' },
  tableWrap:    { background:'#111', border:'1px solid #222', borderRadius:'12px', overflow:'hidden' },
  tHead:        { display:'flex', gap:'8px', padding:'10px 16px', background:'#161616', borderBottom:'1px solid #222' },
  th:           { color:'#6b7280', fontSize:'9px', letterSpacing:'1px', fontWeight:'600', flex:1 },
  tRow:         { display:'flex', gap:'8px', padding:'10px 16px', borderBottom:'1px solid #1a1a1a', alignItems:'center' },
  redistributedRow: { borderLeft:'3px solid #f59e0b', background:'#1a1400' },
  td:           { flex:1, display:'flex', alignItems:'center' },
  clientName:   { color:'#fff', fontSize:'12px', fontWeight:'600' },
  redistTag:    { color:'#f59e0b', fontSize:'10px', marginTop:'2px' },
  sel:          { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'6px', color:'#22c55e', fontSize:'11px', padding:'5px 6px' },
  inp:          { width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'6px', color:'#fff', fontSize:'11px', padding:'5px 8px' },
  emptyMsg:     { color:'#6b7280', textAlign:'center', padding:'3rem', fontSize:'14px' },
  footageWrap:  { maxWidth:'720px' },
  footSummary:  { display:'flex', gap:'12px', marginBottom:'16px' },
  footStat:     { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'12px 20px', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px', minWidth:'100px' },
  footCard:     { background:'#111', border:'1px solid #222', borderRadius:'10px', padding:'14px', marginBottom:'8px' },
  footTop:      { display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'12px' },
  footClient:   { color:'#fff', fontSize:'13px', fontWeight:'600', marginBottom:'4px' },
  footMeta:     { color:'#6b7280', fontSize:'11px' },
  footDetails:  { color:'#9ca3af', fontSize:'11px', marginTop:'4px', fontStyle:'italic' },
  footActions:  { marginTop:'10px' },
  completeBtn:  { background:'#22c55e22', border:'1px solid #22c55e33', borderRadius:'6px', color:'#4ade80', fontSize:'11px', fontWeight:'600', padding:'6px 14px', cursor:'pointer' },
  reportWrap:   { display:'flex', alignItems:'center', justifyContent:'center', minHeight:'80vh' },
  reportCard:   { background:'#111', border:'1px solid #222', borderRadius:'16px', padding:'2.5rem 2rem', maxWidth:'480px', width:'100%' },
  reportGrid:   { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px', marginBottom:'1.5rem' },
  repStat:      { background:'#161616', borderRadius:'10px', padding:'12px', display:'flex', flexDirection:'column', alignItems:'center', gap:'4px' },
  redistInfo:   { background:'#1a1200', border:'1px solid #f59e0b33', borderRadius:'8px', padding:'10px 14px', color:'#fbbf24', fontSize:'12px', marginBottom:'1rem' },
  downloadBtn:  { width:'100%', background:'#22c55e', border:'none', borderRadius:'8px', color:'#000', fontWeight:'700', fontSize:'14px', padding:'12px', cursor:'pointer', marginBottom:'8px' },
  logoutFinalBtn: { width:'100%', background:'transparent', border:'1px solid #222', borderRadius:'8px', color:'#6b7280', fontSize:'14px', padding:'10px', cursor:'pointer' },
}
