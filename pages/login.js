import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/router'
import Head from 'next/head'

// ── Top-down vehicle shapes ──
const VEHICLE_TYPES = {
  car:   { w:18, h:10, color:'#1a4a2e', roof:'#22c55e', windows:[[3,2,5,3],[10,2,5,3]] },
  suv:   { w:20, h:11, color:'#1e5c36', roof:'#4ade80', windows:[[3,2,6,3],[11,2,5,3]] },
  bus:   { w:38, h:13, color:'#14532d', roof:'#16a34a', windows:[[3,2,6,4],[11,2,6,4],[19,2,6,4],[27,2,6,4]] },
  truck: { w:32, h:12, color:'#0f3d1f', roof:'#166534', windows:[[22,2,7,5]] },
  van:   { w:24, h:12, color:'#1a4a2e', roof:'#22c55e', windows:[[3,2,7,4],[12,2,7,4]] },
}

class Vehicle {
  constructor(road, offset, type) {
    this.road   = road
    this.t      = offset
    this.type   = type || Object.keys(VEHICLE_TYPES)[Math.floor(Math.random()*5)]
    this.spec   = VEHICLE_TYPES[this.type]
    this.speed  = 0.0003 + Math.random()*0.0003
    this.id     = 'VH' + String(Math.floor(Math.random()*9000)+1000)
    this.speed_kmh = Math.floor(35 + Math.random()*45)
    this.boxAlpha = 0
    this.boxTarget = 0.7 + Math.random()*0.3
    this.boxTimer = Math.random()*200
    this.trail  = []
  }

  update() {
    this.t += this.speed
    if (this.t > 1) this.t = 0

    this.boxTimer--
    if (this.boxTimer <= 0) {
      this.boxAlpha = this.boxTarget
      this.boxTimer = 80 + Math.random()*120
      this.boxTarget = 0.5 + Math.random()*0.5
    }
    this.boxAlpha += (this.boxTarget - this.boxAlpha) * 0.05
  }

  getPos(W, H) {
    const r = this.road
    return {
      x: (r.x1 + (r.x2-r.x1)*this.t) * W,
      y: (r.y1 + (r.y2-r.y1)*this.t) * H,
      angle: Math.atan2((r.y2-r.y1)*H, (r.x2-r.x1)*W),
    }
  }

