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
    } catch { setError('Network error.'); setLoading(false) }
  }

  return (
    <>
      <Head><title>Cautio CRM — Login</title></Head>
      <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:'#0a0a0a',padding:'20px'}}>
        <div style={{background:'#111',border:'1px solid #222',borderRadius:'16px',padding:'2.5rem 2rem',width:'100%',maxWidth:'380px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'2rem'}}>
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
              <path d="M20 3L4 10v10c0 10 6.5 19 16 21.5C29.5 39 36 30 36 20V10L20 3z" fill="#22c55e" opacity="0.12"/>
              <path d="M20 3L4 10v10c0 10 6.5 19 16 21.5C29.5 39 36 30 36 20V10L20 3z" fill="none" stroke="#22c55e" strokeWidth="1.5"/>
              <path d="M13 20l5 5 9-9" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <div>
              <div style={{color:'#fff',fontSize:'20px',fontWeight:'700'}}>Cau<span style={{color:'#22c55e'}}>tio</span></div>
              <div style={{color:'#6b7280',fontSize:'9px',letterSpacing:'2.5px'}}>FLEET INTELLIGENCE · CRM</div>
            </div>
          </div>
          <h1 style={{color:'#fff',fontSize:'22px',fontWeight:'700',marginBottom:'4px'}}>Welcome back</h1>
          <p style={{color:'#6b7280',fontSize:'13px',marginBottom:'1.8rem'}}>Sign in to your operations dashboard</p>
          <form onSubmit={handleLogin}>
            <label style={{display:'block',color:'#22c55e',fontSize:'10px',letterSpacing:'1.5px',fontWeight:'600',marginBottom:'6px'}}>EMPLOYEE ID</label>
            <input style={{display:'block',width:'100%',background:'#161616',border:'1px solid #2a2a2a',borderRadius:'8px',color:'#fff',padding:'11px 14px',fontSize:'14px',marginBottom:'1.2rem',outline:'none'}}
              placeholder="EMP001 or your name" value={empId} onChange={e=>setEmpId(e.target.value)} required/>
            <label style={{display:'block',color:'#22c55e',fontSize:'10px',letterSpacing:'1.5px',fontWeight:'600',marginBottom:'6px'}}>PASSWORD</label>
            <input style={{display:'block',width:'100%',background:'#161616',border:'1px solid #2a2a2a',borderRadius:'8px',color:'#fff',padding:'11px 14px',fontSize:'14px',marginBottom:'1.2rem',outline:'none'}}
              type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required/>
            {error && <div style={{background:'#1a0808',border:'1px solid #3a1515',borderRadius:'8px',color:'#f87171',fontSize:'12px',padding:'10px 14px',marginBottom:'12px'}}>{error}</div>}
            <button type="submit" disabled={loading}
              style={{width:'100%',background:'#22c55e',border:'none',borderRadius:'8px',color:'#000',fontWeight:'700',fontSize:'14px',padding:'13px',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:'8px'}}>
              {loading ? <><span className="spinner" style={{width:16,height:16,borderWidth:2}}></span>Signing in...</> : 'Sign In →'}
            </button>
          </form>
          <div style={{color:'#374151',fontSize:'11px',textAlign:'center',marginTop:'1.5rem'}}>Cautio CRM v2.0 · Internal Platform</div>
        </div>
      </div>
    </>
  )
}
