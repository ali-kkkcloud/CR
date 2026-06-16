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
      </Head>
      <div style={s.page}>
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
    </>
  )
}

const s = {
  page:    { minHeight:'100vh', width:'100%', display:'flex', alignItems:'center', justifyContent:'center', background:'#0a0a0a', padding:'20px', boxSizing:'border-box' },
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
