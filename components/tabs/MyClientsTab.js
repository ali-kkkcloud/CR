import { C } from '../Widgets'

const STATUS_OPTIONS  = ['', 'Updated', 'No New Misalignment', 'All Vehicles are Offline', 'No Misalignment']
const FATIGUE_OPTIONS = ['No', 'Yes']

export default function MyClientsTab({ clients, filled, saveUpdate, saving, currentHour }) {
  return (
    <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'14px', overflow:'hidden' }}>
      {clients.length === 0 ? (
        <div style={{ color:C.muted, textAlign:'center', padding:'3rem' }}>No clients assigned for this slot.</div>
      ) : (
        <>
          <div style={th.row}>
            <div style={{...th.cell,flex:1.6}}>CLIENT</div>
            <div style={{...th.cell,flex:0.5,textAlign:'center'}}>VEH</div>
            <div style={{...th.cell,flex:1.2}}>STATUS</div>
            <div style={{...th.cell,flex:1.4}}>MISALIGN VEHICLES</div>
            <div style={{...th.cell,flex:0.7}}>ALERTS</div>
            <div style={{...th.cell,flex:1.1}}>FATIGUE</div>
            <div style={{...th.cell,flex:1.1}}>LAST UPDATED</div>
            <div style={{...th.cell,flex:0.5,textAlign:'center'}}>SAVE</div>
          </div>
          {clients.map(({ client, vehicleCount, isRedistributed, fromEmployee }) => {
            const f = filled[client] || {}
            const key = (field) => `${client}_${field}`
            const fatigueIsYes = (f.fatigue || 'No') === 'Yes'
            const hasData = !!(f.status || '').trim()
            return (
              <div key={client} style={{...td.row, ...(isRedistributed?{background:C.purple+'0d'}:{})}}>
                <div style={{...td.cell,flex:1.6}}>
                  <div style={{ color:C.text, fontSize:'12.5px', fontWeight:600 }}>{client}</div>
                  {isRedistributed && <div style={{ color:C.purple, fontSize:'10px', marginTop:'2px' }}>↩ from {fromEmployee}</div>}
                </div>
                <div style={{...td.cell,flex:0.5,justifyContent:'center'}}>
                  <span style={{ background:C.s2, color:C.text2, borderRadius:'6px', padding:'2px 8px', fontSize:'11px', fontWeight:600 }}>{vehicleCount||0}</span>
                </div>
                <div style={{...td.cell,flex:1.2}}>
                  <select style={sel} value={f.status||''} onChange={e=>saveUpdate(client,'status',e.target.value)}>
                    {STATUS_OPTIONS.map(o=><option key={o} value={o}>{o||'— select —'}</option>)}
                  </select>
                </div>
                <div style={{...td.cell,flex:1.4}}>
                  <input style={inp} placeholder="VH1234, VH5678" value={f.misalignVehicles||''} onChange={e=>saveUpdate(client,'misalignVehicles',e.target.value)}/>
                </div>
                <div style={{...td.cell,flex:0.7}}>
                  <input style={{...inp,textAlign:'center'}} type="number" min="0" placeholder="0" value={f.alertCount||''} onChange={e=>saveUpdate(client,'alertCount',e.target.value)}/>
                </div>
                <div style={{...td.cell,flex:1.1,gap:'4px'}}>
                  <select style={{...sel,flex:fatigueIsYes?'0 0 55px':'1'}} value={f.fatigue||'No'} onChange={e=>saveUpdate(client,'fatigue',e.target.value)}>
                    {FATIGUE_OPTIONS.map(o=><option key={o}>{o}</option>)}
                  </select>
                  {fatigueIsYes && (
                    <input style={{...inp,flex:1,textAlign:'center'}} type="number" min="0" placeholder="Count" value={f.fatigueCount||''} onChange={e=>saveUpdate(client,'fatigueCount',e.target.value)}/>
                  )}
                </div>
                <div style={{...td.cell,flex:1.1}}>
                  {hasData ? (
                    <span style={{color:C.accent,fontSize:'10px'}}>Updated at {f.updatedAt || '—'}</span>
                  ) : (
                    <span style={{color:C.red,fontSize:'10px',fontWeight:'600'}}>Still not updated</span>
                  )}
                </div>
                <div style={{...td.cell,flex:0.5,justifyContent:'center'}}>
                  {saving[key('status')]||saving[key('alertCount')]||saving[key('fatigueCount')]
                    ?<span className="spinner" style={{width:14,height:14,borderWidth:2}}></span>
                    :<span style={{color:C.accent,fontSize:'16px'}}>✓</span>}
                </div>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

const th = {
  row: { display:'flex', padding:'10px 16px', borderBottom:`1px solid ${C.border}`, background:C.s2 },
  cell: { color:C.muted, fontSize:'10px', fontWeight:700, letterSpacing:'0.4px' },
}
const td = {
  row: { display:'flex', alignItems:'center', padding:'10px 16px', borderBottom:`1px solid ${C.borderRow}`, gap:'6px' },
  cell: { display:'flex', alignItems:'center' },
}
const sel = { width:'100%', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'7px', color:C.text, fontSize:'11.5px', padding:'7px 8px' }
const inp = { width:'100%', background:C.s2, border:`1px solid ${C.border2}`, borderRadius:'7px', color:C.text, fontSize:'11.5px', padding:'7px 8px', boxSizing:'border-box' }
