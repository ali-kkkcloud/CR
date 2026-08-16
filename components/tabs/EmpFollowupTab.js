import { C } from '../Widgets'
import { Card, T, R, SP, SURF } from '../ui'

export default function EmpFollowupTab({ followups }) {
  return (
    <div style={{ maxWidth:'800px' }}>
      {followups.length === 0 ? (
        <div style={{ color:C.muted, textAlign:'center', padding:'3rem' }}>No follow-up footage requests assigned to you.</div>
      ) : (
        followups.map(item => (
          <div key={item.issueId} style={{ background:C.card, border:`1px solid ${C.amber}33`, borderRadius:'10px', padding:'14px', marginBottom:'8px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', gap:'12px', flexWrap:'wrap' }}>
              <div>
                <div style={{ color:C.text, fontSize:'13px', fontWeight:600, marginBottom:'4px' }}>
                  <span style={{color:C.amber,marginRight:'6px'}}>↩</span>{item.client} · {item.vehicle}
                </div>
                <div style={{ color:C.muted, fontSize:'11px' }}>
                  ID: {item.issueId} &nbsp;·&nbsp; Forwarded by: <strong style={{color:C.text}}>{item.originalEmployee}</strong> &nbsp;·&nbsp; At: {item.forwardedAt}
                </div>
                {item.details && <div style={{ color:C.text2, fontSize:'11px', marginTop:'4px', fontStyle:'italic' }}>{item.details}</div>}
              </div>
              <span className="badge badge-amber">FOLLOW-UP</span>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
