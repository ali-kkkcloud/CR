// ══════════════════════════════════════════════════════════════════════
// Shared UI primitives.
//
// Before this file every screen invented its own card, its own button and
// its own idea of what a pill looked like — five radii, a dozen font sizes,
// and no hover or focus state anywhere. Everything visual now comes from
// here, so a change lands in one place and the two sides of the app look
// like one product.
//
// Colours are the brand tokens, unchanged. What is new is the scale they
// are applied on.
// ══════════════════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'
import Icon from './Icons'
import { C } from './Widgets'

// ── Scale ─────────────────────────────────────────────────────────────
export const T  = { xs:'10.5px', sm:'11.5px', base:'12.5px', md:'13.5px', lg:'15px', xl:'19px', xxl:'25px' }
export const R  = { sm:'6px', md:'9px', lg:'13px', full:'999px' }
export const SP = { 1:'4px', 2:'8px', 3:'12px', 4:'16px', 5:'20px', 6:'24px', 8:'32px' }

// The operating day as YYYY-MM-DD, offset by whole days.
//
// The day turns over at 07:00 IST, matching every date the server writes, so
// before seven in the morning "today" is still the previous date. Built from
// the IST calendar parts rather than toISOString(), which converts to UTC and
// silently walks the date back for any IST time before 05:30 — the exact hours
// this rule exists for.
export function istDayISO(offsetDays = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  if (d.getHours() < 7) d.setDate(d.getDate() - 1)
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

// The operating day a moment belongs to, as DD/MM/YYYY — the same rule the
// server writes every row with. Anything before 07:00 belongs to the day
// before, so a night shift's 2am is filed under the day it clocked in on.
export function businessDayOf(date) {
  const d = new Date(date)
  if (isNaN(d)) return null
  if (d.getHours() < 7) d.setDate(d.getDate() - 1)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Today's operating day, written the way people read it: "18 Aug 2026".
// At two in the morning this still says yesterday's date, because that is the
// day the work on screen is being filed under — showing the calendar date
// instead would disagree with every record the shift produces.
export function istBusinessDateLabel() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  if (d.getHours() < 7) d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })
}

export const SURF = {
  raised: '#1E1E1E',
  sunken: '#131313',
  hover:  '#232323',
}

