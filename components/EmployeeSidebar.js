import Icon from './Icons'
import CautioWordmark from './Wordmark'
import { C } from './Widgets'

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard',        icon: 'overview' },
  { key: 'myday',     label: 'My Day',            icon: 'fullday' },
  { key: 'clients',   label: 'My Clients',        icon: 'users' },
  { key: 'footage',   label: 'Footage Requests',  icon: 'footage' },
  { key: 'followup',  label: 'Follow-ups',        icon: 'followups' },
  { key: 'performance', label: 'My Performance',  icon: 'analytics' },
  { key: 'notifications', label: 'Notifications', icon: 'alerts' },
  { key: 'help',      label: 'Help & Support',     icon: 'sparkles' },
  { key: 'settings',  label: 'Settings',            icon: 'settings' },
]

export default function EmployeeSidebar({ activeTab, setActiveTab, counts = {}, user, onlineStatus = 'Online', shiftTime, loginTime }) {
  return (
    <div style={s.wrap}>
      <div>
        <div style={s.brandRow}>
          <img src="/cautio_shield.webp" alt="Cautio" style={s.logo} onError={e => (e.target.style.display = 'none')} />
          <div>
            <div style={s.brandTxt}><CautioWordmark size={20} color={C.text} weight={800} letterSpacing="0.3px" /></div>
            <div style={s.tagline}>Command Center</div>
          </div>
        </div>

        <div style={s.navList}>
          {NAV_ITEMS.map(item => {
            const active = activeTab === item.key
            const badge = counts[item.key]
            return (
              <button key={item.key} onClick={() => setActiveTab(item.key)} style={{ ...s.navBtn, ...(active ? s.navBtnActive : {}) }}>
                <Icon name={item.icon} size={17} color={active ? C.accent : C.muted} />
                <span style={{ ...s.navLabel, color: active ? C.accent : C.text2 }}>{item.label}</span>
                {item.key==='myday' && <span style={s.newTag}>New</span>}
                {typeof badge === 'number' && badge > 0 && (
                  <span style={{ ...s.navBadge, ...(active ? { background: C.accent, color: '#06120a' } : {}) }}>{badge}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div style={s.bottomStack}>
        <div style={s.profileCard}>
          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'8px' }}>
            <div style={s.avatar}>{(user?.name||'U').slice(0,2).toUpperCase()}</div>
            <div style={{ minWidth:0 }}>
              <div style={s.empName}>{user?.name || 'Employee'}</div>
              <div style={s.empId}>EMP-{user?.empId||'—'}</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:'5px', marginBottom:'8px' }}>
            <span className="live-dot" style={{ width:6, height:6, background:C.accent }}></span>
            <span style={{ color:C.accent, fontSize:'10.5px', fontWeight:600 }}>{onlineStatus}</span>
          </div>
          <div style={s.profileRow}><span style={s.profileLbl}>Shift Time</span><span style={s.profileVal}>{shiftTime||'—'}</span></div>
          <div style={s.profileRow}><span style={s.profileLbl}>Login Time</span><span style={s.profileVal}>{loginTime||'—'}</span></div>
        </div>
        <div style={s.footer}>© {new Date().getFullYear()} Cautio Telematics.<br />All rights reserved.</div>
      </div>
    </div>
  )
}

const s = {
  wrap: { width: '250px', minWidth: '250px', height: '100vh', position: 'sticky', top: 0, background: C.bg, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '20px 14px', overflowY: 'auto' },
  brandRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '0 6px 20px 6px' },
  logo: { width: '36px', height: '36px', objectFit: 'contain' },
  brandTxt: { color: C.text, fontSize: '20px', fontWeight: '800', letterSpacing: '0.3px', lineHeight: 1 },
  tagline: { color: C.muted, fontSize: '9.5px', marginTop: '3px', letterSpacing: '0.5px' },
  navList: { display: 'flex', flexDirection: 'column', gap: '2px' },
  navBtn: { display: 'flex', alignItems: 'center', gap: '11px', width: '100%', background: 'transparent', border: 'none', borderRadius: '9px', padding: '10px 10px', cursor: 'pointer', textAlign: 'left' },
  navBtnActive: { background: C.accentDark },
  navLabel: { fontSize: '13px', fontWeight: '500', flex: 1 },
  navBadge: { background: '#2a2a2a', color: C.text2, fontSize: '10px', fontWeight: '700', borderRadius: '20px', padding: '2px 7px', minWidth: '18px', textAlign: 'center' },
  newTag: { background: C.accent, color: '#06120a', fontSize: '8px', fontWeight: '800', borderRadius: '4px', padding: '2px 5px' },
  bottomStack: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '18px' },
  profileCard: { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px' },
  avatar: { width: '32px', height: '32px', borderRadius: '50%', background: C.accent, color: '#06120a', fontSize: '12px', fontWeight: '700', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  empName: { color: C.text, fontSize: '12px', fontWeight: '700', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' },
  empId: { color: C.muted, fontSize: '9.5px' },
  profileRow: { display:'flex', justifyContent:'space-between', fontSize:'10px', marginTop:'4px' },
  profileLbl: { color: C.muted },
  profileVal: { color: C.text2, fontWeight:600 },
  footer: { color: '#4a4a4a', fontSize: '9.5px', lineHeight: 1.5, padding: '4px 6px 0 6px' },
}
