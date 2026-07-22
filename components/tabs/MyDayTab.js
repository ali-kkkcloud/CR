import { useState, useMemo } from 'react'
import Icon from '../Icons'
import { C, Donut } from '../Widgets'

const STATUS_OPTIONS  = ['', 'Updated', 'No New Misalignment', 'All Vehicles are Offline', 'No Misalignment']
const FATIGUE_OPTIONS = ['No', 'Yes']

function hourLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)}`
}
function hourRangeLabel(h) {
  const to12 = (n) => n === 0 ? 12 : n > 12 ? n - 12 : n
  const suf  = (n) => n >= 12 ? 'PM' : 'AM'
  return `${to12(h)}:00 ${suf(h)} - ${to12((h+1)%24)}:00 ${suf((h+1)%24)}`
}

// Converts a myDay.timeline[hour].clients[] entry into the shape the
// UpdateClientModal expects (same field names as /api/clients/current's
// `filled` map) — used when editing a past/future hour, not just current.
function clientRowToFilled(c) {
  return {
    status: c.status || '', misalignVehicles: c.misalignVehicles || '',
    alertCount: c.alertCount || '', fatigue: c.fatigue || 'No',
    fatigueCount: c.fatigueCount || '', updatedAt: c.updatedAt || '',
  }
}

export default function MyDayTab({ currentHour, currentClients, filled, myDay, saveUpdate, saving, footagePending, followupsPending, onGoToTab, canEdit = true }) {
  const [editTarget, setEditTarget] = useState(null) // { client, hour }
  const [viewedHour, setViewedHour] = useState(null) // null = not viewing a specific past/future hour
  const [hourOverrides, setHourOverrides] = useState({}) // { [hour]: { [client]: {...} } } — local instant feedback for non-current-hour edits

  const nextHourData = myDay?.timeline.find(t => t.hour === (currentHour+1)%24)

  const currentSlotStats = useMemo(() => {
    const total = currentClients.length
    let completed = 0
    currentClients.forEach(c => { if ((filled[c.client]?.status||'').trim()) completed++ })
    return { total, completed, pending: total-completed, pct: total>0?Math.round((completed/total)*100):0 }
  }, [currentClients, filled])

  const heroClient = currentClients[0]
  const heroFilled = heroClient ? (filled[heroClient.client]||{}) : {}
  const heroDone = !!(heroFilled.status||'').trim()

  const currentTaskClient = currentClients.find(c => !(filled[c.client]?.status||'').trim())

  const smartReminders = []
  if (footagePending>0) smartReminders.push({ icon:'footage', color:C.red, title:'Footage Upload', desc:`${footagePending} footage request(s) pending`, tab:'footage' })
  if (followupsPending>0) smartReminders.push({ icon:'followups', color:C.amber, title:'Follow-ups', desc:`${followupsPending} follow-up(s) pending`, tab:'followup' })
  const pendingNow = currentClients.filter(c => !(filled[c.client]?.status||'').trim())
  if (pendingNow.length>0) smartReminders.push({ icon:'clock', color:C.amber, title:'This Hour', desc:`${pendingNow.length} client(s) pending update`, tab:null })

  const recentUpdates = useMemo(() => {
    if (!myDay) return []
    const events = []
    myDay.timeline.forEach(t => t.clients.forEach(c => {
      if (c.filled && c.updatedAt) events.push({ time:c.updatedAt, hour:t.hour, client:c.client, label:'CRM Updated' })
    }))
    return events.slice(-8).reverse()
  }, [myDay])

  return (
    <div>
      {/* Current hour hero + next hour */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:'12px', marginBottom:'14px' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'18px' }}>
          <div style={{ color:C.muted, fontSize:'10px', fontWeight:700, letterSpacing:'0.5px', marginBottom:'6px' }}>CURRENT HOUR</div>
          <div style={{ color:C.text, fontSize:'22px', fontWeight:800, marginBottom:'14px' }}>{hourRangeLabel(currentHour)}</div>
          {!heroClient ? (
            <div style={{ color:C.muted, fontSize:'12px' }}>No clients assigned this hour.</div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:'16px', flexWrap:'wrap' }}>
              <div style={{ width:'52px', height:'52px', borderRadius:'12px', background:C.accentDark, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                <Icon name="overview" size={22} color={C.accent} />
              </div>
              <div style={{ flex:1, minWidth:'140px' }}>
                <div style={{ color:C.text, fontSize:'16px', fontWeight:700 }}>{heroClient.client}</div>
                <div style={{ color:C.muted, fontSize:'11px' }}>{heroClient.vehicleCount||0} Vehicles</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ color:C.amber, fontSize:'18px', fontWeight:800 }}>{currentSlotStats.pending}</div>
                <div style={{ color:C.muted, fontSize:'9px' }}>PENDING</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ color:C.accent, fontSize:'18px', fontWeight:800 }}>{currentSlotStats.completed}</div>
                <div style={{ color:C.muted, fontSize:'9px' }}>COMPLETED</div>
              </div>
              <Donut segments={[{value:currentSlotStats.pct,color:C.accent},{value:100-currentSlotStats.pct,color:C.border2}]} size={64} thickness={8} centerLabel={`${currentSlotStats.pct}%`} />
            </div>
          )}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'18px' }}>
          <div style={{ color:C.muted, fontSize:'10px', fontWeight:700, letterSpacing:'0.5px', marginBottom:'6px' }}>NEXT HOUR ({hourRangeLabel((currentHour+1)%24)})</div>
          {!nextHourData || nextHourData.clients.length===0 ? (
            <div style={{ color:C.muted, fontSize:'12px', marginTop:'10px' }}>Nothing scheduled yet.</div>
          ) : (
            <div style={{ marginTop:'10px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <div style={{ width:'34px', height:'34px', borderRadius:'8px', background:C.s2, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Icon name="overview" size={15} color={C.text2} />
                </div>
                <div>
                  <div style={{ color:C.text, fontSize:'13px', fontWeight:700 }}>{nextHourData.clients[0].client}</div>
                  <div style={{ color:C.muted, fontSize:'10.5px' }}>{nextHourData.clients[0].vehicleCount||0} Vehicles{nextHourData.clients.length>1?` +${nextHourData.clients.length-1} more`:''}</div>
                </div>
              </div>
              <div style={{ color:C.muted, fontSize:'10px', marginTop:'10px', display:'flex', alignItems:'center', gap:'4px' }}>
                <Icon name="clock" size={11} color={C.muted}/> Starts in {59-new Date().getMinutes()} mins
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Today's timeline — click any hour (past or future) to view its clients */}
      {myDay && (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', marginBottom:'14px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'14px', flexWrap:'wrap', gap:'8px' }}>
            <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700 }}>TODAY'S TIMELINE</div>
            <div style={{ display:'flex', gap:'14px' }}>
              <LegendDot color={C.accent} label="Completed" />
              <LegendDot color={C.accent} label="Current" ring />
              <LegendDot color={C.dim} label="Upcoming" />
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', overflowX:'auto', paddingBottom:'6px' }}>
            {myDay.timeline.map((t,i) => {
              const isCurrent = t.hour === currentHour
              const isPast = !isCurrent && t.hour < currentHour
              const isSelected = viewedHour === t.hour
              const done = t.totalClients>0 && t.completedClients===t.totalClients
              return (
                <div key={t.hour} style={{ display:'flex', alignItems:'center', flexShrink:0 }}>
                  <button
                    onClick={()=>setViewedHour(isSelected ? null : t.hour)}
                    style={{ background:'transparent', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', minWidth:'64px', padding:'4px 0' }}
                  >
                    <div style={{
                      width: isCurrent?'18px':'14px', height: isCurrent?'18px':'14px', borderRadius:'50%',
                      background: isPast&&done ? C.accent : isCurrent ? 'transparent' : C.dim,
                      border: isCurrent ? `2.5px solid ${C.accent}` : isSelected ? `2px solid ${C.accent}` : 'none',
                      boxShadow: isSelected ? `0 0 0 3px ${C.accent}33` : 'none',
                    }}></div>
                    <div style={{ color: isCurrent?C.accent:isSelected?C.text:C.muted, fontSize:'9.5px', marginTop:'6px', fontWeight: (isCurrent||isSelected)?700:400 }}>{hourLabel(t.hour).split(' ')[0]}</div>
                  </button>
                  {i < myDay.timeline.length-1 && <div style={{ width:'26px', height:'2px', background: isPast?C.accent:C.border2 }}></div>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Hour Detail — shown when a non-current hour is picked from the timeline above */}
      {viewedHour !== null && myDay && (() => {
        const hourData = myDay.timeline.find(t => t.hour === viewedHour)
        const isFuture = viewedHour > currentHour
        const overrides = hourOverrides[viewedHour] || {}
        return (
          <div style={{ background:C.card, border:`1px solid ${C.accent}44`, borderRadius:'14px', padding:'16px', marginBottom:'14px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
              <div style={{ color:C.accent, fontSize:'12px', fontWeight:700 }}>{hourRangeLabel(viewedHour)}{viewedHour===currentHour?' (Current Hour)':isFuture?' (Upcoming)':''}</div>
              <button onClick={()=>setViewedHour(null)} style={{ background:'transparent', border:'none', color:C.muted, fontSize:'16px', cursor:'pointer' }}>×</button>
            </div>
            {!hourData || hourData.clients.length===0 ? (
              <div style={{ color:C.muted, fontSize:'12px' }}>No clients scheduled this hour.</div>
            ) : isFuture ? (
              <div>
                <div style={{ color:C.muted, fontSize:'11px', marginBottom:'10px' }}>This hour hasn't started yet — clients will be updatable once it begins.</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:'8px' }}>
                  {hourData.clients.map(c => (
                    <div key={c.client} style={{ background:C.s2, borderRadius:'8px', padding:'10px', opacity:0.6 }}>
                      <div style={{ color:C.text, fontSize:'11.5px', fontWeight:600 }}>{c.client}</div>
                      <div style={{ color:C.muted, fontSize:'9.5px' }}>{c.vehicleCount||0} Vehicles</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:'8px' }}>
                {hourData.clients.map(c => {
                  const ov = overrides[c.client]
                  const done = ov ? !!(ov.status||'').trim() : c.filled
                  return (
                    <div key={c.client} style={{ background: done?C.accentDark+'22':C.s2, border:`1px solid ${done?C.accent+'55':C.border2}`, borderRadius:'8px', padding:'10px' }}>
                      <div style={{ color:C.text, fontSize:'11.5px', fontWeight:600 }}>{c.client}</div>
                      <div style={{ color:C.muted, fontSize:'9.5px', marginBottom:'8px' }}>{c.vehicleCount||0} Vehicles{done && c.updatedAt ? ` · ${c.updatedAt}` : ''}</div>
                      <button disabled={!canEdit} onClick={()=>canEdit && setEditTarget({client:c.client, hour:viewedHour})} style={{
                        width:'100%', background: !canEdit?C.s2:done?'transparent':C.accent, border: done?`1px solid ${C.accent}55`:'none',
                        borderRadius:'6px', color: !canEdit?C.muted:done?C.accent:'#06120a', fontSize:'10.5px', fontWeight:700, padding:'6px', cursor: canEdit?'pointer':'not-allowed',
                      }}>{!canEdit ? (done?'Updated':'View Only') : done?'✓ Updated — Edit':'Update Now'}</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })()}

      {/* My clients today */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', marginBottom:'14px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'12px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700 }}>MY CLIENTS THIS HOUR</div>
          <span style={{ color:C.muted, fontSize:'10px' }}>{currentClients.length} client(s)</span>
        </div>
        {currentClients.length===0 ? (
          <div style={{ color:C.muted, fontSize:'12px' }}>No clients assigned this hour.</div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px, 1fr))', gap:'10px' }}>
            {currentClients.map(c => {
              const f = filled[c.client] || {}
              const done = !!(f.status||'').trim()
              return (
                <div key={c.client} style={{ background: done?C.accentDark+'22':C.s2, border:`1px solid ${done?C.accent+'55':C.border2}`, borderRadius:'10px', padding:'12px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
                    <div style={{ width:'26px', height:'26px', borderRadius:'7px', background:C.s2, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <Icon name="overview" size={12} color={C.text2} />
                    </div>
                    <div style={{ minWidth:0 }}>
                      <div style={{ color:C.text, fontSize:'12px', fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.client}</div>
                      <div style={{ color:C.muted, fontSize:'9.5px' }}>{c.vehicleCount||0} Vehicles</div>
                    </div>
                  </div>
                  {c.isRedistributed && <div style={{ color:C.purple, fontSize:'9.5px', marginBottom:'6px' }}>↩ from {c.fromEmployee}</div>}
                  <button disabled={!canEdit} onClick={()=>canEdit && setEditTarget({client:c.client, hour:currentHour})} style={{
                    width:'100%', background: !canEdit?C.s2:done?'transparent':C.accent, border: done?`1px solid ${C.accent}55`:'none',
                    borderRadius:'7px', color: !canEdit?C.muted:done?C.accent:'#06120a', fontSize:'11px', fontWeight:700, padding:'7px', cursor: canEdit?'pointer':'not-allowed',
                  }}>{!canEdit ? (done?'Updated':'View Only') : done?'✓ Updated — Edit':'Update Now'}</button>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Current task / progress / recent activity */}
      <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr 1.2fr', gap:'12px', marginBottom:'14px' }}>
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'12px' }}>CURRENT TASK</div>
          {!currentTaskClient ? (
            <div style={{ color:C.accent, fontSize:'12px' }}>✓ All caught up for this hour.</div>
          ) : (
            <>
              <div style={{ color:C.muted, fontSize:'10px', marginBottom:'4px' }}>Next Client</div>
              <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'10px' }}>
                <span style={{ color:C.text, fontSize:'15px', fontWeight:700 }}>{currentTaskClient.client}</span>
                <span style={{ background:C.redBg, color:C.red, fontSize:'9.5px', fontWeight:700, borderRadius:'5px', padding:'2px 7px' }}>PENDING</span>
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button disabled={!canEdit} onClick={()=>canEdit && setEditTarget({client:currentTaskClient.client, hour:currentHour})} style={{ flex:1, background: canEdit?C.accent:C.s2, border:'none', borderRadius:'8px', color: canEdit?'#06120a':C.muted, fontSize:'12px', fontWeight:700, padding:'10px', cursor: canEdit?'pointer':'not-allowed' }}>{canEdit?'Update Now':'View Only'}</button>
              </div>
            </>
          )}
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', display:'flex', flexDirection:'column', alignItems:'center' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px', alignSelf:'flex-start' }}>TODAY'S PROGRESS</div>
          <Donut segments={[{value:myDay?.totalCompleted||0,color:C.accent},{value:myDay?.totalMissed||0,color:C.border2}]} size={80} thickness={10} centerLabel={myDay&&myDay.totalClients>0?`${Math.round((myDay.totalCompleted/myDay.totalClients)*100)}%`:'0%'} centerSub="Done" />
          <div style={{ display:'flex', gap:'16px', marginTop:'10px' }}>
            <div style={{textAlign:'center'}}><div style={{color:C.text,fontSize:'13px',fontWeight:800}}>{myDay?.totalClients||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>TOTAL</div></div>
            <div style={{textAlign:'center'}}><div style={{color:C.accent,fontSize:'13px',fontWeight:800}}>{myDay?.totalCompleted||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>DONE</div></div>
            <div style={{textAlign:'center'}}><div style={{color:C.amber,fontSize:'13px',fontWeight:800}}>{myDay?.totalMissed||0}</div><div style={{color:C.muted,fontSize:'8.5px'}}>LEFT</div></div>
          </div>
        </div>

        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>RECENT ACTIVITY</div>
          {recentUpdates.length===0 ? <div style={{color:C.muted,fontSize:'11px'}}>No updates yet today.</div> : (
            <div style={{ display:'flex', flexDirection:'column', gap:'8px', maxHeight:'150px', overflowY:'auto' }}>
              {recentUpdates.map((e,i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ color:C.text2, fontSize:'10.5px' }}>{e.label} — {e.client}</span>
                  <span style={{ color:C.muted, fontSize:'9.5px' }}>{e.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Smart reminders */}
      {smartReminders.length>0 && (
        <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px', marginBottom:'14px' }}>
          <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'10px' }}>SMART REMINDERS</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:'10px' }}>
            {smartReminders.map((r,i) => (
              <div key={i} onClick={()=>r.tab && onGoToTab(r.tab)} style={{ display:'flex', alignItems:'center', gap:'8px', background:C.s2, borderRadius:'8px', padding:'10px', cursor:r.tab?'pointer':'default' }}>
                <div style={{ width:'26px', height:'26px', borderRadius:'8px', background:r.color+'1a', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <Icon name={r.icon} size={13} color={r.color} />
                </div>
                <div>
                  <div style={{ color:r.color, fontSize:'11px', fontWeight:700 }}>{r.title}</div>
                  <div style={{ color:C.muted, fontSize:'9.5px' }}>{r.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', padding:'16px' }}>
        <div style={{ color:C.accent, fontSize:'10.5px', fontWeight:700, marginBottom:'12px' }}>QUICK ACTIONS</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(150px, 1fr))', gap:'10px' }}>
          {[
            { icon:'progress', label:'Update Client', sub: canEdit?'Update Now':'View Only', onClick:()=> canEdit && currentTaskClient && setEditTarget({client:currentTaskClient.client, hour:currentHour}) },
            { icon:'users', label:'My Clients', sub:'View All', onClick:()=>onGoToTab('clients') },
            { icon:'footage', label:'Footage Requests', sub:'View Requests', onClick:()=>onGoToTab('footage') },
            { icon:'followups', label:'Follow-ups', sub:'View All', onClick:()=>onGoToTab('followup') },
          ].map((a,i) => (
            <button key={i} onClick={a.onClick} style={{ background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'10px', padding:'14px', cursor:'pointer', textAlign:'left' }}>
              <Icon name={a.icon} size={16} color={C.accent} />
              <div style={{ color:C.text, fontSize:'12px', fontWeight:700, marginTop:'8px' }}>{a.label}</div>
              <div style={{ color:C.muted, fontSize:'10px' }}>{a.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Update-client modal — works for the current hour or any hour picked from the timeline */}
      {editTarget && (
        <UpdateClientModal
          client={editTarget.client}
          data={
            editTarget.hour === currentHour
              ? (filled[editTarget.client] || {})
              : { ...(myDay?.timeline.find(t=>t.hour===editTarget.hour)?.clients.find(c=>c.client===editTarget.client) ? clientRowToFilled(myDay.timeline.find(t=>t.hour===editTarget.hour).clients.find(c=>c.client===editTarget.client)) : {}), ...(hourOverrides[editTarget.hour]?.[editTarget.client] || {}) }
          }
          saving={saving}
          onSave={(client, field, value) => {
            if (editTarget.hour === currentHour) {
              saveUpdate(client, field, value)
            } else {
              saveUpdate(client, field, value, editTarget.hour)
              setHourOverrides(prev => ({
                ...prev,
                [editTarget.hour]: { ...(prev[editTarget.hour]||{}), [client]: { ...(prev[editTarget.hour]?.[client]||{}), [field]: value } },
              }))
            }
          }}
          onClose={()=>setEditTarget(null)}
        />
      )}
    </div>
  )
}

function LegendDot({ color, label, ring }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:'5px' }}>
      <span style={{ width:8, height:8, borderRadius:'50%', background: ring?'transparent':color, border: ring?`2px solid ${color}`:'none' }}></span>
      <span style={{ color:C.muted, fontSize:'9.5px' }}>{label}</span>
    </div>
  )
}

function UpdateClientModal({ client, data, saving, onSave, onClose }) {
  const fatigueIsYes = (data.fatigue || 'No') === 'Yes'
  const key = (field) => `${client}_${field}`
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={onClose}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'16px', padding:'1.5rem', width:'420px', maxWidth:'90vw' }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'16px' }}>
          <div style={{ color:C.text, fontSize:'15px', fontWeight:700 }}>Update — {client}</div>
          <button onClick={onClose} style={{ background:'transparent', border:'none', color:C.muted, fontSize:'18px', cursor:'pointer' }}>×</button>
        </div>

        <label style={mlbl}>STATUS</label>
        <select style={msel} value={data.status||''} onChange={e=>onSave(client,'status',e.target.value)}>
          {STATUS_OPTIONS.map(o=><option key={o} value={o}>{o||'— select —'}</option>)}
        </select>

        <label style={mlbl}>MISALIGN VEHICLES</label>
        <input style={minp} placeholder="VH1234, VH5678" value={data.misalignVehicles||''} onChange={e=>onSave(client,'misalignVehicles',e.target.value)} />

        <label style={mlbl}>ALERT COUNT</label>
        <input style={minp} type="number" min="0" placeholder="0" value={data.alertCount||''} onChange={e=>onSave(client,'alertCount',e.target.value)} />

        <label style={mlbl}>FATIGUE</label>
        <div style={{ display:'flex', gap:'8px', marginBottom:'14px' }}>
          <select style={{...msel, marginBottom:0, flex: fatigueIsYes?'0 0 90px':1}} value={data.fatigue||'No'} onChange={e=>onSave(client,'fatigue',e.target.value)}>
            {FATIGUE_OPTIONS.map(o=><option key={o}>{o}</option>)}
          </select>
          {fatigueIsYes && <input style={{...minp, marginBottom:0, flex:1}} type="number" min="0" placeholder="Count" value={data.fatigueCount||''} onChange={e=>onSave(client,'fatigueCount',e.target.value)} />}
        </div>

        <div style={{ color:C.muted, fontSize:'10.5px', marginBottom:'12px' }}>
          {saving[key('status')]||saving[key('alertCount')]||saving[key('fatigueCount')] ? 'Saving...' : data.updatedAt ? `Last saved at ${data.updatedAt}` : 'Not saved yet'}
        </div>

        <button onClick={onClose} style={{ width:'100%', background:C.accent, border:'none', borderRadius:'8px', color:'#06120a', fontSize:'13px', fontWeight:700, padding:'11px', cursor:'pointer' }}>Done</button>
      </div>
    </div>
  )
}

const mlbl = { display:'block', color:C.accent, fontSize:'10px', letterSpacing:'1px', fontWeight:'600', marginBottom:'5px' }
const msel = { width:'100%', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, padding:'8px 10px', fontSize:'13px', marginBottom:'12px', boxSizing:'border-box' }
const minp = { width:'100%', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'8px', color:C.text, padding:'8px 10px', fontSize:'13px', marginBottom:'12px', boxSizing:'border-box' }