// ══════════════════════════════════════════════════════════════════════
// Card — the single container. `pad={false}` when the content manages its
// own padding (a list that needs full-bleed rows).
// ══════════════════════════════════════════════════════════════════════
export function Card({ children, pad = true, style, className = '', ...rest }) {
  return (
    <div
      className={`lift ${className}`}
      style={{
        background: SURF.raised,
        border: `1px solid ${C.border}`,
        borderRadius: R.lg,
        padding: pad ? SP[4] : 0,
        minWidth: 0,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  )
}

// A card's own heading row: title on the left, anything else on the right.
export function CardHead({ title, sub, right, icon }) {
  return (
    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:SP[3], marginBottom:SP[3] }}>
      <div style={{ minWidth:0 }}>
        <div style={{ display:'flex', alignItems:'center', gap:SP[2] }}>
          {icon && <Icon name={icon} size={14} color={C.muted} />}
          <span className="eyebrow">{title}</span>
        </div>
        {sub && <div style={{ color:C.muted, fontSize:T.sm, marginTop:'3px' }}>{sub}</div>}
      </div>
      {right}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Button — four intents, three sizes. Every one gets hover and press
// feedback, which nothing in the old UI had.
// ══════════════════════════════════════════════════════════════════════
export function Button({
  children, onClick, variant = 'ghost', size = 'md',
  icon, iconRight, disabled, loading, title, style, full, type = 'button',
}) {
  const sizes = {
    sm: { padding:'6px 10px',  fontSize:T.sm,   gap:'5px' },
    md: { padding:'9px 14px',  fontSize:T.base, gap:'7px' },
    lg: { padding:'12px 20px', fontSize:T.md,   gap:'8px' },
  }[size]

  const variants = {
    // The one action a screen most wants you to take.
    primary: { background:C.accent, color:'#06120a', border:`1px solid ${C.accent}`, fontWeight:700 },
    // Everything ordinary.
    ghost:   { background:SURF.raised, color:C.text2, border:`1px solid ${C.border2}`, fontWeight:600 },
    // Sits on an already-raised surface, so it needs less of its own.
    subtle:  { background:'transparent', color:C.muted, border:`1px solid ${C.border2}`, fontWeight:600 },
    // Destructive or stop-what-you-are-doing.
    danger:  { background:'#FF4D4D14', color:C.red, border:`1px solid ${C.red}55`, fontWeight:700 },
  }[variant]

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className="pressable"
      style={{
        display:'inline-flex', alignItems:'center', justifyContent:'center',
        borderRadius:R.md, whiteSpace:'nowrap', lineHeight:1.2,
        width: full ? '100%' : undefined,
        ...sizes, ...variants, ...style,
        // A disabled primary at half opacity is still bright green and still
        // reads as the thing to press. Drop it to a flat, obviously inert
        // surface instead.
        ...(disabled && !loading
          ? { background:'transparent', color:C.dim, border:`1px solid ${C.border2}` }
          : {}),
      }}
    >
      {loading
        ? <span className="spinner" style={{ width:13, height:13, borderWidth:2 }} />
        : icon && <Icon name={icon} size={size==='lg'?16:14} color={disabled ? C.dim : variants.color} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size==='lg'?16:14} color={disabled ? C.dim : variants.color} />}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Pill — a read-only fact in the top bar (date, clock, shift window).
// ══════════════════════════════════════════════════════════════════════
export function Pill({ icon, children, color, tone = 'default' }) {
  const fg = color || C.text2
  return (
    <div style={{
      display:'inline-flex', alignItems:'center', gap:'6px',
      background: tone==='plain' ? 'transparent' : SURF.raised,
      border:`1px solid ${tone==='plain' ? 'transparent' : C.border2}`,
      borderRadius:R.md, padding:'7px 11px',
      color:fg, fontSize:T.base, whiteSpace:'nowrap',
    }}>
      {icon && <Icon name={icon} size={13} color={color || C.muted} />}
      {children}
    </div>
  )
}

// A coloured status label. `dot` adds the leading marker.
export function Tag({ children, color = C.muted, dot = false, solid = false }) {
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:'5px',
      background: solid ? color : color+'1a',
      color: solid ? '#06120a' : color,
      border:`1px solid ${solid ? color : color+'40'}`,
      borderRadius:R.full, padding:'2px 9px',
      fontSize:'10px', fontWeight:700, whiteSpace:'nowrap', letterSpacing:'0.2px',
    }}>
      {dot && <span style={{ width:'5px', height:'5px', borderRadius:'50%', background: solid ? '#06120a' : color }} />}
      {children}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Segmented — a small set of mutually exclusive choices. Replaces the
// loose row of differently-styled filter buttons that each tab had.
// options: [{ value, label, count }]
// ══════════════════════════════════════════════════════════════════════
export function Segmented({ options, value, onChange, size = 'md' }) {
  const pad = size === 'sm' ? '5px 10px' : '7px 13px'
  const fs  = size === 'sm' ? T.sm : T.base
  return (
    <div style={{
      display:'inline-flex', gap:'2px', padding:'3px',
      background:SURF.sunken, border:`1px solid ${C.border2}`, borderRadius:R.md,
    }}>
      {options.map(o => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={on ? '' : 'pressable'}
            style={{
              display:'inline-flex', alignItems:'center', gap:'6px',
              background: on ? C.accentDark : 'transparent',
              color: on ? C.accent : C.muted,
              border:'none', borderRadius:R.sm, padding:pad,
              fontSize:fs, fontWeight: on ? 700 : 600, whiteSpace:'nowrap',
            }}
          >
            {o.label}
            {typeof o.count === 'number' && (
              <span style={{
                background: on ? C.accent+'26' : '#ffffff0d',
                color: on ? C.accent : C.muted,
                borderRadius:R.full, padding:'1px 6px', fontSize:'10px', fontWeight:700,
              }}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Field — a label bound to a control, with optional hint underneath.
// ══════════════════════════════════════════════════════════════════════
export function Field({ label, hint, children, style }) {
  return (
    <div className="field" style={{ minWidth:0, ...style }}>
      {label && (
        <div style={{
          color:C.muted, fontSize:'10px', fontWeight:700,
          letterSpacing:'0.9px', textTransform:'uppercase', marginBottom:'6px',
        }}>{label}</div>
      )}
      {children}
      {hint && <div style={{ color:C.muted, fontSize:T.xs, marginTop:'5px' }}>{hint}</div>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// SearchInput — a text field with a leading icon and a clear button.
// ══════════════════════════════════════════════════════════════════════
export function SearchInput({ value, onChange, placeholder = 'Search…', style }) {
  return (
    <div className="search-box" style={{ position:'relative', flex:1, minWidth:0, ...style }}>
      <span style={{ position:'absolute', left:'10px', top:'50%', transform:'translateY(-50%)', display:'flex', pointerEvents:'none' }}>
        <Icon name="search" size={14} color={C.muted} />
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ paddingLeft:'32px', paddingRight: value ? '30px' : '11px' }}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          title="Clear"
          style={{
            position:'absolute', right:'6px', top:'50%', transform:'translateY(-50%)',
            background:'transparent', border:'none', color:C.muted,
            fontSize:'15px', lineHeight:1, padding:'2px 5px', borderRadius:R.sm,
          }}
        >×</button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Stat — one number with its label. The building block of every KPI row.
// ══════════════════════════════════════════════════════════════════════
export function Stat({ icon, label, value, sub, subColor, progress, onClick, accent = C.accent }) {
  const clickable = !!onClick
  return (
    <div
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key==='Enter'||e.key===' ') { e.preventDefault(); onClick() } } : undefined}
      className={clickable ? 'pressable' : 'lift'}
      style={{
        background:SURF.raised, border:`1px solid ${C.border}`, borderRadius:R.lg,
        padding:SP[4], cursor: clickable ? 'pointer' : 'default', minWidth:0,
      }}
    >
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:SP[3] }}>
        <div style={{
          width:'30px', height:'30px', borderRadius:R.md, background:accent+'14',
          display:'flex', alignItems:'center', justifyContent:'center',
        }}>
          <Icon name={icon} size={15} color={accent} />
        </div>
        {clickable && <Icon name="arrow-right" size={14} color={C.dim} />}
      </div>
      <div style={{ color:C.muted, fontSize:T.xs, marginBottom:'5px' }} className="ellip">{label}</div>
      <div style={{ color:C.text, fontSize:T.xxl, fontWeight:800, lineHeight:1, letterSpacing:'-0.5px' }}>{value}</div>
      {sub && <div style={{ fontSize:T.xs, color:subColor||C.muted, marginTop:'5px' }} className="ellip">{sub}</div>}
      {typeof progress === 'number' && <Meter value={progress} style={{ marginTop:SP[3] }} />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// PageHead — the top of a screen: what it is, and the handful of numbers
// that actually change what you do next.
//
// Every admin screen had grown its own row of stat tiles — nine of them on
// one, six on another — and a tile is a big, expensive shape: it takes a
// third of the fold to say "39288 total vehicles", which nobody acts on. The
// facts here are a single line of text. They cost one row, they read left to
// right like a sentence, and putting them beside the title means the working
// content starts at the top of the screen instead of below the fold.
//
// facts: [{ label, value, tone?: 'good'|'warn'|'bad', onClick? }]
// ══════════════════════════════════════════════════════════════════════
export function PageHead({ title, sub, facts = [], actions, children }) {
  const toneColor = { good: C.accent, warn: C.amber, bad: C.red }
  return (
    <div style={{ marginBottom: SP[4] }}>
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:SP[4], flexWrap:'wrap' }}>
        <div style={{ minWidth:0 }}>
          <div style={{ color:C.text, fontSize:T.xl, fontWeight:800, letterSpacing:'-0.4px' }}>{title}</div>
          {sub && <div style={{ color:C.muted, fontSize:T.base, marginTop:'3px' }}>{sub}</div>}
        </div>
        {actions && <div style={{ display:'flex', gap:SP[2], flexWrap:'wrap' }}>{actions}</div>}
      </div>

      {facts.length > 0 && (
        <div style={{
          display:'flex', alignItems:'center', gap:SP[4], flexWrap:'wrap',
          marginTop:SP[3], paddingTop:SP[3], borderTop:`1px solid ${C.border}`,
        }}>
          {facts.filter(Boolean).map((f, i) => {
            const col = toneColor[f.tone] || C.text
            const Tag = f.onClick ? 'button' : 'div'
            return (
              <Tag
                key={i}
                onClick={f.onClick}
                className={f.onClick ? 'pressable' : undefined}
                style={{
                  display:'flex', alignItems:'baseline', gap:'7px',
                  background:'transparent', border:'none', padding:0,
                  cursor: f.onClick ? 'pointer' : 'default',
                }}
              >
                <span style={{ color:col, fontSize:T.lg, fontWeight:800, lineHeight:1, letterSpacing:'-0.3px' }}>
                  {f.value}
                </span>
                <span style={{ color:C.muted, fontSize:T.sm }}>{f.label}</span>
              </Tag>
            )
          })}
        </div>
      )}
      {children}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Section — one heading, said the same way on every screen.
// ══════════════════════════════════════════════════════════════════════
export function Section({ title, sub, right, children, style }) {
  return (
    <div style={{ marginBottom: SP[5], ...style }}>
      {(title || right) && (
        <div style={{
          display:'flex', alignItems:'baseline', justifyContent:'space-between',
          gap:SP[3], flexWrap:'wrap', marginBottom:SP[3],
        }}>
          <div style={{ minWidth:0 }}>
            {title && <span className="eyebrow">{title}</span>}
            {sub && <div style={{ color:C.muted, fontSize:T.sm, marginTop:'3px' }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// PickList — a column of people or things, one of which is selected.
// The same shape on every screen that has a list-and-detail layout, so
// moving between them doesn't mean learning a new list each time.
// ══════════════════════════════════════════════════════════════════════
export function PickList({ items, value, onPick, empty, maxHeight = '620px' }) {
  return (
    <div className="scroll-fade" style={{ overflowY:'auto', maxHeight, minHeight:0 }}>
      {items.length === 0
        ? <div style={{ color:C.muted, fontSize:T.base, padding:'22px 16px', textAlign:'center' }}>{empty || 'Nothing here.'}</div>
        : items.map(it => {
          const on = it.key === value
          return (
            <button
              key={it.key}
              onClick={() => onPick(it.key)}
              className="row-hover"
              style={{
                display:'flex', alignItems:'center', gap:'11px', width:'100%',
                background: on ? C.accentSoft : 'transparent',
                border:'none', borderLeft:`3px solid ${on ? C.accent : 'transparent'}`,
                borderBottom:`1px solid ${C.border}`,
                padding:'11px 14px 11px 11px', textAlign:'left',
              }}
            >
              {it.badge}
              <span style={{ flex:1, minWidth:0 }}>
                <span className="ellip" style={{
                  display:'block', color: on ? C.text : C.text2,
                  fontSize:T.base, fontWeight: on ? 700 : 600,
                }}>{it.label}</span>
                {it.sub && (
                  <span className="ellip" style={{ display:'block', color: it.subColor || C.muted, fontSize:'9.5px', marginTop:'2px' }}>
                    {it.sub}
                  </span>
                )}
              </span>
              {it.right}
            </button>
          )
        })}
    </div>
  )
}

// A thin progress bar. Used under stats and beside list headers.
export function Meter({ value, color = C.accent, height = 4, style }) {
  const pct = Math.max(0, Math.min(100, value || 0))
  return (
    <div style={{ height:`${height}px`, background:'#ffffff0f', borderRadius:R.full, overflow:'hidden', ...style }}>
      <div style={{ height:'100%', width:`${pct}%`, background:color, borderRadius:R.full, transition:`width var(--slow)` }} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// EmptyState — every "nothing here" in the app, said the same way.
// A blank panel with no explanation is the single most common way a
// working screen gets reported as broken.
// ══════════════════════════════════════════════════════════════════════
export function EmptyState({ icon = 'sparkles', title, detail, action, tone = 'neutral' }) {
  const color = tone === 'warn' ? C.amber : tone === 'good' ? C.accent : C.muted
  return (
    <div style={{ textAlign:'center', padding:'52px 24px' }}>
      <div style={{
        width:'46px', height:'46px', borderRadius:R.lg, background:color+'14',
        display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 14px',
      }}>
        <Icon name={icon} size={21} color={color} />
      </div>
      <div style={{ color:C.text2, fontSize:T.md, fontWeight:700 }}>{title}</div>
      {detail && (
        <div style={{ color:C.muted, fontSize:T.base, lineHeight:1.65, marginTop:'8px', maxWidth:'420px', margin:'8px auto 0' }}>
          {detail}
        </div>
      )}
      {action && <div style={{ marginTop:SP[4] }}>{action}</div>}
    </div>
  )
}

// A full-width strip explaining a state that applies to the whole screen
// (read-only, shift ended, something needs attention).
export function Banner({ tone = 'info', icon, children, action }) {
  const map = {
    info:  { fg:C.blue,   bg:'#3b82f612' },
    warn:  { fg:C.amber,  bg:'#FFC10710' },
    good:  { fg:C.accent, bg:'#94EC8E10' },
    error: { fg:C.red,    bg:'#FF4D4D12' },
  }[tone]
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:SP[3], flexWrap:'wrap',
      background:map.bg, border:`1px solid ${map.fg}2e`, borderRadius:R.md,
      padding:'11px 14px',
    }}>
      <Icon name={icon || (tone==='good'?'check-circle':'alerts')} size={15} color={map.fg} />
      <span style={{ color:map.fg, fontSize:T.base, fontWeight:600, flex:1, minWidth:'200px', lineHeight:1.5 }}>{children}</span>
      {action}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Modal — one implementation, instead of the four hand-rolled overlays
// that had drifted apart. Escape and backdrop both close it.
// ══════════════════════════════════════════════════════════════════════
export function Modal({ open, onClose, title, sub, icon, iconColor = C.accent, width = 420, children, footer }) {
  // Escape closes it. This has always been in the comment above and was never
  // actually wired up, and it matters most for the one modal that has no
  // footer buttons — a roster list, where the only way out was to guess that
  // clicking the dark area behind it would work.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position:'fixed', inset:0, background:'rgba(0,0,0,0.78)', backdropFilter:'blur(3px)',
        display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:SP[5],
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="fade-in"
        style={{
          background:SURF.raised, border:`1px solid ${C.border2}`, borderRadius:R.lg,
          width:`${width}px`, maxWidth:'100%', maxHeight:'88vh', overflowY:'auto',
          boxShadow:'0 18px 50px rgba(0,0,0,0.65)',
        }}
      >
        <div style={{ padding:`${SP[5]} ${SP[5]} ${SP[4]}`, position:'relative' }}>
          {/* A visible way out, on every modal. Some carry a Cancel button in
              their footer and some don't; the ones that don't had no closing
              affordance on screen at all. */}
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="pressable"
            style={{
              position:'absolute', top:'12px', right:'12px',
              background:'transparent', border:'none', borderRadius:R.sm,
              color:C.muted, fontSize:'18px', lineHeight:1, padding:'4px 8px', cursor:'pointer',
            }}
          >×</button>
          {icon && (
            <div style={{
              width:'44px', height:'44px', borderRadius:R.lg, background:iconColor+'18',
              display:'flex', alignItems:'center', justifyContent:'center', marginBottom:SP[3],
            }}>
              <Icon name={icon} size={20} color={iconColor} />
            </div>
          )}
          {title && <div style={{ color:C.text, fontSize:T.lg, fontWeight:700, paddingRight:'26px' }}>{title}</div>}
          {sub && <div style={{ color:C.muted, fontSize:T.base, marginTop:'6px', lineHeight:1.6 }}>{sub}</div>}
          {children && <div style={{ marginTop: title||sub ? SP[4] : 0 }}>{children}</div>}
        </div>
        {footer && (
          <div style={{
            display:'flex', gap:SP[2], padding:`${SP[3]} ${SP[5]} ${SP[5]}`,
            borderTop:`1px solid ${C.border}`, paddingTop:SP[4],
          }}>{footer}</div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Table — a data grid with a sticky header. cols: [{ key, label, width,
// align, render }]
// ══════════════════════════════════════════════════════════════════════
export function Table({ cols, rows, rowKey, onRowClick, empty, dense = false }) {
  if (!rows || rows.length === 0) return empty || null
  const padY = dense ? '8px' : '11px'
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', minWidth:'560px' }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.key} style={{
                position:'sticky', top:0, zIndex:1,
                background:SURF.sunken, color:C.muted,
                fontSize:'10px', fontWeight:700, letterSpacing:'0.8px', textTransform:'uppercase',
                textAlign:c.align||'left', padding:`9px 12px`,
                borderBottom:`1px solid ${C.border2}`, whiteSpace:'nowrap',
                width:c.width,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={rowKey ? rowKey(r, i) : i}
              className="row-hover"
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              style={{ cursor: onRowClick ? 'pointer' : 'default' }}
            >
              {cols.map(c => (
                <td key={c.key} style={{
                  padding:`${padY} 12px`, borderBottom:`1px solid ${C.border}`,
                  color:C.text2, fontSize:T.base, textAlign:c.align||'left', verticalAlign:'middle',
                }}>
                  {c.render ? c.render(r, i) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Skeleton — holds the shape while data loads, so nothing jumps.
// ══════════════════════════════════════════════════════════════════════
export function Skeleton({ h = 14, w = '100%', style }) {
  return <div className="skeleton" style={{ height:h, width:w, ...style }} />
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <Card>
      <Skeleton h={11} w="42%" style={{ marginBottom:'14px' }} />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} h={9} w={i === lines-1 ? '60%' : '100%'} style={{ marginBottom:'9px' }} />
      ))}
    </Card>
  )
}

// ══════════════════════════════════════════════════════════════════════
// Toast — a short confirmation that does not need dismissing. Returns a
// [node, show] pair; the caller renders the node once.
// ══════════════════════════════════════════════════════════════════════
export function useToast() {
  const [toast, setToast] = useState(null)
  function show(message, tone = 'good') {
    setToast({ message, tone, id: Date.now() })
    setTimeout(() => setToast(t => (t && t.message === message ? null : t)), 2600)
  }
  const node = toast ? (
    <div
      key={toast.id}
      className="fade-in"
      style={{
        position:'fixed', bottom:SP[6], left:'50%', transform:'translateX(-50%)',
        display:'flex', alignItems:'center', gap:SP[2], zIndex:1200,
        background:SURF.raised, border:`1px solid ${(toast.tone==='error'?C.red:C.accent)}55`,
        borderRadius:R.md, padding:'11px 17px',
        boxShadow:'0 10px 30px rgba(0,0,0,0.6)',
      }}
    >
      <Icon name={toast.tone==='error'?'alerts':'check-circle'} size={15} color={toast.tone==='error'?C.red:C.accent} />
      <span style={{ color:C.text, fontSize:T.base, fontWeight:600 }}>{toast.message}</span>
    </div>
  ) : null
  return [node, show]
}

// ══════════════════════════════════════════════════════════════════════
// IST clock helpers.
//
// Every time in the sheets is IST wall-clock with no zone attached, so any
// browser-local arithmetic over them is wrong by the machine's offset from
// IST. On a laptop set to IST it happens to come out right, which is why a
// break that had run 19 minutes could read 19 hours on a machine set to UTC
// and nobody noticed. These do the maths in the IST frame on both sides.
// ══════════════════════════════════════════════════════════════════════

export function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

// "hh:mm:ss am/pm" or "HH:mm:ss" against a "DD/MM/YYYY" date, as a moment in
// the IST frame. Returns null if either part is unreadable.
export function parseISTStamp(dateStr, timeStr) {
  const t = (timeStr || '').toString().trim()
  let h, mi, se
  let m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i)
  if (m) {
    h = parseInt(m[1], 10); mi = parseInt(m[2], 10); se = parseInt(m[3], 10)
    const ap = m[4].toLowerCase()
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
  } else {
    m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
    if (!m) return null
    h = parseInt(m[1], 10); mi = parseInt(m[2], 10); se = parseInt(m[3], 10)
  }
  const d = (dateStr || '').toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (d) return new Date(+d[3], +d[2] - 1, +d[1], h, mi, se, 0)
  // No date on the row: place it on the IST day in progress, and if that puts
  // it in the future it can only have been yesterday.
  const base = nowIST()
  const out = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mi, se, 0)
  if (out.getTime() > base.getTime() + 120000) out.setDate(out.getDate() - 1)
  return out
}

// Seconds a break has been running, measured in IST on both ends.
export function elapsedSecondsIST(dateStr, timeStr) {
  const start = parseISTStamp(dateStr, timeStr)
  if (!start) return 0
  return Math.max(0, Math.floor((nowIST().getTime() - start.getTime()) / 1000))
}

// ── Shared formatters, so an hour reads the same on every screen ──
export function fmtHour(h) {
  if (h == null) return '—'
  const to12 = n => (n === 0 ? 12 : n > 12 ? n - 12 : n)
  return `${to12(h)}:00 ${h >= 12 ? 'PM' : 'AM'}`
}

export function fmtRange(start, end) {
  if (start == null || end == null) return '—'
  return `${fmtHour(start)} – ${fmtHour(end)}`
}

export function fmtHourSlot(h) {
  if (h == null) return '—'
  return `${fmtHour(h)} – ${fmtHour((h + 1) % 24)}`
}
