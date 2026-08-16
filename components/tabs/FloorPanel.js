// ══════════════════════════════════════════════════════════════════════
// The floor — every employee, their state, and how far through their work
// they are, in one column.
//
// This is what a supervisor actually stares at, and until now it wasn't on
// the Overview at all: you had to open Full Day View to see who was where.
// The Overview instead led with eight stat cards, which answer "how are we
// doing" — a question nobody opens a command centre to ask first.
// ══════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, SearchInput, Segmented, Tag, Meter, EmptyState, T, R, SP, SURF } from '../ui'

const STATE = {
  'Active':      { color: C.accent, label: 'On shift',    rank: 0 },
  'Not Started': { color: C.red,    label: 'Not started', rank: 1 },
  'Ended':       { color: C.blue,   label: 'Ended',       rank: 3 },
  'Week Off':    { color: C.purple, label: 'Week off',    rank: 4 },
  'Off Shift':   { color: C.dim,    label: 'Off shift',   rank: 5 },
}

function fmt(h) {
  if (h == null) return '—'
  const to12 = n => (n === 0 ? 12 : n > 12 ? n - 12 : n)
  return `${to12(h)}${h >= 12 ? 'pm' : 'am'}`
}

export default function FloorPanel({ employees, breaks, onPick }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('onduty')

  const onBreakNames = useMemo(
    () => new Set((breaks?.employees || []).filter(e => e.currentlyOnBreak).map(e => e.name)),
    [breaks]
  )

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return employees
      .filter(e => {
        if (term && !e.name.toLowerCase().includes(term)) return false
        if (filter === 'onduty')  return e.statusLabel === 'Active' || e.statusLabel === 'Not Started'
        if (filter === 'issues')  return e.statusLabel === 'Not Started' || onBreakNames.has(e.name) || e.pendingCount > 0
        return true
      })
      // Whoever needs looking at first, then by outstanding work.
      .sort((a, b) => {
        const ra = STATE[a.statusLabel]?.rank ?? 9
        const rb = STATE[b.statusLabel]?.rank ?? 9
        if (ra !== rb) return ra - rb
        return (b.pendingCount || 0) - (a.pendingCount || 0)
      })
  }, [employees, q, filter, onBreakNames])

  const counts = {
    onduty: employees.filter(e => e.statusLabel === 'Active' || e.statusLabel === 'Not Started').length,
    issues: employees.filter(e => e.statusLabel === 'Not Started' || onBreakNames.has(e.name) || e.pendingCount > 0).length,
    all:    employees.length,
  }

  return (
    <Card pad={false} style={{ display:'flex', flexDirection:'column', minHeight:0 }}>
      <div style={{ padding:SP[4], borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:SP[2] }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:SP[2] }}>
          <span className="eyebrow">The floor</span>
          <Tag color={C.accent} dot>LIVE</Tag>
        </div>
        <SearchInput value={q} onChange={setQ} placeholder="Find someone…" />
        <Segmented
          size="sm" value={filter} onChange={setFilter}
          options={[
            { value:'onduty', label:'On duty', count:counts.onduty },
            { value:'issues', label:'Needs eyes', count:counts.issues },
            { value:'all',    label:'All',      count:counts.all },
          ]}
        />
      </div>

      <div style={{ flex:1, overflowY:'auto', minHeight:0, maxHeight:'560px' }}>
        {rows.length === 0 ? (
          <EmptyState icon="users" tone="good" title="Nobody here." detail="Nothing matches this filter right now." />
        ) : rows.map(e => {
          const st  = STATE[e.statusLabel] || { color:C.muted, label:e.statusLabel }
          const on  = onBreakNames.has(e.name)
          const tot = (e.totalUpdates || 0) + (e.pendingCount || 0)
          const pct = tot > 0 ? Math.round(((e.totalUpdates || 0) / tot) * 100) : 0
          return (
            <button
              key={e.name}
              onClick={() => onPick && onPick(e)}
              className="row-hover"
              style={{
                display:'flex', alignItems:'center', gap:'11px', width:'100%',
                background:'transparent', border:'none',
                borderBottom:`1px solid ${C.border}`, padding:'11px 16px', textAlign:'left',
              }}
            >
              <span style={{
                width:'30px', height:'30px', borderRadius:'50%', flexShrink:0,
                background:st.color+'1a', color:st.color,
                fontSize:'10.5px', fontWeight:800,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}>{e.name.slice(0, 2).toUpperCase()}</span>

              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:'flex', alignItems:'center', gap:'7px' }}>
                  <span className="ellip" style={{ color:C.text, fontSize:T.base, fontWeight:700 }}>{e.name}</span>
                  {on && <Tag color={C.red} dot>BREAK</Tag>}
                  {e.isAdjusted && <Tag color={C.amber}>ADJ</Tag>}
                </span>
                <span style={{ display:'block', color:st.color, fontSize:'9.5px', marginTop:'2px' }}>
                  {st.label} · {fmt(e.effStart ?? e.shiftStart)}–{fmt(e.effEnd ?? e.shiftEnd)}
                  {e.startTime ? ` · in ${e.startTime}` : ''}
                </span>
                {tot > 0 && <Meter value={pct} height={3} style={{ marginTop:'6px' }} />}
              </span>

              <span style={{ textAlign:'right', flexShrink:0, minWidth:'48px' }}>
                <span style={{ display:'block', color:C.text, fontSize:T.base, fontWeight:800 }}>
                  {e.totalUpdates || 0}
                </span>
                <span style={{
                  display:'block', color: e.pendingCount > 0 ? C.amber : C.dim,
                  fontSize:'9.5px', marginTop:'1px',
                }}>{e.pendingCount || 0} left</span>
              </span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
