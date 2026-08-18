import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import Icon from '../Icons'
import { C } from '../Widgets'
import {
  Card, Button, Tag, Segmented, Field, SearchInput, EmptyState, Banner,
  Meter, T, R, SP, SURF, fmtHour, fmtHourSlot, useToast,
} from '../ui'

const STATUS_OPTIONS  = ['', 'Updated', 'No New Misalignment', 'All Vehicles are Offline', 'No Misalignment']
const FATIGUE_OPTIONS = ['No', 'Yes']

// The fields that make up one client's record. Kept in one place because
// three things need to agree on it: the draft, the dirty check, and what
// gets posted. /api/crm/update rewrites the whole row, so a save must
// always carry every field — sending only the one that changed would blank
// the rest.
const FIELDS = ['liveVehicles', 'status', 'misalignVehicles', 'alertCount', 'fatigue', 'fatigueCount', 'notes']

function blankRecord() {
  return { liveVehicles:'', status:'', misalignVehicles:'', alertCount:'', fatigue:'No', fatigueCount:'', notes:'' }
}

function recordOf(filled, client) {
  const f = filled[client] || {}
  return {
    liveVehicles:     f.liveVehicles || '',
    status:           f.status || '',
    misalignVehicles: f.misalignVehicles || '',
    alertCount:       f.alertCount || '',
    fatigue:          f.fatigue || 'No',
    fatigueCount:     f.fatigueCount || '',
    notes:            f.notes || '',
  }
}

function isDone(filled, client) {
  return !!(filled[client]?.status || '').toString().trim()
}

// How many vehicle numbers are actually listed. The sheet column is a
// free-text list, so this is the honest count rather than parseInt of it.
function countVehicles(cell) {
  return (cell || '').toString().split(/[,\n]+/).map(s => s.trim()).filter(Boolean).length
}

// An empty list has three quite different meanings, and saying only "no
// clients" leaves the employee guessing which one they're looking at —
// most often after clocking in early, when the page looks broken.
// Is `hour` inside this window? The window may wrap past midnight.
function inWindow(w, hour) {
  if (!w || w.start == null || w.end == null || hour == null) return true
  return w.end <= w.start
    ? (hour >= w.start || hour < w.end)
    : (hour >= w.start && hour < w.end)
}

function emptyMessage({ scheduledThisHour, clockedOut, myWindow, currentHour }) {
  if (clockedOut) {
    return {
      icon: 'check-circle', tone: 'good',
      title: 'Your shift has ended.',
      detail: 'Anything still open went to whoever is on shift now.',
    }
  }
  if (scheduledThisHour === false && myWindow) {
    // Outside the window has two quite different meanings, and saying the
    // wrong one is worse than saying nothing: somebody still clocked in at
    // half past eight in the evening was being told their shift starts at ten
    // in the morning, as though they had turned up eleven hours early.
    const beforeStart = !inWindow(myWindow, currentHour) && currentHour < myWindow.start && myWindow.end > myWindow.start
    if (!beforeStart) {
      return {
        icon: 'clock', tone: 'warn',
        title: `Your shift window ended at ${fmtHour(myWindow.end)}.`,
        detail: 'Nothing further is assigned to you — later hours belong to whoever is on shift now. End your shift so your hours are recorded, or use OT if you are staying on.',
      }
    }
    return {
      icon: 'clock', tone: 'warn',
      title: `Your shift starts at ${fmtHour(myWindow.start)}.`,
      detail: 'This hour belongs to whoever is on shift right now. Your clients appear the moment your shift begins.',
    }
  }
  return {
    icon: 'sparkles', tone: 'neutral',
    title: 'No clients assigned for this slot.',
    detail: 'Nothing is due for you this hour. The board fills itself at the top of the next one.',
  }
}

