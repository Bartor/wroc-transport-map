// Roadworks on the map, and in words where they matter.
import { Polygon, Polyline, LayerGroup } from 'react-leaflet'
import { Block, Hint } from '@bartor-net/ui-kit'
import { MapTooltip, TipNote } from '@bartor-net/ui-kit/map'
import { WORKS_COLOR } from './works'

export function WorksLayer({ works, areas = [] }) {
  return (
    <LayerGroup>
      {/* the districts they bear on, under them and not in the way of a click */}
      {areas.map((a) => (
        <Polygon key={a.key} positions={a.rings} interactive={false}
          pathOptions={{ color: WORKS_COLOR, weight: 2, opacity: 0.85, dashArray: '2 5', fill: false }} />
      ))}
      {/* tracks it left without trams, as their only way went through it */}
      {works.filter((w) => w.reroute?.g?.length).map((w) => (
        <LayerGroup key={`${w.id}-idle`}>
          <Polyline positions={w.reroute.g} interactive={false} pathOptions={{ color: '#15181e', weight: 5, opacity: 0.6, lineCap: 'round' }} />
          <Polyline positions={w.reroute.g} interactive={false} pathOptions={{ color: WORKS_COLOR, weight: 3, opacity: 0.95, dashArray: '1 7', lineCap: 'round' }} />
          <Polyline positions={w.reroute.g} pathOptions={{ color: '#000000', weight: 14, opacity: 0 }}>
            <MapTooltip sticky>
              <b>Tory bez tramwajów</b> <TipNote>{w.name}, {w.when}</TipNote><br />
              {w.reroute.what}
            </MapTooltip>
          </Polyline>
        </LayerGroup>
      ))}
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
          <b>{w.via ? `Objazd: ${w.name}` : w.name}</b>{w.where && !w.via ? `, ${w.where}` : ''} — {w.what} <span style={{ opacity: 0.75 }}>{w.when}{w.approx ? ' (daty przybliżone)' : ''}</span>{' '}
          {w.sources.map(([label, url], i) => <small key={url}>{i ? ', ' : ''}<a href={url} target="_blank" rel="noreferrer">{label}</a></small>)}
        </p>
      ))}
      {hint && <Hint>{hint}</Hint>}
    </Block>
  )
}
