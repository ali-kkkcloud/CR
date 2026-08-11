import Icon from './Icons'
import CautioWordmark from './Wordmark'

const C = {
  bg: '#000000',
  card: '#1E1E1E',
  border: '#171717',
  accent: '#94EC8E',
  accentDark: '#215B3B',
  text: '#FFFFFF',
  text2: '#D8D8D8',
  muted: '#9E9E9E',
}

const NAV_ITEMS = [
  { key: 'overview',       label: 'Overview',            icon: 'overview' },
  { key: 'fullday',        label: 'Full Day View',       icon: 'fullday' },
  { key: 'progress',       label: 'Employee Progress',   icon: 'progress' },
  { key: 'footage',        label: 'Footage Requests',    icon: 'footage' },
  { key: 'followups',      label: 'Follow-ups',          icon: 'followups' },
  { key: 'redistribution', label: 'Redistribution Log',  icon: 'redistribution' },
  { key: 'leaves',         label: 'Leaves',               icon: 'leaves' },
  { key: 'reports',        label: 'Reports',              icon: 'reports' },
  { key: 'analytics',      label: 'Analytics',            icon: 'analytics' },
  { key: 'alerts',         label: 'Alerts',                icon: 'alerts' },
  { key: 'settings',       label: 'Settings',              icon: 'settings' },
]

export default function Sidebar({ activeTab, setActiveTab, counts = {}, vehiclesMonitored, employeesMonitored }) {
  return (
    <div style={s.wrap}>
      <div>
        <div style={s.brandRow}>
          <img src="/cautio_shield.webp" alt="Cautio" style={s.logo} onError={e => (e.target.style.display = 'none')} />
          <div>
            <div style={s.brandTxt}><CautioWordmark size={21} color={C.text} weight={800} letterSpacing="0.3px" /></div>
            <div style={s.tagline}>Smarter Journeys. Safer Fleets.</div>
          </div>
        </div>

        <div style={s.sectionLbl}>COMMAND CENTER</div>

        <div style={s.navList}>
          {NAV_ITEMS.map(item => {
            const active = activeTab === item.key
            const badge = counts[item.key]
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                style={{ ...s.navBtn, ...(active ? s.navBtnActive : {}) }}
              >
                <Icon name={item.icon} size={17} color={active ? C.accent : C.muted} />
                <span style={{ ...s.navLabel, color: active ? C.accent : C.text2 }}>{item.label}</span>
                {typeof badge === 'number' && badge > 0 && (
                  <span style={{ ...s.navBadge, ...(active ? { background: C.accent, color: '#06120a' } : {}) }}>{badge}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div style={s.bottomStack}>
        <div style={s.statusCard}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span className="live-dot" style={{ width: 7, height: 7, background: C.accent }}></span>
            <span style={s.statusTxt}>All Systems Operational</span>
          </div>
          <div style={s.statusSub}>Last checked: {new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })}</div>
        </div>

        <div style={s.aiCard}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
            <div style={s.aiIconWrap}><Icon name="sparkles" size={13} color={C.accent} /></div>
            <span style={s.aiTitle}>Cautio AI</span>
            <span style={s.betaTag}>BETA</span>
          </div>
          <div style={s.aiDesc}>
            AI is monitoring{typeof employeesMonitored === 'number' ? ` ${employeesMonitored} employees` : ' your workforce'}
            {typeof vehiclesMonitored === 'number' ? ` and ${vehiclesMonitored} vehicles` : ''}.
          </div>
          <button style={s.aiBtn} onClick={() => setActiveTab('analytics')}>
            View AI Insights <Icon name="arrow-right" size={12} color={C.accent} />
          </button>
        </div>

        <div style={s.footer}>© {new Date().getFullYear()} Cautio Telematics.<br />All rights reserved.</div>
      </div>
    </div>
  )
}

const s = {
  wrap: { width: '260px', minWidth: '260px', height: '100vh', position: 'sticky', top: 0, background: C.bg, borderRight: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '20px 14px', overflowY: 'auto' },
  brandRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '0 6px 18px 6px' },
  logo: { width: '38px', height: '38px', objectFit: 'contain' },
  brandTxt: { color: C.text, fontSize: '21px', fontWeight: '800', letterSpacing: '0.3px', lineHeight: 1 },
  tagline: { color: C.muted, fontSize: '9.5px', marginTop: '3px' },
  sectionLbl: { color: C.muted, fontSize: '10px', fontWeight: '700', letterSpacing: '1.5px', padding: '0 10px', marginBottom: '8px' },
  navList: { display: 'flex', flexDirection: 'column', gap: '2px' },
  navBtn: { display: 'flex', alignItems: 'center', gap: '11px', width: '100%', background: 'transparent', border: 'none', borderRadius: '9px', padding: '10px 10px', cursor: 'pointer', textAlign: 'left' },
  navBtnActive: { background: C.accentDark },
  navLabel: { fontSize: '13px', fontWeight: '500', flex: 1 },
  navBadge: { background: '#2a2a2a', color: C.text2, fontSize: '10px', fontWeight: '700', borderRadius: '20px', padding: '2px 7px', minWidth: '18px', textAlign: 'center' },
  bottomStack: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '18px' },
  statusCard: { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '10px 12px' },
  statusTxt: { color: C.accent, fontSize: '11.5px', fontWeight: '600' },
  statusSub: { color: C.muted, fontSize: '10px', marginTop: '4px' },
  aiCard: { background: C.card, border: `1px solid ${C.border}`, borderRadius: '10px', padding: '12px' },
  aiIconWrap: { width: '20px', height: '20px', borderRadius: '6px', background: C.accentDark, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  aiTitle: { color: C.text, fontSize: '12.5px', fontWeight: '700' },
  betaTag: { background: C.accentDark, color: C.accent, fontSize: '8.5px', fontWeight: '700', borderRadius: '4px', padding: '1px 5px', letterSpacing: '0.5px' },
  aiDesc: { color: C.muted, fontSize: '10.5px', lineHeight: 1.5, marginBottom: '8px' },
  aiBtn: { background: 'transparent', border: 'none', color: C.accent, fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', padding: 0 },
  footer: { color: '#4a4a4a', fontSize: '9.5px', lineHeight: 1.5, padding: '4px 6px 0 6px' },
}
