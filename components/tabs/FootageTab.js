import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C, slaBadge, parseSheetDate } from '../Widgets'
import { Card, Button, SearchInput, Segmented, T, R, SP, SURF } from '../ui'

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
  // null = nothing selected yet — only the two summary cards + the 72h
  // highlight are shown. The full list only opens once a card (or the
  // highlight) is clicked.
  const [statusChip, setStatusChip] = useState(null)
  const [page, setPage] = useState(1)
  const [drawerItem, setDrawerItem] = useState(null)

  const followupIds = useMemo(() => new Set(footageAll.followups.map(f=>f.issueId)), [footageAll.followups])

  const combined = useMemo(() => {
    const p = footageAll.pending.map(i => ({ ...i, status: followupIds.has(i.issueId) ? 'Forwarded' : 'Pending' }))
    const c = footageAll.completed.map(i => ({ ...i, status: 'Completed' }))
    const list = [...p, ...c].map(i => {
      const raised = parseSheetDate(i.raisedAt)
      const resolvedD = i.resolved ? parseSheetDate(i.resolvedAt) : null
      // Clamped at 0: a handful of rows carry a raised-at timestamp in the
      // future (data entry slips), which would otherwise render as a
      // negative age like "-5.0h".
      const ageHours = !i.resolved && raised ? Math.max(0, (Date.now() - raised.getTime())/3600000) : null
      const resolveHours = i.resolved && raised && resolvedD ? (resolvedD.getTime() - raised.getTime())/3600000 : null
      return { ...i, raisedD: raised, resolvedD, ageHours, resolveHours }
    })
    // Most recent first (falls back to resolved time, then keeps original order if neither parses)
    return list.sort((a,b) => {
      const at = a.raisedD?.getTime() ?? a.resolvedD?.getTime() ?? 0
      const bt = b.raisedD?.getTime() ?? b.resolvedD?.getTime() ?? 0
      return bt - at
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

  // Search scopes ALL analytics below (KPIs, charts, employee performance, etc.)
  // — not just the table. Status chips (All/Pending/Forwarded/...) only
  // narrow the table listing itself, so switching a chip doesn't skew the
  // overview numbers.
  const searchScoped = useMemo(() => {
    if (!search.trim()) return rangeFiltered
    const q = search.trim().toLowerCase()
    return rangeFiltered.filter(i =>
      (i.issueId||'').toLowerCase().includes(q) || (i.vehicle||'').toLowerCase().includes(q) ||
      (i.client||'').toLowerCase().includes(q) || (i.raisedBy||'').toLowerCase().includes(q)
    )
  }, [rangeFiltered, search])

  const tableRows = useMemo(() => {
    if (!statusChip) return []
    if (statusChip==='all') return searchScoped
    if (statusChip==='overdue') return searchScoped.filter(i => i.ageHours!=null && i.ageHours>24)
    if (statusChip==='last72') return searchScoped.filter(i => i.status!=='Completed' && i.ageHours!=null && i.ageHours<=72)
    return searchScoped.filter(i => i.status.toLowerCase()===statusChip)
  }, [searchScoped, statusChip])

  const paged = tableRows.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE)
  const totalPages = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE))

  // KPIs — driven by searchScoped (range + search), so typing a client/employee
  // name here updates every number on the page, per the requested behaviour.
  const kpis = useMemo(() => {
    const pendingAll = searchScoped.filter(i=>i.status!=='Completed')
    const completedAll = searchScoped.filter(i=>i.status==='Completed')
    const overdue = pendingAll.filter(i=>i.ageHours!=null && i.ageHours>24)
    const resolveTimes = completedAll.map(i=>i.resolveHours).filter(v=>v!=null)
    const avgResolve = resolveTimes.length ? resolveTimes.reduce((a,b)=>a+b,0)/resolveTimes.length : null
    const oldestPending = pendingAll.reduce((max,i)=> (i.ageHours!=null && i.ageHours>(max||0)) ? i.ageHours : max, null)
    const closedToday = completedAll.filter(i => i.resolvedD && ddmmyyyy(i.resolvedD)===ddmmyyyy(new Date())).length
    const forwardedCount = searchScoped.filter(i=>i.status==='Forwarded').length
    return {
      total: searchScoped.length, pending: pendingAll.length, completed: completedAll.length,
      overdue: overdue.length, avgResolve, oldestPending, forwarded: forwardedCount, closedToday,
    }
  }, [searchScoped])

  // Still-open requests raised within the LAST 72 hours — the current
  // working window. Anything older than 72h is deliberately excluded.
  const pendingLast72h = useMemo(
    () => searchScoped.filter(i => i.status !== 'Completed' && i.ageHours != null && i.ageHours <= 72).length,
    [searchScoped]
  )


  function exportFiltered() {
    const rows = [
      ['Issue ID','Client','Vehicle','Raised At','Raised By','Status','Details','Age/Resolve (h)'],
      ...tableRows.map(i => [i.issueId, i.client, i.vehicle, i.raisedAt, i.raisedBy, i.status, i.details, (i.ageHours??i.resolveHours)?.toFixed?.(1)||'']),
    ]
    downloadCSV(rows, `Footage_Requests_${quickRange}.csv`)
  }

  return (
    <div>
      {/* Control bar */}
      <Card style={{ marginBottom:SP[4] }}>
        <div style={{ display:'flex', gap:SP[3], alignItems:'center', flexWrap:'wrap' }}>
          <Segmented
            size="sm"
            value={quickRange}
            onChange={(v)=>{ setQuickRange(v); setPage(1) }}
            options={[
              { value:'all',       label:'All time' },
              { value:'today',     label:'Today' },
              { value:'yesterday', label:'Yesterday' },
              { value:'7d',        label:'Last 7 days' },
              { value:'30d',       label:'Last 30 days' },
            ]}
          />
          <div style={{ flex:1, minWidth:'220px' }}>
            <SearchInput value={search} onChange={(v)=>{ setSearch(v); setPage(1) }} placeholder="Search issue ID, vehicle, client or employee…" />
          </div>
          <Button size="sm" variant="ghost" icon="download" onClick={exportFiltered}>Export</Button>
        </div>
      </Card>

      {/* Two headline cards — click either to filter the table below */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
        {[
          { key:'pending',   label:'PENDING REQUESTS',   count:kpis.pending,   color:C.amber,  sub:'Newest first' },
          { key:'completed', label:'COMPLETED REQUESTS', count:kpis.completed, color:C.accent, sub:`${kpis.closedToday} closed today` },
        ].map(card => {
          const active = statusChip === card.key
          return (
            <div key={card.key} onClick={()=>{ setStatusChip(active?null:card.key); setPage(1) }}
              style={{
                background: active ? C.accentDark+'33' : C.card,
                border:`1px solid ${active ? card.color : C.border}`,
                borderRadius:'14px', padding:'18px 20px', cursor:'pointer',
              }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
                <span style={{ color:C.muted, fontSize:'10.5px', fontWeight:700, letterSpacing:'0.5px' }}>{card.label}</span>
                <Icon name={card.key==='pending'?'clock':'check-circle'} size={16} color={card.color} />
              </div>
              <div style={{ color:card.color, fontSize:'32px', fontWeight:800, lineHeight:1 }}>{card.count}</div>
              <div style={{ color:C.muted, fontSize:'11px', marginTop:'6px' }}>{card.sub}</div>
              <div style={{ color:C.muted, fontSize:'10px', marginTop:'8px' }}>
                {active ? '✓ Showing below — click to clear' : 'Click to view full list →'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Last-72-hours highlight — the active working window */}
      <div
        onClick={()=>{ setStatusChip(statusChip==='last72'?null:'last72'); setPage(1) }}
        style={{
          display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', cursor:'pointer',
          background: pendingLast72h>0 ? C.amber+'14' : C.card,
          border:`1px solid ${pendingLast72h>0 ? C.amber+'55' : C.border}`,
          borderRadius:'12px', padding:'14px 18px', marginBottom:'12px',
        }}>
        <Icon name="alerts" size={16} color={pendingLast72h>0?C.amber:C.muted} />
        <span style={{ color: pendingLast72h>0?C.amber:C.muted, fontSize:'20px', fontWeight:800 }}>{pendingLast72h}</span>
        <span style={{ color:C.text2, fontSize:'12px', fontWeight:600 }}>pending from the last 72 hours</span>
        <span style={{ marginLeft:'auto', color:C.muted, fontSize:'10.5px' }}>
          {statusChip==='last72' ? '✓ Showing below — click to clear' : 'Click to view →'}
        </span>
      </div>

      {/* Nothing selected yet — nudge instead of dumping the full list */}
      {!statusChip && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', color:C.muted, fontSize:'12px', background:C.card, border:`1px dashed ${C.border2}`, borderRadius:'12px', padding:'26px', marginBottom:'12px' }}>
          <Icon name="search" size={14} color={C.muted} />
          Click "Pending" or "Completed" above to view the full, newest-first list.
        </div>
      )}

      {/* Table — only once a card (or the 72h highlight) has been opened */}
      {statusChip && (
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'6px', padding:'14px 16px', borderBottom:`1px solid ${C.border}`, flexWrap:'wrap' }}>
          {['all','pending','forwarded','completed','overdue'].map(chip => (
            <button key={chip} onClick={()=>{setStatusChip(chip);setPage(1)}} style={{
              ...chipStyle, ...(statusChip===chip ? { background:C.accentDark, borderColor:C.accent, color:C.accent } : {}),
            }}>{chip==='all'?'All Requests':chip[0].toUpperCase()+chip.slice(1)}</button>
          ))}
          <span style={{ marginLeft:'auto', color:C.muted, fontSize:'11px' }}>{tableRows.length} request(s) · most recent first</span>
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
          <span style={{ color:C.muted, fontSize:'11px' }}>Page</span>
          <input
            type="number" min={1} max={totalPages} value={page}
            onChange={e=>{
              const v = parseInt(e.target.value)
              if (!isNaN(v)) setPage(Math.min(totalPages, Math.max(1, v)))
            }}
            style={{ width:'48px', textAlign:'center', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'6px', color:C.text, fontSize:'11px', padding:'6px 4px' }}
          />
          <span style={{ color:C.muted, fontSize:'11px' }}>of {totalPages}</span>
          <button disabled={page>=totalPages} onClick={()=>setPage(p=>p+1)} style={{ ...chipStyle, opacity:page>=totalPages?0.4:1 }}>Next ›</button>
        </div>
      </div>
      )}

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

const quickBtnStyle = { background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md, color:C.text2, fontSize:T.sm, fontWeight:600, padding:'7px 11px', cursor:'pointer', whiteSpace:'nowrap' }
const chipStyle = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'20px', color:C.text2, fontSize:'10.5px', fontWeight:600, padding:'6px 12px', cursor:'pointer', whiteSpace:'nowrap' }
const tdStyle = { color:C.text, fontSize:'11.5px', padding:'10px 14px', verticalAlign:'top' }
