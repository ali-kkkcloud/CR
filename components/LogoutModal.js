import { C } from './Widgets'

export default function LogoutModal({ show, onConfirm, onCancel }) {
  if (!show) return null
  return (
    <div style={s.overlay} onClick={onCancel}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.icon}>⏻</div>
        <div style={s.title}>Logout?</div>
        <div style={s.desc}>Are you sure you want to logout? You will need to sign in again.</div>
        <div style={s.btnRow}>
          <button style={s.noBtn} onClick={onCancel}>No, stay</button>
          <button style={s.yesBtn} onClick={onConfirm}>Yes, logout</button>
        </div>
      </div>
    </div>
  )
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, backdropFilter: 'blur(2px)',
  },
  modal: {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: '16px',
    padding: '2rem', width: '320px', textAlign: 'center',
  },
  icon: { fontSize: '32px', color: C.red, marginBottom: '12px' },
  title: { color: C.text, fontSize: '18px', fontWeight: '700', marginBottom: '8px' },
  desc: { color: C.muted, fontSize: '13px', marginBottom: '24px', lineHeight: '1.5' },
  btnRow: { display: 'flex', gap: '10px' },
  noBtn: {
    flex: 1, background: C.s2, border: `1px solid ${C.border2}`, borderRadius: '8px',
    color: C.text, fontSize: '13px', fontWeight: '600', padding: '11px', cursor: 'pointer',
  },
  yesBtn: {
    flex: 1, background: C.red, border: 'none', borderRadius: '8px',
    color: '#fff', fontSize: '13px', fontWeight: '600', padding: '11px', cursor: 'pointer',
  },
}
