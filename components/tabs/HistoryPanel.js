// ══════════════════════════════════════════════════════════════════════
// Before the platform.
//
// The team worked for months in spreadsheets before any of this existed, and
// that work is theirs. Left off the screen, every chart would begin on the day
// the platform switched on and imply the year started there.
//
// It is shown as its own block rather than folded into the date range above
// it, and for a reason worth stating: the old records are MONTHLY totals. A
// month is a lump sum — it cannot be cut into days — so adding it to a range
// picker would either overstate a week or silently drop a quarter. Kept
// separate, every figure on the screen means exactly what it says.
//
// Anyone no longer on the roster keeps their months and is marked, because
// those months happened.
// ══════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import { C } from '../Widgets'
import { Card, SearchInput, Tag, Meter, EmptyState, Segmented, T, R, SP, SURF } from '../ui'

const n = (v) => (v || 0).toLocaleString('en-IN')

function pct(done, total) {
  if (!total) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

export default function HistoryPanel({ history, only, title = 'Before the platform' }) {
  const [q, setQ] = useState('')
  const [view, setView] = useState('people')

  const periods = history?.periods || []
  const byEmployee = history?.byEmployee || {}
  const totals = history?.totals || null

  const people = useMemo(() => {
    const all = Object.values(byEmployee)
    const term = q.trim().toLowerCase()
    return all
      .filter(p => !only || p.name === only)
      .filter(p => !term || p.name.toLowerCase().includes(term))
      .sort((a, b) => b.clients - a.clients)
  }, [byEmployee, q, only])

  if (periods.length === 0) return null

  const single = !!only
  const VIEWS = [
    { value: 'people', label: 'By person' },
    { value: 'months', label: 'By month' },
  ]

  return (
    <Card pad={false} style={{ marginBottom: SP[5] }}>
      <div style={{
        padding: SP[4], borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: SP[3], flexWrap: 'wrap',
      }}>
        <span className="eyebrow" style={{ flexShrink: 0 }}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', flex: 1, minWidth: '160px' }}>
          {periods.map(p => <Tag key={p.label} color={C.blue}>{p.label}</Tag>)}
        </span>
        {!single && <Segmented size="sm" options={VIEWS} value={view} onChange={setView} />}
        {!single && view === 'people' && (
          <SearchInput value={q} onChange={setQ} placeholder="Find someone…" style={{ width: '170px' }} />
        )}
      </div>

      {/* The whole of it, in one line, before any breakdown. */}
      {totals && !single && (
        <div style={{
          display: 'flex', gap: SP[5], flexWrap: 'wrap',
          padding: `${SP[3]} ${SP[4]}`, background: SURF.sunken,
          borderBottom: `1px solid ${C.border}`,
        }}>
          {[
            ['clients given',      n(totals.clients),   C.text],
            ['completed',          n(totals.completed), C.accent],
            ['left open',          n(totals.pending),   C.amber],
            ['vehicles assigned',  n(totals.vehicles),  C.text2],
            ['vehicles watched',   n(totals.monitored), C.blue],
          ].map(([label, value, color]) => (
            <span key={label}>
              <span style={{ display: 'block', color, fontSize: T.lg, fontWeight: 800, lineHeight: 1.2 }}>{value}</span>
              <span style={{ display: 'block', color: C.muted, fontSize: T.xs }}>{label}</span>
            </span>
          ))}
        </div>
      )}

      <div className="no-scrollbar" style={{ overflowX: 'auto', maxHeight: single ? 'none' : '420px', overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '620px' }}>
          <thead>
            <tr style={{ background: SURF.sunken, position: 'sticky', top: 0, zIndex: 1 }}>
              {[(single || view === 'months') ? 'Period' : 'Employee', 'Clients', 'Completed', 'Left open', 'Vehicles', 'Watched', 'Done']
                .map((h, i) => (
                  <th key={h} style={{
                    textAlign: i === 0 ? 'left' : 'right',
                    padding: '8px 14px', color: C.muted, fontSize: T.xs, fontWeight: 800,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
            </tr>
          </thead>
          <tbody>
            {(single || view === 'months'
              ? (single ? (people[0]?.months || []) : periods)
              : people
            ).map((row, i) => {
              const label = single || view === 'months' ? row.label : row.name
              const done = pct(row.completed, row.clients)
              return (
                <tr key={label + i} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '9px 14px', maxWidth: '230px' }}>
                    <span className="ellip" style={{ display: 'block', color: C.text, fontSize: T.base, fontWeight: 700 }}>
                      {label}
                    </span>
                    {!single && view === 'months' && (
                      <span style={{ color: C.dim, fontSize: '9.5px' }}>{row.from} – {row.to} · {row.people} people</span>
                    )}
                    {!single && view === 'people' && row.onRoster === false && (
                      <span style={{ color: C.dim, fontSize: '9.5px' }}>no longer on the roster</span>
                    )}
                    {single && (
                      <span style={{ color: C.dim, fontSize: '9.5px' }}>{row.from} – {row.to}</span>
                    )}
                  </td>
                  <td style={cell()}>{n(row.clients)}</td>
                  <td style={cell(C.accent)}>{n(row.completed)}</td>
                  <td style={cell(row.pending > 0 ? C.amber : C.dim)}>{n(row.pending)}</td>
                  <td style={cell(C.text2)}>{n(row.vehicles)}</td>
                  <td style={cell(C.blue)}>{n(row.monitored)}</td>
                  <td style={{ padding: '9px 14px', textAlign: 'right', minWidth: '86px' }}>
                    <span style={{ color: C.muted, fontSize: T.sm, fontWeight: 700 }}>{done}%</span>
                    <Meter value={done} color={done >= 60 ? C.accent : C.amber} height={3} style={{ marginTop: '4px' }} />
                  </td>
                </tr>
              )
            })}
            {single && people[0] && (
              <tr style={{ background: SURF.sunken }}>
                <td style={{ padding: '10px 14px', color: C.text, fontSize: T.base, fontWeight: 800 }}>All of it</td>
                <td style={cell(C.text, 800)}>{n(people[0].clients)}</td>
                <td style={cell(C.accent, 800)}>{n(people[0].completed)}</td>
                <td style={cell(C.amber, 800)}>{n(people[0].pending)}</td>
                <td style={cell(C.text2, 800)}>{n(people[0].vehicles)}</td>
                <td style={cell(C.blue, 800)}>{n(people[0].monitored)}</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: C.muted, fontSize: T.sm, fontWeight: 800 }}>
                  {pct(people[0].completed, people[0].clients)}%
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {people.length === 0 && !single && (
        <EmptyState icon="users" title="Nobody matches that." detail="No one in the history matches that name." />
      )}

      <div style={{ padding: `${SP[2]} ${SP[4]} ${SP[3]}`, color: C.dim, fontSize: '9.5px' }}>
        Recorded in the old spreadsheets, month by month, before this platform.
        Monthly totals — not broken down by day — so they sit beside the figures
        above rather than inside the date range.
      </div>
    </Card>
  )
}

function cell(color = C.text, weight = 700) {
  return { padding: '9px 14px', textAlign: 'right', color, fontSize: T.sm, fontWeight: weight, whiteSpace: 'nowrap' }
}