  draw(ctx, W, H) {
    const { x, y, angle } = this.getPos(W, H)
    this.trail.push({x, y})
    if (this.trail.length > 18) this.trail.shift()

    // Trail
    if (this.trail.length > 2) {
      ctx.beginPath()
      this.trail.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y))
      ctx.strokeStyle = 'rgba(74,222,128,0.12)'
      ctx.lineWidth   = 2
      ctx.stroke()
    }

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)

    const { w, h, color, roof, windows } = this.spec
    const hw = w/2, hh = h/2

    // Shadow
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur  = 6
    ctx.shadowOffsetX = 2
    ctx.shadowOffsetY = 2

    // Body
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(-hw, -hh, w, h, 3)
    ctx.fill()
    ctx.shadowBlur = 0

    // Roof panel
    ctx.fillStyle = roof
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    ctx.roundRect(-hw+3, -hh+2, w-6, h-4, 2)
    ctx.fill()
    ctx.globalAlpha = 1

    // Windows
    ctx.fillStyle = 'rgba(180,240,210,0.45)'
    windows.forEach(([wx,wy,ww,wh]) => {
      ctx.fillRect(-hw+wx, -hh+wy, ww, wh)
    })

    // Wheels
    ctx.fillStyle = '#050a06'
    const wheelR = 2.5
    const wx_positions = [-hw+3, hw-3]
    const wy_positions = [-hh+1, hh-1]
    wx_positions.forEach(wx => wy_positions.forEach(wy => {
      ctx.beginPath(); ctx.arc(wx, wy, wheelR, 0, Math.PI*2); ctx.fill()
    }))

    // Headlights (front)
    ctx.fillStyle = 'rgba(255,253,200,0.9)'
    ctx.beginPath(); ctx.arc(hw-1, -hh+2.5, 1.5, 0, Math.PI*2); ctx.fill()
    ctx.beginPath(); ctx.arc(hw-1,  hh-2.5, 1.5, 0, Math.PI*2); ctx.fill()

    // Taillights (back)
    ctx.fillStyle = 'rgba(255,50,50,0.8)'
    ctx.beginPath(); ctx.arc(-hw+1, -hh+2.5, 1.2, 0, Math.PI*2); ctx.fill()
    ctx.beginPath(); ctx.arc(-hw+1,  hh-2.5, 1.2, 0, Math.PI*2); ctx.fill()

    ctx.restore()

    // Detection bounding box
    const bw = this.spec.w + 12
    const bh = this.spec.h + 10
    const cos = Math.cos(angle), sin = Math.sin(angle)

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)

    // Box corners (L-shaped corners only for telematics feel)
    const cornerLen = 6
    ctx.strokeStyle = `rgba(74,222,128,${this.boxAlpha})`
    ctx.lineWidth   = 1.5
    ctx.shadowColor = '#4ade80'
    ctx.shadowBlur  = 4

    const corners = [
      [-bw/2, -bh/2, 1, 1],
      [ bw/2, -bh/2,-1, 1],
      [ bw/2,  bh/2,-1,-1],
      [-bw/2,  bh/2, 1,-1],
    ]
    corners.forEach(([cx,cy,dx,dy]) => {
      ctx.beginPath()
      ctx.moveTo(cx, cy+dy*cornerLen); ctx.lineTo(cx,cy); ctx.lineTo(cx+dx*cornerLen,cy)
      ctx.stroke()
    })
    ctx.shadowBlur = 0
    ctx.restore()

    // Vehicle ID tag
    ctx.save()
    ctx.translate(x - bw/2 * Math.cos(angle) + bh/2 * Math.sin(angle),
                  y - bw/2 * Math.sin(angle) - bh/2 * Math.cos(angle) - 6)
    ctx.globalAlpha = this.boxAlpha * 0.9
    ctx.fillStyle   = 'rgba(0,20,8,0.85)'
    ctx.fillRect(-18, -9, 36, 11)
    ctx.fillStyle = '#4ade80'
    ctx.font      = 'bold 7px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(this.id, 0, 0)
    ctx.globalAlpha = 1
    ctx.restore()

    // Speed tag
    ctx.save()
    ctx.translate(x + bw/2*Math.cos(angle) - bh/2*Math.sin(angle),
                  y + bw/2*Math.sin(angle) + bh/2*Math.cos(angle) + 8)
    ctx.globalAlpha = this.boxAlpha * 0.85
    ctx.fillStyle   = 'rgba(0,20,8,0.85)'
    ctx.fillRect(-16, -8, 32, 11)
    ctx.fillStyle = '#86efac'
    ctx.font      = 'bold 7px monospace'
    ctx.textAlign = 'center'
    ctx.fillText(`${this.speed_kmh}km/h`, 0, 0)
    ctx.globalAlpha = 1
    ctx.restore()
  }
}

