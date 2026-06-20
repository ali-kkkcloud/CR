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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
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
          @media (max-width: 860px) {
            .cautio-left { display: none !important; }
            .cautio-right { flex: 1 !important; }
          }
          @keyframes moveRight {
            0%   { transform: translateX(-80px); opacity: 0; }
            10%  { opacity: 1; }
            90%  { opacity: 1; }
            100% { transform: translateX(700px); opacity: 0; }
          }
          @keyframes moveLeft {
            0%   { transform: translateX(700px); opacity: 0; }
            10%  { opacity: 1; }
            90%  { opacity: 1; }
            100% { transform: translateX(-80px); opacity: 0; }
          }
          @keyframes moveDown {
            0%   { transform: translateY(-60px); opacity: 0; }
            10%  { opacity: 1; }
            90%  { opacity: 1; }
            100% { transform: translateY(700px); opacity: 0; }
          }
          @keyframes moveUp {
            0%   { transform: translateY(700px); opacity: 0; }
            10%  { opacity: 1; }
            90%  { opacity: 1; }
            100% { transform: translateY(-60px); opacity: 0; }
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.5; }
            50%       { opacity: 1; }
          }
          @keyframes roadGlow {
            0%, 100% { opacity: 0.25; }
            50%       { opacity: 0.5; }
          }
          .road-h { animation: roadGlow 4s ease-in-out infinite; }
          .road-v { animation: roadGlow 4s ease-in-out infinite 2s; }
          .v1  { animation: moveRight 7s  linear infinite 0s;  }
          .v2  { animation: moveRight 7s  linear infinite 2.5s;}
          .v3  { animation: moveRight 10s linear infinite 1s;  }
          .v4  { animation: moveLeft  8s  linear infinite 0s;  }
          .v5  { animation: moveLeft  8s  linear infinite 3.5s;}
          .v6  { animation: moveDown  9s  linear infinite 0.5s;}
          .v7  { animation: moveDown  9s  linear infinite 4.5s;}
          .v8  { animation: moveUp    8s  linear infinite 1.5s;}
          .v9  { animation: moveUp    8s  linear infinite 5s;  }
          .pin1 { animation: pulse 3s ease-in-out infinite; }
          .pin2 { animation: pulse 3s ease-in-out infinite 1.5s; }
        `}</style>
      </Head>

      <div style={s.page}>

        {/* ── LEFT: Animated Fleet Map ── */}
        <div style={s.left} className="cautio-left">
          <svg viewBox="0 0 580 580" style={{position:'absolute',inset:0,width:'100%',height:'100%'}}>
            <defs>
              <pattern id="sg" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#162a1c" strokeWidth="0.8"/>
              </pattern>
              <pattern id="bg" width="160" height="160" patternUnits="userSpaceOnUse">
                <rect width="160" height="160" fill="url(#sg)"/>
                <path d="M 160 0 L 0 0 0 160" fill="none" stroke="#1e3828" strokeWidth="1.5"/>
              </pattern>
              <radialGradient id="cg" cx="50%" cy="50%" r="55%">
                <stop offset="0%"   stopColor="#22c55e" stopOpacity="0.2"/>
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0"/>
              </radialGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="4" result="blur"/>
                <feComposite in="SourceGraphic" in2="blur" operator="over"/>
              </filter>
            </defs>

            <rect width="580" height="580" fill="#050e07"/>
            <rect width="580" height="580" fill="url(#bg)"/>
            <ellipse cx="290" cy="290" rx="290" ry="290" fill="url(#cg)"/>

            {/* Horizontal road 1 — y=200 */}
            <rect x="0" y="193" width="580" height="14" fill="#0a1a0d" className="road-h"/>
            <line x1="0" y1="200" x2="580" y2="200" stroke="#22c55e" strokeWidth="2" strokeOpacity="0.5" filter="url(#glow)"/>

            {/* Horizontal road 2 — y=400 */}
            <rect x="0" y="393" width="580" height="14" fill="#0a1a0d" className="road-h"/>
            <line x1="0" y1="400" x2="580" y2="400" stroke="#22c55e" strokeWidth="2" strokeOpacity="0.5" filter="url(#glow)"/>

            {/* Vertical road 1 — x=160 */}
            <rect x="153" y="0" width="14" height="580" fill="#0a1a0d" className="road-v"/>
            <line x1="160" y1="0" x2="160" y2="580" stroke="#22c55e" strokeWidth="2" strokeOpacity="0.5" filter="url(#glow)"/>

            {/* Vertical road 2 — x=420 */}
            <rect x="413" y="0" width="14" height="580" fill="#0a1a0d" className="road-v"/>
            <line x1="420" y1="0" x2="420" y2="580" stroke="#22c55e" strokeWidth="2" strokeOpacity="0.5" filter="url(#glow)"/>

            {/* Intersection glow circles */}
            {[[160,200],[420,200],[160,400],[420,400]].map(([x,y],i) => (
              <g key={i}>
                <circle cx={x} cy={y} r="22" fill="#22c55e" fillOpacity="0.06"/>
                <circle cx={x} cy={y} r="5"  fill="#22c55e" fillOpacity="0.4"/>
              </g>
            ))}

            {/* Location pins */}
            <g className="pin1">
              <circle cx="160" cy="200" r="7" fill="#4ade80"/>
              <circle cx="160" cy="200" r="14" fill="none" stroke="#4ade80" strokeWidth="1" opacity="0.4"/>
              <text x="174" y="196" fill="#4ade80" fontSize="12" fontFamily="system-ui" fontWeight="700">Indore Hub</text>
            </g>
            <g className="pin2">
              <circle cx="420" cy="400" r="7" fill="#4ade80"/>
              <circle cx="420" cy="400" r="14" fill="none" stroke="#4ade80" strokeWidth="1" opacity="0.4"/>
              <text x="434" y="396" fill="#4ade80" fontSize="12" fontFamily="system-ui" fontWeight="700">Bangalore</text>
            </g>
            <g>
              <circle cx="420" cy="200" r="4" fill="#4ade80" fillOpacity="0.7"/>
              <text x="430" y="196" fill="#9ca3af" fontSize="10" fontFamily="system-ui">Delhi NCR</text>
            </g>
            <g>
              <circle cx="160" cy="400" r="4" fill="#4ade80" fillOpacity="0.7"/>
              <text x="170" y="396" fill="#9ca3af" fontSize="10" fontFamily="system-ui">Mumbai</text>
            </g>

            {/* ── VEHICLES moving RIGHT on road y=200 ── */}

            {/* Car - v1 */}
            <g className="v1">
              <rect x="0" y="195" width="20" height="9" rx="2.5" fill="#16a34a"/>
              <rect x="3" y="196" width="14" height="5" rx="1" fill="#4ade80" opacity="0.5"/>
              <rect x="4" y="197" width="3" height="2" rx="0.5" fill="#fff" opacity="0.7"/>
              <rect x="9" y="197" width="3" height="2" rx="0.5" fill="#fff" opacity="0.7"/>
              <circle cx="4"  cy="204" r="2" fill="#0a0a0a"/>
              <circle cx="16" cy="204" r="2" fill="#0a0a0a"/>
            </g>

            {/* Bus - v2 */}
            <g className="v2">
              <rect x="0" y="192" width="32" height="12" rx="2" fill="#14532d"/>
              <rect x="1" y="193" width="30" height="10" rx="1.5" fill="#22c55e" opacity="0.85"/>
              <rect x="2" y="194" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="9" y="194" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="16" y="194" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="23" y="194" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <circle cx="6"  cy="204" r="2.5" fill="#0a0a0a"/>
              <circle cx="26" cy="204" r="2.5" fill="#0a0a0a"/>
            </g>

            {/* Truck - v3 */}
            <g className="v3">
              <rect x="0" y="191" width="36" height="13" rx="1.5" fill="#14532d"/>
              <rect x="26" y="192" width="9" height="10" rx="1" fill="#1a3d22"/>
              <rect x="27" y="193" width="6" height="5" rx="0.5" fill="#4ade80" opacity="0.45"/>
              <rect x="1" y="193" width="23" height="8" rx="0.5" fill="#166534" opacity="0.8"/>
              <circle cx="8"  cy="204" r="2.5" fill="#0a0a0a"/>
              <circle cx="22" cy="204" r="2.5" fill="#0a0a0a"/>
              <circle cx="31" cy="204" r="2.5" fill="#0a0a0a"/>
            </g>

            {/* ── VEHICLES moving LEFT on road y=400 ── */}

            {/* Car - v4 */}
            <g className="v4">
              <rect x="560" y="395" width="20" height="9" rx="2.5" fill="#16a34a"/>
              <rect x="563" y="396" width="14" height="5" rx="1" fill="#4ade80" opacity="0.5"/>
              <rect x="564" y="397" width="3" height="2" rx="0.5" fill="#fff" opacity="0.7"/>
              <rect x="569" y="397" width="3" height="2" rx="0.5" fill="#fff" opacity="0.7"/>
              <circle cx="564" cy="404" r="2" fill="#0a0a0a"/>
              <circle cx="576" cy="404" r="2" fill="#0a0a0a"/>
            </g>

            {/* Bus - v5 */}
            <g className="v5">
              <rect x="548" y="392" width="32" height="12" rx="2" fill="#14532d"/>
              <rect x="549" y="393" width="30" height="10" rx="1.5" fill="#22c55e" opacity="0.85"/>
              <rect x="550" y="394" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="557" y="394" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="564" y="394" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="571" y="394" width="5" height="4" rx="0.5" fill="#fff" opacity="0.5"/>
              <circle cx="554" cy="404" r="2.5" fill="#0a0a0a"/>
              <circle cx="574" cy="404" r="2.5" fill="#0a0a0a"/>
            </g>

            {/* ── VEHICLES moving DOWN on road x=160 ── */}

            {/* Car - v6 */}
            <g className="v6">
              <rect x="155" y="0" width="9" height="20" rx="2.5" fill="#16a34a"/>
              <rect x="156" y="3" width="7" height="14" rx="1" fill="#4ade80" opacity="0.5"/>
              <rect x="157" y="4" width="2" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
              <rect x="157" y="9" width="2" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
              <circle cx="156" cy="3"  r="2" fill="#0a0a0a"/>
              <circle cx="163" cy="3"  r="2" fill="#0a0a0a"/>
              <circle cx="156" cy="20" r="2" fill="#0a0a0a"/>
              <circle cx="163" cy="20" r="2" fill="#0a0a0a"/>
            </g>

            {/* Bus - v7 */}
            <g className="v7">
              <rect x="153" y="0" width="14" height="32" rx="2" fill="#14532d"/>
              <rect x="154" y="1" width="12" height="30" rx="1.5" fill="#22c55e" opacity="0.85"/>
              <rect x="155" y="2" width="5" height="5" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="155" y="9" width="5" height="5" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="155" y="16" width="5" height="5" rx="0.5" fill="#fff" opacity="0.5"/>
              <circle cx="156" cy="1"  r="2.5" fill="#0a0a0a"/>
              <circle cx="163" cy="1"  r="2.5" fill="#0a0a0a"/>
              <circle cx="156" cy="31" r="2.5" fill="#0a0a0a"/>
              <circle cx="163" cy="31" r="2.5" fill="#0a0a0a"/>
            </g>

            {/* ── VEHICLES moving UP on road x=420 ── */}

            {/* Car - v8 */}
            <g className="v8">
              <rect x="415" y="560" width="9" height="20" rx="2.5" fill="#16a34a"/>
              <rect x="416" y="563" width="7" height="14" rx="1" fill="#4ade80" opacity="0.5"/>
              <rect x="417" y="564" width="2" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
              <rect x="417" y="569" width="2" height="3" rx="0.5" fill="#fff" opacity="0.7"/>
              <circle cx="416" cy="561" r="2" fill="#0a0a0a"/>
              <circle cx="423" cy="561" r="2" fill="#0a0a0a"/>
              <circle cx="416" cy="578" r="2" fill="#0a0a0a"/>
              <circle cx="423" cy="578" r="2" fill="#0a0a0a"/>
            </g>

            {/* Bus - v9 */}
            <g className="v9">
              <rect x="413" y="548" width="14" height="32" rx="2" fill="#14532d"/>
              <rect x="414" y="549" width="12" height="30" rx="1.5" fill="#22c55e" opacity="0.85"/>
              <rect x="415" y="550" width="5" height="5" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="415" y="557" width="5" height="5" rx="0.5" fill="#fff" opacity="0.5"/>
              <rect x="415" y="564" width="5" height="5" rx="0.5" fill="#fff" opacity="0.5"/>
              <circle cx="415" cy="549" r="2.5" fill="#0a0a0a"/>
              <circle cx="426" cy="549" r="2.5" fill="#0a0a0a"/>
              <circle cx="415" cy="578" r="2.5" fill="#0a0a0a"/>
              <circle cx="426" cy="578" r="2.5" fill="#0a0a0a"/>
            </g>

          </svg>

          {/* Left bottom text */}
          <div style={s.leftText}>
            <div style={s.leftTag}>CAUTIO FLEET INTELLIGENCE</div>
            <div style={s.leftHeading}>
              Every vehicle,<br/>
              <span style={{color:'#4ade80'}}>every moment,</span><br/>
              under your watch.
            </div>
            <div style={s.leftSub}>
              Monitoring 5Cr+ safe kilometers across India — from Indore to every highway.
            </div>
          </div>
        </div>

        {/* ── RIGHT: Login Form ── */}
        <div style={s.right} className="cautio-right">
          <div style={s.card}>
            <div style={s.logoRow}>
              <img src="/cautio_shield.webp" alt="Cautio" style={s.logoImg} onError={e => e.target.style.display='none'}/>
              <div>
                <div style={s.brand}>Cau<span style={{color:'#22c55e'}}>tio</span></div>
                <div style={s.sub}>FLEET INTELLIGENCE · CRM</div>
              </div>
            </div>
            <h1 style={s.title}>Welcome back</h1>
            <p style={s.desc}>Sign in to your operations dashboard</p>
            <form onSubmit={handleLogin}>
              <label style={s.lbl}>EMPLOYEE ID</label>
              <input
                style={s.inp}
                placeholder="EMP001 or your name"
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                required
                autoComplete="username"
              />
              <label style={s.lbl}>PASSWORD</label>
              <input
                style={s.inp}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              {error && <div style={s.err}>{error}</div>}
              <button type="submit" style={s.btn} disabled={loading}>
                {loading
                  ? <><span className="spinner" style={{width:16,height:16,borderWidth:2}}></span>&nbsp;Signing in...</>
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

const s = {
  page:    { minHeight:'100vh', width:'100%', display:'flex', background:'#0a0a0a' },
  left:    { flex:1, position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', justifyContent:'flex-end', padding:'48px', background:'#050e07', borderRight:'1px solid #1a2a1e', minHeight:'100vh' },
  leftText:    { position:'relative', zIndex:2 },
  leftTag:     { color:'#22c55e', fontSize:'10px', letterSpacing:'2.5px', fontWeight:'700', marginBottom:'16px', opacity:0.8 },
  leftHeading: { color:'#fff', fontSize:'30px', fontWeight:'800', lineHeight:'1.35', marginBottom:'14px' },
  leftSub:     { color:'#6b7280', fontSize:'13px', lineHeight:'1.6', maxWidth:'340px' },
  right:   { flex:'0 0 460px', display:'flex', alignItems:'center', justifyContent:'center', padding:'20px', boxSizing:'border-box', background:'#0a0a0a' },
  card:    { background:'#111', border:'1px solid #222', borderRadius:'16px', padding:'2.5rem 2rem', width:'100%', maxWidth:'380px', boxSizing:'border-box' },
  logoRow: { display:'flex', alignItems:'center', gap:'12px', marginBottom:'2rem' },
  logoImg: { width:'42px', height:'42px', objectFit:'contain', flexShrink:0 },
  brand:   { color:'#fff', fontSize:'22px', fontWeight:'700' },
  sub:     { color:'#6b7280', fontSize:'9px', letterSpacing:'2px', marginTop:'2px' },
  title:   { color:'#fff', fontSize:'22px', fontWeight:'700', marginBottom:'6px' },
  desc:    { color:'#6b7280', fontSize:'13px', marginBottom:'1.8rem' },
  lbl:     { display:'block', color:'#22c55e', fontSize:'10px', letterSpacing:'1.5px', fontWeight:'600', marginBottom:'6px' },
  inp:     { display:'block', width:'100%', background:'#161616', border:'1px solid #2a2a2a', borderRadius:'8px', color:'#fff', padding:'12px 14px', fontSize:'14px', marginBottom:'1.2rem', outline:'none', boxSizing:'border-box' },
  btn:     { width:'100%', background:'#22c55e', border:'none', borderRadius:'8px', color:'#000', fontWeight:'700', fontSize:'15px', padding:'13px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' },
  err:     { background:'#1a0808', border:'1px solid #3a1515', borderRadius:'8px', color:'#f87171', fontSize:'12px', padding:'10px 14px', marginBottom:'12px' },
  ver:     { color:'#374151', fontSize:'11px', textAlign:'center', marginTop:'1.5rem' },
}
