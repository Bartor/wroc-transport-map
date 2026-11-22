import { useRef } from 'react'
import { LAYERS, HOUR_LABEL } from './data'

// Two thumbs on a 24-hour track, at hour boundaries 0..24. A start after the
// end wraps over midnight, which is how "Noc 22-5" is represented: one range,
// drawn as two segments. Underneath, one thin band per visible layer shows the
// hours that layer was actually measured, so a range reaching into unmeasured
// hours is visible before any number is read.

const END = 24
const label = (b) => (b === 24 ? '24:00' : HOUR_LABEL(b))

const covered = (range, h) => {
  const [a, b] = range
  return a < b ? h >= a && h < b : h >= a || h < b
}

/** Hours each layer was counted. Road varies by cross-section, so it reports
 *  a share; the peak-only layers have one fixed window each. */
function bands(data, visible) {
  const out = []
  if (visible.road) {
    out.push({
      key: 'road', color: LAYERS.road.color, label: LAYERS.road.label,
      cells: data.roadCoverage.map((f) => (f >= 0.9 ? 1 : f > 0 ? 0.4 : 0)),
      note: 'część przekrojów liczono 24 h, większość 5:00–21:00',
    })
    const ko = data.meta.windows?.roadPeak
    if (ko) {
      out.push({
        key: 'roadPeak', color: LAYERS.road.color, label: 'Kordon obszaru (KO)',
        cells: Array.from({ length: 24 }, (_, h) => (ko.includes(h) ? 1 : 0)),
        note: 'przekroje drogowe na kordonie obszaru (KO) liczono tylko w szczytach',
      })
    }
  }
  for (const k of ['pt', 'bike', 'ped', 'rail']) {
    const w = data.meta.windows?.[k]
    if (!visible[k] || !w) continue
    out.push({
      key: k, color: LAYERS[k].color, label: LAYERS[k].label,
      cells: Array.from({ length: 24 }, (_, h) => (w.includes(h) ? 1 : 0)),
      note: 'liczono tylko w szczytach',
    })
  }
  return out
}

function spanText(cells) {
  const runs = []
  cells.forEach((c, h) => {
    if (c < 1) return
    const last = runs.at(-1)
    if (last && last[1] === h) last[1] = h + 1
    else runs.push([h, h + 1])
  })
  return runs.map(([a, b]) => `${label(a)}–${label(b)}`).join(', ')
}

export default function HourRange({ data, visible, range, setRange }) {
  const track = useRef(null)
  const [from, to] = range

  const boundaryAt = (clientX) => {
    const r = track.current.getBoundingClientRect()
    return Math.max(0, Math.min(END, Math.round(((clientX - r.left) / r.width) * END)))
  }

  const move = (which, b) => {
    let [a, z] = which === 0 ? [b, to] : [from, b]
    // 0 and 24 are the same instant: a start is kept at 0, an end at 24, so
    // the full day is [0, 24] and never an empty wrap-around
    if (a === END) a = 0
    if (z === 0) z = END
    if (a === z) return
    setRange([a, z])
  }

  // Track the drag on window rather than with pointer capture, which some
  // pointer types refuse; the thumb keeps following even off the track.
  const drag = (which) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.focus()
    const onMove = (ev) => move(which, boundaryAt(ev.clientX))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  // clicking the track moves whichever thumb is nearer
  const jump = (e) => {
    const b = boundaryAt(e.clientX)
    move(Math.abs(b - from) <= Math.abs(b - to) ? 0 : 1, b)
  }

  const keys = (which) => (e) => {
    const cur = which === 0 ? from : to
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key]
    if (step) { e.preventDefault(); move(which, Math.max(0, Math.min(END, cur + step))) }
    if (e.key === 'Home') { e.preventDefault(); move(which, 0) }
    if (e.key === 'End') { e.preventDefault(); move(which, END) }
  }

  const segments = from < to ? [[from, to]] : [[from, END], [0, to]]
  const rows = bands(data, visible)
  const pos = (b) => `${(b / END) * 100}%`

  return (
    <div className="hour-range">
      <div className="hr-head">
        <span>{label(from)}–{label(to)}{from > to ? ' (przez północ)' : ''}</span>
      </div>
      <div className="hr-body">
        <div className="hr-track" ref={track} onPointerDown={jump}>
          {segments.map(([a, b]) => (
            <i key={`${a}-${b}`} className="hr-fill" style={{ left: pos(a), width: pos(b - a) }} />
          ))}
          {[from, to].map((b, i) => (
            <span key={i} className="hr-thumb" role="slider" tabIndex={0}
              aria-label={i === 0 ? 'Początek okresu' : 'Koniec okresu'}
              aria-valuemin={0} aria-valuemax={END} aria-valuenow={b}
              aria-valuetext={label(b)} style={{ left: pos(b) }}
              onPointerDown={drag(i)} onKeyDown={keys(i)} />
          ))}
        </div>

        {rows.length > 0 && (
          <div className="hr-bands">
            {rows.map((r) => (
              <div key={r.key} className="hr-band"
                title={`${r.label}: pomiar ${spanText(r.cells)} — ${r.note}`}>
                {r.cells.map((c, h) => (
                  <i key={h} className={covered(range, h) ? 'in' : ''}
                    style={{
                      left: pos(h), width: pos(1),
                      background: c ? r.color : 'transparent',
                      opacity: c === 1 ? undefined : c ? 0.45 : undefined,
                    }} />
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="hr-ticks" aria-hidden="true">
          {[0, 6, 12, 18, 24].map((t) => <span key={t} style={{ left: pos(t) }}>{t}</span>)}
        </div>
      </div>
      {rows.length > 0 && (
        <p className="hr-legend">
          Paski pod suwakiem: godziny objęte pomiarem dla widocznych warstw —
          przerwa oznacza brak danych. Najedź na pasek po szczegóły.
        </p>
      )}
    </div>
  )
}
