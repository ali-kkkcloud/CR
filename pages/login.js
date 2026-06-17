import { useState } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

export default function Login() {
  const router = useRouter()
  const [empId,    setEmpId]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res  = await fetch('/api/auth/login', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ empId, password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); setLoading(false); return }
      if (data.user.role === 'admin') router.push('/admin')
      else router.push('/dashboard')
    } catch { setError('Network error. Try again.'); setLoading(false) }
  }

  return (
    <>
      <Head>
        <title>Cautio CRM — Login</title>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <style>{`
          @media (max-width: 900px) {
            .cautio-left-panel { display: none !important; }
            .cautio-right-panel { flex: 1 !important; }
          }
        `}</style>
      </Head>
      <div style={s.page}>

        <div style={s.leftPanel} className="cautio-left-panel">
          <FleetAnimation />
          <div style={s.leftText}>
            <div style={s.leftHeading}>Creating <span style={{color:'#4ade80'}}>Nationwide Connections</span></div>
            <div style={s.leftHeading}>&amp; Building <span style={{color:'#4ade80'}}>Safer Roads</span></div>
            <div style={s.leftSub}>Real-time fleet intelligence across India</div>
          </div>
        </div>

        <div style={s.rightPanel} className="cautio-right-panel">
          <div style={s.card}>
            <div style={s.logoRow}>
              <img src="/cautio_shield.webp" alt="Cautio" style={s.logoImg}
                onError={e => e.target.style.display='none'}/>
              <div>
                <div style={s.brand}>Cau<span style={{color:'#22c55e'}}>tio</span></div>
                <div style={s.sub}>FLEET INTELLIGENCE · CRM</div>
              </div>
            </div>
            <h1 style={s.title}>Welcome back</h1>
            <p style={s.desc}>Sign in to your operations dashboard</p>
            <form onSubmit={handleLogin}>
              <label style={s.lbl}>EMPLOYEE ID</label>
              <input style={s.inp} placeholder="EMP001 or your name"
                value={empId} onChange={e=>setEmpId(e.target.value)} required autoComplete="username"/>
              <label style={s.lbl}>PASSWORD</label>
              <input style={s.inp} type="password" placeholder="••••••••"
                value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/>
              {error && <div style={s.err}>{error}</div>}
              <button type="submit" style={s.btn} disabled={loading}>
                {loading
                  ? <><span className="spinner" style={{width:16,height:16,borderWidth:2}}></span> Signing in...</>
                  : 'Sign In →'}
              </button>
            </form>
            <p style={s.ver}>Cautio CRM v2.0 · Internal Platform</p>
          </div>
        </div>
      </div>
    </>
  )
}

