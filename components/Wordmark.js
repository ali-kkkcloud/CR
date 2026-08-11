// The Cautio wordmark.
//
// Only the tittle — the dot over the "i" — is green; every other letter takes
// the surrounding text colour. A glyph can't be part-coloured, so the "i" is
// drawn as a dotless ı (U+0131) with a round dot positioned over it. Every
// measurement is in em, so the dot tracks the font size wherever this is used.
//
// The visible letters are hidden from assistive tech and a plain "Cautio" is
// exposed instead, so screen readers and copy-paste get the real word rather
// than "Cautıo".
export default function CautioWordmark({
  size = 30,
  color = '#fff',
  dotColor = '#22c55e',
  weight = 900,
  letterSpacing = '-0.5px',
  style = {},
}) {
  return (
    <span style={{
      fontSize: typeof size === 'number' ? `${size}px` : size,
      fontWeight: weight, color, letterSpacing,
      lineHeight: 1, display: 'inline-block', whiteSpace: 'nowrap',
      ...style,
    }}>
      <span style={{
        position: 'absolute', width: '1px', height: '1px',
        padding: 0, margin: '-1px', overflow: 'hidden',
        clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0,
      }}>Cautio</span>
      <span aria-hidden="true">
        Caut<span style={{ position: 'relative', display: 'inline-block' }}>
          {'ı'}
          <span style={{
            position: 'absolute',
            left: '50%', transform: 'translateX(-50%)',
            top: '0.075em',
            width: '0.16em', height: '0.16em',
            borderRadius: '50%', background: dotColor,
          }} />
        </span>o
      </span>
    </span>
  )
}
