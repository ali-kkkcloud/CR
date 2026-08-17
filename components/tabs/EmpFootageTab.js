import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C, parseSheetDate } from '../Widgets'
import { Card, Button, Tag, SearchInput, EmptyState, T, R, SP, SURF } from '../ui'

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
    // Centred, not left-anchored. A bounded column on a 1460px page was
    // pinned to the left edge with the whole right half empty — the column
    // is the right width, it just needs the auto margins to sit in the middle.
    <div style={{ maxWidth:'980px', margin:'0 auto' }}>
      {/* Search / date filter bar */}
      <Card style={{ display:'flex', gap:SP[2], alignItems:'center', flexWrap:'wrap', marginBottom:SP[3] }}>
        <SearchInput
          value={search} onChange={setSearch}
          placeholder="Search vehicle no., client or issue ID…"
          style={{ minWidth:'200px' }}
        />
        <input
          type="date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}
          style={{ width:'auto', fontSize:T.sm }}
        />
        {dateFilter && <Button size="sm" variant="subtle" onClick={()=>setDateFilter('')}>Clear date</Button>}
      </Card>

      {/* Two headline cards — click either to open the full, newest-first list below */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:SP[3], marginBottom:SP[3] }}>
        {[
          { key:'pending',   label:'PENDING REQUESTS',   count:filteredPending.length,   color:C.amber,  icon:'clock' },
          { key:'completed', label:'COMPLETED REQUESTS', count:filteredCompleted.length,  color:C.accent, icon:'check-circle' },
        ].map(cardDef => {
          const active = view === cardDef.key
          return (
            <button
              key={cardDef.key}
              onClick={()=>setView(active?null:cardDef.key)}
              className="pressable"
              style={{
                textAlign:'left', cursor:'pointer',
                background: active ? C.accentSoft : SURF.raised,
                border:`1px solid ${active ? cardDef.color : C.border}`,
                borderRadius:R.lg, padding:'18px 20px',
              }}
            >
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'8px' }}>
                <span className="eyebrow">{cardDef.label}</span>
                <Icon name={cardDef.icon} size={16} color={cardDef.color} />
              </div>
              <div style={{ color:cardDef.color, fontSize:'32px', fontWeight:800, lineHeight:1, letterSpacing:'-1px' }}>{cardDef.count}</div>
              <div style={{ color:C.muted, fontSize:T.sm, marginTop:'6px' }}>Newest first</div>
              <div style={{ color: active ? C.accent : C.muted, fontSize:T.xs, marginTop:'8px', fontWeight: active ? 600 : 400 }}>
                {active ? '✓ Showing below — click to clear' : 'Click to view full list →'}
              </div>
            </button>
          )
        })}
      </div>

      {/* Last-72-hours highlight — sits outside/below the cards */}
      <button
        onClick={()=>setView(view==='last72'?null:'last72')}
        className="pressable"
        style={{
          display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap', cursor:'pointer',
          width:'100%', textAlign:'left',
          background: pendingLast72h.length>0 ? C.amber+'14' : SURF.raised,
          border:`1px solid ${pendingLast72h.length>0 ? C.amber+'55' : C.border}`,
          borderRadius:R.md, padding:'14px 18px', marginBottom:SP[3],
        }}>
        <Icon name="alerts" size={16} color={pendingLast72h.length>0?C.amber:C.muted} />
        <span style={{ color: pendingLast72h.length>0?C.amber:C.muted, fontSize:'20px', fontWeight:800 }}>{pendingLast72h.length}</span>
        <span style={{ color:C.text2, fontSize:T.base, fontWeight:600 }}>pending from the last 72 hours</span>
        <span style={{ marginLeft:'auto', color: view==='last72' ? C.accent : C.muted, fontSize:T.xs }}>
          {view==='last72' ? '✓ Showing below — click to clear' : 'Click to view →'}
        </span>
      </button>

      {/* Nothing selected yet — nudge instead of dumping the full list */}
      {!view && (
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'center', gap:'8px',
          color:C.muted, fontSize:T.base, background:SURF.raised,
          border:`1px dashed ${C.border2}`, borderRadius:R.md, padding:'26px',
        }}>
          <Icon name="search" size={14} color={C.muted} />
          Pick “Pending”, “Completed” or the 72-hour count above to open the full list.
        </div>
      )}

      {view && listToShow.length===0 && (
        <Card pad={false}>
          <EmptyState icon="search" title="No requests match these filters." detail="Try clearing the search box or the date." />
        </Card>
      )}

      {view && listToShow.length > 0 && (
        <div style={{ display:'flex', flexDirection:'column', gap:SP[2] }}>
          {listToShow.map(item => (
            <Card key={item.issueId} style={item.resolved ? { opacity:0.68 } : undefined}>
              {/* flex-start, not stretch — a 999px-radius pill stretched to the
                  row's height renders as an ellipse. */}
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:SP[3], flexWrap:'wrap' }}>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'7px', marginBottom:'4px', flexWrap:'wrap' }}>
                    <Icon name={item.resolved ? 'check-circle' : 'arrow-right'} size={13} color={item.resolved ? C.accent : C.blue} />
                    <span style={{ color:C.text, fontSize:T.md, fontWeight:700 }}>{item.vehicle}</span>
                    <span style={{ color:C.muted, fontSize:T.base }}>{item.client}</span>
                  </div>
                  <div style={{ color:C.muted, fontSize:T.sm }}>
                    ID {item.issueId} &nbsp;·&nbsp; raised {item.raisedAt}{item.location ? ` · ${item.location}` : ''}
                    {item.resolved && item.resolvedAt && <>&nbsp;·&nbsp; completed {item.resolvedAt}</>}
                  </div>
                  {item.details && (
                    <div style={{ color:C.text2, fontSize:T.sm, marginTop:'5px', fontStyle:'italic' }}>{item.details}</div>
                  )}
                </div>
                <Tag color={item.resolved ? C.accent : C.amber} dot>{item.resolved ? 'DONE' : 'PENDING'}</Tag>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
