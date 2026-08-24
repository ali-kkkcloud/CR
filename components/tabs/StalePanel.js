// ══════════════════════════════════════════════════════════════════════
// Clients nobody has touched since seven this morning
//
// Every other screen here treats an hour on its own, and that is right: a
// client scheduled at eleven and again at five is two pieces of work, and
// somebody who did the eleven has done the eleven.
//
// The cost of that is there was nowhere at all that said "this client has
// been waiting since seven". A client untouched from one end of the day to
// the other showed up as a pending row on six different screens, one hour at
// a time, and each of those rows looks exactly like a client that was seen an
// hour ago. Nothing added them up, so nothing could be asked about them.
//
// This is that one fact, said once. Not a coverage gap — a coverage gap is
// work that reached no board, which nobody could have done. This reached
// somebody's board, in one hour or in six, and still has not one update
// against it.
//
// Sorted by fleet size, because that is where the exposure is: a client with
// six hundred vehicles going unwatched all day is not the same problem as one
// with two.
// ══════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, SearchInput, Tag, EmptyState, T, R, SP, SURF } from '../ui'

function fmtHour(h) {
  if (h == null) return '—'
  const to12 = n => (n === 0 ? 12 : n > 12 ? n - 12 : n)
  return `${to12(h)}${h >= 12 ? 'pm' : 'am'}`
}

export default function StalePanel({ clients = [] }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return clients
    return clients.filter(c => (c.client || '').toLowerCase().includes(needle))
  }, [clients, q])

  const totalVehicles = clients.reduce((s, c) => s + (c.vehicleCount || 0), 0)
  const totalSlots    = clients.reduce((s, c) => s + (c.pending || 0), 0)

  if (clients.length === 0) {
    return (
      <Card pad={false} style={{ overflow:'hidden' }}>
        <EmptyState
          icon="check-circle"
          title="Every client has been filled at least once since 7am."
          detail="This lists clients nobody has filled since seven this morning — whoever they belonged to. One update by anyone, at any hour, takes a client off it. The hour in progress is not counted; nothing in it is late yet."
        />
      </Card>
    )
  }

  return (
    <>
      {/* The three numbers that decide whether this needs acting on now. */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:SP[3], marginBottom:SP[4] }}>
        <Card>
          <div className="eyebrow">Still not updated</div>
          <div style={{ color:C.red, fontSize:'30px', fontWeight:800, marginTop:'6px' }}>{clients.length}</div>
          <div style={{ color:C.muted, fontSize:T.xs, marginTop:'4px' }}>nobody has filled these since 7am</div>
        </Card>
        <Card>
          <div className="eyebrow">Vehicles behind them</div>
          <div style={{ color:C.amber, fontSize:'30px', fontWeight:800, marginTop:'6px' }}>{totalVehicles.toLocaleString()}</div>
          <div style={{ color:C.muted, fontSize:T.xs, marginTop:'4px' }}>unwatched all day</div>
        </Card>
        <Card>
          <div className="eyebrow">Slots missed</div>
          <div style={{ color:C.text, fontSize:'30px', fontWeight:800, marginTop:'6px' }}>{totalSlots}</div>
          <div style={{ color:C.muted, fontSize:T.xs, marginTop:'4px' }}>client-hours across the day</div>
        </Card>
      </div>

      <Card pad={false} style={{ overflow:'hidden' }}>
        <div style={{ padding:SP[3], borderBottom:`1px solid ${C.border}` }}>
          <SearchInput value={q} onChange={setQ} placeholder="Filter clients…" />
        </div>

        {rows.length === 0 ? (
          <EmptyState icon="search" title="No client matches that." />
        ) : rows.map(c => {
          const isOpen = open === c.client
          return (
            <div key={c.client} style={{ borderBottom:`1px solid ${C.border}` }}>
              <button
                onClick={() => setOpen(isOpen ? null : c.client)}
                className="row-hover"
                style={{
                  display:'flex', alignItems:'center', gap:SP[3], width:'100%',
                  background:'transparent', border:'none', padding:'13px 14px', textAlign:'left',
                }}
              >
                <span style={{ width:'8px', height:'8px', borderRadius:'50%', background:C.red, flexShrink:0 }} />
                <span style={{ flex:1, minWidth:0 }}>
                  <span className="ellip" style={{ display:'block', color:C.text, fontSize:T.base, fontWeight:700 }}>
                    {c.client}
                  </span>
                  <span style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'3px' }}>
                    {(c.vehicleCount || 0).toLocaleString()} vehicles
                    {c.firstHour != null && <> · due since {fmtHour(c.firstHour)}</>}
                    {c.lastOwner && <> · last with <span style={{ color:C.text2 }}>{c.lastOwner}</span></>}
                  </span>
                </span>
                <Tag color={C.red}>{c.pending} MISSED</Tag>
                <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color={C.muted} />
              </button>

              {/* Who held it, hour by hour. This is the answer to "who was
                  supposed to do this?" — and with several names on it, the
                  answer is usually that it was handed on rather than skipped
                  by one person. */}
              {isOpen && (
                <div style={{ background:SURF.sunken, padding:SP[3], borderTop:`1px solid ${C.border}` }}>
                  {c.slots.map((s, i) => (
                    <div key={i} style={{
                      display:'flex', alignItems:'center', gap:SP[3],
                      padding:'8px 10px', borderRadius:R.sm,
                      background: i % 2 ? 'transparent' : C.border + '33',
                    }}>
                      <span style={{ color:C.text2, fontSize:T.base, fontWeight:700, width:'62px', flexShrink:0 }}>
                        {fmtHour(s.hour)}
                      </span>
                      <span style={{ flex:1, minWidth:0, color:C.text, fontSize:T.base }} className="ellip">
                        {s.owner}
                      </span>
                      <span style={{ color:C.red, fontSize:T.xs, fontWeight:600 }}>not updated</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </Card>
    </>
  )
}