function FleetAnimation() {
  return (
    <svg viewBox="0 0 600 600" style={{ width: '100%', height: '100%', position:'absolute', inset:0 }}>
      <defs>
        <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#1a3a24" strokeWidth="1"/>
        </pattern>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#22c55e" stopOpacity="0.25"/>
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0"/>
        </radialGradient>
        <filter id="dotGlow"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>

      <rect width="600" height="600" fill="url(#grid)" />
      <circle cx="300" cy="300" r="280" fill="url(#glow)" />

      <path d="M 0 220 L 600 220" stroke="#22c55e" strokeOpacity="0.35" strokeWidth="3"/>
      <path d="M 0 380 L 600 380" stroke="#22c55e" strokeOpacity="0.35" strokeWidth="3"/>
      <path d="M 180 0 L 180 600" stroke="#22c55e" strokeOpacity="0.35" strokeWidth="3"/>
      <path d="M 420 0 L 420 600" stroke="#22c55e" strokeOpacity="0.35" strokeWidth="3"/>
      <path d="M 0 0 L 600 600" stroke="#22c55e" strokeOpacity="0.15" strokeWidth="2"/>

      <g>
        <circle cx="180" cy="220" r="5" fill="#4ade80"/>
        <text x="192" y="215" fill="#9ca3af" fontSize="13" fontFamily="system-ui">MG Road</text>
      </g>
      <g>
        <circle cx="420" cy="380" r="5" fill="#4ade80"/>
        <text x="432" y="375" fill="#9ca3af" fontSize="13" fontFamily="system-ui">Park Street</text>
      </g>

      <circle r="6" fill="#4ade80" filter="url(#dotGlow)">
        <animateMotion dur="6s" repeatCount="indefinite" path="M 0 220 L 600 220" />
      </circle>
      <circle r="5" fill="#86efac">
        <animateMotion dur="6s" repeatCount="indefinite" path="M 0 220 L 600 220" />
      </circle>

      <circle r="6" fill="#4ade80" filter="url(#dotGlow)">
        <animateMotion dur="8s" repeatCount="indefinite" path="M 600 380 L 0 380" />
      </circle>
      <circle r="5" fill="#86efac">
        <animateMotion dur="8s" repeatCount="indefinite" path="M 600 380 L 0 380" />
      </circle>

      <circle r="6" fill="#4ade80" filter="url(#dotGlow)">
        <animateMotion dur="7s" repeatCount="indefinite" path="M 180 0 L 180 600" />
      </circle>
      <circle r="5" fill="#86efac">
        <animateMotion dur="7s" repeatCount="indefinite" path="M 180 0 L 180 600" />
      </circle>

      <circle r="6" fill="#4ade80" filter="url(#dotGlow)">
        <animateMotion dur="9s" repeatCount="indefinite" path="M 420 600 L 420 0" />
      </circle>
      <circle r="5" fill="#86efac">
        <animateMotion dur="9s" repeatCount="indefinite" path="M 420 600 L 420 0" />
      </circle>

      <circle cx="180" cy="220" r="10" fill="none" stroke="#4ade80" strokeWidth="1.5" opacity="0.6">
        <animate attributeName="r" values="6;30;6" dur="3s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.6;0;0.6" dur="3s" repeatCount="indefinite"/>
      </circle>
      <circle cx="420" cy="380" r="10" fill="none" stroke="#4ade80" strokeWidth="1.5" opacity="0.6">
        <animate attributeName="r" values="6;30;6" dur="3.5s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0.6;0;0.6" dur="3.5s" repeatCount="indefinite"/>
      </circle>
    </svg>
  )
}

const s = {
  page: { minHeight:'100vh', width:'100%', display:'flex', background:'#0a0a0a' },
  leftPanel: {
    flex: 1, position: 'relative', overflow: 'hidden', display:'flex', flexDirection:'column',
    justifyContent: 'flex-end', padding: '60px', background: '#070d09',
    borderRight: '1px solid #1a2a1e',
  },
  leftText: { position: 'relative', zIndex: 2 },
  leftHeading: { color: '#fff', fontSize: '28px', fontWeight: '700', lineHeight: '1.4' },
  leftSub: { color: '#6b7280', fontSize: '14px', marginTop: '12px' },
  rightPanel: { flex: '0 0 480px', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', boxSizing:'border-box' },
  card:    { background:'#111', border:'1px solid #222', borderRadius:'16px', padding:'2.5rem 2rem', width:'100%', maxWidth:'400px', boxSizing:'border-box' },
  logoRow: { display:'flex', alignItems:'center', gap:'12px', marginBottom:'2rem' },
  logoImg: { width:'42px', height:'42px', objectFit:'contain', flexShrink:0 },
  brand:   { color:'#fff', fontSize:'22px', fontWeight:'700' },
  sub:     { color:'#6b7280', fontSize:'9px', letterSpacing:'2px', marginTop:'2px' },
  title:   { color:'#fff', fontSize:'24px', fontWeight:'700', marginBottom:'6px' },
  desc:    { color:'#6b7280', fontSize:'13px', marginBottom:'1.8rem' },
  lbl:     { display:'block', color:'#22c55e', fontSize:'10px', letterSpacing:'1.5px', fontWeight:'600', marginBottom:'6px' },
  inp:     { display:'block', width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', padding:'12px 14px', fontSize:'14px', marginBottom:'1.2rem', outline:'none', boxSizing:'border-box' },
  btn:     { width:'100%', background:'#22c55e', border:'none', borderRadius:'8px', color:'#000', fontWeight:'700', fontSize:'15px', padding:'13px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' },
  err:     { background:'#1a0808', border:'1px solid #3a1515', borderRadius:'8px', color:'#f87171', fontSize:'12px', padding:'10px 14px', marginBottom:'12px' },
  ver:     { color:'#374151', fontSize:'11px', textAlign:'center', marginTop:'1.5rem' },
}
