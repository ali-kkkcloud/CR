import { useState, useMemo } from 'react'
import { C } from '../Widgets'

function matchDateFlexible(raisedAtStr, isoDate) {
  if (!isoDate) return true
  const [y, m, d] = isoDate.split('-')
  return (raisedAtStr || '').includes(`${d}/${m}/${y}`)
}

export default function EmpFootageTab({ footage }) {
  const [search, setSearch] = useState('')
  const [dateFilter, setDateFilter] = useState('')

  const filteredPending = useMemo(() => {
    let list = footage.pending
    if (dateFilter) list = list.filter(i => matchDateFlexible(i.raisedAt, dateFilter))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i => (i.vehicle||'').toLowerCase().includes(q) || (i.issueId||'').toString().toLowerCase().includes(q) || (i.client||'').toLowerCase().includes(q))
    }
    return list
  }, [footage.pending, search, dateFilter])

  const filteredCompleted = useMemo(() => {
    let list = footage.completed
    if (dateFilter) list = list.filter(i => matchDateFlexible(i.raisedAt, dateFilter))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(i => (i.vehicle||'').toLowerCase().includes(q) || (i.issueId||'').toString().toLowerCase().includes(q) || (i.client||'').toLowerCase().includes(q))
    }
    return list
  }, [footage.completed, search, dateFilter])

  return (
    <div style={{ maxWidth:'900px' }}>
      <div style={{ display:'flex', gap:'10px', alignItems:'center', flexWrap:'wrap', background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'14px 16px', marginBottom:'14px' }}>
        <div style={statBox}><span style={{color:C.amber,fontSize:'20px',fontWeight:700}}>{filteredPending.length}</span><span style={{color:C.muted,fontSize:'9px'}}>PENDING</span></div>
        <div style={statBox}><span style={{color:C.accent,fontSize:'20px',fontWeight:700}}>{filteredCompleted.length}</span><span style={{color:C.muted,fontSize:'9px'}}>COMPLETED</span></div>
        <input style={{...inp, flex:1, minWidth:'180px'}} placeholder="🔍 Search vehicle no. or issue ID..." value={search} onChange={e=>setSearch(e.target.value)} />
        <input type="date" style={inp} value={dateFilter} onChange={e=>setDateFilter(e.target.value)} />
        {dateFilter && <button onClick={()=>setDateFilter('')} style={btn}>✕</button>}
      </div>

      {filteredPending.length===0 && filteredCompleted.length===0 && <div style={{ color:C.muted, textAlign:'center', padding:'3rem' }}>No footage requests found.</div>}

      {filteredPending.map(item => (
        <div key={item.issueId} style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
            <div>
              <div style={{ color:C.text, fontSize:'13px', fontWeight:600, marginBottom:'4px' }}><span style={{color:C.blue,marginRight:'6px'}}>▶</span>{item.client} · {item.vehicle}</div>
              <div style={{ color:C.muted, fontSize:'11px' }}>ID: {item.issueId} &nbsp;·&nbsp; Raised: {item.raisedAt} {item.location && `· ${item.location}`}</div>
              {item.details && <div style={{ color:C.text2, fontSize:'11px', marginTop:'4px', fontStyle:'italic' }}>{item.details}</div>}
            </div>
            <span className="badge badge-amber">PENDING</span>
          </div>
        </div>
      ))}

      {filteredCompleted.length > 0 && <>
        <div style={{ color:C.dim, fontSize:'10px', letterSpacing:'1px', margin:'16px 0 8px', fontWeight:600 }}>COMPLETED</div>
        {filteredCompleted.map(item => (
          <div key={item.issueId} style={{...card, opacity:0.6}}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
              <div>
                <div style={{ color:C.text, fontSize:'13px', fontWeight:600, marginBottom:'4px' }}><span style={{color:C.accent,marginRight:'6px'}}>✓</span>{item.client} · {item.vehicle}</div>
                <div style={{ color:C.muted, fontSize:'11px' }}>Completed: {item.resolvedAt} · ID: {item.issueId}</div>
              </div>
              <span className="badge badge-green">DONE</span>
            </div>
          </div>
        ))}
      </>}
    </div>
  )
}

const statBox = { display:'flex', flexDirection:'column', alignItems:'center', background:C.s2, borderRadius:'8px', padding:'8px 14px', gap:'2px' }
const inp = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, fontSize:'12.5px', padding:'8px 10px', boxSizing:'border-box' }
const btn = { background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text2, fontSize:'12px', padding:'8px 12px', cursor:'pointer' }
const card = { background:C.card, border:`1px solid ${C.border}`, borderRadius:'10px', padding:'14px', marginBottom:'8px' }
