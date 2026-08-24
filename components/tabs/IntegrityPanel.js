// ══════════════════════════════════════════════════════════════════════
// Browsers claiming attention the sheet does not support
//
// An extension was found on the floor whose only purpose was to stop the
// automatic break firing: it forces the idle reading to zero on every poll,
// fakes mouse and key events, patches the page's own timer, and clicks
// Resume if a break gets through anyway.
//
// None of that can be blocked from inside the page — an extension runs with
// the page's own privileges, after the page's own code. What the server can
// do is notice the disagreement between two clocks: one browser insisting
// somebody has been at their desk all afternoon, and a sheet showing they
// have recorded nothing since lunch.
//
// This states that, and stops. It does not accuse and it does not act — a
// quiet hour and a spoofed browser look identical for ten minutes, and the
// difference at three hours is a judgement for a person to make with what
// they know about the shift. Which is why the wording is what the server
// observed, never what it concluded.
// ══════════════════════════════════════════════════════════════════════
import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, Tag, T, R, SP } from '../ui'

export default function IntegrityPanel({ flags = [] }) {
  if (!flags.length) return null

  const high = flags.filter(f => f.severity === 'high')

  return (
    <Card pad={false} style={{ overflow:'hidden', marginBottom:SP[5], borderColor: high.length ? C.amber + '55' : C.border }}>
      <div style={{
        display:'flex', alignItems:'center', gap:SP[3],
        padding:'13px 15px', borderBottom:`1px solid ${C.border}`,
        background: high.length ? C.amber + '0d' : 'transparent',
      }}>
        <Icon name="alerts" size={15} color={high.length ? C.amber : C.muted} />
        <span style={{ flex:1, minWidth:0 }}>
          <span style={{ display:'block', color: high.length ? C.amber : C.text, fontSize:T.base, fontWeight:700 }}>
            {flags.length} {flags.length === 1 ? 'browser is' : 'browsers are'} reporting activity the sheet does not support
          </span>
          <span style={{ display:'block', color:C.muted, fontSize:T.xs, marginTop:'3px' }}>
            worth a look, not a conclusion — a genuinely quiet stretch reads the same way for a while
          </span>
        </span>
      </div>

      {flags.map(f => (
        <div key={f.name} style={{
          display:'flex', alignItems:'flex-start', gap:SP[3],
          padding:'11px 15px', borderBottom:`1px solid ${C.border}`,
        }}>
          <span className="ellip" style={{ width:'132px', flexShrink:0, color:C.text, fontSize:T.base, fontWeight:600 }}>
            {f.name}
          </span>
          <span style={{ flex:1, minWidth:0 }}>
            {f.reasons.map((r, i) => (
              <span key={i} style={{ display:'block', color:C.muted, fontSize:T.xs, marginBottom:'2px' }}>
                · {r}
              </span>
            ))}
          </span>
          <Tag color={f.severity === 'high' ? C.amber : C.muted}>
            {f.severity === 'high' ? 'LOOK' : 'MINOR'}
          </Tag>
        </div>
      ))}

      <div style={{ padding:'10px 15px', color:C.muted, fontSize:T.xs, lineHeight:1.6 }}>
        The break itself is unchanged: a browser can still vouch for somebody
        indefinitely. Setting <span style={{ color:C.text2 }}>CAUTIO_HEARTBEAT_TRUST_MINUTES</span> puts
        a ceiling on how far past the last recorded work that claim is believed.
      </div>
    </Card>
  )
}
