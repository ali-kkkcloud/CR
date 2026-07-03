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
            position: relative;
            width: 100vw;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: flex-end;
            overflow: hidden;
          }

          /* VIDEO — full background, covers entire screen */
          .bg-video-wrap {
            position: absolute;
            inset: 0;
            z-index: 0;
          }
          .bg-video {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            filter: brightness(0.5) saturate(1.3);
          }

          /* Gradient overlay — right side gets darker for card readability */
          .bg-overlay {
            position: absolute;
            inset: 0;
            z-index: 1;
            background: linear-gradient(
              to left,
              rgba(2,7,4,0.97) 0%,
              rgba(2,7,4,0.93) 28%,
              rgba(2,7,4,0.5)  55%,
              rgba(2,7,4,0.1)  100%
            );
          }

          /* Bottom-left branding on top of video */
          .video-brand {
            position: absolute;
            bottom: 44px;
            left: 52px;
            z-index: 5;
          }
          .vb-tag {
            color: rgba(74,222,128,0.65);
            font-size: 9px;
            letter-spacing: 3px;
            font-weight: 700;
            margin-bottom: 10px;
            font-family: monospace;
          }
          .vb-headline {
            color: #fff;
            font-size: 26px;
            font-weight: 900;
            line-height: 1.35;
            text-shadow: 0 2px 24px rgba(0,0,0,0.9);
          }
          .vb-green { color: #4ade80; }

          /* LOGIN CARD — right side, with margin from edge */
          .card-wrap {
            position: relative;
            z-index: 10;
            width: 500px;
            min-width: 500px;
            margin-right: 7%;
            padding: 0 8px;
          }

          .card {
            background: rgba(2,10,5,0.9);
            border: 1px solid rgba(34,197,94,0.18);
            border-radius: 20px;
            padding: 3rem 2.6rem;
            backdrop-filter: blur(24px);
            box-shadow:
              0 0 0 1px rgba(34,197,94,0.06),
              0 24px 60px rgba(0,0,0,0.7),
              0 0 40px rgba(34,197,94,0.06);
          }

          .logo-row {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 2.6rem;
          }
          .logo-img {
            width: 54px;
            height: 54px;
            object-fit: contain;
            filter: drop-shadow(0 0 12px rgba(34,197,94,0.45));
          }
          .brand-name {
            font-size: 28px;
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

          .heading {
            font-size: 34px;
            font-weight: 900;
            color: #fff;
            letter-spacing: -0.6px;
            line-height: 1.15;
            margin-bottom: 10px;
          }
          .subheading {
            font-size: 14px;
            color: rgba(255,255,255,0.35);
            margin-bottom: 2.4rem;
            line-height: 1.5;
          }

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
            padding: 15px 18px;
            font-size: 15px;
            margin-bottom: 1.3rem;
            outline: none;
            transition: border-color 0.2s, background 0.2s;
            font-family: inherit;
          }
          .field-input:focus {
            border-color: rgba(34,197,94,0.65);
            background: rgba(34,197,94,0.05);
          }
          .field-input::placeholder { color: rgba(255,255,255,0.2); }
          input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 30px rgba(34,197,94,0.05) inset !important;
            -webkit-text-fill-color: #fff !important;
          }

          .error-box {
            background: rgba(239,68,68,0.08);
            border: 1px solid rgba(239,68,68,0.25);
            border-radius: 10px;
            color: #f87171;
            font-size: 13px;
            padding: 12px 16px;
            margin-bottom: 16px;
          }

          .submit-btn {
            width: 100%;
            background: #22c55e;
            border: none;
            border-radius: 12px;
            color: #000;
            font-weight: 900;
            font-size: 16px;
            padding: 16px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            letter-spacing: 0.3px;
            box-shadow: 0 0 32px rgba(34,197,94,0.3), 0 4px 16px rgba(0,0,0,0.5);
            transition: all 0.2s;
            font-family: inherit;
          }
          .submit-btn:hover:not(:disabled) {
            background: #4ade80;
            transform: translateY(-1px);
            box-shadow: 0 0 48px rgba(34,197,94,0.45), 0 6px 20px rgba(0,0,0,0.5);
          }
          .submit-btn:disabled { background: #166534; cursor: wait; }

          .version {
            color: rgba(255,255,255,0.15);
            font-size: 11px;
            text-align: center;
            margin-top: 2rem;
            letter-spacing: 0.3px;
          }

          @media (max-width: 768px) {
            .page { justify-content: center; }
            .card-wrap { width: 100%; min-width: unset; margin-right: 0; padding: 20px; }
            .video-brand { display: none; }
            .heading { font-size: 26px; }
          }
        `}</style>
      </Head>

      <div className="page">

        {/* VIDEO BACKGROUND */}
        <div className="bg-video-wrap">
          <video
            className="bg-video"
            autoPlay loop muted playsInline
            src="/fleet_bg.mp4"
          />
          <div className="bg-overlay"/>
        </div>

        {/* BRANDING — bottom left over video */}
        <div className="video-brand">
          <div className="vb-tag">CAUTIO FLEET INTELLIGENCE</div>
          <div className="vb-headline">
            Every vehicle,<br/>
            <span className="vb-green">every moment,</span><br/>
            under your watch.
          </div>
        </div>

        {/* LOGIN CARD — right side */}
        <div className="card-wrap">
          <div className="card">

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
            <p className="subheading">Sign in to your operations dashboard</p>

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

              <button type="submit" className="submit-btn" disabled={loading}>
                {loading
                  ? <><span className="spinner" style={{width:18,height:18,borderWidth:2}}/> Signing in...</>
                  : 'Sign In →'}
              </button>
            </form>

            <p className="version">Cautio CRM v2.0 · Internal Operations Platform</p>
          </div>
        </div>

      </div>
    </>
  )
}
