// ══════════════════════════════════════════════════════════════════════
// Client rules — days a client is off, and notes pinned to an hour
//
// Two things an admin can say about a client, on one screen because they are
// the same kind of statement and were asked for together:
//
//   OFF FOR THE DAY   pick clients, pick dates (future dates included), and
//                     they come off every board for those days. Not counted
//                     as work anybody missed, because it was never due.
//
//   NOTE FOR AN HOUR  pick clients, pick hours, write a note. Whoever holds
//                     that client in that hour sees the note and finds the
//                     client at the top of their list. No date — it stands
//                     until it is deleted.
//
// ── The hours offered are the client's own ────────────────────────────
//
// Client_Timings decides which hours a client runs in, so those are the only
// hours a note can be attached to. Offering all twenty-four would let somebody
// write a note nobody could ever be shown — the exact fault that let a client
// with no hours reach a board in the first place, which is what this screen
// exists partly to make impossible.
// ══════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, CardHead, Button, Segmented, Tag, Field, SearchInput,
         EmptyState, Table, T, R, SP, SURF, fmtHour, useToast } from '../ui'
import { fetchJSON } from '../../lib/fetchJson'

const isoOf = (d) => {
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
const fromISO = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}
// The other direction. Needed because dd/mm/yyyy strings do not sort —
// "05/09/2026" reads as later than "30/08/2026" to a string comparison — so
// anything comparing dates has to do it in ISO.
const toISO = (d) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || '')
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
// The operating day, 07:00 to 07:00 — before seven the platform is still on
// yesterday's date, so "today" on this screen has to mean the same thing it
// means everywhere else.
function operatingToday() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  if (d.getHours() < 7) d.setDate(d.getDate() - 1)
  return d
}

