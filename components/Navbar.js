import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'

export default function Navbar({ user, shiftStatus, onEndShift }) {
  const router = useRouter()
  const [clock, setClock] = useState('')

  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleString('en-IN', {
        timeZone:'Asia/Kolkata', weekday:'short', day:'2-digit',
        month:'short', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:true
      }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method:'POST' })
    router.push('/login')
  }

  return (
    <nav style={s.nav}>
      <div style={s.left}>
        <img src="/cautio_shield.webp" alt="Cautio" style={s.logo}
          onError={e => e.target.style.display='none'}/>
        <span style={s.brand}>Cau<span style={{color:'#22c55e'}}>tio</span> CRM</span>
        {user?.role === 'admin' && <span style={s.adminBadge}>ADMIN</span>}
        {shiftStatus === 'active' && (
          <span style={s.shiftPill}>
            <span className="live-dot" style={{width:6,height:6}}></span>
            SHIFT ACTIVE
          </span>
        )}
      </div>
      <div style={s.right}>
        <span style={s.clock}>{clock}</span>
        {user?.role !== 'admin' && shiftStatus === 'active' && onEndShift && (
          <button onClick={onEndShift} style={s.endBtn}>⏹ End Shift</button>
        )}
        <div style={s.avatar} onClick={handleLogout} title="Click to logout">
          {(user?.name||'U').slice(0,2).toUpperCase()}
        </div>
      </div>
    </nav>
  )
}

const s = {
  nav:       { background:'#111', borderBottom:'1px solid #222', height:'52px', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', position:'sticky', top:0, zIndex:100 },
  left:      { display:'flex', alignItems:'center', gap:'10px' },
  logo:      { width:'24px', height:'24px', objectFit:'contain' },
  brand:     { color:'#fff', fontSize:'15px', fontWeight:'700', whiteSpace:'nowrap' },
  adminBadge:{ background:'#22c55e14', border:'1px solid #22c55e', borderRadius:'6px', padding:'2px 8px', color:'#22c55e', fontSize:'10px', fontWeight:'700', letterSpacing:'1px' },
  shiftPill: { background:'#22c55e14', border:'1px solid #22c55e33', borderRadius:'20px', padding:'3px 10px', color:'#22c55e', fontSize:'11px', fontWeight:'600', display:'flex', alignItems:'center', gap:'5px' },
  right:     { display:'flex', alignItems:'center', gap:'12px' },
  clock:     { color:'#6b7280', fontSize:'12px', whiteSpace:'nowrap', fontVariantNumeric:'tabular-nums' },
  endBtn:    { background:'#ef444422', border:'1px solid #ef444433', borderRadius:'8px', color:'#f87171', fontSize:'12px', fontWeight:'600', padding:'6px 12px', cursor:'pointer', whiteSpace:'nowrap' },
  avatar:    { width:'32px', height:'32px', borderRadius:'50%', background:'#22c55e', color:'#000', fontSize:'11px', fontWeight:'700', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 },
}
