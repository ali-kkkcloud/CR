import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C, parseSheetDate } from '../Widgets'
import { Card, T, R, SP, SURF } from '../ui'

function matchDateFlexible(raisedAtStr, isoDate) {
  if (!isoDate) return true
  const [y, m, d] = isoDate.split('-')
  return (raisedAtStr || '').includes(`${d}/${m}/${y}`)
}

export default function EmpFootageTab({ footage }) {
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  // null = nothing selected yet — only the two summary cards + the 72h
  // highlight are shown. The full list only opens once a card (or the
  // highlight) is clicked.
  const [view, setView] = useState(null)

  const sortedPending = useMemo(() => {
    return footage.pending
      .map(i => ({ ...i, raisedD: parseSheetDate(i.raisedAt) }))
      .sort((a, b) => (b.raisedD?.getTime() ?? 0) - (a.raisedD?.getTime() ?? 0))
  }, [footage.pending])

  const sortedCompleted = useMemo(() => {
    return footage.completed
      .map(i => ({ ...i, raisedD: parseSheetDate(i.raisedAt), resolvedD: parseSheetDate(i.resolvedAt) }))
      .sort((a, b) => {
        const at = a.resolvedD?.getTime() ?? a.raisedD?.getTime() ?? 0
        const bt = b.resolvedD?.getTime() ?? b.raisedD?.getTime() ?? 0
        return bt - at
      })
  }, [footage.completed])

  function applyFilters(list) {
    let out = list
    if (dateFilter) out = out.filter(i => matchDateFlexible(i.raisedAt, dateFilter))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter(i => (i.vehicle||'').toLowerCase().includes(q) || (i.issueId||'').toString().toLowerCase().includes(q) || (i.client||'').toLowerCase().includes(q))
    }
    return out
  }

  const filteredPending = useMemo(() => applyFilters(sortedPending), [sortedPending, search, dateFilter])
  const filteredCompleted = useMemo(() => applyFilters(sortedCompleted), [sortedCompleted, search, dateFilter])

  // Still-open requests raised within the LAST 72 hours — the current
  // working window. Anything older than 72h is deliberately excluded.
  const pendingLast72h = useMemo(
    () => filteredPending.filter(i => i.raisedD && (Date.now() - i.raisedD.getTime())/3600000 <= 72),
    [filteredPending]
  )

  const listToShow = view === 'pending' ? filteredPending : view === 'completed' ? filteredCompleted : view === 'last72' ? pendingLast72h : []

  return (
    <div style={{ maxWidth:'900px' }}>
      {/* Search / date filter bar */}
      <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'14px 16px', marginBottom:'14px' }}>
        <input style={{...inp, flex:1, minWidth:'180px'}} placeholder="🔍 Search vehicle no. or issue ID..." value={search} onChange={e=>setSearch(e.target.value)} />
        <input type="date" style={inp} value={dateFilter} onChange={e=>setDateFilter(e.target.value)} />
        {dateFilter && <button onClick={()=>setDateFilter('')} style={btn}>✕</button>}
      </div>

      {/* Two headline cards — click either to open the full, newest-first list below */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px', marginBottom:'12px' }}>
        {[
          { key:'pending',   label:'PENDING REQUESTS',   count:filteredPending.length,   color:C.amber,  icon:'clock' },
          { key:'completed', label:'COMPLETED REQUESTS', count:filteredCompleted.length,  color:C.accent, icon:'check-circle' },
        ].map(cardDef => {
          const active = view === cardDef.key
          return (
            <div key={cardDef.key} onClick={()=>setView(active?null:cardDef.key)}
              style={{
                background: active ? C.accentDark+'33' : C.card,
                border:`1px solid ${active ? cardDef.color : C.border}`,
                borderRadius:'14px', padding:'18px 20px', cursor:'pointer',
              }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
                <span style={{ color:C.muted, fontSize:'10.5px', fontWeight:700, letterSpacing:'0.5px' }}>{cardDef.label}</span>
                <Icon name={cardDef.icon} size={16} color={cardDef.color} />
              </div>
              <div style={{ color:cardDef.color, fontSize:'32px', fontWeight:800, lineHeight:1 }}>{cardDef.count}</div>
              <div style={{ color:C.muted, fontSize:'11px', marginTop:'6px' }}>Newest first</div>
              <div style={{ color:C.muted, fontSize:'10px', marginTop:'8px' }}>
                {active ? '✓ Showing below — click to clear' : 'Click to view full list →'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Last-72-hours highlight — sits outside/below the cards */}
      <div
        onClick={()=>setView(view==='last72'?null:'last72')}
        style={{
          display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', cursor:'pointer',
          background: pendingLast72h.length>0 ? C.amber+'14' : C.card,
          border:`1px solid ${pendingLast72h.length>0 ? C.amber+'55' : C.border}`,
          borderRadius:'12px', padding:'14px 18px', marginBottom:'12px',
        }}>
        <Icon name="alerts" size={16} color={pendingLast72h.length>0?C.amber:C.muted} />
        <span style={{ color: pendingLast72h.length>0?C.amber:C.muted, fontSize:'20px', fontWeight:800 }}>{pendingLast72h.length}</span>
        <span style={{ color:C.text2, fontSize:'12px', fontWeight:600 }}>pending from the last 72 hours</span>
        <span style={{ marginLeft:'auto', color:C.muted, fontSize:'10.5px' }}>
          {view==='last72' ? '✓ Showing below — click to clear' : 'Click to view →'}
        </span>
      </div>

      {/* Nothing selected yet — nudge instead of dumping the full list */}
      {!view && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:'8px', color:C.muted, fontSize:'12px', background:C.card, border:`1px dashed ${C.border2}`, borderRadius:'12px', padding:'26px' }}>
          <Icon name="search" size={14} color={C.muted} />
          Click "Pending" or "Completed" above to view the full, newest-first list.
        </div>
      )}

      {view && listToShow.length===0 && (
        <div style={{ color:C.muted, textAlign:'center', padding:'2rem' }}>No requests match these filters.</div>
      )}

      {view && listToShow.map(item => (
        <div key={item.issueId} style={item.resolved ? {...card, opacity:0.6} : card}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div>
              <div style={{ color:C.text, fontSize:'13px', fontWeight:600, marginBottom:'4px' }}>
                <span style={{color: item.resolved?C.accent:C.blue, marginRight:'6px'}}>{item.resolved?'✓':'▶'}</span>
                {item.client} · {item.vehicle}
              </div>
              <div style={{ color:C.muted, fontSize:'11px' }}>
                ID: {item.issueId} &nbsp;·&nbsp; Raised: {item.raisedAt} {item.location && `· ${item.location}`}
                {item.resolved && item.resolvedAt && <>&nbsp;·&nbsp; Completed: {item.resolvedAt}</>}
              </div>
              {item.details && <div style={{ color:C.text2, fontSize:'11px', marginTop:'4px', fontStyle:'italic' }}>{item.details}</div>}
            </div>
            <span className={item.resolved ? 'badge badge-green' : 'badge badge-amber'}>{item.resolved ? 'DONE' : 'PENDING'}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

const inp = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'12.5px', padding:'8px 10px', boxSizing:'border-box' }
const btn = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'12px', padding:'8px 12px', cursor:'pointer' }
const card = { background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'14px', marginBottom:'8px' }
