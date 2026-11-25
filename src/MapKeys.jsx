// What is being shown, over the legend and in its style.
import { Fragment, useState } from 'react'
import { isPhone } from '@bartor-net/ui-kit'

const CSS = `
.map-keys { position: absolute; left: 12px; bottom: 26px; z-index: 500; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; pointer-events: none; max-height: calc(100% - 130px); }
.map-keys > * { pointer-events: auto; }
.map-keys .kit-map-legend { position: relative; left: auto; right: auto; top: auto; bottom: auto; }
.map-keys .showing { min-height: 0; overflow-y: auto; width: 260px; box-sizing: border-box; }
.map-keys .showing.closed { width: auto; }
.map-keys .showing b.head { display: flex; align-items: center; gap: .4rem; padding-right: 1rem; }
.map-keys .showing dl { display: grid; grid-template-columns: auto 1fr auto; gap: .2rem .55rem; margin: .1rem 0 0; align-items: baseline; }
.map-keys .showing dt { color: var(--kit-dim); }
.map-keys .showing dd { margin: 0; color: var(--kit-text); overflow-wrap: anywhere; }
.map-keys .showing button.undo { border: 0; background: none; color: var(--kit-dim); cursor: pointer; padding: 0 3px; font: inherit; font-size: .85rem; line-height: 1; }
.map-keys .showing button.undo:hover { color: var(--kit-text); }
.map-keys .showing .warn { color: #f2c14e; }
@media (max-width: 760px) {
  .map-keys { top: 10px; right: 10px; left: auto; bottom: auto; align-items: flex-end; max-height: 60%; }
  .map-keys .showing:not(.closed) { padding-top: .5rem; width: min(70vw, 260px); }
}
`

/** The corner of the map where it is said what is on it. */
export function MapKeys({ info, children }) {
  return (
    <div className="map-keys">
      <style>{CSS}</style>
      {info && <Showing info={info} />}
      {children}
    </div>
  )
}

function Showing({ info }) {
  const [open, setOpen] = useState(() => !isPhone())
  if (!open) {
    return <button type="button" className="kit-map-legend closed showing" onClick={() => setOpen(true)}>Wyświetlanie</button>
  }
  return (
    <div className="kit-map-legend showing" role="region" aria-label="Wyświetlanie">
      <button type="button" className="kit-legend-close" aria-label="Zwiń wyświetlanie" onClick={() => setOpen(false)}>×</button>
      <b className="head"><i style={{ background: info.color }} />{info.title}</b>
      <dl>
        {info.rows.map((r) => (
          <Fragment key={r.label}>
            <dt>{r.label}</dt>
            <dd style={r.filter ? { fontWeight: 600 } : undefined}>
              {r.warn && <span className="warn">(!) </span>}{r.value}{r.note && <span className="warn"> — {r.note}</span>}
            </dd>
            {r.clear
              ? <button type="button" className="undo" title={`Usuń: ${r.label}`} aria-label={`Usuń: ${r.label}`} onClick={r.clear}>×</button>
              : <span />}
          </Fragment>
        ))}
      </dl>
    </div>
  )
}
