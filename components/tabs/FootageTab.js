import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C, KpiCard, Donut, LineChart, HBarList, slaBadge, parseSheetDate } from '../Widgets'

const PAGE_SIZE = 10

function fmtHours(h) {
  if (h == null) return '—'
  if (h < 1) return `${Math.round(h*60)}m`
  if (h < 48) return `${h.toFixed(1)}h`
  return `${Math.round(h/24)}d`
}

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export default function FootageTab({ footageAll, downloadCSV, onCloseFollowup, todayISO }) {
  const [search, setSearch] = useState('')
  const [quickRange, setQuickRange] = useState('all')
  const [statusChip, setStatusChip] = useState('all')
  const [page, setPage] = useState(1)
  const [drawerItem, setDrawerItem] = useState(null)

  const followupIds = useMemo(() => new Set(footageAll.followups.map(f=>f.issueId)), [footageAll.followups])

  const combined = useMemo(() => {
    const p = footageAll.pending.map(i => ({ ...i, status: followupIds.has(i.issueId) ? 'Forwarded' : 'Pending' }))
    const c = footageAll.completed.map(i => ({ ...i, status: 'Completed' }))
    return [...p, ...c].map(i => {
      const raised = parseSheetDate(i.raisedAt)
      const resolvedD = i.resolved ? parseSheetDate(i.resolvedAt) : null
      const ageHours = !i.resolved && raised ? (Date.now() - raised.getTime())/3600000 : null
      const resolveHours = i.resolved && raised && resolvedD ? (resolvedD.getTime() - raised.getTime())/3600000 : null
      return { ...i, raisedD: raised, resolvedD, ageHours, resolveHours }
    })
  }, [footageAll, followupIds])

  const rangeFiltered = useMemo(() => {
    if (quickRange === 'all') return combined
    const now = new Date()
    let from
    if (quickRange === 'today') from = new Date(now.getFullYear(),now.getMonth(),now.getDate())
    else if (quickRange === 'yesterday') { from = new Date(now.getFullYear(),now.getMonth(),now.getDate()-1) }
    else if (quickRange === '7d') from = new Date(now.getTime() - 7*86400000)
    else if (quickRange === '30d') from = new Date(now.getTime() - 30*86400000)
    const to = quickRange === 'yesterday' ? new Date(now.getFullYear(),now.getMonth(),now.getDate()) : new Date(now.getTime()+86400000)
    return combined.filter(i => i.raisedD ? (i.raisedD>=from && i.raisedD<to) : quickRange==='all')
  }, [combined, quickRange])

  const chipFiltered = useMemo(() => {
    if (statusChip==='all') return rangeFiltered
    if (statusChip==='overdue') return rangeFiltered.filter(i => i.ageHours!=null && i.ageHours>24)
    return rangeFiltered.filter(i => i.status.toLowerCase()===statusChip)
  }, [rangeFiltered, statusChip])

  const searched = useMemo(() => {
    if (!search.trim()) return chipFiltered
    const q = search.trim().toLowerCase()
    return chipFiltered.filter(i =>
      (i.issueId||'').toLowerCase().includes(q) || (i.vehicle||'').toLowerCase().includes(q) ||
      (i.client||'').toLowerCase().includes(q) || (i.raisedBy||'').toLowerCase().includes(q)
    )
  }, [chipFiltered, search])

  const paged = searched.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(searched.length / PAGE_SIZE))

  // KPIs
  const kpis = useMemo(() => {
    const pendingAll = combined.filter(i=>i.status!=='Completed')
    const completedAll = combined.filter(i=>i.status==='Completed')
    const overdue = pendingAll.filter(i=>i.ageHours!=null && i.ageHours>24)
    const resolveTimes = completedAll.map(i=>i.resolveHours).filter(v=>v!=null)
    const avgResolve = resolveTimes.length ? resolveTimes.reduce((a,b)=>a+b,0)/resolveTimes.length : null
    const oldestPending = pendingAll.reduce((max,i)=> (i.ageHours!=null && i.ageHours>(max||0)) ? i.ageHours : max, null)
    const closedToday = completedAll.filter(i => i.resolvedD && ddmmyyyy(i.resolvedD)===ddmmyyyy(new Date())).length
    return {
      total: combined.length, pending: pendingAll.length, completed: completedAll.length,
      overdue: overdue.length, avgResolve, oldestPending, forwarded: footageAll.followups.length, closedToday,
    }
  }, [combined, footageAll.followups])

  // Employee performance
  const employeePerf = useMemo(() => {
    const map = {}
    combined.forEach(i => {
      const by = i.raisedBy || 'Unknown'
      if (!map[by]) map[by] = { name:by, total:0, pending:0, resolved:0, resolveTimes:[] }
      map[by].total++
      if (i.status==='Completed') { map[by].resolved++; if (i.resolveHours!=null) map[by].resolveTimes.push(i.resolveHours) }
      else map[by].pending++
    })
    return Object.values(map).map(e => ({ ...e, avgResolve: e.resolveTimes.length ? e.resolveTimes.reduce((a,b)=>a+b,0)/e.resolveTimes.length : null }))
      .sort((a,b)=>b.total-a.total).slice(0,8)
  }, [combined])

  // Client health
  const clientHealth = useMemo(() => {
    const map = {}
    combined.forEach(i => {
      const cl = i.client || 'Unknown'
      if (!map[cl]) map[cl] = { name:cl, total:0, pending:0, resolved:0 }
      map[cl].total++
      if (i.status==='Completed') map[cl].resolved++; else map[cl].pending++
    })
    return Object.values(map).map(c => ({ ...c, pendingPct: c.total?Math.round((c.pending/c.total)*100):0 }))
      .sort((a,b)=>b.total-a.total).slice(0,6)
  }, [combined])

  // Top vehicles
  const topVehicles = useMemo(() => {
    const map = {}
    combined.forEach(i => { const v=i.vehicle||'Unknown'; map[v]=(map[v]||0)+1 })
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([label,value])=>({label,value,color:C.blue}))
  }, [combined])

  // Trend — last 7 days
  const trend = useMemo(() => {
    const days = Array.from({length:7},(_,i)=>{ const d=new Date(); d.setDate(d.getDate()-(6-i)); return d })
    const labels = days.map(d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}))
    const raised = days.map(d => combined.filter(i=>i.raisedD && ddmmyyyy(i.raisedD)===ddmmyyyy(d)).length)
    const resolved = days.map(d => combined.filter(i=>i.resolvedD && ddmmyyyy(i.resolvedD)===ddmmyyyy(d)).length)
    return { labels, raised, resolved }
  }, [combined])

  // Recent activity — last 24h, graceful fallback if timestamps don't parse
  const recentActivity = useMemo(() => {
    const events = []
    combined.forEach(i => {
      if (i.raisedD) events.push({ t:i.raisedD, label:`${i.raisedBy||'Someone'} raised request for ${i.vehicle}`, tag:'Raised', color:C.blue, issueId:i.issueId })
      if (i.resolvedD) events.push({ t:i.resolvedD, label:`${i.raisedBy||'Someone'} completed request for ${i.vehicle}`, tag:'Completed', color:C.accent, issueId:i.issueId })
    })
    footageAll.followups.forEach(f => events.push({ t:null, label:`${f.originalEmployee} forwarded ${f.vehicle} to ${f.forwardedTo}`, tag:'Forwarded', color:C.purple, issueId:f.issueId }))
    const withTime = events.filter(e=>e.t).sort((a,b)=>b.t-a.t)
    const last24h = withTime.filter(e => Date.now()-e.t.getTime() < 24*3600000)
    return (last24h.length ? last24h : withTime).slice(0,8)
  }, [combined, footageAll.followups])

  const insights = useMemo(() => {
    const out = []
    if (clientHealth[0]) out.push(`${clientHealth[0].name} has the highest footage request volume (${clientHealth[0].total} requests) in this view.`)
    if (employeePerf.length) {
      const withAvg = employeePerf.filter(e=>e.avgResolve!=null)
      if (withAvg.length) {
        const teamAvg = withAvg.reduce((s,e)=>s+e.avgResolve,0)/withAvg.length
        const slowest = [...withAvg].sort((a,b)=>b.avgResolve-a.avgResolve)[0]
        if (slowest && teamAvg>0) {
          const pctSlower = Math.round(((slowest.avgResolve-teamAvg)/teamAvg)*100)
          if (pctSlower>5) out.push(`${slowest.name}'s avg resolution time is ${pctSlower}% slower than the team average.`)
        }
      }
    }
    if (kpis.overdue>0) out.push(`${kpis.overdue} request(s) are currently overdue (open more than 24 hours).`)
    return out
  }, [clientHealth, employeePerf, kpis])

  function exportFiltered() {
    const rows = [
      ['Issue ID','Client','Vehicle','Raised At','Raised By','Status','Details','Age/Resolve (h)'],
      ...searched.map(i => [i.issueId, i.client, i.vehicle, i.raisedAt, i.raisedBy, i.status, i.details, (i.ageHours??i.resolveHours)?.toFixed?.(1)||'']),
    ]
    downloadCSV(rows, `Footage_Requests_${quickRange}.csv`)
  }

  return (
    <div>
      {/* Control bar */}
      <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'12px 16px', marginBottom:'14px' }}>
        {['all','today','yesterday','7d','30d'].map(r => (
          <button key={r} onClick={()=>{setQuickRange(r);setPage(1)}} style={{
            ...quickBtnStyle, ...(quickRange===r ? { background:C.accentDark, borderColor:C.accent, color:C.accent } : {}),
          }}>{{all:'All Time',today:'Today',yesterday:'Yesterday','7d':'Last 7 Days','30d':'Last 30 Days'}[r]}</button>
        ))}
        <input placeholder="🔍 Search Issue ID, Vehicle, Client, Employee..." value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} style={{ ...dateInpStyle, flex:1, minWidth:'220px' }} />
        <button style={outlineBtnStyle} onClick={exportFiltered}><Icon name="download" size={12} color={C.text2}/> Export</button>
      </div>

      {/* KPI strip */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px, 1fr))', gap:'10px', marginBottom:'14px' }}>
        <KpiCard icon="footage" label="Total Requests" value={kpis.total} />
        <KpiCard icon="clock" label="Pending" value={kpis.pending} subColor={kpis.pending>0?C.amber:C.muted} />
        <KpiCard icon="check-circle" label="Completed" value={kpis.completed} />
        <KpiCard icon="alerts" label="Overdue (>24h)" value={kpis.overdue} subColor={kpis.overdue>0?C.red:C.muted} />
        <KpiCard icon="clock" label="Avg Resolution" value={fmtHours(kpis.avgResolve)} />
        <KpiCard icon="clock" label="Oldest Pending" value={fmtHours(kpis.oldestPending)} subColor={kpis.oldestPending>24?C.red:C.muted} />
        <KpiCard icon="followups" label="Forwarded" value={kpis.forwarded} />
        <KpiCard icon="check-circle" label="Closed Today" value={kpis.closedToday} />
      </div>

      {/* Analytics row */}
      <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1.3fr 1fr', gap:'12px', marginBottom:'12px' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>EMPLOYEE PERFORMANCE</div>
          {employeePerf.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No data.</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:'7px' }}>
              <div style={{ display:'flex', color:C.muted, fontSize:'9px', fontWeight:700, padding:'0 2px' }}>
                <span style={{flex:1}}>EMPLOYEE</span><span style={{width:'40px',textAlign:'right'}}>TOT</span><span style={{width:'40px',textAlign:'right'}}>PEND</span><span style={{width:'50px',textAlign:'right'}}>AVG</span>
              </div>
              {employeePerf.map(e => (
                <div key={e.name} style={{ display:'flex', alignItems:'center', fontSize:'11px' }}>
                  <span style={{ flex:1, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.name}</span>
                  <span style={{ width:'40px', textAlign:'right', color:C.text2 }}>{e.total}</span>
                  <span style={{ width:'40px', textAlign:'right', color:e.pending>0?C.amber:C.muted }}>{e.pending}</span>
                  <span style={{ width:'50px', textAlign:'right', color:C.muted }}>{fmtHours(e.avgResolve)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'6px' }}>REQUEST TREND (LAST 7 DAYS)</div>
          <div style={{ display:'flex', gap:'12px', marginBottom:'6px' }}>
            <span style={{ fontSize:'9.5px', color:C.blue }}>● Raised</span>
            <span style={{ fontSize:'9.5px', color:C.accent }}>● Resolved</span>
          </div>
          <LineChart series={[{name:'Raised',color:C.blue,data:trend.raised},{name:'Resolved',color:C.accent,data:trend.resolved}]} labels={trend.labels} height={150} />
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>STATUS MATRIX</div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center' }}>
            <Donut segments={[
              { label:'Pending', value:kpis.pending-kpis.forwarded>0?kpis.pending-kpis.forwarded:0, color:C.amber },
              { label:'Forwarded', value:kpis.forwarded, color:C.purple },
              { label:'Completed', value:kpis.completed, color:C.accent },
            ]} size={110} thickness={15} centerLabel={kpis.total} centerSub="Total" />
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'5px', marginTop:'10px' }}>
            {[{l:'Pending',c:C.amber,v:kpis.pending-kpis.forwarded>0?kpis.pending-kpis.forwarded:0},{l:'Forwarded',c:C.purple,v:kpis.forwarded},{l:'Completed',c:C.accent,v:kpis.completed}].map(x=>(
              <div key={x.l} style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'10.5px' }}>
                <span style={{width:7,height:7,borderRadius:'50%',background:x.c}}></span><span style={{color:C.text2,flex:1}}>{x.l}</span><span style={{color:C.text,fontWeight:700}}>{x.v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'12px', marginBottom:'14px' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>CLIENT HEALTH</div>
          {clientHealth.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No data.</div> : clientHealth.map(c => (
            <div key={c.name} style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'7px' }}>
              <span style={{ color:C.text2, fontSize:'10.5px', width:'92px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</span>
              <div style={{ flex:1, height:'6px', background:C.border2, borderRadius:'3px', overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${c.pendingPct}%`, background: c.pendingPct>50?C.red:c.pendingPct>20?C.amber:C.accent, borderRadius:'3px' }}></div>
              </div>
              <span style={{ color:C.muted, fontSize:'10px', width:'34px', textAlign:'right' }}>{c.pendingPct}%</span>
            </div>
          ))}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>TOP 5 VEHICLES (BY REQUESTS)</div>
          {topVehicles.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No data.</div> : <HBarList items={topVehicles} />}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>RECENT ACTIVITY</div>
          {recentActivity.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No recent activity.</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', maxHeight:'160px', overflowY:'auto' }}>
              {recentActivity.map((a,i) => (
                <div key={i} style={{ display:'flex', gap:'7px', alignItems:'flex-start' }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:a.color, marginTop:'4px', flexShrink:0 }}></span>
                  <div style={{ fontSize:'10.5px', color:C.text2 }}>{a.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {insights.length>0 && (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'16px', marginBottom:'14px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'6px', marginBottom:'10px' }}>
            <Icon name="sparkles" size={13} color={C.accent}/>
            <span style={{ color:C.accent, fontSize:'10.5px', fontWeight:700 }}>AI INSIGHTS</span>
            <span style={{ background:C.accentDark, color:C.accent, fontSize:'8px', fontWeight:700, borderRadius:'4px', padding:'1px 5px' }}>BETA</span>
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
            {insights.map((t,i) => <div key={i} style={{ color:C.text2, fontSize:'11px', background:C.s2, borderRadius:'8px', padding:'8px 12px' }}>{t}</div>)}
          </div>
        </div>
      )}

      {/* Table */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'14px 16px', borderBottom:`1px solid ${C.border}`, flexWrap:'wrap' }}>
          {['all','pending','forwarded','completed','overdue'].map(chip => (
            <button key={chip} onClick={()=>{setStatusChip(chip);setPage(1)}} style={{
              ...chipStyle, ...(statusChip===chip ? { background:C.accentDark, borderColor:C.accent, color:C.accent } : {}),
            }}>{chip==='all'?'All Requests':chip[0].toUpperCase()+chip.slice(1)}</button>
          ))}
          <span style={{ marginLeft:'auto', color:C.muted, fontSize:'11px' }}>{searched.length} request(s)</span>
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'760px' }}>
            <thead>
              <tr style={{ background:C.s2 }}>
                {['Issue ID','Raised At','Client / Vehicle','Raised By','Status','Age / Resolve','Actions'].map(h => (
                  <th key={h} style={{ color:C.muted, fontSize:'10px', letterSpacing:'0.5px', padding:'10px 14px', textAlign:'left', fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map(item => {
                const st = { Pending:C.amber, Forwarded:C.purple, Completed:C.accent }[item.status] || C.muted
                const badge = item.status==='Completed' ? { label:fmtHours(item.resolveHours), color:C.muted } : slaBadge(item.ageHours)
                return (
                  <tr key={item.issueId} style={{ borderBottom:`1px solid ${C.borderRow}` }}>
                    <td style={tdStyle}>{item.issueId}</td>
                    <td style={{...tdStyle,color:C.muted}}>{item.raisedAt}</td>
                    <td style={tdStyle}>
                      <div style={{ color:C.text, fontWeight:600 }}>{item.client}</div>
                      <div style={{ color:C.muted, fontSize:'10px' }}>{item.vehicle}</div>
                    </td>
                    <td style={tdStyle}>{item.raisedBy}</td>
                    <td style={tdStyle}><span style={{ background:st+'1f', color:st, borderRadius:'5px', padding:'2px 8px', fontSize:'9.5px', fontWeight:700 }}>{item.status.toUpperCase()}</span></td>
                    <td style={{...tdStyle,color:badge.color,fontWeight:700}}>{badge.label}</td>
                    <td style={tdStyle}>
                      <button onClick={()=>setDrawerItem(item)} style={{ background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'6px', color:C.text2, fontSize:'10px', padding:'5px 10px', cursor:'pointer' }}>View</button>
                    </td>
                  </tr>
                )
              })}
              {paged.length===0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign:'center', color:C.muted, padding:'30px' }}>No requests match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'8px', padding:'12px 16px' }}>
          <button disabled={page<=1} onClick={()=>setPage(p=>p-1)} style={{ ...chipStyle, opacity:page<=1?0.4:1 }}>‹ Prev</button>
          <span style={{ color:C.muted, fontSize:'11px' }}>Page {page} of {totalPages}</span>
          <button disabled={page>=totalPages} onClick={()=>setPage(p=>p+1)} style={{ ...chipStyle, opacity:page>=totalPages?0.4:1 }}>Next ›</button>
        </div>
      </div>

      {/* Drawer */}
      {drawerItem && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', justifyContent:'flex-end', zIndex:1000 }} onClick={()=>setDrawerItem(null)}>
          <div style={{ width:'380px', maxWidth:'90vw', height:'100%', background:C.card, borderLeft:`1px solid ${C.border}`, padding:'20px', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
              <div style={{ color:C.text, fontSize:'15px', fontWeight:700 }}>{drawerItem.issueId}</div>
              <button onClick={()=>setDrawerItem(null)} style={{ background:'transparent', border:'none', color:C.muted, fontSize:'18px', cursor:'pointer' }}>×</button>
            </div>
            {[
              ['Client', drawerItem.client], ['Vehicle', drawerItem.vehicle], ['Raised At', drawerItem.raisedAt],
              ['Raised By', drawerItem.raisedBy], ['Location', drawerItem.location||'—'], ['Details', drawerItem.details||'—'],
              ['Remarks', drawerItem.remarks||'—'], ['Status', drawerItem.status],
              ...(drawerItem.status==='Completed' ? [['Resolved At', drawerItem.resolvedAt], ['Resolution Time', fmtHours(drawerItem.resolveHours)]] : [['Age', fmtHours(drawerItem.ageHours)]]),
            ].map(([k,v]) => (
              <div key={k} style={{ marginBottom:'12px' }}>
                <div style={{ color:C.muted, fontSize:'9.5px', fontWeight:700, letterSpacing:'0.5px', marginBottom:'3px' }}>{k.toUpperCase()}</div>
                <div style={{ color:C.text2, fontSize:'12.5px' }}>{v}</div>
              </div>
            ))}
            {drawerItem.status==='Forwarded' && (
              <button onClick={()=>{ onCloseFollowup(drawerItem); setDrawerItem(null) }} style={{ width:'100%', marginTop:'10px', background:C.redBg, border:`1px solid #3a1515`, borderRadius:'8px', color:C.red, fontSize:'12px', fontWeight:600, padding:'10px', cursor:'pointer' }}>Close Follow-up</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const dateInpStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'12.5px', padding:'7px 10px' }
const quickBtnStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11px', padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const outlineBtnStyle = { display:'flex', alignItems:'center', gap:'5px', background:'transparent', border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'11.5px', fontWeight:600, padding:'8px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const chipStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'20px', color:C.text2, fontSize:'10.5px', fontWeight:600, padding:'6px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const tdStyle = { color:C.text, fontSize:'11.5px', padding:'10px 14px', verticalAlign:'top' }
