// Roadworks on the map, and in words where they matter.
import { Polyline, LayerGroup } from 'react-leaflet'
import { Block, Hint } from '@bartor-net/ui-kit'
import { MapTooltip, TipNote } from '@bartor-net/ui-kit/map'
import { WORKS_COLOR } from './works'

export function WorksLayer({ works }) {
  return (
    <LayerGroup>
      {works.filter((w) => w.g.length).map((w) => (
        <LayerGroup key={w.id}>
          <Polyline positions={w.g} interactive={false} pathOptions={{ color: '#15181e', weight: w.hard ? 7 : 5, opacity: 0.9, lineCap: 'butt' }} />
          <Polyline positions={w.g} interactive={false} pathOptions={{ color: WORKS_COLOR, weight: w.hard ? 4.5 : 2.5, opacity: w.hard ? 1 : 0.85, dashArray: w.hard ? '7 6' : '4 6', lineCap: 'butt' }} />
          <Polyline positions={w.g} pathOptions={{ color: '#000000', weight: 14, opacity: 0 }}>
            <MapTooltip sticky>
              <b>{w.name}</b>{w.where ? `, ${w.where}` : ''} <TipNote>remont w czasie badań</TipNote><br />
              {w.what}<br />
              <TipNote>{w.when}{w.approx ? ' (daty przybliżone)' : ''}</TipNote>
            </MapTooltip>
          </Polyline>
        </LayerGroup>
      ))}
    </LayerGroup>
  )
}

/** The works that bear on what a panel is of. */
export function WorksBlock({ works, title = 'Remonty w czasie badań', hint }) {
  if (!works.length) return null
  return (
    <Block>
      {title && <h4 style={{ color: WORKS_COLOR }}>{title}</h4>}
      {works.map((w) => (
        <p key={w.id} style={{ margin: '0 0 6px', fontSize: 12, borderLeft: `3px solid ${WORKS_COLOR}`, paddingLeft: 8 }}>
          <b>{w.name}</b>{w.where ? `, ${w.where}` : ''} — {w.what} <span style={{ opacity: 0.75 }}>{w.when}{w.approx ? ' (daty przybliżone)' : ''}</span>{' '}
          {w.sources.map(([label, url], i) => <small key={url}>{i ? ', ' : ''}<a href={url} target="_blank" rel="noreferrer">{label}</a></small>)}
        </p>
      ))}
      {hint && <Hint>{hint}</Hint>}
    </Block>
  )
}