export default function MyClientsTab({
  clients, filled, saveClient, currentHour, canEdit = true,
  scheduledThisHour, clockedOut, myWindow,
  // The board is no longer locked to the hour in progress. The rail above it
  // can select any hour of the shift, and saving an earlier one is the same
  // call with the hour passed through — /api/crm/update has always taken the
  // slot as an argument.
  hour, hourState = 'current',
  // { client, at } — a request from outside (the rail's "Up next") to put a
  // particular client in the detail pane. Carries a timestamp so asking for
  // the same client twice still registers as a new request.
  focusRequest,
}) {
  const slot = hour == null ? currentHour : hour
  const isNow = slot === currentHour
  // An hour that hasn't begun has nothing to record against it yet.
  const upcoming = hourState === 'upcoming' && !isNow
  const editable = canEdit && !upcoming
  const [selected, setSelected] = useState(null)
  // Drafts are keyed by HOUR and client, not client alone.
  //
  // The rail can move the board between hours without remounting this
  // component, and the same client appears in many hours of a shift. Keyed by
  // name only, an unsaved edit typed against Zingbus at 3AM reappeared as
  // Zingbus's record at 4AM — and saving it wrote those values to the 4AM
  // slot. Silent, and wrong in the sheet.
  const [drafts, setDrafts]     = useState({})
  const [query, setQuery]       = useState('')
  const [filter, setFilter]     = useState('pending')
  const [savingNow, setSavingNow] = useState(false)
  const [justSaved, setJustSaved] = useState(null)
  const [toastNode, toast]      = useToast()
  const listRef = useRef(null)

  const customEntry = clients.find(c => c.isCustom)
  const realClients = useMemo(() => clients.filter(c => !c.isCustom), [clients])

  const doneCount    = realClients.filter(c => isDone(filled, c.client)).length
  const pendingCount = realClients.length - doneCount
  const pct = realClients.length ? Math.round((doneCount / realClients.length) * 100) : 0

  // ── The list on the left, after search and filter ──
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return realClients.filter(c => {
      if (q && !c.client.toLowerCase().includes(q)) return false
      const done = isDone(filled, c.client)
      if (filter === 'pending') return !done
      if (filter === 'done')    return done
      return true
    })
  }, [realClients, filled, query, filter])

  // Keep a selection alive at all times. When the filter or the hour empties
  // the current one out, fall to the first thing still on screen rather than
  // leaving the detail pane blank.
  useEffect(() => {
    if (selected && realClients.some(c => c.client === selected)) return
    setSelected(visible[0]?.client || realClients[0]?.client || null)
  }, [realClients, visible, selected])

  // Asked for from outside. Search and filter both get cleared first —
  // selecting a client the list is currently hiding would move the detail pane
  // to a row that isn't on screen, which reads as the button doing nothing.
  //
  // Handled exactly once per request. Keyed only on the request, a client list
  // that refreshes every thirty seconds would re-apply the last focus for the
  // rest of the shift — wiping whatever the operator had typed into the search
  // box each time the poll came back.
  const handledFocusRef = useRef(null)
  useEffect(() => {
    if (!focusRequest?.client) return
    const token = `${focusRequest.at || ''}|${focusRequest.client}`
    if (handledFocusRef.current === token) return
    if (!realClients.some(c => c.client === focusRequest.client)) return
    handledFocusRef.current = token
    setQuery('')
    setFilter('all')
    setSelected(focusRequest.client)
  }, [focusRequest, realClients])

  const dkey = useCallback((client) => `${slot}|${client}`, [slot])

  const draftOf = useCallback(
    (client) => drafts[dkey(client)] || recordOf(filled, client),
    [drafts, filled, dkey]
  )

  const dirty = useMemo(() => {
    if (!selected) return false
    const d = drafts[`${slot}|${selected}`]
    if (!d) return false
    const saved = recordOf(filled, selected)
    return FIELDS.some(f => (d[f] || '') !== (saved[f] || ''))
  }, [drafts, filled, selected, slot])

  function setField(client, field, value) {
    setDrafts(prev => {
      const k = `${slot}|${client}`
      const base = prev[k] || recordOf(filled, client)
      const next = { ...base, [field]: value }
      // Fatigue count only exists while fatigue is Yes — leaving a stale
      // number behind would be written to the sheet on the next save.
      if (field === 'fatigue' && value === 'No') next.fatigueCount = ''
      return { ...prev, [k]: next }
    })
  }

  // ── Save ──
  // One request carrying the whole record, rather than one per field per
  // keystroke as the old grid did. That was a Sheets write for every letter
  // typed into the misalignment box — the single biggest source of the
  // platform feeling slow, and of quota being spent on nothing.
  const doSave = useCallback(async (client, { advance = false } = {}) => {
    if (!client || !editable || savingNow) return
    const rec = drafts[`${slot}|${client}`]
    if (!rec) return
    setSavingNow(true)
    try {
      const ok = await saveClient(client, rec, slot)
      if (ok) {
        setDrafts(prev => { const n = { ...prev }; delete n[`${slot}|${client}`]; return n })
        setJustSaved(client)
        setTimeout(() => setJustSaved(s => (s === client ? null : s)), 1000)
        toast(`${client} saved`)
        if (advance) {
          // The next client still needing work, wrapping past the end. On a
          // pending-filtered list the row just saved disappears, so "next"
          // has to be worked out from the full list, not the visible one.
          const pool = realClients.filter(c => c.client === client || !isDone(filled, c.client))
          const idx  = pool.findIndex(c => c.client === client)
          const nxt  = pool.slice(idx + 1).find(c => c.client !== client) || pool.find(c => c.client !== client)
          if (nxt) setSelected(nxt.client)
        }
      } else {
        toast('Could not save — try again', 'error')
      }
    } finally {
      setSavingNow(false)
    }
  }, [drafts, editable, savingNow, saveClient, realClients, filled, toast, slot])

  function step(delta) {
    if (!visible.length) return
    const i = visible.findIndex(c => c.client === selected)
    const next = visible[(i + delta + visible.length) % visible.length]
    if (next) setSelected(next.client)
  }

  // ── Keyboard ──
  // Ctrl/Cmd+S saves. Alt+↑/↓ moves between clients — plain arrows are left
  // alone so they still work inside the fields themselves.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        if (dirty) doSave(selected)
        return
      }
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault()
        step(e.key === 'ArrowDown' ? 1 : -1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, selected, doSave, visible])

  // Keep the selected row in view when it moves by keyboard.
  useEffect(() => {
    if (!selected || !listRef.current) return
    const el = listRef.current.querySelector(`[data-client="${CSS.escape(selected)}"]`)
    if (el) el.scrollIntoView({ block:'nearest' })
  }, [selected])

  // ── An hour spent on something other than fleet work ──
  if (customEntry) {
    return (
      // A minimum height, so an hour with no board doesn't collapse into a
      // strip beside a full-height rail and read as a half-loaded page.
      <Card style={{ padding:0, overflow:'hidden', minHeight:'420px', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ padding:'48px 24px', textAlign:'center' }}>
          <div style={{
            width:'52px', height:'52px', borderRadius:R.lg, background:C.accentDark,
            display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px',
          }}>
            <Icon name="sparkles" size={24} color={C.accent} />
          </div>
          <div className="eyebrow" style={{ marginBottom:'10px' }}>{fmtHourSlot(slot)}</div>
          <div style={{ color:C.text, fontSize:T.xl, fontWeight:800, letterSpacing:'-0.3px' }}>
            {customEntry.client}
          </div>
          <div style={{ color:C.muted, fontSize:T.base, marginTop:'10px', maxWidth:'380px', margin:'10px auto 0', lineHeight:1.65 }}>
            This hour is set aside for this, so no client fleets are assigned to you.
            Your board fills again at {fmtHour((slot + 1) % 24)}.
          </div>
        </div>
      </Card>
    )
  }

  // ── Nothing assigned ──
  if (realClients.length === 0) {
    const m = emptyMessage({ scheduledThisHour, clockedOut, myWindow, currentHour })
    return (
      <Card pad={false} style={{ minHeight:'420px', display:'flex', flexDirection:'column' }}>
        {!canEdit && <ReadOnlyStrip clockedOut={clockedOut} />}
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <EmptyState icon={m.icon} tone={m.tone} title={m.title} detail={m.detail} />
        </div>
      </Card>
    )
  }

  const sel     = selected
  const rec     = sel ? draftOf(sel) : blankRecord()
  const selMeta = realClients.find(c => c.client === sel)
  const selDone = sel ? isDone(filled, sel) : false
  const savedAt = sel ? (filled[sel]?.updatedAt || '') : ''
  const fatigueYes = rec.fatigue === 'Yes'

  return (
    <>
      {toastNode}

      {/* No hour header here. The rail above the board carries the hour and
          the rail beside it carries the count — repeating both on top of the
          board was three statements of the same fact competing for the same
          screen. An hour other than the one in progress still needs saying,
          because nothing else on screen would explain the different data. */}
      {!isNow && (
        <div style={{ marginBottom:SP[3] }}>
          <Banner tone="info" icon="calendar">
            {hourState === 'done' ? 'Viewing an earlier hour' : 'Viewing a later hour'} · {fmtHourSlot(slot)}
            {' — '}{doneCount} of {realClients.length} done
          </Banner>
        </div>
      )}

      {!editable && (
        <div style={{ marginBottom:SP[3] }}>
          <Banner tone="warn" icon="clock">
            {upcoming
              ? 'This hour hasn’t started yet — its clients become editable once it begins.'
              : clockedOut
                ? 'Your shift has ended — this board is read-only.'
                : 'View only — start your shift to make updates.'}
          </Banner>
        </div>
      )}

      {/* ══════════ SPLIT VIEW ══════════ */}
      {/* A fixed height, not a minimum. Without it the left rail grows to fit
          its own contents — 119 clients in a busy hour turned the page into a
          ten-thousand-pixel scroll and pushed the save bar off the bottom of
          the screen. Bounded, each side scrolls inside itself and the save
          buttons stay where they are. */}
      <div className="board-two" style={{
        height:'calc(100vh - 232px)', minHeight:'460px',
      }}>

        {/* ── LEFT: the whole hour, always visible ── */}
        <Card pad={false} className="board-list" style={{
          display:'flex', flexDirection:'column', overflow:'hidden',
        }}>
          <div style={{ padding:SP[3], borderBottom:`1px solid ${C.border}`, display:'flex', flexDirection:'column', gap:SP[2] }}>
            <SearchInput value={query} onChange={setQuery} placeholder="Filter clients…" />
            <Segmented
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value:'pending', label:'Pending', count:pendingCount },
                { value:'done',    label:'Done',    count:doneCount },
                { value:'all',     label:'All',     count:realClients.length },
              ]}
            />
          </div>

          <div ref={listRef} style={{ flex:1, overflowY:'auto', minHeight:0 }}>
            {visible.length === 0 ? (
              <div style={{ padding:'32px 20px', textAlign:'center', color:C.muted, fontSize:T.base, lineHeight:1.6 }}>
                {query
                  ? <>Nothing matches “{query}”.</>
                  : filter === 'pending'
                    ? 'Every client is updated. Nice work.'
                    : 'Nothing here yet.'}
              </div>
            ) : visible.map(c => {
              const done   = isDone(filled, c.client)
              const on     = c.client === sel
              const edited = !!drafts[`${slot}|${c.client}`]
              // Which client was last touched, and when — per row, on the list
              // itself. The old grid carried a LAST UPDATED column that said
              // "Updated at 3:14:02 pm" or "Still not updated" against every
              // client, and it is the one thing an operator scans the list for:
              // not just what is left, but how long something has been sitting.
              const at = (filled[c.client]?.updatedAt || '').toString().trim()
              return (
                <button
                  key={c.client}
                  data-client={c.client}
                  onClick={() => setSelected(c.client)}
                  className="row-hover"
                  style={{
                    display:'flex', alignItems:'center', gap:'10px', width:'100%',
                    background: on ? C.accentSoft : 'transparent',
                    border:'none',
                    borderLeft:`3px solid ${on ? C.accent : 'transparent'}`,
                    borderBottom:`1px solid ${C.border}`,
                    padding:'11px 13px 11px 10px', textAlign:'left',
                  }}
                >
                  <span style={{
                    width:'7px', height:'7px', borderRadius:'50%', flexShrink:0,
                    background: done ? C.accent : edited ? C.amber : C.dim,
                  }} />
                  <span style={{ flex:1, minWidth:0 }}>
                    <span className="ellip" style={{
                      display:'block', color: on ? C.text : C.text2,
                      fontSize:T.base, fontWeight: on ? 700 : 600,
                    }}>{c.client}</span>
                    <span style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'2px' }}>
                      {c.vehicleCount || 0} vehicles
                      {c.isSpecific && <span style={{ color:C.blue }}> · yours</span>}
                      {c.isRedistributed && c.fromEmployee && (
                        <span style={{ color:C.purple }}> · ↩ {c.fromEmployee}</span>
                      )}
                    </span>
                    <span className="ellip" style={{
                      display:'block', marginTop:'2px',
                      color: done ? C.accent : C.red,
                      fontSize:T.xs, fontWeight: done ? 500 : 600,
                    }}>
                      {done
                        ? (at ? `Updated at ${at}` : 'Updated')
                        : upcoming ? 'Not started yet' : 'Still not updated'}
                    </span>
                  </span>
                  {edited
                    ? <Tag color={C.amber}>UNSAVED</Tag>
                    : done && <Icon name="check-circle" size={15} color={C.accent} />}
                </button>
              )
            })}
          </div>
        </Card>

        {/* ── RIGHT: everything about the one client ── */}
        <Card pad={false} className="board-detail" style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column' }}>
          {!sel ? (
            <EmptyState icon="users" title="Pick a client from the list." />
          ) : (
            <>
              {/* Detail header */}
              <div style={{
                display:'flex', alignItems:'flex-start', justifyContent:'space-between',
                gap:SP[3], padding:SP[4], borderBottom:`1px solid ${C.border}`, flexWrap:'wrap',
              }}>
                <div style={{ minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:SP[2], flexWrap:'wrap' }}>
                    <span style={{ color:C.text, fontSize:T.xl, fontWeight:800, letterSpacing:'-0.4px' }}>{sel}</span>
                    {selMeta?.isSpecific && <Tag color={C.blue} dot>YOUR FIXED CLIENT</Tag>}
                    {dirty
                      ? <Tag color={C.amber} dot>UNSAVED</Tag>
                      : selDone
                        ? <Tag color={C.accent} dot>DONE</Tag>
                        : <Tag color={C.muted} dot>PENDING</Tag>}
                  </div>
                  <div style={{ color:C.muted, fontSize:T.base, marginTop:'5px' }}>
                    {selMeta?.vehicleCount || 0} vehicles · {fmtHour(slot)} slot
                    {selMeta?.isRedistributed && selMeta.fromEmployee && (
                      <span style={{ color:C.purple }}> · handed over by {selMeta.fromEmployee}</span>
                    )}
                    {/* Said either way round. "Last saved 3:14 pm" only appears
                        when there is something to say, so its absence used to
                        be the only sign that a client had never been touched. */}
                    {selDone
                      ? (savedAt ? <> · <span style={{ color:C.accent }}>updated at {savedAt}</span></> : null)
                      : <> · <span style={{ color: upcoming ? C.muted : C.red, fontWeight:600 }}>
                          {upcoming ? 'not started yet' : 'still not updated'}
                        </span></>}
                  </div>
                </div>
                <div style={{ display:'flex', gap:SP[2] }}>
                  <Button size="sm" variant="subtle" onClick={() => step(-1)} title="Previous client (Alt+↑)">↑ Prev</Button>
                  <Button size="sm" variant="subtle" onClick={() => step(1)}  title="Next client (Alt+↓)">Next ↓</Button>
                </div>
              </div>

              {/* The record. Scrolls on its own so the save bar below stays
                  pinned rather than being pushed out of reach. */}
              <div style={{ padding:SP[4], flex:1, minHeight:0, overflowY:'auto', display:'flex', flexDirection:'column', gap:SP[4] }}>
                {/* How many of this client's vehicles were actually watched
                    this hour. Asked first, because it is the thing you know as
                    soon as you have looked — and the client's fleet size next
                    to it is what makes the number mean something. */}
                <Field
                  label="Live vehicles checked"
                  hint={`Out of ${selMeta?.vehicleCount || 0} on this client's fleet — how many were live on screen`}
                >
                  <input
                    disabled={!editable} type="number" min="0" max={selMeta?.vehicleCount || undefined}
                    placeholder={`0 – ${selMeta?.vehicleCount || 0}`}
                    value={rec.liveVehicles}
                    onChange={e => setField(sel, 'liveVehicles', e.target.value)}
                  />
                </Field>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 150px', gap:SP[3] }}>
                  <Field label="Status" hint="This is what marks the client complete.">
                    <select
                      disabled={!editable}
                      value={rec.status}
                      onChange={e => setField(sel, 'status', e.target.value)}
                    >
                      {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o || '— select —'}</option>)}
                    </select>
                  </Field>
                  <Field label="Alert count">
                    <input
                      disabled={!editable} type="number" min="0" placeholder="0"
                      value={rec.alertCount}
                      onChange={e => setField(sel, 'alertCount', e.target.value)}
                    />
                  </Field>
                </div>

                <Field
                  label="Misaligned vehicles"
                  hint={countVehicles(rec.misalignVehicles) > 0
                    ? `Comma separated — ${countVehicles(rec.misalignVehicles)} vehicle${countVehicles(rec.misalignVehicles)===1?'':'s'} flagged`
                    : 'Comma separated, e.g. KA01AB1234, KA02CD5678'}
                >
                  <input
                    disabled={!editable} placeholder="KA01AB1234, KA02CD5678"
                    value={rec.misalignVehicles}
                    onChange={e => setField(sel, 'misalignVehicles', e.target.value)}
                  />
                </Field>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 150px', gap:SP[3] }}>
                  <Field label="Fatigue">
                    <select
                      disabled={!editable}
                      value={rec.fatigue}
                      onChange={e => setField(sel, 'fatigue', e.target.value)}
                    >
                      {FATIGUE_OPTIONS.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </Field>
                  <Field label="Fatigue count">
                    <input
                      disabled={!editable || !fatigueYes} type="number" min="0"
                      placeholder={fatigueYes ? '0' : '—'}
                      value={rec.fatigueCount}
                      onChange={e => setField(sel, 'fatigueCount', e.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Notes" hint="Optional — anything the next shift should know.">
                  <textarea
                    disabled={!editable} rows={2} placeholder="Anything worth passing on…"
                    value={rec.notes}
                    onChange={e => setField(sel, 'notes', e.target.value)}
                    style={{ resize:'vertical', minHeight:'56px' }}
                  />
                </Field>
              </div>

              {/* Save bar */}
              <div style={{
                display:'flex', alignItems:'center', gap:SP[2],
                padding:SP[4], borderTop:`1px solid ${C.border}`, background:SURF.sunken,
                borderBottomLeftRadius:R.lg, borderBottomRightRadius:R.lg, flexWrap:'wrap',
              }}>
                <div style={{ flex:1, minWidth:'140px', color:C.muted, fontSize:T.xs }}>
                  {!editable
                    ? (upcoming ? 'This hour hasn’t started yet' : 'Read-only')
                    : justSaved === sel
                      ? <span style={{ color:C.accent, fontWeight:600 }}>✓ Saved</span>
                      : dirty
                        ? <span style={{ color:C.amber, fontWeight:600 }}>Unsaved changes</span>
                        : <>Ctrl+S to save · Alt+↑↓ to change client</>}
                </div>
                <Button
                  variant="ghost" size="md" disabled={!editable || !dirty} loading={savingNow}
                  onClick={() => doSave(sel)}
                >Save</Button>
                <Button
                  variant="primary" size="md" disabled={!editable || !dirty} loading={savingNow}
                  onClick={() => doSave(sel, { advance: true })}
                >Save &amp; next ↓</Button>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  )
}

function ReadOnlyStrip({ clockedOut }) {
  return (
    <div style={{
      background:'#FFC10710', borderBottom:`1px solid ${C.amber}2e`,
      padding:'11px 16px', color:C.amber, fontSize:T.base, fontWeight:600,
    }}>
      {clockedOut ? 'Your shift has ended — read-only.' : 'View only — start your shift to make updates.'}
    </div>
  )
}
