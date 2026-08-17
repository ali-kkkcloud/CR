import Icon from '../Icons'
import { C } from '../Widgets'
import { Card, Tag, EmptyState, T, SP } from '../ui'

export default function EmpFollowupTab({ followups }) {
  return (
    // Centred, not left-anchored — the column was pinned to the left edge of
    // a much wider page, which is what made the screen look half-empty.
    <div style={{ maxWidth:'860px', margin:'0 auto' }}>
      {followups.length === 0 ? (
        <Card pad={false}>
          <EmptyState
            icon="followups" tone="good"
            title="No follow-up footage requests assigned to you."
            detail="A follow-up lands here when a colleague hands you one of their open footage requests at the end of their shift."
          />
        </Card>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:SP[2] }}>
          {followups.map(item => (
            <Card key={item.issueId} style={{ borderColor:C.amber+'33' }}>
              {/* flex-start, not the default stretch: a pill with a 999px
                  radius stretched to the full height of the row turns into a
                  great yellow ellipse. */}
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:SP[3], flexWrap:'wrap' }}>
                <div style={{ minWidth:0, flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'7px', marginBottom:'4px', flexWrap:'wrap' }}>
                    <Icon name="followups" size={13} color={C.amber} />
                    <span style={{ color:C.text, fontSize:T.md, fontWeight:700 }}>{item.vehicle}</span>
                    <span style={{ color:C.muted, fontSize:T.base }}>{item.client}</span>
                  </div>
                  <div style={{ color:C.muted, fontSize:T.sm }}>
                    ID {item.issueId} &nbsp;·&nbsp; forwarded by{' '}
                    <strong style={{ color:C.text2 }}>{item.originalEmployee}</strong>
                    &nbsp;·&nbsp; at {item.forwardedAt}
                  </div>
                  {item.details && (
                    <div style={{ color:C.text2, fontSize:T.sm, marginTop:'5px', fontStyle:'italic' }}>{item.details}</div>
                  )}
                </div>
                <Tag color={C.amber} dot>FOLLOW-UP</Tag>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
