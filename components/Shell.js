// ══════════════════════════════════════════════════════════════════════
// The application frame — sidebar, top bar, page body.
//
// Both sides of the product used to carry their own copy of this, and the
// copies had drifted: different widths, different active states, a flat
// list of eleven nav items with no grouping, and no hover feedback at all.
// One frame now, with the nav supplied per side.
// ══════════════════════════════════════════════════════════════════════
import { useState } from 'react'
import Icon from './Icons'
import CautioWordmark from './Wordmark'
import { C } from './Widgets'
import { T, R, SP, SURF, Tag } from './ui'

// ══════════════════════════════════════════════════════════════════════
// SideNav
// groups: [{ label, items: [{ key, label, icon, badge }] }]
// ══════════════════════════════════════════════════════════════════════
export function SideNav({ groups, activeTab, setActiveTab, tagline, footer }) {
  return (
    <nav
      className="sidebar"
      style={{
        width:'var(--sidebar-w)', minWidth:'var(--sidebar-w)',
        height:'100vh', position:'sticky', top:0,
        background:C.bg, borderRight:`1px solid ${C.border}`,
        display:'flex', flexDirection:'column',
        padding:`${SP[5]} ${SP[3]} ${SP[4]}`, overflowY:'auto', overflowX:'hidden',
      }}
    >
      {/* Brand */}
      <div style={{ display:'flex', alignItems:'center', gap:'10px', padding:`0 ${SP[2]} ${SP[5]}` }}>
        <img
          src="/cautio_shield.webp" alt="Cautio"
          style={{ width:'34px', height:'34px', objectFit:'contain', flexShrink:0 }}
          onError={e => (e.target.style.display = 'none')}
        />
        <div className="sidebar-brand-text" style={{ minWidth:0 }}>
          <CautioWordmark size={19} color={C.text} weight={800} letterSpacing="0.3px" />
          {tagline && <div style={{ color:C.muted, fontSize:'9.5px', marginTop:'3px' }} className="ellip">{tagline}</div>}
        </div>
      </div>

      {/* Nav */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:SP[5] }}>
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label && (
              <div className="eyebrow sidebar-label" style={{ padding:`0 ${SP[3]}`, marginBottom:'7px' }}>
                {g.label}
              </div>
            )}
            <div style={{ display:'flex', flexDirection:'column', gap:'1px' }}>
              {g.items.map(item => (
                <NavButton
                  key={item.key}
                  item={item}
                  active={activeTab === item.key}
                  onClick={() => setActiveTab(item.key)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {footer && <div className="sidebar-foot" style={{ marginTop:SP[5] }}>{footer}</div>}
    </nav>
  )
}

function NavButton({ item, active, onClick }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      title={item.label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="sidebar-nav-btn"
      style={{
        position:'relative',
        display:'flex', alignItems:'center', gap:'11px', width:'100%',
        background: active ? C.accentSoft : hover ? '#ffffff0a' : 'transparent',
        border:'none', borderRadius:R.md, padding:'9px 11px', textAlign:'left',
        transition:'background var(--fast)',
      }}
    >
      {/* Active marker. A tinted row with an accent bar stays legible at a
          glance without painting a solid block of brand green into the
          sidebar the way the old one did. */}
      {active && (
        <span style={{
          position:'absolute', left:0, top:'50%', transform:'translateY(-50%)',
          width:'3px', height:'17px', borderRadius:'0 3px 3px 0', background:C.accent,
        }} />
      )}
      <Icon name={item.icon} size={17} color={active ? C.accent : hover ? C.text2 : C.muted} />
      <span
        className="sidebar-label ellip"
        style={{ flex:1, fontSize:T.md, fontWeight: active ? 700 : 500, color: active ? C.accent : C.text2 }}
      >
        {item.label}
      </span>
      {typeof item.badge === 'number' && item.badge > 0 && (
        <span className="sidebar-label" style={{
          background: active ? C.accent : '#ffffff12',
          color: active ? '#06120a' : C.text2,
          fontSize:'10px', fontWeight:700, borderRadius:R.full,
          padding:'1px 7px', minWidth:'19px', textAlign:'center',
        }}>{item.badge > 99 ? '99+' : item.badge}</span>
      )}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════
// TopBar — page identity on the left, live context and account on the
// right. Sticky, so the shift controls stay reachable down a long page.
// ══════════════════════════════════════════════════════════════════════
export function TopBar({ title, sub, right }) {
  return (
    <header style={{
      position:'sticky', top:0, zIndex:50,
      padding:`${SP[4]} ${SP[6]}`,
      background:'rgba(0,0,0,0.82)', backdropFilter:'blur(12px)',
      borderBottom:`1px solid ${C.border}`,
    }}>
      {/* The same column the page body uses. Without it the title sat against
          the left edge and the controls against the right, with a metre of
          nothing between them on a wide monitor. */}
      <div style={{
        maxWidth:'var(--content-max)', margin:'0 auto',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        gap:SP[4], flexWrap:'wrap',
      }}>
        <div style={{ minWidth:0 }}>
          <h1 style={{ color:C.text, fontSize:T.xl, fontWeight:800, letterSpacing:'-0.4px', lineHeight:1.25 }}>
            {title}
          </h1>
          {sub && <div style={{ color:C.muted, fontSize:T.base, marginTop:'2px' }} className="ellip">{sub}</div>}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:SP[2], flexWrap:'wrap' }}>{right}</div>
      </div>
    </header>
  )
}

// ══════════════════════════════════════════════════════════════════════
// AccountButton — avatar, name, role. Opens whatever the caller wants.
// ══════════════════════════════════════════════════════════════════════
export function AccountButton({ name, sub, onClick }) {
  return (
    <button
      onClick={onClick}
      className="pressable"
      style={{
        display:'flex', alignItems:'center', gap:'9px',
        background:SURF.raised, border:`1px solid ${C.border2}`, borderRadius:R.md,
        padding:'5px 10px 5px 5px',
      }}
    >
      <span style={{
        width:'28px', height:'28px', borderRadius:'50%', background:C.accent,
        color:'#06120a', fontSize:'11px', fontWeight:800,
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
      }}>{(name || 'U').slice(0, 2).toUpperCase()}</span>
      <span style={{ textAlign:'left', minWidth:0 }}>
        <span className="ellip" style={{ display:'block', color:C.text, fontSize:T.sm, fontWeight:700, lineHeight:1.3 }}>
          {name || '—'}
        </span>
        <span style={{ display:'block', color:C.muted, fontSize:'10px', lineHeight:1.3 }}>{sub}</span>
      </span>
      <Icon name="chevron-down" size={13} color={C.muted} />
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════
// NotifyButton — bell with an unread count.
// ══════════════════════════════════════════════════════════════════════
// `ring` makes the bell knock itself every few seconds instead of sitting
// still. A badge that never moves stops being read after the first hour of a
// shift; something that has been waiting for someone deserves to ask again.
// It is a short shake on a long cycle, not a constant wobble, and it stops
// entirely for anyone who has asked their system for less motion.
export function NotifyButton({ count = 0, onClick, title = 'Notifications', ring = false }) {
  return (
    <button
      onClick={onClick} title={title}
      className="pressable"
      style={{
        position:'relative', background:SURF.raised,
        border:`1px solid ${ring ? C.amber + '66' : C.border2}`,
        borderRadius:R.md, width:'36px', height:'36px',
        display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
      }}
    >
      <span className={ring ? 'bell-ring' : undefined} style={{ display:'flex' }}>
        <Icon name="bell" size={16} color={ring ? C.amber : C.text2} />
      </span>
      {count > 0 && (
        <span style={{
          position:'absolute', top:'-5px', right:'-5px',
          background:C.red, color:'#fff', fontSize:'9px', fontWeight:800,
          borderRadius:R.full, minWidth:'17px', height:'17px', padding:'0 4px',
          display:'flex', alignItems:'center', justifyContent:'center',
          border:`2px solid ${C.bg}`,
        }}>{count > 9 ? '9+' : count}</span>
      )}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════
// PageBody — the one place page padding is decided.
// ══════════════════════════════════════════════════════════════════════
export function PageBody({ children, style }) {
  return (
    <main style={{ padding:`${SP[5]} ${SP[6]} ${SP[8]}`, minWidth:0 }}>
      <div style={{ maxWidth:'var(--content-max)', margin:'0 auto', minWidth:0, ...style }}>
        {children}
      </div>
    </main>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Small sidebar cards — status and profile blocks at the foot of the nav.
// ══════════════════════════════════════════════════════════════════════
export function SideCard({ children, style }) {
  return (
    <div style={{
      background:SURF.raised, border:`1px solid ${C.border}`, borderRadius:R.md,
      padding:'11px 12px', ...style,
    }}>{children}</div>
  )
}

export function SideRow({ label, value, valueColor }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', gap:SP[2], fontSize:T.xs, marginTop:'5px' }}>
      <span style={{ color:C.muted, flexShrink:0 }}>{label}</span>
      <span className="ellip" style={{ color:valueColor || C.text2, fontWeight:600, textAlign:'right' }}>{value}</span>
    </div>
  )
}

export { Tag }