export default function ClientRulesPanel() {
  const [mode, setMode]   = useState('hidden')
  const [data, setData]   = useState(null)
  const [loading, setLoad] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy]   = useState(false)
  const [toastNode, toast] = useToast()

  const load = useCallback(async () => {
    setLoad(true)
    const r = await fetchJSON('/api/admin/client-rules')
    if (r.ok && r.data) { setData(r.data); setError('') }
    else { setError(r.failed ? `The server did not answer (${r.error}).` : (r.data?.error || `The server answered ${r.status}.`)) }
    setLoad(false)
  }, [])
  useEffect(() => { load() }, [load])

  const clients = data?.clients || []

  const send = async (body, okMsg) => {
    setBusy(true)
    const r = await fetchJSON('/api/admin/client-rules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (r.ok && r.data?.ok) { toast(okMsg); await load(); return true }
    // The server's own message is the useful one — it names the client or the
    // hour that was refused. Replacing it with "could not save" would throw
    // away the only thing that says what to do next.
    toast(r.data?.error || (r.failed ? `No answer from the server (${r.error})` : `Failed (${r.status})`), 'error')
    return false
  }

  return (
    <div style={{ maxWidth:'1060px', margin:'0 auto' }}>
      {toastNode}

      <Card style={{ marginBottom:SP[4] }}>
        <Segmented
          value={mode} onChange={setMode}
          options={[
            { value:'hidden', label:'Off for the day' },
            { value:'note',   label:'Note for an hour' },
          ]}
        />
        <div style={{ color:C.muted, fontSize:T.xs, marginTop:SP[3] }}>
          {mode === 'hidden'
            ? 'Takes a client off every board for the dates you pick — today or any day ahead. It is not counted as missed work, because it was never due.'
            : 'Whoever gets this client in this hour sees the note, and finds the client at the top of their list. No date — it stands until you remove it.'}
        </div>
      </Card>

      {error ? (
        <Card pad={false}>
          <EmptyState icon="offline" tone="warn" title="Could not load the client rules"
                      detail={error} action={<Button variant="primary" onClick={load}>Try again</Button>} />
        </Card>
      ) : loading && !data ? (
        <Card><div style={{ display:'flex', justifyContent:'center', padding:'2.5rem' }}><div className="spinner" /></div></Card>
      ) : mode === 'hidden' ? (
        <HiddenSection clients={clients} rows={data.hidden} busy={busy} send={send} />
      ) : (
        <NoteSection clients={clients} rows={data.notes} busy={busy} send={send} />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Off for the day
// ══════════════════════════════════════════════════════════════════════
function HiddenSection({ clients, rows, busy, send }) {
  const [picked, setPicked] = useState([])
  const [dates, setDates]   = useState([])
  const [oneDate, setOneDate] = useState(() => isoOf(operatingToday()))
  const [reason, setReason] = useState('')

  // ── "Today" moves, and this screen may be open when it does ──────────
  //
  // The operating day rolls at seven in the morning and this floor works
  // through it. A tab left open across that rollover would keep offering
  // yesterday as the earliest date, and an admin could add a day that has
  // already finished and been settled. Re-checked every minute so the picker
  // and its minimum move with the clock. The server refuses a past date too —
  // this is so nobody is offered one in the first place.
  const [floorToday, setFloorToday] = useState(() => isoOf(operatingToday()))
  useEffect(() => {
    const t = setInterval(() => setFloorToday(isoOf(operatingToday())), 60000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    setOneDate(d => (d < floorToday ? floorToday : d))
    // Compared as ISO. The list holds dd/mm/yyyy, and those do not sort:
    // "05/09/2026" reads as later than "30/08/2026" to a string comparison.
    setDates(ds => ds.filter(d => toISO(d) >= floorToday))
  }, [floorToday])

  const addDate = () => {
    const d = fromISO(oneDate)
    if (d && !dates.includes(d)) setDates([...dates, d])
  }

  const save = async () => {
    const ok = await send(
      { kind:'hidden', action:'add', clients: picked, dates, reason },
      `${picked.length} client${picked.length === 1 ? '' : 's'} taken off ${dates.length} day${dates.length === 1 ? '' : 's'}.`)
    if (ok) { setPicked([]); setDates([]); setReason('') }
  }

  return (
    <>
      <Card style={{ marginBottom:SP[4] }}>
        <CardHead title="Take clients off a day" sub="Pick the clients, then the dates. Both can be more than one." />

        <ClientPicker clients={clients} picked={picked} setPicked={setPicked} />

        <div style={{ display:'flex', alignItems:'flex-end', gap:SP[3], flexWrap:'wrap', marginTop:SP[4] }}>
          <Field label="Date" hint="Today or any day ahead" style={{ minWidth:'170px' }}>
            <input type="date" value={oneDate} min={floorToday}
                   onChange={e => setOneDate(e.target.value)} />
          </Field>
          <Button variant="ghost" icon="plus" onClick={addDate}>Add date</Button>
        </div>

        {dates.length > 0 && (
          <div style={{ display:'flex', gap:SP[2], flexWrap:'wrap', marginTop:SP[3] }}>
            {dates.map(d => (
              <Chip key={d} label={d} onRemove={() => setDates(dates.filter(x => x !== d))} />
            ))}
          </div>
        )}

        <Field label="Reason" hint="Optional — kept in the sheet so the record says why." style={{ marginTop:SP[4] }}>
          <input placeholder="e.g. fleet off the road, client on holiday"
                 value={reason} onChange={e => setReason(e.target.value)} />
        </Field>

        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:SP[4] }}>
          <Button variant="primary" loading={busy} disabled={!picked.length || !dates.length} onClick={save}>
            Take off {picked.length || 0} × {dates.length || 0} day{dates.length === 1 ? '' : 's'}
          </Button>
        </div>
      </Card>

      <Card pad={false}>
        <div style={{ padding:SP[4], paddingBottom:0 }}>
          <CardHead title="Currently off" sub="Past days are kept so the record of what was taken off, and when, survives." />
        </div>
        <Table
          cols={[
            { key:'date', label:'Date' },
            { key:'client', label:'Client', render: r => <span style={{ color:C.text, fontWeight:600 }}>{r.client}</span> },
            { key:'act', label:'', align:'right', render: r => (
              <Button variant="ghost" onClick={() =>
                send({ kind:'hidden', action:'remove', clients:[r.client], dates:[r.date] },
                     `${r.client} is back on ${r.date}.`)}>Put back</Button>
            )},
          ]}
          rows={rows}
          rowKey={r => `${r.date}|${r.client}`}
          empty={<EmptyState icon="check-circle" title="Nothing is taken off any day."
                             detail="Every client in Client_Timings is running as scheduled." />}
        />
      </Card>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Note for an hour
// ══════════════════════════════════════════════════════════════════════
function NoteSection({ clients, rows, busy, send }) {
  const [picked, setPicked] = useState([])
  const [hours, setHours]   = useState([])
  const [note, setNote]     = useState('')

  // Only the hours EVERY chosen client actually runs in. Picking two clients
  // whose hours do not overlap should offer nothing rather than offering an
  // hour that will be refused on save — the screen and the server have to
  // agree about what is possible.
  const offered = useMemo(() => {
    if (!picked.length) return []
    const lists = picked.map(name => new Set(clients.find(c => c.client === name)?.hours || []))
    return [...lists[0]].filter(h => lists.every(s => s.has(h))).sort((a, b) => a - b)
  }, [picked, clients])

  // Deselect any hour that stopped being offered when the client list changed,
  // or the form would post an hour the server is bound to refuse.
  useEffect(() => { setHours(hs => hs.filter(h => offered.includes(h))) }, [offered])

  const save = async () => {
    const ok = await send(
      { kind:'note', action:'add', clients: picked, hours, note },
      `Note pinned to ${picked.length} client${picked.length === 1 ? '' : 's'} at ${hours.length} hour${hours.length === 1 ? '' : 's'}.`)
    if (ok) { setPicked([]); setHours([]); setNote('') }
  }

  return (
    <>
      <Card style={{ marginBottom:SP[4] }}>
        <CardHead title="Pin a note to an hour" sub="The client goes to the top of that hour's board, with the note on it." />

        <ClientPicker clients={clients} picked={picked} setPicked={setPicked} showHours />

        <div style={{ marginTop:SP[4] }}>
          <div className="eyebrow" style={{ marginBottom:'6px' }}>Hours</div>
          {!picked.length ? (
            <div style={{ color:C.dim, fontSize:T.xs }}>Pick a client first — the hours offered are the ones it runs in.</div>
          ) : offered.length === 0 ? (
            <div style={{ color:C.amber, fontSize:T.xs }}>
              These clients share no hour in Client_Timings. Pick fewer, or ones that run together.
            </div>
          ) : (
            <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
              {offered.map(h => {
                const on = hours.includes(h)
                return (
                  <button key={h} className="pressable"
                    onClick={() => setHours(on ? hours.filter(x => x !== h) : [...hours, h])}
                    style={{
                      background: on ? C.accent + '22' : SURF.raised,
                      border:`1px solid ${on ? C.accent : C.border2}`,
                      color: on ? C.accent : C.text2,
                      borderRadius:R.sm, padding:'6px 11px',
                      fontSize:T.xs, fontWeight:700,
                    }}>{fmtHour(h)}</button>
                )
              })}
            </div>
          )}
        </div>

        <Field label="Note" hint="Shown highlighted on the client, for whoever gets it that hour." style={{ marginTop:SP[4] }}>
          <input placeholder="e.g. Driver camera blurred — check carefully"
                 value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
        </Field>

        <div style={{ display:'flex', justifyContent:'flex-end', marginTop:SP[4] }}>
          <Button variant="primary" loading={busy}
                  disabled={!picked.length || !hours.length || !note.trim()} onClick={save}>
            Pin to {picked.length || 0} × {hours.length || 0} hour{hours.length === 1 ? '' : 's'}
          </Button>
        </div>
      </Card>

      <Card pad={false}>
        <div style={{ padding:SP[4], paddingBottom:0 }}>
          <CardHead title="Notes in force" sub="These stand until they are removed — they carry no date." />
        </div>
        <Table
          cols={[
            { key:'client', label:'Client', render: r => <span style={{ color:C.text, fontWeight:600 }}>{r.client}</span> },
            { key:'hour', label:'Hour', render: r => fmtHour(r.hour) },
            { key:'note', label:'Note', render: r => (
              <span style={{ color:C.amber, fontWeight:600 }}>{r.note}</span>
            )},
            { key:'act', label:'', align:'right', render: r => (
              <Button variant="ghost" onClick={() =>
                send({ kind:'note', action:'remove', clients:[r.client], hours:[r.hour] },
                     `Note removed from ${r.client} at ${fmtHour(r.hour)}.`)}>Remove</Button>
            )},
          ]}
          rows={rows}
          rowKey={r => `${r.client}|${r.hour}`}
          empty={<EmptyState icon="sparkles" title="No notes pinned."
                             detail="Pin one above and whoever holds that client in that hour will see it first." />}
        />
      </Card>
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════
// The client picker — typed search, because there are 410 of them
// ══════════════════════════════════════════════════════════════════════
function ClientPicker({ clients, picked, setPicked, showHours = false }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  // A click anywhere else closes the suggestions, or the list sits over the
  // form for the rest of the session.
  useEffect(() => {
    const away = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase()
    return clients
      .filter(c => !picked.includes(c.client))
      .filter(c => !s || c.client.toLowerCase().includes(s))
      .slice(0, 40)
  }, [clients, picked, q])

  const add = (name) => { setPicked([...picked, name]); setQ('') }

  return (
    <div ref={boxRef} style={{ position:'relative' }}>
      <div className="eyebrow" style={{ marginBottom:'6px' }}>Clients</div>

      {picked.length > 0 && (
        <div style={{ display:'flex', gap:SP[2], flexWrap:'wrap', marginBottom:SP[3] }}>
          {picked.map(name => (
            <Chip key={name} label={name} onRemove={() => setPicked(picked.filter(x => x !== name))} />
          ))}
        </div>
      )}

      <SearchInput value={q} onChange={(v) => { setQ(v); setOpen(true) }}
                   placeholder="Type to search all clients…" />

      {open && matches.length > 0 && (
        <div style={{
          position:'absolute', zIndex:20, left:0, right:0, marginTop:'4px',
          background:SURF.raised, border:`1px solid ${C.border2}`, borderRadius:R.md,
          maxHeight:'260px', overflowY:'auto', boxShadow:'0 12px 30px #00000080',
        }}>
          {matches.map(c => (
            <button key={c.client} className="row-hover" onClick={() => add(c.client)}
              style={{
                display:'flex', width:'100%', alignItems:'center', justifyContent:'space-between',
                gap:SP[3], background:'transparent', border:'none', textAlign:'left',
                padding:'9px 12px', color:C.text2, fontSize:T.base,
              }}>
              <span className="ellip">{c.client}</span>
              {/* The hours are shown here on purpose: it is the moment somebody
                  finds out a client has NO hours set, which is exactly the
                  state that used to put it on a board it did not belong on. */}
              <span style={{ color: c.hours.length ? C.dim : C.amber, fontSize:T.xs, flexShrink:0 }}>
                {c.hours.length ? (showHours ? c.hours.map(fmtHour).join(' · ') : `${c.hours.length} hrs`) : 'no hours set'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function Chip({ label, onRemove }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:'6px',
      background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.full,
      padding:'4px 6px 4px 11px', color:C.text2, fontSize:T.xs, fontWeight:600,
    }}>
      {label}
      <button onClick={onRemove} className="pressable" title="Remove"
        style={{
          display:'flex', alignItems:'center', justifyContent:'center',
          width:'17px', height:'17px', borderRadius:R.full,
          background:C.bg, border:`1px solid ${C.border2}`, flexShrink:0,
        }}>
        <Icon name="minus" size={9} color={C.muted} />
      </button>
    </span>
  )
}
