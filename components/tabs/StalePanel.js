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

  // ── Whose are they? ──────────────────────────────────────────────────
  //
  // The list answers "what is still waiting"; this answers "who do I go and
  // ask". A client counts for everyone who held it in an hour that has
  // finished — the same test the employee's own panel uses, so the number
  // beside a name here is the number that person sees on their dashboard.
  //
  // Because a client handed from one person to the next is on both their
  // boards, these counts can add up to more than the total above. That is the
  // honest answer to "whose is it" and the header says so rather than picking
  // one owner and hiding the rest.
  const byEmployee = useMemo(() => {
    const m = new Map()
    clients.forEach(c => {
      const owners = new Set((c.slots || []).map(s => s.owner).filter(Boolean))
      owners.forEach(name => {
        const rec = m.get(name) || { name, clients: 0, vehicles: 0 }
        rec.clients++
        rec.vehicles += c.vehicleCount || 0
        m.set(name, rec)
      })
    })
    return [...m.values()].sort((a, b) => b.clients - a.clients || b.vehicles - a.vehicles)
  }, [clients])

  const worst = byEmployee.length ? byEmployee[0].clients : 0

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

      {/* Who to go and ask, before the list of what. */}
      {byEmployee.length > 0 && (
        <Card pad={false} style={{ overflow:'hidden', marginBottom:SP[4] }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${C.border}` }}>
            <div className="eyebrow">By employee</div>
            <div style={{ color:C.muted, fontSize:T.xs, marginTop:'3px' }}>
              clients still waiting on each person&apos;s board · a client handed on
              counts for everyone who held it, so these can total more than {clients.length}
            </div>
          </div>
          <div style={{ padding:SP[3], display:'flex', flexDirection:'column', gap:'9px' }}>
            {byEmployee.map(e => (
              <div key={e.name} style={{ display:'flex', alignItems:'center', gap:SP[3] }}>
                <span className="ellip" style={{ width:'132px', flexShrink:0, color:C.text, fontSize:T.base, fontWeight:600 }}>
                  {e.name}
                </span>
                {/* Bar against the worst offender, so the shape of the floor
                    reads at a glance rather than needing the numbers compared. */}
                <span style={{ flex:1, minWidth:0, height:'8px', borderRadius:'99px', background:C.border, overflow:'hidden' }}>
                  <span style={{
                    display:'block', height:'100%', borderRadius:'99px', background:C.red,
                    width: `${worst ? Math.max(4, (e.clients / worst) * 100) : 0}%`,
                  }} />
                </span>
                <span style={{ color:C.text, fontSize:T.base, fontWeight:700, width:'34px', textAlign:'right', flexShrink:0 }}>
                  {e.clients}
                </span>
                <span style={{ color:C.muted, fontSize:T.xs, width:'96px', textAlign:'right', flexShrink:0 }}>
                  {e.vehicles.toLocaleString()} veh
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

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
