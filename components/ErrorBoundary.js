// ══════════════════════════════════════════════════════════════════════
// A render error must never be a white screen.
//
// React unmounts the whole tree when a component throws while rendering, and
// Next replaces it with "Application error: a client-side exception has
// occurred" — grey text on white, no navigation, nothing to click. On a floor
// of people working an hour at a time, that is an outage: they cannot see
// their clients, cannot record what they have done, and cannot even tell
// whether the platform is up.
//
// One bad field in one payload should cost the panel it is in, not the shift.
// This catches the throw, keeps the rest of the page alive, and gives the
// person something to do — reload, or carry on with the screens that work.
// ══════════════════════════════════════════════════════════════════════
import { Component } from 'react'
import { C } from './Widgets'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Still reported, so a real fault is not silently swallowed — it simply
    // does not take the page with it.
    console.error('render error caught by boundary:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    const label = this.props.label || 'this section'
    return (
      <div style={{
        background: C.card, border: `1px solid ${C.amber}44`, borderRadius: '12px',
        padding: '20px', margin: '12px 0', color: C.text2, fontSize: '12.5px', lineHeight: 1.7,
      }}>
        <div style={{ color: C.amber, fontWeight: 800, fontSize: '13.5px', marginBottom: '6px' }}>
          {label} could not be drawn
        </div>
        <div style={{ color: C.muted }}>
          Something in the data for this panel was not what the screen expected.
          The rest of the page is unaffected — carry on, and reload when you get
          a moment.
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          style={{
            marginTop: '13px', background: C.accentDark, color: C.accent,
            border: 'none', borderRadius: '8px', padding: '8px 14px',
            fontSize: '12px', fontWeight: 700, cursor: 'pointer',
          }}
        >Try again</button>
        <button
          onClick={() => typeof window !== 'undefined' && window.location.reload()}
          style={{
            marginTop: '13px', marginLeft: '8px', background: 'transparent', color: C.muted,
            border: `1px solid ${C.border2}`, borderRadius: '8px', padding: '8px 14px',
            fontSize: '12px', fontWeight: 700, cursor: 'pointer',
          }}
        >Reload the page</button>
      </div>
    )
  }
}
