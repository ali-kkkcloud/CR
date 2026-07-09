// Lightweight hand-drawn SVG icon set — zero extra npm dependencies.
// Usage: <Icon name="overview" size={18} color="#94EC8E" />

export default function Icon({ name, size = 18, color = 'currentColor', strokeWidth = 1.8 }) {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  switch (name) {
    case 'overview':
      return <svg {...p}><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9h14v-9" /><path d="M9.5 19v-5h5v5" /></svg>
    case 'fullday':
      return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></svg>
    case 'progress':
      return <svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3.5 2.5-6 5.5-6s5.5 2.5 5.5 6" /><circle cx="17.5" cy="8.5" r="2.3" /><path d="M15.8 20c0-2.7 1.6-4.9 3.7-5.3" /></svg>
    case 'footage':
      return <svg {...p}><rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5 21 8v8l-5-2.5" /></svg>
    case 'followups':
      return <svg {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v2" /></svg>
    case 'redistribution':
      return <svg {...p}><path d="M17 3 21 7l-4 4" /><path d="M3 11V9a2 2 0 0 1 2-2h16" /><path d="M7 21 3 17l4-4" /><path d="M21 13v2a2 2 0 0 1-2 2H3" /></svg>
    case 'leaves':
      return <svg {...p}><path d="M20 4C10 4 4 10 4 20c10 0 16-6 16-16z" /><path d="M4.5 19.5 12 12" /></svg>
    case 'reports':
      return <svg {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="8" y1="17" x2="8" y2="11" /><line x1="12" y1="17" x2="12" y2="7" /><line x1="16" y1="17" x2="16" y2="13" /></svg>
    case 'analytics':
      return <svg {...p}><polyline points="3,17 9,11 13,15 21,6" /><polyline points="15,6 21,6 21,12" /></svg>
    case 'alerts':
      return <svg {...p}><path d="M12 3a5 5 0 0 0-5 5v3.3c0 1-.4 2-1.2 2.7L4 16h16l-1.8-2c-.8-.7-1.2-1.7-1.2-2.7V8a5 5 0 0 0-5-5z" /><path d="M9.5 19a2.5 2.5 0 0 0 5 0" /></svg>
    case 'settings':
      return <svg {...p}><circle cx="12" cy="12" r="3" /><path d="M19 12c0-.5 0-1-.1-1.5l2-1.6-2-3.4-2.3.9c-.8-.7-1.7-1.2-2.7-1.6L13.4 2h-2.8l-.5 2.8c-1 .4-1.9.9-2.7 1.6l-2.3-.9-2 3.4 2 1.6C5 11 5 11.5 5 12s0 1 .1 1.5l-2 1.6 2 3.4 2.3-.9c.8.7 1.7 1.2 2.7 1.6l.5 2.8h2.8l.5-2.8c1-.4 1.9-.9 2.7-1.6l2.3.9 2-3.4-2-1.6c.1-.5.1-1 .1-1.5z" /></svg>
    case 'shield':
      return <svg {...p}><path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z" /><path d="M9 12l2 2 4-4.5" /></svg>
    case 'users':
      return <svg {...p}><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><circle cx="17.5" cy="8.5" r="2.3" /><path d="M15.8 20c0-2.7 1.6-4.9 3.7-5.3" /></svg>
    case 'check-circle':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8.3 12.3 11 15l5-6" /></svg>
    case 'clock':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></svg>
    case 'offline':
      return <svg {...p}><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
    case 'camera':
      return <svg {...p}><rect x="3" y="7" width="14" height="11" rx="2" /><path d="M17 11l4-2.3v6.6L17 13" /><circle cx="10" cy="12.5" r="2.3" /></svg>
    case 'shuffle':
      return <svg {...p}><path d="M4 6h3.5L15 17h4.5" /><path d="M4 17h3.5L11 12" /><path d="M16.5 6H19" /><path d="M17 3.5 19.5 6 17 8.5" /><path d="M17 14.5 19.5 17 17 19.5" /></svg>
    case 'bell':
      return <svg {...p}><path d="M12 3a5 5 0 0 0-5 5v3.3c0 1-.4 2-1.2 2.7L4 16h16l-1.8-2c-.8-.7-1.2-1.7-1.2-2.7V8a5 5 0 0 0-5-5z" /><path d="M9.5 19a2.5 2.5 0 0 0 5 0" /></svg>
    case 'search':
      return <svg {...p}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.2" y2="16.2" /></svg>
    case 'calendar':
      return <svg {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" /></svg>
    case 'download':
      return <svg {...p}><path d="M12 3v12" /><path d="M7.5 10.5 12 15l4.5-4.5" /><path d="M4 19h16" /></svg>
    case 'arrow-right':
      return <svg {...p}><line x1="4" y1="12" x2="19" y2="12" /><path d="M13.5 6 19 12l-5.5 6" /></svg>
    case 'chevron-down':
      return <svg {...p}><path d="M6 9l6 6 6-6" /></svg>
    case 'plus':
      return <svg {...p}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case 'minus':
      return <svg {...p}><line x1="5" y1="12" x2="19" y2="12" /></svg>
    case 'locate':
      return <svg {...p}><circle cx="12" cy="12" r="2.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /></svg>
    case 'sparkles':
      return <svg {...p}><path d="M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4z" /><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7z" /></svg>
    case 'trend-up':
      return <svg {...p}><polyline points="3,16 9,10 13,14 21,5" /></svg>
    default:
      return <svg {...p}><circle cx="12" cy="12" r="9" /></svg>
  }
}
