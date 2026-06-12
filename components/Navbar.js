import { useRouter } from 'next/router'

export default function Navbar({ user, shiftStatus, onEndShift }) {
  const router = useRouter()
  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
  }
  const now = new Date().toLocaleString('en-IN', {
    timeZone:'Asia/Kolkata', weekday:'short', day:'2-digit',
    month:'short', hour:'2-digit', minute:'2-digit', hour12:true
  })
  return (
    <nav style={{background:'#111',borderBottom:'1px solid #222',height:'52px',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'0 20px',position:'sticky',top:0,zIndex:100}}>
      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <path d="M13 2L3 6.5v7C3 19 7.5 23.5 13 25c5.5-1.5 10-6 10-11.5v-7L13 2z" fill="#22c55e" opacity="0.12"/>
          <path d="M13 2L3 6.5v7C3 19 7.5 23.5 13 25c5.5-1.5 10-6 10-11.5v-7L13 2z" fill="none" stroke="#22c55e" strokeWidth="1.2"/>
          <path d="M9 13l3 3 6-6" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span style={{color:'#fff',fontSize:'15px',fontWeight:'700'}}>Cau<span style={{color:'#22c55e'}}>tio</span> CRM</span>
        {user?.role==='admin' && <span style={{background:'#22c55e14',border:'1px solid #22c55e',borderRadius:'6px',padding:'2px 8px',color:'#22c55e',fontSize:'10px',fontWeight:'700',letterSpacing:'1px'}}>ADMIN</span>}
        {shiftStatus==='active' && <span style={{background:'#22c55e14',border:'1px solid #22c55e33',borderRadius:'20px',padding:'3px 10px',color:'#22c55e',fontSize:'11px',fontWeight:'600',display:'flex',alignItems:'center',gap:'5px'}}><span className="live-dot" style={{width:6,height:6}}></span>SHIFT ACTIVE</span>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'12px'}}>
        <span style={{color:'#6b7280',fontSize:'12px'}}>{now}</span>
        {user?.role!=='admin' && shiftStatus==='active' && onEndShift && (
          <button onClick={onEndShift} style={{background:'#ef444422',border:'1px solid #ef444433',borderRadius:'8px',color:'#f87171',fontSize:'12px',fontWeight:'600',padding:'6px 12px',cursor:'pointer'}}>⏹ End Shift</button>
        )}
        <div style={{width:'32px',height:'32px',borderRadius:'50%',background:'#22c55e',color:'#000',fontSize:'11px',fontWeight:'700',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer'}} onClick={handleLogout} title="Click to logout">
          {(user?.name||'U').slice(0,2).toUpperCase()}
        </div>
      </div>
    </nav>
  )
}
