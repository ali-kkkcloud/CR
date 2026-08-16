import { C } from './Widgets'
import { SideNav, SideCard, SideRow } from './Shell'
import { T, R } from './ui'

// Grouped, rather than the flat list of nine it used to be. The three
// things an operator does every hour sit at the top on their own; the
// modules that aren't wired to live data are pushed to the bottom where
// they stop competing for attention.
const GROUPS = [
  {
    label: 'My work',
    items: [
      { key:'dashboard', label:'Dashboard',       icon:'overview' },
      { key:'clients',   label:'My Clients',       icon:'users'    },
      { key:'myday',     label:'My Day',           icon:'fullday'  },
    ],
  },
  {
    label: 'Requests',
    items: [
      { key:'footage',  label:'Footage Requests', icon:'footage'   },
      { key:'followup', label:'Follow-ups',       icon:'followups' },
    ],
  },
  {
    label: 'More',
    items: [
      { key:'performance',   label:'My Performance', icon:'analytics' },
      { key:'notifications', label:'Notifications',  icon:'alerts'    },
      { key:'help',          label:'Help & Support',  icon:'sparkles'  },
      { key:'settings',      label:'Settings',        icon:'settings'  },
    ],
  },
]

export default function EmployeeSidebar({
  activeTab, setActiveTab, counts = {}, user,
  onlineStatus = 'Online', shiftTime, loginTime,
}) {
  const groups = GROUPS.map(g => ({
    ...g,
    items: g.items.map(i => ({ ...i, badge: counts[i.key] })),
  }))

  const online = onlineStatus === 'Online'

  return (
    <SideNav
      groups={groups}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      tagline="Employee Console"
      footer={
        <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
          <SideCard>
            <div style={{ display:'flex', alignItems:'center', gap:'9px', marginBottom:'9px' }}>
              <div style={{
                width:'30px', height:'30px', borderRadius:'50%', background:C.accent,
                color:'#06120a', fontSize:'11px', fontWeight:800,
                display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
              }}>{(user?.name || 'U').slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth:0 }}>
                <div className="ellip" style={{ color:C.text, fontSize:T.sm, fontWeight:700 }}>
                  {user?.name || 'Employee'}
                </div>
                <div style={{ color:C.muted, fontSize:'9.5px' }}>{user?.empId || '—'}</div>
              </div>
            </div>
            <div style={{
              display:'flex', alignItems:'center', gap:'6px',
              paddingBottom:'8px', borderBottom:`1px solid ${C.border2}`,
            }}>
              {online
                ? <span className="live-dot" />
                : <span style={{ width:'7px', height:'7px', borderRadius:'50%', background:C.dim }} />}
              <span style={{ color: online ? C.accent : C.muted, fontSize:T.xs, fontWeight:700 }}>
                {onlineStatus}
              </span>
            </div>
            <SideRow label="Shift" value={shiftTime || '—'} />
            <SideRow label="Clocked in" value={loginTime || '—'} valueColor={loginTime ? C.accent : C.muted} />
          </SideCard>
          <div style={{ color:'#4a4a4a', fontSize:'9.5px', lineHeight:1.5, padding:`4px ${R.sm}` }}>
            © {new Date().getFullYear()} Cautio Telematics.<br />All rights reserved.
          </div>
        </div>
      }
    />
  )
}
