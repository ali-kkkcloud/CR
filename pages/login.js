import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

export default function Login() {
  const router   = useRouter()
  const canvasRef = useRef(null)
  const [empId,    setEmpId]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  // ── Canvas animation ──
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    let W = canvas.width  = canvas.offsetWidth
    let H = canvas.height = canvas.offsetHeight

    const onResize = () => {
      W = canvas.width  = canvas.offsetWidth
      H = canvas.height = canvas.offsetHeight
    }
    window.addEventListener('resize', onResize)

    // Road segments — isometric grid lines
    const ROADS = [
      // horizontal
      { x1:0, y1:0.25, x2:1, y2:0.25, dir:'h' },
      { x1:0, y1:0.55, x2:1, y2:0.55, dir:'h' },
      { x1:0, y1:0.82, x2:1, y2:0.82, dir:'h' },
      // vertical-ish (slight diagonal = tedi)
      { x1:0.15, y1:0, x2:0.28, y2:1, dir:'v' },
      { x1:0.48, y1:0, x2:0.60, y2:1, dir:'v' },
      { x1:0.78, y1:0, x2:0.88, y2:1, dir:'v' },
    ]

    // Vehicle class
    class Vehicle {
      constructor(road, idx) {
        this.road  = road
        this.t     = Math.random()
        this.speed = 0.0006 + Math.random() * 0.0006
        this.type  = ['car','bus','truck'][Math.floor(Math.random()*3)]
        this.rev   = idx % 2 === 0
        this.color = ['#4ade80','#22c55e','#86efac','#16a34a'][Math.floor(Math.random()*4)]
      }

      pos() {
        const { x1,y1,x2,y2 } = this.road
        const t = this.rev ? 1 - this.t : this.t
        return { x: (x1 + (x2-x1)*t) * W, y: (y1 + (y2-y1)*t) * H }
      }

      update() {
        this.t += this.speed
        if (this.t > 1) this.t = 0
      }

      draw(ctx) {
        const { x, y } = this.pos()
        const dx = (this.road.x2 - this.road.x1)
        const dy = (this.road.y2 - this.road.y1)
        const angle = Math.atan2(dy, dx) + (this.rev ? Math.PI : 0)

        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(angle)

        const sizes = { car:[16,8], bus:[28,10], truck:[22,10] }
        const [vw, vh] = sizes[this.type]

        // Vehicle glow
        ctx.shadowColor = this.color
        ctx.shadowBlur  = 8

        // Body
        ctx.fillStyle = this.color
        ctx.globalAlpha = 0.92
        ctx.beginPath()
        ctx.roundRect(-vw/2, -vh/2, vw, vh, 3)
        ctx.fill()

        // Windows
        ctx.globalAlpha = 0.35
        ctx.fillStyle = '#fff'
        if (this.type === 'bus') {
          for (let i = 0; i < 3; i++) {
            ctx.fillRect(-vw/2 + 4 + i*8, -vh/2 + 2, 5, 3)
          }
        } else {
          ctx.fillRect(-vw/2 + 4, -vh/2 + 2, 5, 3)
        }

        // Wheels
        ctx.globalAlpha = 0.8
        ctx.fillStyle = '#0a0a0a'
        const wheelPositions = this.type === 'truck'
          ? [[-7,-vh/2-1],[7,-vh/2-1],[-7,vh/2+1],[7,vh/2+1]]
          : [[-vw/2+4,-vh/2-1],[-vw/2+4,vh/2+1],[vw/2-4,-vh/2-1],[vw/2-4,vh/2+1]]
        wheelPositions.forEach(([wx,wy]) => {
          ctx.beginPath()
          ctx.arc(wx, wy, 2, 0, Math.PI*2)
          ctx.fill()
        })

        // Headlights
        ctx.globalAlpha = 0.9
        ctx.fillStyle = '#fffde7'
        ctx.beginPath()
        ctx.arc(vw/2, -2, 1.5, 0, Math.PI*2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(vw/2, 2, 1.5, 0, Math.PI*2)
        ctx.fill()

        ctx.restore()
        ctx.globalAlpha = 1
        ctx.shadowBlur  = 0
      }
    }

    const vehicles = []
    ROADS.forEach((road, ri) => {
      const count = 2 + Math.floor(Math.random()*2)
      for (let i = 0; i < count; i++) {
        const v = new Vehicle(road, i)
        v.t = i / count
        vehicles.push(v)
      }
    })

    // Pulse dots at intersections
    let pulse = 0

    function draw() {
      ctx.clearRect(0, 0, W, H)

      // Background
      ctx.fillStyle = '#040d06'
      ctx.fillRect(0, 0, W, H)

      // Radial glow center
      const grd = ctx.createRadialGradient(W*0.45, H*0.45, 0, W*0.45, H*0.45, W*0.6)
      grd.addColorStop(0,   'rgba(34,197,94,0.12)')
      grd.addColorStop(1,   'rgba(34,197,94,0)')
      ctx.fillStyle = grd
      ctx.fillRect(0, 0, W, H)

      // Grid
      ctx.strokeStyle = '#0f2416'
      ctx.lineWidth   = 0.8
      for (let x = 0; x < W; x += 45) {
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke()
      }
      for (let y = 0; y < H; y += 45) {
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke()
      }

      // Roads — glowing lines
      ROADS.forEach(road => {
        const x1 = road.x1 * W, y1 = road.y1 * H
        const x2 = road.x2 * W, y2 = road.y2 * H

        // Road surface
        ctx.strokeStyle = '#081508'
        ctx.lineWidth   = 14
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()

        // Road glow line
        ctx.shadowColor = '#22c55e'
        ctx.shadowBlur  = 12
        ctx.strokeStyle = 'rgba(34,197,94,0.4)'
        ctx.lineWidth   = 1.5
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()
        ctx.shadowBlur  = 0

        // Center dashes
        ctx.strokeStyle = 'rgba(34,197,94,0.15)'
        ctx.lineWidth   = 1
        ctx.setLineDash([8,12])
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()
        ctx.setLineDash([])
      })

      // Intersection pulse dots
      const intersections = []
      for (let i = 0; i < ROADS.length; i++) {
        for (let j = i+1; j < ROADS.length; j++) {
          const a = ROADS[i], b = ROADS[j]
          // Simplified: mark midpoints of each road pair as intersection
          const ix = ((a.x1+a.x2)/2 * W + (b.x1+b.x2)/2 * W) / 2
          const iy = ((a.y1+a.y2)/2 * H + (b.y1+b.y2)/2 * H) / 2
          intersections.push({x: ix, y: iy})
        }
      }

      pulse = (pulse + 0.02) % (Math.PI * 2)
      const pAlpha = 0.4 + 0.3 * Math.sin(pulse)
      const pR     = 6 + 3 * Math.sin(pulse)

      intersections.slice(0,6).forEach(pt => {
        ctx.shadowColor = '#4ade80'
        ctx.shadowBlur  = 10
        ctx.fillStyle   = `rgba(74,222,128,${pAlpha})`
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, pR, 0, Math.PI*2)
        ctx.fill()
        ctx.shadowBlur = 0
      })

      // Vehicles
      vehicles.forEach(v => { v.update(); v.draw(ctx) })

      animId = requestAnimationFrame(draw)
    }

    draw()

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
    }
  }, [])

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
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #040d06; }
          @media (max-width: 800px) {
            .c-canvas { display: none !important; }
            .c-right  { flex: 1 !important; min-width: unset !important; }
          }
          input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 30px #161616 inset !important;
            -webkit-text-fill-color: #fff !important;
          }
        `}</style>
      </Head>

      <div style={{minHeight:'100vh',display:'flex',background:'#040d06',position:'relative'}}>

        {/* Canvas animation — full background */}
        <canvas
          ref={canvasRef}
          className="c-canvas"
          style={{position:'absolute',inset:0,width:'100%',height:'100%',display:'block'}}
        />

        {/* Bottom-left text */}
        <div style={{position:'absolute',bottom:'48px',left:'48px',zIndex:2}} className="c-canvas">
          <div style={{color:'#22c55e',fontSize:'10px',letterSpacing:'3px',fontWeight:'700',marginBottom:'14px',opacity:.7}}>
            CAUTIO FLEET INTELLIGENCE
          </div>
          <div style={{color:'#fff',fontSize:'34px',fontWeight:'900',lineHeight:'1.28',marginBottom:'14px'}}>
            Every vehicle,<br/>
            <span style={{color:'#4ade80'}}>every moment,</span><br/>
            under your watch.
          </div>
          <div style={{color:'rgba(255,255,255,0.35)',fontSize:'13px',lineHeight:'1.7',maxWidth:'380px'}}>
            Real-time fleet intelligence — monitoring 5Cr+ safe kilometers across India.
          </div>
        </div>

        {/* Login card — right side, vertically centered */}
        <div className="c-right" style={{
          position:'relative', zIndex:10,
          marginLeft:'auto',
          width:'520px', minWidth:'520px',
          display:'flex', alignItems:'center', justifyContent:'center',
          minHeight:'100vh', padding:'32px',
          background:'rgba(4,13,6,0.75)',
          backdropFilter:'blur(12px)',
          borderLeft:'1px solid rgba(34,197,94,0.12)',
        }}>
          <div style={{width:'100%', maxWidth:'440px'}}>

            {/* Logo */}
            <div style={{display:'flex',alignItems:'center',gap:'14px',marginBottom:'2.5rem'}}>
              <img
                src="/cautio_shield.webp" alt="Cautio"
                style={{width:'52px',height:'52px',objectFit:'contain'}}
                onError={e=>e.target.style.display='none'}
              />
              <div>
                <div style={{color:'#fff',fontSize:'26px',fontWeight:'800',letterSpacing:'-0.5px'}}>
                  Cau<span style={{color:'#22c55e'}}>tio</span>
                </div>
                <div style={{color:'rgba(34,197,94,0.5)',fontSize:'9px',letterSpacing:'2.5px',marginTop:'2px'}}>
                  FLEET INTELLIGENCE · CRM
                </div>
              </div>
            </div>

            <div style={{marginBottom:'2rem'}}>
              <h1 style={{color:'#fff',fontSize:'28px',fontWeight:'800',marginBottom:'8px',letterSpacing:'-0.3px'}}>
                Welcome back
              </h1>
              <p style={{color:'rgba(255,255,255,0.4)',fontSize:'14px'}}>
                Sign in to access your operations dashboard
              </p>
            </div>

            <form onSubmit={handleLogin}>
              <div style={{marginBottom:'1.2rem'}}>
                <label style={{display:'block',color:'#22c55e',fontSize:'10px',letterSpacing:'1.5px',fontWeight:'700',marginBottom:'8px'}}>
                  EMPLOYEE ID
                </label>
                <input
                  style={{
                    display:'block',width:'100%',
                    background:'rgba(255,255,255,0.05)',
                    border:'1px solid rgba(34,197,94,0.2)',
                    borderRadius:'10px',color:'#fff',
                    padding:'14px 16px',fontSize:'15px',
                    outline:'none',transition:'border-color 0.2s',
                  }}
                  placeholder="EMP001 or your name"
                  value={empId}
                  onChange={e=>setEmpId(e.target.value)}
                  required
                  autoComplete="username"
                  onFocus={e=>e.target.style.borderColor='rgba(34,197,94,0.6)'}
                  onBlur={e=>e.target.style.borderColor='rgba(34,197,94,0.2)'}
                />
              </div>

              <div style={{marginBottom:'1.6rem'}}>
                <label style={{display:'block',color:'#22c55e',fontSize:'10px',letterSpacing:'1.5px',fontWeight:'700',marginBottom:'8px'}}>
                  PASSWORD
                </label>
                <input
                  style={{
                    display:'block',width:'100%',
                    background:'rgba(255,255,255,0.05)',
                    border:'1px solid rgba(34,197,94,0.2)',
                    borderRadius:'10px',color:'#fff',
                    padding:'14px 16px',fontSize:'15px',
                    outline:'none',transition:'border-color 0.2s',
                  }}
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e=>setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  onFocus={e=>e.target.style.borderColor='rgba(34,197,94,0.6)'}
                  onBlur={e=>e.target.style.borderColor='rgba(34,197,94,0.2)'}
                />
              </div>

              {error && (
                <div style={{
                  background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',
                  borderRadius:'10px',color:'#f87171',fontSize:'13px',
                  padding:'12px 16px',marginBottom:'16px'
                }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width:'100%',
                  background: loading ? '#15803d' : '#22c55e',
                  border:'none',borderRadius:'10px',
                  color:'#000',fontWeight:'800',fontSize:'16px',
                  padding:'15px',cursor:loading?'wait':'pointer',
                  display:'flex',alignItems:'center',justifyContent:'center',gap:'10px',
                  letterSpacing:'0.3px',
                  boxShadow:'0 0 24px rgba(34,197,94,0.25)',
                  transition:'all 0.2s',
                }}
              >
                {loading
                  ? <><span className="spinner" style={{width:18,height:18,borderWidth:2}}></span> Signing in...</>
                  : 'Sign In →'}
              </button>
            </form>

            <p style={{color:'rgba(255,255,255,0.2)',fontSize:'11px',textAlign:'center',marginTop:'2rem'}}>
              Cautio CRM v2.0 · Internal Operations Platform
            </p>

          </div>
        </div>

      </div>
    </>
  )
}
