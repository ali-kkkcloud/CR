import Icon from './Icons'

export const C = {
  bg:         '#000000',
  card:       '#1E1E1E',
  border:     '#171717',
  borderRow:  '#262626',
  border2:    '#2a2a2a',
  s2:         '#262626',
  accent:     '#94EC8E',
  accentSoft: '#94EC8E14',
  accentDark: '#215B3B',
  text:       '#FFFFFF',
  text2:      '#D8D8D8',
  muted:      '#9E9E9E',
  dim:        '#3f3f3f',
  red:        '#FF4D4D',
  redBg:      '#3a1515',
  amber:      '#FFC107',
  amberBg:    '#1a1200',
  blue:       '#60a5fa',
  purple:     '#a78bfa',
}

export function KpiCard({ icon, label, value, sub, subColor, progress, onClick }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e)=>{ if (e.key==='Enter'||e.key===' ') { e.preventDefault(); onClick() } } : undefined}
      style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:'12px', padding:'14px', cursor:onClick?'pointer':'default' }}>
      <div style={{ width:'28px', height:'28px', borderRadius:'8px', background:C.accentSoft, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:'10px' }}>
        <Icon name={icon} size={15} color={C.accent}/>
      </div>
      <div style={{ color:C.muted, fontSize:'10.5px', marginBottom:'4px' }}>{label}</div>
      <div style={{ color:C.text, fontSize:'22px', fontWeight:800, lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:'10px', color:subColor||C.muted, marginTop:'2px' }}>{sub}</div>}
      {onClick && <div style={{ fontSize:'9.5px', color:C.muted, marginTop:'6px' }}>Click to view →</div>}
      {typeof progress === 'number' && (
        <div style={{ height:'4px', background:C.border2, borderRadius:'3px', overflow:'hidden', marginTop:'8px' }}>
          <div style={{ height:'100%', width:`${Math.max(0,Math.min(100,progress))}%`, background:C.accent, borderRadius:'3px' }}></div>
        </div>
      )}
    </div>
  )
}

export function Donut({ segments, size = 120, thickness = 15, centerLabel, centerSub }) {
  const total = segments.reduce((a,seg)=>a+seg.value,0) || 1
  const r = (size - thickness) / 2
  const circ = 2 * Math.PI * r
  let acc = 0
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size/2},${size/2}) rotate(-90)`}>
          <circle r={r} fill="none" stroke={C.border2} strokeWidth={thickness} />
          {segments.map((seg,i) => {
            const len = (seg.value/total) * circ
            const dashoffset = -acc
            acc += len
            return (
              <circle key={i} r={r} fill="none" stroke={seg.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${circ-len}`} strokeDashoffset={dashoffset} strokeLinecap="butt" />
            )
          })}
        </g>
      </svg>
      {(centerLabel!==undefined) && (
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
          <div style={{ color:C.text, fontSize: size>100?'20px':'14px', fontWeight:800, lineHeight:1 }}>{centerLabel}</div>
          {centerSub && <div style={{ color:C.muted, fontSize:'9px', marginTop:'3px' }}>{centerSub}</div>}
        </div>
      )}
    </div>
  )
}

// Multi-series SVG line chart with filled area, y-axis scale, and end-value
// callouts. series = [{ name, color, data:[nums] }], labels = [strings]
export function LineChart({ series, labels, height = 170, width = 560 }) {
  const pad = { l: 34, r: 36, t: 18, b: 24 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const allVals = series.flatMap(s => s.data)
  const rawMax = Math.max(1, ...allVals)
  // Round the axis max up to a "nice" number so gridline labels aren't ugly
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax || 1)))
  const max = Math.max(1, Math.ceil((rawMax*1.15) / magnitude) * magnitude)
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0

  const xOf = (i) => pad.l + i*stepX
  const yOf = (v) => pad.t + innerH - (v/max)*innerH

  const toPoints = (data) => data.map((v,i) => `${xOf(i)},${yOf(v)}`).join(' ')
  const toArea = (data) => `${pad.l},${pad.t+innerH} ${toPoints(data)} ${xOf(data.length-1)},${pad.t+innerH}`

  const gridSteps = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
      {gridSteps.map((g,i) => (
        <g key={i}>
          <line x1={pad.l} x2={width-pad.r} y1={pad.t+innerH*(1-g)} y2={pad.t+innerH*(1-g)} stroke={C.border} strokeWidth="1" />
          <text x={pad.l-8} y={pad.t+innerH*(1-g)+3} fontSize="9" fill={C.muted} textAnchor="end">{Math.round(max*g)}</text>
        </g>
      ))}
      {series.map((s,si) => (
        <g key={si}>
          <polygon points={toArea(s.data)} fill={s.color} opacity="0.08" />
          <polyline points={toPoints(s.data)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {s.data.map((v,i) => (
            <circle key={i} cx={xOf(i)} cy={yOf(v)} r="3.5" fill={C.bg} stroke={s.color} strokeWidth="2" />
          ))}
          {/* End-of-line value callout for quick readability */}
          <text x={xOf(s.data.length-1)+8} y={yOf(s.data[s.data.length-1])+3} fontSize="10" fontWeight="700" fill={s.color} textAnchor="start">
            {s.data[s.data.length-1]}
          </text>
        </g>
      ))}
      {labels.map((l,i) => (
        (i===0 || i===labels.length-1 || i===Math.floor(labels.length/2)) &&
        <text key={i} x={xOf(i)} y={height-4} fontSize="9.5" fill={C.text2} textAnchor="middle">{l}</text>
      ))}
    </svg>
  )
}

