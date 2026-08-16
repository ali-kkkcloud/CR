import Icon from './Icons'
import { C } from './Widgets'
import { SideNav, SideCard } from './Shell'
import { T, R } from './ui'

// Eleven items in one undifferentiated column was the single biggest
// source of "the admin screen is confusing". They are the same eleven —
// grouped by what the supervisor is actually doing when they reach for
// them, with the not-yet-live modules last.
const GROUPS = [
  {
    label: 'Live',
    items: [
      { key:'overview', label:'Overview',       icon:'overview' },
      { key:'fullday',  label:'Full Day View',  icon:'fullday'  },
      { key:'breaks',   label:'Breaks',          icon:'clock'    },
    ],
  },
  {
    label: 'People & work',
    items: [
      { key:'progress',       label:'Employee Progress',  icon:'progress'       },
      { key:'footage',        label:'Footage Requests',   icon:'footage'        },
      { key:'followups',      label:'Follow-ups',         icon:'followups'      },
      { key:'redistribution', label:'Redistribution Log', icon:'redistribution' },
      { key:'leaves',         label:'Leaves',              icon:'leaves'         },
    ],
  },
  {
    label: 'More',
    items: [
      { key:'reports',   label:'Reports',   icon:'reports'   },
      { key:'analytics', label:'Analytics', icon:'analytics' },
      { key:'alerts',    label:'Alerts',    icon:'alerts'    },
      { key:'settings',  label:'Settings',  icon:'settings'  },
    ],
  },
]

export default function Sidebar({ activeTab, setActiveTab, counts = {}, employeesMonitored }) {
  const groups = GROUPS.map(g => ({
    ...g,
    items: g.items.map(i => ({ ...i, badge: counts[i.key] })),
  }))

  return (
    <SideNav
      groups={groups}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      tagline="Command Center"
      footer={
        <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
          <SideCard>
            <div style={{ display:'flex', alignItems:'center', gap:'7px' }}>
              <span className="live-dot" />
              <span style={{ color:C.accent, fontSize:T.sm, fontWeight:700 }}>All systems operational</span>
            </div>
            <div style={{ color:C.muted, fontSize:'10px', marginTop:'5px' }}>
              Monitoring {typeof employeesMonitored === 'number' ? `${employeesMonitored} employees` : 'your workforce'}
            </div>
          </SideCard>
          <button
            onClick={() => setActiveTab('analytics')}
            className="pressable"
            style={{
              display:'flex', alignItems:'center', gap:'8px', width:'100%',
              background:C.accentSoft, border:`1px solid ${C.accent}2e`, borderRadius:R.md,
              padding:'10px 12px', textAlign:'left',
            }}
          >
            <Icon name="sparkles" size={15} color={C.accent} />
            <span style={{ flex:1, minWidth:0 }}>
              <span className="ellip" style={{ display:'block', color:C.accent, fontSize:T.sm, fontWeight:700 }}>
                Cautio AI
              </span>
              <span style={{ display:'block', color:C.muted, fontSize:'9.5px' }}>Insights · Beta</span>
            </span>
            <Icon name="arrow-right" size={13} color={C.accent} />
          </button>
          <div style={{ color:'#4a4a4a', fontSize:'9.5px', lineHeight:1.5, padding:`4px ${R.sm}` }}>
            © {new Date().getFullYear()} Cautio Telematics.<br />All rights reserved.
          </div>
        </div>
      }
    />
  )
}
