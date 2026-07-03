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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; background: #020704; overflow: hidden; }

          .page {
            width: 100vw;
            height: 100vh;
            display: flex;
            background: #020704;
            overflow: hidden;
          }

          /* ── LEFT: Video panel ── */
          .left-panel {
            flex: 1;
            position: relative;
            overflow: hidden;
            background: #020704;
          }

          .left-video {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            filter: brightness(0.85) saturate(1.15) contrast(1.05);
          }

          /* Subtle dark vignette on edges, NOT center — keeps video clear */
          .left-vignette {
            position: absolute;
            inset: 0;
            background:
              linear-gradient(to right,  rgba(2,7,4,0.3) 0%, transparent 15%, transparent 85%, rgba(2,7,4,0.9) 100%),
              linear-gradient(to bottom, rgba(2,7,4,0.4) 0%, transparent 12%, transparent 80%, rgba(2,7,4,0.7) 100%);
            pointer-events: none;
          }

          /* Bottom-left text over video */
          .left-branding {
            position: absolute;
            bottom: 40px;
            left: 40px;
            z-index: 5;
          }
          .lb-tag {
            color: rgba(74,222,128,0.75);
            font-size: 10px;
            letter-spacing: 3px;
            font-weight: 700;
            margin-bottom: 12px;
            text-transform: uppercase;
          }
          .lb-headline {
            color: #fff;
            font-size: 28px;
            font-weight: 900;
            line-height: 1.3;
            text-shadow: 0 2px 20px rgba(0,0,0,0.9), 0 0 40px rgba(0,0,0,0.7);
            margin-bottom: 10px;
          }
          .lb-green { color: #4ade80; }
          .lb-sub {
            color: rgba(255,255,255,0.55);
            font-size: 13px;
            line-height: 1.6;
            max-width: 360px;
            text-shadow: 0 1px 10px rgba(0,0,0,0.9);
          }

          /* ── RIGHT: Login card panel ── */
          .right-panel {
            width: 520px;
            min-width: 520px;
            background: rgba(2,10,5,0.96);
            border-left: 1px solid rgba(34,197,94,0.12);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 48px 52px;
            flex-shrink: 0;
            position: relative;
            z-index: 10;
          }

          /* Subtle green glow from left edge */
          .right-panel::before {
            content: '';
            position: absolute;
            left: -1px;
            top: 20%;
            height: 60%;
            width: 1px;
            background: linear-gradient(to bottom, transparent, rgba(34,197,94,0.5), transparent);
          }

          .card-inner { width: 100%; }

          /* Logo */
          .logo-row {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 3rem;
          }
          .logo-img {
            width: 56px;
            height: 56px;
            object-fit: contain;
            filter: drop-shadow(0 0 14px rgba(34,197,94,0.5));
          }
          .brand-name {
            font-size: 30px;
            font-weight: 900;
            color: #fff;
            letter-spacing: -0.5px;
          }
          .brand-sub {
            font-size: 9px;
            letter-spacing: 2.5px;
            color: rgba(34,197,94,0.45);
            margin-top: 4px;
          }

          /* Heading */
          .heading {
            font-size: 36px;
            font-weight: 900;
            color: #fff;
            letter-spacing: -0.8px;
            line-height: 1.12;
            margin-bottom: 10px;
          }
          .sub-heading {
            font-size: 14px;
            color: rgba(255,255,255,0.35);
            margin-bottom: 2.8rem;
            line-height: 1.5;
          }

          /* Fields */
          .field-label {
            display: block;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 1.8px;
            color: #22c55e;
            margin-bottom: 8px;
          }
          .field-input {
            display: block;
            width: 100%;
            background: rgba(255,255,255,0.04);
            border: 1px solid rgba(34,197,94,0.2);
            border-radius: 12px;
            color: #fff;
            padding: 16px 18px;
            font-size: 15px;
            margin-bottom: 1.4rem;
            outline: none;
            transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
            font-family: inherit;
          }
          .field-input:focus {
            border-color: rgba(34,197,94,0.6);
            background: rgba(34,197,94,0.04);
            box-shadow: 0 0 0 3px rgba(34,197,94,0.08);
          }
          .field-input::placeholder { color: rgba(255,255,255,0.18); }
          input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 30px rgba(2,10,5,0.98) inset !important;
            -webkit-text-fill-color: #fff !important;
          }

          /* Error */
          .error-box {
            background: rgba(239,68,68,0.08);
            border: 1px solid rgba(239,68,68,0.25);
            border-radius: 10px;
            color: #f87171;
            font-size: 13px;
            padding: 12px 16px;
            margin-bottom: 16px;
          }

          /* Button */
          .submit-btn {
            width: 100%;
            background: #22c55e;
            border: none;
            border-radius: 12px;
            color: #000;
            font-weight: 900;
            font-size: 16px;
            padding: 17px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            letter-spacing: 0.3px;
            box-shadow: 0 0 36px rgba(34,197,94,0.3), 0 4px 20px rgba(0,0,0,0.5);
            transition: all 0.2s;
            font-family: inherit;
          }
          .submit-btn:hover:not(:disabled) {
            background: #4ade80;
            transform: translateY(-1px);
            box-shadow: 0 0 52px rgba(34,197,94,0.45), 0 6px 24px rgba(0,0,0,0.5);
          }
          .submit-btn:disabled { background: #166534; cursor: wait; }

          .version-txt {
            color: rgba(255,255,255,0.14);
            font-size: 11px;
            text-align: center;
            margin-top: 2rem;
            letter-spacing: 0.3px;
          }

          @media (max-width: 820px) {
            .left-panel { display: none; }
            .right-panel { width: 100%; min-width: unset; padding: 32px 24px; }
          }
        `}</style>
      </Head>

      <div className="page">

        {/* ── LEFT: VIDEO ── */}
        <div className="left-panel">
          <video
            className="left-video"
            autoPlay
            loop
            muted
            playsInline
            src="/fleet_bg.mp4"
          />
          <div className="left-vignette"/>

          {/* Branding text bottom-left */}
          <div className="left-branding">
            <div className="lb-tag">Cautio Fleet Intelligence</div>
            <div className="lb-headline">
              Every vehicle,<br/>
              <span className="lb-green">every moment,</span><br/>
              under your watch.
            </div>
            <div className="lb-sub">
              India's most trusted fleet command center — monitoring 5Cr+ safe kilometers in real time.
            </div>
          </div>
        </div>

        {/* ── RIGHT: LOGIN CARD ── */}
        <div className="right-panel">
          <div className="card-inner">

            {/* Logo */}
            <div className="logo-row">
              <img
                src="/cautio_shield.webp"
                alt="Cautio"
                className="logo-img"
                onError={e => e.target.style.display='none'}
              />
              <div>
                <div className="brand-name">
                  Cau<span style={{color:'#22c55e'}}>tio</span>
                </div>
                <div className="brand-sub">FLEET INTELLIGENCE · CRM</div>
              </div>
            </div>

            <h1 className="heading">Welcome back</h1>
            <p className="sub-heading">
              Sign in to your Command Center
            </p>

            <form onSubmit={handleLogin}>
              <label className="field-label">EMPLOYEE ID</label>
              <input
                className="field-input"
                placeholder="EMP001 or your name"
                value={empId}
                onChange={e => setEmpId(e.target.value)}
                required
                autoComplete="username"
              />

              <label className="field-label">PASSWORD</label>
              <input
                className="field-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />

              {error && <div className="error-box">{error}</div>}

              <button
                type="submit"
                className="submit-btn"
                disabled={loading}
              >
                {loading
                  ? <><span className="spinner" style={{width:18,height:18,borderWidth:2}}/> Signing in...</>
                  : 'Sign In →'}
              </button>
            </form>

            <p className="version-txt">
              Cautio CRM v2.0 · Fleet Command Center
            </p>

          </div>
        </div>

      </div>
    </>
  )
}
