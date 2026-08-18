import Icon from './Icons'
import { C } from './Widgets'
import { SideNav, SideCard } from './Shell'
import { T, R } from './ui'

// Five destinations, not twelve.
//
// A column of twelve items asks the supervisor to know the whole product
// before they can find anything in it, and half of those items answered the
// same question as the item above them — footage and follow-ups are one queue,
// attendance and breaks are one question about a person, the hour grid and the
// redistribution log are two views of one day. Nothing has been removed: each
// of those screens is still exactly itself, one click deeper, behind a switch
// at the top of the section it belongs to.
//
// The order is the order the questions get asked: is the floor all right, what
// happened today, what is queued, how are people doing.
export const SECTIONS = [
  { key:'live',     label:'Dashboard', icon:'overview',  leaf:'overview' },
  { key:'day',      label:'Hour by hour', icon:'fullday', leaf:'fullday'  },
  { key:'requests', label:'Requests',   icon:'footage',   leaf:'footage'  },
  { key:'people',   label:'Team',       icon:'progress',  leaf:'progress' },
  { key:'more',     label:'More',       icon:'settings',  leaf:'reports'  },
]

// Which section each screen lives in. Screens keep their own keys, so every
// link and every render condition in the app still points at the same place.
export const TAB_SECTION = {
  overview:'live',
  fullday:'day', redistribution:'day',
  footage:'requests', followups:'requests',
  progress:'people', breaks:'people', leaves:'people',
  reports:'more', analytics:'more', alerts:'more', settings:'more',
}

export default function Sidebar({ activeTab, setActiveTab, counts = {}, employeesMonitored }) {
  const activeSection = TAB_SECTION[activeTab] || 'live'
  const groups = [{
    items: SECTIONS.map(s => ({
      key: s.key, label: s.label, icon: s.icon, badge: counts[s.key],
    })),
  }]

  return (
    <SideNav
      groups={groups}
      activeTab={activeSection}
      setActiveTab={(key) => {
        const s = SECTIONS.find(x => x.key === key)
        if (s) setActiveTab(s.leaf)
      }}
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
          <div style={{ color:'#4a4a4a', fontSize:'9.5px', lineHeight:1.5, padding:`4px ${R.sm}` }}>
            © {new Date().getFullYear()} Cautio Telematics.<br />All rights reserved.
          </div>
        </div>
      }
    />
  )
}
