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
          html, body { height: 100%; overflow: hidden; background: #020704; }

          .login-page {
            display: flex;
            height: 100vh;
            width: 100vw;
            position: relative;
            overflow: hidden;
          }

          /* ── VIDEO SIDE (right 60%) ── */
          .video-side {
            position: absolute;
            inset: 0;
            z-index: 0;
          }
          .bg-video {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            filter: brightness(0.55) saturate(1.2);
          }
          /* Dark overlay gradient over video — left fades to dark for card */
          .video-overlay {
            position: absolute;
            inset: 0;
            background: linear-gradient(
              to right,
              rgba(2,7,4,0.98) 0%,
              rgba(2,7,4,0.92) 30%,
              rgba(2,7,4,0.55) 55%,
              rgba(2,7,4,0.15) 100%
            );
            z-index: 1;
          }

          /* ── LOGIN CARD SIDE (left) ── */
          .card-side {
            position: relative;
            z-index: 10;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 520px;
            min-width: 520px;
            min-height: 100vh;
            padding: 40px 48px;
            flex-shrink: 0;
            margin-left: 5%;
          }

          .card-inner {
            width: 100%;
            max-width: 440px;
          }

          /* Logo row */
          .logo-row {
            display: flex;
            align-items: center;
            gap: 14px;
            margin-bottom: 2.8rem;
          }
          .logo-img {
            width: 54px;
            height: 54px;
            object-fit: contain;
            filter: drop-shadow(0 0 12px rgba(34,197,94,0.5));
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
            color: rgba(34,197,94,0.5);
            margin-top: 3px;
          }

          /* Heading */
          .welcome-head {
            font-size: 36px;
            font-weight: 900;
            color: #fff;
            letter-spacing: -0.8px;
            line-height: 1.15;
            margin-bottom: 10px;
          }
          .welcome-sub {
            font-size: 14px;
            color: rgba(255,255,255,0.38);
            margin-bottom: 2.4rem;
            line-height: 1.5;
          }

          /* Form */
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
            background: rgba(255,255,255,0.05);
            border: 1px solid rgba(34,197,94,0.22);
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
            border-color: rgba(34,197,94,0.7);
            background: rgba(34,197,94,0.06);
          }
          .field-input::placeholder { color: rgba(255,255,255,0.22); }

          /* Error */
          .error-box {
            background: rgba(239,68,68,0.08);
            border: 1px solid rgba(239,68,68,0.28);
            border-radius: 10px;
            color: #f87171;
            font-size: 13px;
            padding: 12px 16px;
            margin-bottom: 16px;
          }

          /* Submit button */
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
            box-shadow: 0 0 32px rgba(34,197,94,0.35), 0 4px 16px rgba(0,0,0,0.4);
            transition: all 0.2s;
            margin-bottom: 0.5rem;
            font-family: inherit;
          }
          .submit-btn:hover:not(:disabled) {
            background: #4ade80;
            box-shadow: 0 0 48px rgba(34,197,94,0.5), 0 4px 20px rgba(0,0,0,0.4);
            transform: translateY(-1px);
          }
          .submit-btn:disabled { background: #15803d; cursor: wait; }

          .version-txt {
            color: rgba(255,255,255,0.15);
            font-size: 11px;
            text-align: center;
            margin-top: 2rem;
            letter-spacing: 0.3px;
          }

          /* Bottom-right branding on video */
          .video-branding {
            position: absolute;
            bottom: 40px;
            right: 44px;
            z-index: 5;
            text-align: right;
          }
          .vb-tag {
            color: rgba(74,222,128,0.7);
            font-size: 9px;
            letter-spacing: 3px;
            font-weight: 700;
            margin-bottom: 10px;
          }
          .vb-headline {
            color: #fff;
            font-size: 22px;
            font-weight: 800;
            line-height: 1.35;
            text-shadow: 0 2px 20px rgba(0,0,0,0.8);
          }
          .vb-green { color: #4ade80; }

          /* Autofill fix */
          input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 30px rgba(34,197,94,0.06) inset !important;
            -webkit-text-fill-color: #fff !important;
          }

          @media (max-width: 768px) {
            .card-side {
              width: 100%;
              min-width: unset;
              margin-left: 0;
              padding: 32px 24px;
            }
            .video-branding { display: none; }
            .welcome-head { font-size: 28px; }
          }
        `}</style>
      </Head>

      <div className="login-page">

        {/* ── VIDEO BACKGROUND ── */}
        <div className="video-side">
          <video
            className="bg-video"
            autoPlay
            loop
            muted
            playsInline
            src="/fleet_bg.mp4"
          />
          <div className="video-overlay"/>
        </div>

        {/* ── VIDEO BRANDING (bottom right) ── */}
        <div className="video-branding">
          <div className="vb-tag">CAUTIO FLEET INTELLIGENCE</div>
          <div className="vb-headline">
            Every vehicle,<br/>
            <span className="vb-green">every moment,</span><br/>
            under your watch.
          </div>
        </div>

        {/* ── LOGIN CARD (left side) ── */}
        <div className="card-side">
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

            {/* Heading */}
            <h1 className="welcome-head">Welcome back</h1>
            <p className="welcome-sub">Sign in to your operations dashboard</p>

            {/* Form */}
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

            <p className="version-txt">Cautio CRM v2.0 · Internal Operations Platform</p>

          </div>
        </div>

      </div>
    </>
  )
}
