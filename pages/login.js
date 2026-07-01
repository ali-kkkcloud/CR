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
          @media (max-width: 860px) {
            .c-left  { display: none !important; }
            .c-right { flex: 1 !important; }
          }
          @keyframes r1 { 0%{transform:translateX(-50px);opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{transform:translateX(640px);opacity:0} }
          @keyframes r2 { 0%{transform:translateX(640px);opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{transform:translateX(-50px);opacity:0} }
          @keyframes d1 { 0%{transform:translateY(-50px);opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{transform:translateY(640px);opacity:0} }
          @keyframes u1 { 0%{transform:translateY(640px);opacity:0} 8%{opacity:1} 92%{opacity:1} 100%{transform:translateY(-50px);opacity:0} }
          @keyframes pinpulse { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.15)} }
          @keyframes roadshine { 0%,100%{opacity:.3} 50%{opacity:.55} }

          .ra { animation: r1 6s  linear infinite }
          .rb { animation: r1 6s  linear infinite 2.2s }
          .rc { animation: r1 9s  linear infinite 1s }
          .rd { animation: r2 7s  linear infinite }
          .re { animation: r2 7s  linear infinite 3.5s }
          .da { animation: d1 8s  linear infinite .5s }
          .db { animation: d1 8s  linear infinite 4.5s }
          .ua { animation: u1 7.5s linear infinite 1.5s }
          .ub { animation: u1 7.5s linear infinite 5s }
          .pa { animation: pinpulse 2.8s ease-in-out infinite }
          .pb { animation: pinpulse 2.8s ease-in-out infinite 1.4s }
          .rs { animation: roadshine 3s ease-in-out infinite }
          .rs2{ animation: roadshine 3s ease-in-out infinite 1.5s }
        `}</style>
      </Head>

      <div style={s.page}>

        {/* LEFT — Fleet animation */}
        <div style={s.left} className="c-left">
          <svg viewBox="0 0 600 600" style={{position:'absolute',inset:0,width:'100%',height:'100%',display:'block'}}>
            <defs>
              <pattern id="g1" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M40 0L0 0 0 40" fill="none" stroke="#163320" strokeWidth=".7"/>
              </pattern>
              <pattern id="g2" width="200" height="200" patternUnits="userSpaceOnUse">
                <rect width="200" height="200" fill="url(#g1)"/>
                <path d="M200 0L0 0 0 200" fill="none" stroke="#1e3d28" strokeWidth="1.5"/>
              </pattern>
              <radialGradient id="grd" cx="50%" cy="50%" r="60%">
                <stop offset="0%"   stopColor="#22c55e" stopOpacity=".18"/>
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0"/>
              </radialGradient>
              <filter id="glow"><feGaussianBlur stdDeviation="3"/></filter>
              <filter id="vglow"><feGaussianBlur stdDeviation="1.5" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter>
            </defs>

            <rect width="600" height="600" fill="#040d06"/>
            <rect width="600" height="600" fill="url(#g2)"/>
            <circle cx="300" cy="300" r="300" fill="url(#grd)"/>

            {/* Horizontal road 1 — y=210 */}
            <rect x="0" y="204" width="600" height="12" fill="#081508" className="rs"/>
            <line x1="0" y1="210" x2="600" y2="210" stroke="#22c55e" strokeWidth="1.5" strokeOpacity=".4" filter="url(#glow)" className="rs"/>
            <line x1="0" y1="210" x2="600" y2="210" stroke="#22c55e" strokeWidth=".5" strokeOpacity=".2"/>

            {/* Horizontal road 2 — y=400 */}
            <rect x="0" y="394" width="600" height="12" fill="#081508" className="rs2"/>
            <line x1="0" y1="400" x2="600" y2="400" stroke="#22c55e" strokeWidth="1.5" strokeOpacity=".4" filter="url(#glow)" className="rs2"/>

            {/* Vertical road 1 — x=160 */}
            <rect x="154" y="0" width="12" height="600" fill="#081508" className="rs"/>
            <line x1="160" y1="0" x2="160" y2="600" stroke="#22c55e" strokeWidth="1.5" strokeOpacity=".4" filter="url(#glow)" className="rs"/>

            {/* Vertical road 2 — x=440 */}
            <rect x="434" y="0" width="12" height="600" fill="#081508" className="rs2"/>
            <line x1="440" y1="0" x2="440" y2="600" stroke="#22c55e" strokeWidth="1.5" strokeOpacity=".4" filter="url(#glow)" className="rs2"/>

            {/* Intersection dots */}
            {[[160,210],[440,210],[160,400],[440,400]].map(([x,y],i)=>(
              <g key={i}>
                <circle cx={x} cy={y} r="20" fill="#22c55e" fillOpacity=".05"/>
                <circle cx={x} cy={y} r="4"  fill="#22c55e" fillOpacity=".5"/>
              </g>
            ))}

            {/* Pins — no city name labels */}
            <g className="pa" style={{transformOrigin:'160px 210px'}}>
              <circle cx="160" cy="210" r="7" fill="#4ade80"/>
              <circle cx="160" cy="210" r="16" fill="none" stroke="#4ade80" strokeWidth="1" strokeOpacity=".35"/>
            </g>
            <g className="pb" style={{transformOrigin:'440px 400px'}}>
              <circle cx="440" cy="400" r="7" fill="#4ade80"/>
              <circle cx="440" cy="400" r="16" fill="none" stroke="#4ade80" strokeWidth="1" strokeOpacity=".35"/>
            </g>
            <circle cx="440" cy="210" r="4" fill="#4ade80" fillOpacity=".6"/>
            <circle cx="160" cy="400" r="4" fill="#4ade80" fillOpacity=".6"/>

            {/* ── VEHICLES → road y=210 ── */}
            {/* Car */}
            <g className="ra" filter="url(#vglow)">
              <rect x="2" y="204" width="22" height="10" rx="3" fill="#15803d"/>
              <rect x="4" y="205" width="16" height="6"  rx="1.5" fill="#4ade80" opacity=".55"/>
              <rect x="5"  y="206" width="4" height="2.5" rx=".5" fill="#fff" opacity=".7"/>
              <rect x="11" y="206" width="4" height="2.5" rx=".5" fill="#fff" opacity=".7"/>
              <circle cx="5"  cy="214" r="2.2" fill="#0a0a0a"/>
              <circle cx="18" cy="214" r="2.2" fill="#0a0a0a"/>
            </g>
            {/* Bus */}
            <g className="rb" filter="url(#vglow)">
              <rect x="2" y="202" width="36" height="14" rx="2.5" fill="#14532d"/>
              <rect x="3" y="203" width="34" height="11" rx="1.5" fill="#22c55e" opacity=".8"/>
              <rect x="4"  y="204" width="6" height="5" rx=".5" fill="#fff" opacity=".45"/>
              <rect x="12" y="204" width="6" height="5" rx=".5" fill="#fff" opacity=".45"/>
              <rect x="20" y="204" width="6" height="5" rx=".5" fill="#fff" opacity=".45"/>
              <rect x="28" y="204" width="6" height="5" rx=".5" fill="#fff" opacity=".45"/>
              <circle cx="7"  cy="216" r="2.8" fill="#0a0a0a"/>
              <circle cx="30" cy="216" r="2.8" fill="#0a0a0a"/>
            </g>
            {/* Truck */}
            <g className="rc" filter="url(#vglow)">
              <rect x="2" y="201" width="40" height="15" rx="2" fill="#14532d"/>
              <rect x="30" y="202" width="11" height="12" rx="1.5" fill="#0d2015"/>
              <rect x="31" y="203" width="8"  height="6"  rx="1"   fill="#4ade80" opacity=".4"/>
              <circle cx="9"  cy="216" r="3" fill="#0a0a0a"/>
              <circle cx="24" cy="216" r="3" fill="#0a0a0a"/>
              <circle cx="35" cy="216" r="3" fill="#0a0a0a"/>
            </g>

            {/* ── VEHICLES ← road y=400 ── */}
            <g className="rd" filter="url(#vglow)">
              <rect x="576" y="394" width="22" height="10" rx="3" fill="#15803d"/>
              <rect x="578" y="395" width="16" height="6"  rx="1.5" fill="#4ade80" opacity=".55"/>
              <circle cx="579" cy="404" r="2.2" fill="#0a0a0a"/>
              <circle cx="594" cy="404" r="2.2" fill="#0a0a0a"/>
            </g>
            <g className="re" filter="url(#vglow)">
              <rect x="562" y="392" width="36" height="14" rx="2.5" fill="#14532d"/>
              <rect x="563" y="393" width="34" height="11" rx="1.5" fill="#22c55e" opacity=".8"/>
              <rect x="564" y="394" width="6" height="5" rx=".5" fill="#fff" opacity=".45"/>
              <rect x="572" y="394" width="6" height="5" rx=".5" fill="#fff" opacity=".45"/>
              <rect x="580" y="394" width="6" height="5" rx=".5" fill="#fff" opacity=".45"/>
              <circle cx="567" cy="406" r="2.8" fill="#0a0a0a"/>
              <circle cx="590" cy="406" r="2.8" fill="#0a0a0a"/>
            </g>

            {/* ── VEHICLES ↓ road x=160 ── */}
            <g className="da" filter="url(#vglow)">
              <rect x="154" y="2" width="12" height="22" rx="3" fill="#15803d"/>
              <rect x="155" y="4" width="10" height="16" rx="1.5" fill="#4ade80" opacity=".55"/>
              <rect x="156" y="5"  width="3" height="4" rx=".5" fill="#fff" opacity=".7"/>
              <rect x="156" y="11" width="3" height="4" rx=".5" fill="#fff" opacity=".7"/>
              <circle cx="156" cy="4"  r="2" fill="#0a0a0a"/>
              <circle cx="164" cy="4"  r="2" fill="#0a0a0a"/>
              <circle cx="156" cy="23" r="2" fill="#0a0a0a"/>
              <circle cx="164" cy="23" r="2" fill="#0a0a0a"/>
            </g>
            <g className="db" filter="url(#vglow)">
              <rect x="153" y="2" width="14" height="36" rx="2.5" fill="#14532d"/>
              <rect x="154" y="3" width="12" height="33" rx="1.5" fill="#22c55e" opacity=".8"/>
              <rect x="155" y="4"  width="5" height="6" rx=".5" fill="#fff" opacity=".4"/>
              <rect x="155" y="13" width="5" height="6" rx=".5" fill="#fff" opacity=".4"/>
              <rect x="155" y="22" width="5" height="6" rx=".5" fill="#fff" opacity=".4"/>
              <circle cx="156" cy="3"  r="2.5" fill="#0a0a0a"/>
              <circle cx="165" cy="3"  r="2.5" fill="#0a0a0a"/>
              <circle cx="156" cy="37" r="2.5" fill="#0a0a0a"/>
              <circle cx="165" cy="37" r="2.5" fill="#0a0a0a"/>
            </g>

            {/* ── VEHICLES ↑ road x=440 ── */}
            <g className="ua" filter="url(#vglow)">
              <rect x="434" y="576" width="12" height="22" rx="3" fill="#15803d"/>
              <rect x="435" y="578" width="10" height="16" rx="1.5" fill="#4ade80" opacity=".55"/>
              <circle cx="436" cy="578" r="2" fill="#0a0a0a"/>
              <circle cx="444" cy="578" r="2" fill="#0a0a0a"/>
              <circle cx="436" cy="597" r="2" fill="#0a0a0a"/>
              <circle cx="444" cy="597" r="2" fill="#0a0a0a"/>
            </g>
            <g className="ub" filter="url(#vglow)">
              <rect x="433" y="562" width="14" height="36" rx="2.5" fill="#14532d"/>
              <rect x="434" y="563" width="12" height="33" rx="1.5" fill="#22c55e" opacity=".8"/>
              <rect x="435" y="564" width="5" height="6" rx=".5" fill="#fff" opacity=".4"/>
              <rect x="435" y="573" width="5" height="6" rx=".5" fill="#fff" opacity=".4"/>
              <circle cx="435" cy="563" r="2.5" fill="#0a0a0a"/>
              <circle cx="445" cy="563" r="2.5" fill="#0a0a0a"/>
              <circle cx="435" cy="597" r="2.5" fill="#0a0a0a"/>
              <circle cx="445" cy="597" r="2.5" fill="#0a0a0a"/>
            </g>

          </svg>

          <div style={s.leftText}>
            <div style={s.leftTag}>CAUTIO FLEET INTELLIGENCE</div>
            <div style={s.leftHeading}>
              Every vehicle,<br/>
              <span style={{color:'#4ade80'}}>every moment,</span><br/>
              under your watch.
            </div>
            <div style={s.leftSub}>
              Monitoring 5Cr+ safe kilometers across India — real-time fleet intelligence at your fingertips.
            </div>
          </div>
        </div>

        {/* RIGHT — Login Form */}
        <div style={s.right} className="c-right">
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
  page: { minHeight:'100vh', width:'100%', display:'flex', background:'#0a0a0a' },
  left: { flex:1, position:'relative', overflow:'hidden', display:'flex', flexDirection:'column', justifyContent:'flex-end', padding:'52px', background:'#040d06', borderRight:'1px solid #162a1c', minHeight:'100vh' },
  leftText:    { position:'relative', zIndex:2 },
  leftTag:     { color:'#22c55e', fontSize:'10px', letterSpacing:'2.5px', fontWeight:'700', marginBottom:'18px', opacity:.75 },
  leftHeading: { color:'#fff', fontSize:'32px', fontWeight:'800', lineHeight:'1.32', marginBottom:'14px' },
  leftSub:     { color:'#4b6857', fontSize:'13px', lineHeight:'1.65', maxWidth:'360px' },
  right: { flex:'0 0 480px', display:'flex', alignItems:'center', justifyContent:'center', padding:'24px', boxSizing:'border-box', background:'#0a0a0a' },
  card:    { background:'#111', border:'1px solid #1e1e1e', borderRadius:'16px', padding:'2.5rem 2.2rem', width:'100%', maxWidth:'400px', boxSizing:'border-box' },
  logoRow: { display:'flex', alignItems:'center', gap:'12px', marginBottom:'2rem' },
  logoImg: { width:'42px', height:'42px', objectFit:'contain', flexShrink:0 },
  brand:   { color:'#fff', fontSize:'22px', fontWeight:'700' },
  sub:     { color:'#4b6857', fontSize:'9px', letterSpacing:'2px', marginTop:'2px' },
  title:   { color:'#fff', fontSize:'22px', fontWeight:'700', marginBottom:'6px' },
  desc:    { color:'#6b7280', fontSize:'13px', marginBottom:'1.8rem' },
  lbl:     { display:'block', color:'#22c55e', fontSize:'10px', letterSpacing:'1.5px', fontWeight:'600', marginBottom:'6px' },
  inp:     { display:'block', width:'100%', background:'#161616', border:'1px solid #252525', borderRadius:'8px', color:'#fff', padding:'12px 14px', fontSize:'14px', marginBottom:'1.2rem', outline:'none', boxSizing:'border-box' },
  btn:     { width:'100%', background:'#22c55e', border:'none', borderRadius:'8px', color:'#000', fontWeight:'700', fontSize:'15px', padding:'13px', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:'8px' },
  err:     { background:'#1a0808', border:'1px solid #3a1515', borderRadius:'8px', color:'#f87171', fontSize:'12px', padding:'10px 14px', marginBottom:'12px' },
  ver:     { color:'#333', fontSize:'11px', textAlign:'center', marginTop:'1.5rem' },
}