export default function Login() {
  const router    = useRouter()
  const canvasRef = useRef(null)
  const [empId,    setEmpId]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId

    const setSize = () => {
      canvas.width  = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
    }
    setSize()
    window.addEventListener('resize', setSize)

    // Roads — 4-way intersection + diagonal
    // All coords are 0-1 fractions of W/H
    const ROADS = [
      // Horizontal main road (top lane goes right, bottom lane goes left)
      { x1:-0.02, y1:0.44, x2:1.02, y2:0.44, rev:false }, // right
      { x1: 1.02, y1:0.52, x2:-0.02, y2:0.52, rev:false }, // left
      // Vertical main road
      { x1:0.44, y1:-0.02, x2:0.44, y2:1.02, rev:false }, // down
      { x1:0.52, y1: 1.02, x2:0.52, y2:-0.02, rev:false }, // up
      // Side road top-left to intersection
      { x1:-0.02, y1:0.20, x2:0.44,  y2:0.44, rev:false },
      { x1:0.44,  y1:0.44, x2:-0.02, y2:0.20, rev:false },
      // Side road bottom-right from intersection
      { x1:0.52, y1:0.52, x2:1.02, y2:0.82, rev:false },
      { x1:1.02, y1:0.82, x2:0.52, y2:0.52, rev:false },
    ]

    const vehicles = []
    ROADS.forEach((road, ri) => {
      const count = ri < 4 ? 3 : 2
      for (let i = 0; i < count; i++) {
        const types = ri < 2
          ? ['car','car','suv','bus','truck','van']
          : ['car','car','suv','van']
        const type = types[Math.floor(Math.random()*types.length)]
        const v = new Vehicle(road, i/count + Math.random()*0.1, type)
        vehicles.push(v)
      }
    })

    let tick = 0

    function drawRoads(W, H) {
      const cx = 0.48 * W
      const cy = 0.48 * H

      // Dark base
      ctx.fillStyle = '#030a04'
      ctx.fillRect(0,0,W,H)

      // Subtle grid
      ctx.strokeStyle = 'rgba(34,197,94,0.04)'
      ctx.lineWidth   = 1
      for (let x=0;x<W;x+=50) { ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke() }
      for (let y=0;y<H;y+=50) { ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke() }

      // Corner blocks (buildings)
      const blockColor = '#060f08'
      const blocks = [
        [0,0,cx-48,cy-48],
        [cx+48,0,W-(cx+48),cy-48],
        [0,cy+48,cx-48,H-(cy+48)],
        [cx+48,cy+48,W-(cx+48),H-(cy+48)],
      ]
      blocks.forEach(([bx,by,bw,bh]) => {
        if (bw<=0||bh<=0) return
        ctx.fillStyle = blockColor
        ctx.fillRect(bx,by,bw,bh)
        // Building texture lines
        ctx.strokeStyle = 'rgba(34,197,94,0.04)'
        ctx.lineWidth = 1
        for (let i=bx;i<bx+bw;i+=20) { ctx.beginPath();ctx.moveTo(i,by);ctx.lineTo(i,by+bh);ctx.stroke() }
        for (let i=by;i<by+bh;i+=20) { ctx.beginPath();ctx.moveTo(bx,i);ctx.lineTo(bx+bw,i);ctx.stroke() }
      })

      // Road surface — main horizontal
      ctx.fillStyle = '#0a1a0c'
      ctx.fillRect(0, cy-48, W, 96)
      // Road surface — main vertical
      ctx.fillRect(cx-48, 0, 96, H)
      // Diagonal roads
      ctx.fillStyle = '#0a1a0c'
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(0, cy-90)
      ctx.lineTo(cx-48, cy-48)
      ctx.lineTo(cx-48, cy+48)
      ctx.lineTo(0, cy+130)
      ctx.closePath()
      ctx.fill()
      ctx.restore()
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(cx+48, cy-48)
      ctx.lineTo(W, cy-130)
      ctx.lineTo(W, cy+90)
      ctx.lineTo(cx+48, cy+48)
      ctx.closePath()
      ctx.fill()
      ctx.restore()

      // Intersection center
      ctx.fillStyle = '#0d1f10'
      ctx.fillRect(cx-48, cy-48, 96, 96)

      // Glowing road center lines
      const drawRoadLine = (x1,y1,x2,y2,dash=true) => {
        ctx.shadowColor = '#22c55e'
        ctx.shadowBlur  = 6
        ctx.strokeStyle = 'rgba(34,197,94,0.3)'
        ctx.lineWidth   = 1
        if(dash) ctx.setLineDash([10,14])
        else ctx.setLineDash([])
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()
        ctx.setLineDash([])
        ctx.shadowBlur = 0
      }
      drawRoadLine(0, cy, cx-48, cy)
      drawRoadLine(cx+48, cy, W, cy)
      drawRoadLine(cx, 0, cx, cy-48)
      drawRoadLine(cx, cy+48, cx, H)

      // Road edge lines (solid white-ish)
      const edgeLines = [
        [0, cy-48, cx-48, cy-48],
        [cx+48, cy-48, W, cy-48],
        [0, cy+48, cx-48, cy+48],
        [cx+48, cy+48, W, cy+48],
        [cx-48, 0, cx-48, cy-48],
        [cx+48, 0, cx+48, cy-48],
        [cx-48, cy+48, cx-48, H],
        [cx+48, cy+48, cx+48, H],
      ]
      ctx.strokeStyle = 'rgba(34,197,94,0.15)'
      ctx.lineWidth   = 1.5
      ctx.setLineDash([])
      edgeLines.forEach(([x1,y1,x2,y2]) => {
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke()
      })

      // Zebra crossings
      const stripeColor = 'rgba(34,197,94,0.06)'
      const drawZebra = (x,y,w,h,vertical=false) => {
        ctx.fillStyle = stripeColor
        const stripeSize = 6
        const gap = 5
        if (!vertical) {
          for (let i=0;i<w;i+=stripeSize+gap) ctx.fillRect(x+i,y,stripeSize,h)
        } else {
          for (let i=0;i<h;i+=stripeSize+gap) ctx.fillRect(x,y+i,w,stripeSize)
        }
      }
      drawZebra(cx-48, cy-68, 96, 18, false) // top
      drawZebra(cx-48, cy+50, 96, 18, false) // bottom
      drawZebra(cx-68, cy-48, 18, 96, true)  // left
      drawZebra(cx+50, cy-48, 18, 96, true)  // right

      // Traffic signals (glowing dots)
      const signals = [
        [cx-52, cy-52],
        [cx+52, cy-52],
        [cx-52, cy+52],
        [cx+52, cy+52],
      ]
      const sigAlpha = 0.7 + 0.3*Math.sin(tick*0.03)
      signals.forEach(([sx,sy]) => {
        ctx.shadowColor = '#4ade80'
        ctx.shadowBlur  = 12
        ctx.fillStyle   = `rgba(74,222,128,${sigAlpha})`
        ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.fill()
        ctx.shadowBlur = 0
      })

      // Radial glow at center
      const grd = ctx.createRadialGradient(cx,cy,0,cx,cy,200)
      grd.addColorStop(0, 'rgba(34,197,94,0.08)')
      grd.addColorStop(1, 'rgba(34,197,94,0)')
      ctx.fillStyle = grd
      ctx.fillRect(cx-200, cy-200, 400, 400)
    }

    function drawTrackingLines(W, H, vehList) {
      // Draw lines between nearby vehicles (tracking simulation)
      for (let i=0; i<vehList.length; i++) {
        for (let j=i+1; j<vehList.length; j++) {
          const a = vehList[i].getPos(W,H)
          const b = vehList[j].getPos(W,H)
          const dx = a.x-b.x, dy = a.y-b.y
          const dist = Math.sqrt(dx*dx+dy*dy)
          if (dist < 120) {
            const alpha = (1-(dist/120)) * 0.15
            ctx.strokeStyle = `rgba(74,222,128,${alpha})`
            ctx.lineWidth   = 0.8
            ctx.setLineDash([3,6])
            ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke()
            ctx.setLineDash([])
          }
        }
      }
    }

    // HUD overlay elements
    function drawHUD(W, H) {
      // Top-left corner bracket
      ctx.strokeStyle = 'rgba(34,197,94,0.25)'
      ctx.lineWidth = 1.5
      const m = 20, l = 30
      ctx.beginPath()
      ctx.moveTo(m, m+l); ctx.lineTo(m,m); ctx.lineTo(m+l,m); ctx.stroke()

      // Bottom-right corner bracket
      ctx.beginPath()
      ctx.moveTo(W-m, H-m-l); ctx.lineTo(W-m,H-m); ctx.lineTo(W-m-l,H-m); ctx.stroke()

      // Scan line
      const scanY = ((tick*1.2) % (H+100)) - 50
      const scanGrd = ctx.createLinearGradient(0, scanY-40, 0, scanY+40)
      scanGrd.addColorStop(0, 'rgba(34,197,94,0)')
      scanGrd.addColorStop(0.5, 'rgba(34,197,94,0.04)')
      scanGrd.addColorStop(1, 'rgba(34,197,94,0)')
      ctx.fillStyle = scanGrd
      ctx.fillRect(0, scanY-40, W, 80)

      // Stats overlay
      ctx.fillStyle = 'rgba(0,20,8,0.7)'
      ctx.fillRect(16, 16, 130, 56)
      ctx.strokeStyle = 'rgba(34,197,94,0.2)'
      ctx.lineWidth = 1
      ctx.strokeRect(16, 16, 130, 56)
      ctx.fillStyle = '#4ade80'
      ctx.font = 'bold 8px monospace'
      ctx.textAlign = 'left'
      ctx.fillText('CAUTIO FLEET MONITOR', 24, 30)
      ctx.fillStyle = 'rgba(134,239,172,0.7)'
      ctx.font = '8px monospace'
      ctx.fillText(`VEHICLES: ${vehicles.length}`, 24, 44)
      ctx.fillText(`STATUS: MONITORING`, 24, 56)
      ctx.fillText(`COVERAGE: ACTIVE`, 24, 64)
    }

    function frame() {
      const W = canvas.width, H = canvas.height
      tick++
      ctx.clearRect(0, 0, W, H)
      drawRoads(W, H)
      drawTrackingLines(W, H, vehicles)
      vehicles.forEach(v => { v.update(); v.draw(ctx, W, H) })
      drawHUD(W, H)
      animId = requestAnimationFrame(frame)
    }

    frame()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', setSize) }
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
          body { background: #030a04; overflow: hidden; }
          @media (max-width:800px) {
            .c-overlay { display:none !important; }
            .c-card-wrap { position:static !important; transform:none !important; width:100% !important; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; background:#030a04; }
          }
          input:-webkit-autofill {
            -webkit-box-shadow: 0 0 0 30px rgba(255,255,255,0.05) inset !important;
            -webkit-text-fill-color: #fff !important;
          }
          input:focus { border-color: rgba(34,197,94,0.6) !important; }
        `}</style>
      </Head>

      <div style={{position:'relative',width:'100vw',height:'100vh',overflow:'hidden',background:'#030a04'}}>

        {/* Full-screen canvas */}
        <canvas
          ref={canvasRef}
          className="c-overlay"
          style={{position:'absolute',inset:0,width:'100%',height:'100%'}}
        />

        {/* Bottom-left branding */}
        <div className="c-overlay" style={{position:'absolute',bottom:'44px',left:'44px',zIndex:5}}>
          <div style={{color:'rgba(34,197,94,0.6)',fontSize:'9px',letterSpacing:'3px',fontWeight:'700',marginBottom:'12px'}}>
            CAUTIO FLEET INTELLIGENCE
          </div>
          <div style={{color:'#fff',fontSize:'30px',fontWeight:'900',lineHeight:'1.3',marginBottom:'12px',textShadow:'0 0 20px rgba(34,197,94,0.3)'}}>
            Every vehicle,<br/>
            <span style={{color:'#4ade80'}}>every moment,</span><br/>
            under your watch.
          </div>
          <div style={{color:'rgba(255,255,255,0.3)',fontSize:'12px',lineHeight:'1.7',maxWidth:'340px'}}>
            Real-time fleet intelligence — monitoring 5Cr+ safe kilometers across India.
          </div>
        </div>

        {/* Login card — center-right, not at edge */}
        <div className="c-card-wrap" style={{
          position:'absolute',
          top:'50%', right:'6%',
          transform:'translateY(-50%)',
          zIndex:10,
          width:'460px',
        }}>
          <div style={{
            background:'rgba(3,12,5,0.88)',
            border:'1px solid rgba(34,197,94,0.18)',
            borderRadius:'20px',
            padding:'2.8rem 2.4rem',
            backdropFilter:'blur(20px)',
            boxShadow:'0 0 60px rgba(0,0,0,0.6), 0 0 30px rgba(34,197,94,0.08)',
            width:'100%',
          }}>
            {/* Logo */}
            <div style={{display:'flex',alignItems:'center',gap:'14px',marginBottom:'2.4rem'}}>
              <img src="/cautio_shield.webp" alt="Cautio"
                style={{width:'52px',height:'52px',objectFit:'contain',filter:'drop-shadow(0 0 8px rgba(34,197,94,0.4))'}}
                onError={e=>e.target.style.display='none'}/>
              <div>
                <div style={{color:'#fff',fontSize:'26px',fontWeight:'900',letterSpacing:'-0.5px'}}>
                  Cau<span style={{color:'#22c55e'}}>tio</span>
                </div>
                <div style={{color:'rgba(34,197,94,0.45)',fontSize:'9px',letterSpacing:'2.5px',marginTop:'3px'}}>
                  FLEET INTELLIGENCE · CRM
                </div>
              </div>
            </div>

            <div style={{marginBottom:'2rem'}}>
              <h1 style={{color:'#fff',fontSize:'26px',fontWeight:'800',marginBottom:'8px',letterSpacing:'-0.3px'}}>
                Welcome back
              </h1>
              <p style={{color:'rgba(255,255,255,0.38)',fontSize:'13px'}}>
                Sign in to your operations dashboard
              </p>
            </div>

            <form onSubmit={handleLogin}>
              {/* Employee ID */}
              <label style={{display:'block',color:'#22c55e',fontSize:'10px',letterSpacing:'1.5px',fontWeight:'700',marginBottom:'8px'}}>
                EMPLOYEE ID
              </label>
              <input
                style={{display:'block',width:'100%',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:'10px',color:'#fff',padding:'14px 16px',fontSize:'14px',marginBottom:'1.3rem',outline:'none',transition:'border-color 0.2s'}}
                placeholder="EMP001 or your name"
                value={empId}
                onChange={e=>setEmpId(e.target.value)}
                required
                autoComplete="username"
              />

              {/* Password */}
              <label style={{display:'block',color:'#22c55e',fontSize:'10px',letterSpacing:'1.5px',fontWeight:'700',marginBottom:'8px'}}>
                PASSWORD
              </label>
              <input
                style={{display:'block',width:'100%',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:'10px',color:'#fff',padding:'14px 16px',fontSize:'14px',marginBottom:'1.6rem',outline:'none',transition:'border-color 0.2s'}}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e=>setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />

              {error && (
                <div style={{background:'rgba(239,68,68,0.08)',border:'1px solid rgba(239,68,68,0.25)',borderRadius:'10px',color:'#f87171',fontSize:'13px',padding:'12px 16px',marginBottom:'16px'}}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  width:'100%',background:loading?'#15803d':'#22c55e',
                  border:'none',borderRadius:'10px',
                  color:'#000',fontWeight:'800',fontSize:'15px',
                  padding:'15px',cursor:loading?'wait':'pointer',
                  display:'flex',alignItems:'center',justifyContent:'center',gap:'10px',
                  boxShadow:'0 0 28px rgba(34,197,94,0.3)',
                  transition:'all 0.2s',letterSpacing:'0.2px',
                }}
              >
                {loading
                  ? <><span className="spinner" style={{width:17,height:17,borderWidth:2}}></span> Signing in...</>
                  : 'Sign In →'}
              </button>
            </form>

            <p style={{color:'rgba(255,255,255,0.18)',fontSize:'11px',textAlign:'center',marginTop:'1.8rem',letterSpacing:'0.3px'}}>
              Cautio CRM v2.0 · Internal Operations Platform
            </p>
          </div>
        </div>

      </div>
    </>
  )
}
