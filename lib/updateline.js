// What a client's status line should say, in one place.
//
// There were two copies of this — one in the board's list, one in the detail
// pane beside it — and only the list ever got fixed. So the row read
// "Updated at 08:30:52 am by Nesiya" while the pane, for the SAME client at
// the same moment, said "still not updated". The same duplication this
// codebase keeps being bitten by, this time in the UI.
//
// It lives here rather than inside the component because a rule that decides
// what an employee sees deserves a test, and a test cannot import a file full
// of JSX.
//
//   mine      this employee filled it in this slot
//   at        the time they filled it, if known
//   elsewhere anybody filled it today, at any hour — { at, by }
//   upcoming  the slot has not started yet
//
// "Still not updated" means one thing everywhere: nobody has filled this
// client since seven this morning.
export function updateLine({ mine, at, elsewhere, upcoming }) {
  if (mine)      return { text: at ? `Updated at ${at}` : 'Updated', tone: 'done' }
  if (elsewhere) return {
    text: `Updated at ${elsewhere.at}${elsewhere.by ? ` by ${elsewhere.by}` : ''}`,
    tone: 'elsewhere',
  }
  if (upcoming)  return { text: 'Not started yet', tone: 'idle' }
  return { text: 'Still not updated', tone: 'late' }
}
