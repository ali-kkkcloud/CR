// ══════════════════════════════════════════════════════════════════════
// Attendance — in, out, and how long away
//
// The first three things a supervisor checks each morning, and until now the
// Command Center could not answer any of them in one place: what time did
// each person clock in, what time did they clock out, and how much break did
// they take. The clock-in and clock-out lived in the floor list as a single
// "in 09:04 am" fragment with no matching out; the break minutes lived on a
// different tab entirely, so lining the two up meant reading one screen
// against another and doing the arithmetic by eye.
//
// It sits at the very top of the Dashboard because it is a register, not an
// analysis: you read it once, top to bottom, and you know who turned up.
//
// A break still running is counted up to this minute and marked, because
// somebody who walked away an hour ago and has not come back is precisely
// the row that matters — reading it as "0m break" would be the one thing
// this panel must never do.
// ══════════════════════════════════════════════════════════════════════
import { useState, useMemo } from 'react'
import { C } from '../Widgets'
import { Card, SearchInput, Tag, EmptyState, Segmented, T, R, SP, SURF } from '../ui'

function fmtMins(m) {
  const v = Math.max(0, Math.round(m || 0))
  const h = Math.floor(v / 60), mm = v % 60
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`
}

function fmtHour(h) {
  if (h == null) return '—'
  const to12 = n => (n === 0 ? 12 : n > 12 ? n - 12 : n)
  return `${to12(h)}${h >= 12 ? 'pm' : 'am'}`
}

// The sheet writes times as "hh:mm:ss am". Seconds are noise in a register.
function fmtClock(t) {
  if (!t) return null
  const m = t.toString().trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?$/i)
  if (!m) return t.toString().trim()
  return `${m[1].padStart(2, '0')}:${m[2]}${m[3] ? ' ' + m[3].toLowerCase().replace(/\./g, '') : ''}`
}

// Somebody who never clocked in has no register line to read, so they are
// separated out rather than shown with three dashes — the question "who is
// missing" deserves its own answer, not a row that looks like the others.
const VIEWS = [
  { value: 'in',      label: 'Turned up' },
  { value: 'notin',   label: 'Not in' },
  { value: 'all',     label: 'Everyone' },
]

export default function AttendancePanel({ employees = [], onPick }) {
  const [q, setQ] = useState('')
  const [view, setView] = useState('in')

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return employees
      .filter(e => !term || e.name.toLowerCase().includes(term))
      .map(e => ({
        ...e,
        turnedUp: !!e.startTime,
        onBreakNow: !!e.breakOpenSince,
      }))
      .filter(e => view === 'all' ? true : view === 'in' ? e.turnedUp : !e.turnedUp)
      // In the order they arrived — a register reads chronologically. People
      // who never came sort to the end of the "everyone" view.
      .sort((a, b) => {
        if (a.turnedUp !== b.turnedUp) return a.turnedUp ? -1 : 1
        return (a.startTime || '').localeCompare(b.startTime || '')
      })
  }, [employees, q, view])

  const counts = useMemo(() => {
    const inCount = employees.filter(e => e.startTime).length
    return {
      in: inCount,
      notin: employees.length - inCount,
      out: employees.filter(e => e.endTime).length,
      breakMins: employees.reduce((s, e) => s + (e.breakMinutes || 0), 0),
      onBreak: employees.filter(e => e.breakOpenSince).length,
    }
  }, [employees])

  return (
    <Card pad={false} style={{ marginBottom: SP[5] }}>
      <div style={{
        padding: SP[4], borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: SP[3], flexWrap: 'wrap',
      }}>
        <span className="eyebrow" style={{ flexShrink: 0 }}>Attendance today</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', flex: 1, minWidth: '180px' }}>
          <Tag color={C.accent}>{counts.in} clocked in</Tag>
          {counts.notin > 0 && <Tag color={C.red}>{counts.notin} not in</Tag>}
          {counts.out  > 0 && <Tag color={C.blue}>{counts.out} clocked out</Tag>}
          {counts.onBreak > 0 && <Tag color={C.amber} dot>{counts.onBreak} on break now</Tag>}
          <Tag color={C.muted}>{fmtMins(counts.breakMins)} break total</Tag>
        </span>
        <Segmented size="sm" options={VIEWS} value={view} onChange={setView} />
        <SearchInput value={q} onChange={setQ} placeholder="Find someone…" style={{ width: '170px' }} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={view === 'notin' ? 'check-circle' : 'users'}
          tone={view === 'notin' ? 'good' : 'neutral'}
          title={view === 'notin' ? 'Everyone has clocked in.' : 'Nobody to show.'}
          detail={view === 'notin' ? 'No one on the roster is still missing.' : 'No one on the roster matches that.'}
        />
      ) : (
        <div className="no-scrollbar" style={{ overflowX: 'auto', maxHeight: '340px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
            <thead>
              <tr style={{ background: SURF.sunken, position: 'sticky', top: 0, zIndex: 1 }}>
                {['Employee', 'Shift', 'Clocked in', 'Clocked out', 'Break taken'].map((h, i) => (
                  <th key={h} style={{
                    textAlign: i === 0 ? 'left' : i < 2 ? 'left' : 'right',
                    padding: '8px 14px', color: C.muted, fontSize: T.xs, fontWeight: 800,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(e => {
                const inAt  = fmtClock(e.startTime)
                const outAt = fmtClock(e.endTime)
                return (
                  <tr
                    key={e.name}
                    className="row-hover"
                    onClick={() => onPick && onPick(e)}
                    style={{ cursor: onPick ? 'pointer' : 'default', borderBottom: `1px solid ${C.border}` }}
                  >
                    <td style={{ padding: '9px 14px', maxWidth: '210px' }}>
                      <span className="ellip" style={{ display: 'block', color: C.text, fontSize: T.base, fontWeight: 700 }}>
                        {e.name}
                      </span>
                      {e.autoBreaks > 0 && (
                        <span style={{ color: C.dim, fontSize: '9.5px' }}>
                          {e.autoBreaks} auto break{e.autoBreaks === 1 ? '' : 's'}
                        </span>
                      )}
                    </td>

                    <td style={{ padding: '9px 14px', color: C.muted, fontSize: T.sm, whiteSpace: 'nowrap' }}>
                      {fmtHour(e.effStart ?? e.shiftStart)}–{fmtHour(e.effEnd ?? e.shiftEnd)}
                      {e.isAdjusted && <span style={{ marginLeft: '6px' }}><Tag color={C.amber}>ADJ</Tag></span>}
                    </td>

                    <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {inAt
                        ? <span style={{ color: C.text, fontSize: T.sm, fontWeight: 700 }}>{inAt}</span>
                        : <span style={{ color: e.isWeekOff ? C.purple : C.red, fontSize: T.sm, fontWeight: 700 }}>
                            {e.isWeekOff ? 'Week off' : 'Not in'}
                          </span>}
                    </td>

                    <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {outAt
                        ? <span style={{ color: C.text2, fontSize: T.sm, fontWeight: 700 }}>{outAt}</span>
                        : inAt
                          // Clocked in and still open. "Still in" is the honest
                          // reading; a dash would look like missing data.
                          ? <span style={{ color: e.shiftStale ? C.amber : C.accent, fontSize: T.sm, fontWeight: 700 }}>
                              {e.shiftStale ? 'left open' : 'still in'}
                            </span>
                          : <span style={{ color: C.dim, fontSize: T.sm }}>—</span>}
                    </td>

                    <td style={{ padding: '9px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span style={{
                        color: e.onBreakNow ? C.amber : (e.breakMinutes > 0 ? C.text2 : C.dim),
                        fontSize: T.sm, fontWeight: 700,
                      }}>
                        {e.breakMinutes > 0 || e.breakSessions > 0 ? fmtMins(e.breakMinutes) : '—'}
                      </span>
                      {e.breakSessions > 1 && (
                        <span style={{ color: C.dim, fontSize: '9.5px', marginLeft: '5px' }}>
                          ×{e.breakSessions}
                        </span>
                      )}
                      {e.onBreakNow && (
                        <span style={{ display: 'block', color: C.amber, fontSize: '9.5px', marginTop: '1px' }}>
                          away now
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