// Horizontal bar list. items = [{ label, value, color }]
export function HBarList({ items, max }) {
  const m = max || Math.max(1, ...items.map(i=>i.value))
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
      {items.map((it,i) => (
        <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px' }}>
          <span style={{ color:C.text2, fontSize:'10.5px', width:'92px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flexShrink:0 }}>{it.label}</span>
          <div style={{ flex:1, height:'6px', background:C.border2, borderRadius:'3px', overflow:'hidden' }}>
            <div style={{ height:'100%', width:`${Math.round((it.value/m)*100)}%`, background:it.color||C.accent, borderRadius:'3px' }}></div>
          </div>
          <span style={{ color:C.text, fontSize:'10.5px', fontWeight:700, width:'26px', textAlign:'right', flexShrink:0 }}>{it.value}</span>
        </div>
      ))}
    </div>
  )
}

export function MiniStat({ label, val, warn }) {
  return (
    <div style={{ textAlign:'center', minWidth:'56px' }}>
      <div style={{ color:warn?C.amber:C.text, fontSize:'14px', fontWeight:700 }}>{val}</div>
      <div style={{ color:C.muted, fontSize:'8px', letterSpacing:'0.3px' }}>{label}</div>
    </div>
  )
}

export function AttendanceDots({ attendance }) {
  return (
    <div style={{ display:'flex', gap:'3px' }}>
      {attendance.map((a,i)=>(
        <div key={i} title={`${a.date}: ${a.status}`} style={{
          width:'10px', height:'10px', borderRadius:'3px',
          background: a.status==='active' ? C.accent : a.status==='completed' ? C.blue : '#3a1515',
        }}></div>
      ))}
    </div>
  )
}

export function StatusPill({ label, color }) {
  return (
    <span style={{ background:color+'1f', color, border:`1px solid ${color}40`, borderRadius:'20px', padding:'2px 9px', fontSize:'10px', fontWeight:700, whiteSpace:'nowrap' }}>
      {label}
    </span>
  )
}

export function ScoreBadge({ score }) {
  let tier
  if (score >= 95)      tier = { label:'Elite Performer',    color:C.accent }
  else if (score >= 85) tier = { label:'Excellent',          color:C.accent }
  else if (score >= 70) tier = { label:'Good',                color:C.amber }
  else if (score >= 50) tier = { label:'Needs Improvement',   color:'#fb923c' }
  else                  tier = { label:'Critical',            color:C.red }
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:'5px', background:tier.color+'1a', border:`1px solid ${tier.color}40`, borderRadius:'20px', padding:'3px 10px', fontSize:'10px', fontWeight:700, color:tier.color, whiteSpace:'nowrap' }}>
      <span style={{ width:'6px', height:'6px', borderRadius:'50%', background:tier.color }}></span>
      {tier.label}
    </span>
  )
}

// Age/SLA-style badge computed purely from elapsed time — used where the
// sheet has no explicit priority/SLA field (see Footage Requests tab).
export function slaBadge(hoursElapsed) {
  if (hoursElapsed == null) return { label:'—', color:C.muted }
  if (hoursElapsed < 4)  return { label:`${hoursElapsed.toFixed(1)}h`, color:C.accent }
  if (hoursElapsed < 12) return { label:`${hoursElapsed.toFixed(1)}h`, color:C.amber }
  return { label:`${Math.round(hoursElapsed)}h`, color:C.red }
}

// Parses the sheet's raisedAt/resolvedAt strings into a Date. Handles the
// common "dd/mm/yyyy, hh:mm:ss" / "dd/mm/yyyy hh:mm" formats used in Sheets
// exports. Returns null if unparseable — callers should fall back to "—".
export function parseSheetDate(str) {
  if (!str) return null
  const t = str.toString()
  const m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/)
  if (m) {
    const [, d, mo, y, h, mi, se] = m
    return new Date(+y, +mo-1, +d, +h, +mi, +(se||0))
  }
  // Some Issue Tracker rows carry a date with no time at all. Treating those
  // as unreadable dropped them out of every sort and out of the 72-hour
  // window entirely; midnight on that day is the honest reading.
  const d2 = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (d2) {
    const [, d, mo, y] = d2
    return new Date(+y, +mo-1, +d, 0, 0, 0)
  }
  return null
}
