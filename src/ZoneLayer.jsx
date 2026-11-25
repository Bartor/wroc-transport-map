import { memo, useMemo } from 'react'
import { CircleMarker, ImageOverlay, LayerGroup, Polygon, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { arc } from './arcs'
import { diverging } from './answers'
import { setHot } from './hot'

// Hundreds of outlines: one canvas rather than an element each. Lines stay
// elements: a second canvas on top would take the pointer from the areas.
let areas = null
const areaCanvas = () => { areas ||= L.canvas({ padding: 0.4 }); return areas }

const Zone = memo(function Zone({ item, on, hot, onPick, tip, quiet, plain }) {
  const fill = quiet ? 0.001 : !item.color ? 0.05 : item.alpha ?? (item.faint ? 0.22 : 0.62)
  const style = {
    color: on || hot ? '#ffffff' : plain ? '#8d99ae' : '#0b1016', weight: on ? 2.5 : hot ? 2 : 0.7,
    opacity: on || hot ? 1 : plain ? 0.4 : 0.55,
    fillColor: item.color || '#5c6675', fillOpacity: hot ? Math.max(fill, 0.25) : fill,
  }
  const handlers = useMemo(() => ({
    click: (e) => onPick(item.p, e.originalEvent?.shiftKey || e.originalEvent?.ctrlKey),
    mouseover: () => setHot({ place: item.p.key }),
    mouseout: () => setHot({}),
  }), [item.p, onPick])
  return (
    <Polygon positions={item.p.rings} renderer={areaCanvas()} pathOptions={style} eventHandlers={handlers}>
      {tip?.(item)}
    </Polygon>
  )
})

/** Areas coloured by value; an item without a colour is only outlined. */
export function ZoneLayer({ items, picked, onPick, tip, quiet, plain, hot }) {
  // the picked ones last, so their outline is on top
  const order = picked?.size
    ? [...items].sort((a, b) => picked.has(a.p.key) - picked.has(b.p.key)) : items
  return (
    <LayerGroup>
      {order.map((x) => (
        <Zone key={`${x.p.key}${picked?.has(x.p.key) ? '+' : ''}`} item={x} on={!!picked?.has(x.p.key)}
          hot={hot === x.p.key} onPick={onPick} tip={tip} quiet={quiet} plain={plain} />
      ))}
    </LayerGroup>
  )
}

const Arc = memo(function Arc({ path, color, weight, opacity, tip, hotAs, cased, end }) {
  const handlers = useMemo(() => (hotAs ? {
    mouseover: () => setHot(hotAs), mouseout: () => setHot({}),
  } : undefined), [hotAs])
  return (
    <>
      {/* a dark edge, so that it stands off whatever is under it */}
      {cased && <Polyline positions={path} interactive={false} pathOptions={{ color: '#0b1016', weight: weight + 2.5, opacity: opacity * 0.55, lineCap: 'round' }} />}
      <Polyline positions={path} interactive={!!hotAs} eventHandlers={handlers}
        pathOptions={{ color, weight, opacity, lineCap: 'round' }}>
        {tip}
      </Polyline>
      {end && (
        <CircleMarker center={path[path.length - 1]} radius={Math.max(3, weight / 2 + 1.5)} interactive={false}
          pathOptions={{ color: '#0b1016', weight: 1, opacity, fillColor: color, fillOpacity: opacity }} />
      )}
    </>
  )
})

/** Curves between places: thin, in the colour of what runs along them. A flow
 *  is { key, from, to, w, color, faint, dim, on, end, tip, hotAs }; `end` marks
 *  where it goes. */
export function Arcs({ flows, width = 6 }) {
  const top = Math.max(1, ...flows.map((f) => f.w))
  const drawn = useMemo(() => flows.map((f) => ({ ...f, path: arc(f.from, f.to) })), [flows])
  return (
    <LayerGroup>
      {drawn.map((f) => (
        <Arc key={f.key} path={f.path} color={f.on ? '#ffffff' : f.color} tip={f.tip} hotAs={f.hotAs}
          cased={!!f.hotAs && !f.dim} end={f.end}
          weight={Math.max(f.hotAs ? 2 : 1, width * Math.sqrt(f.w / top)) + (f.on ? 1.5 : f.strong ? 2 : 0)}
          opacity={f.on || f.strong ? 1 : f.dim ? 0.2 : f.faint ? (f.hotAs ? 0.6 : 0.45) : 0.9} />
      ))}
    </LayerGroup>
  )
}

/** Trips that stay where they start: a ring around the middle of the place. */
export function Rings({ rings }) {
  const top = Math.max(1, ...rings.map((r) => r.top ?? r.w))
  return (
    <LayerGroup>
      {rings.map((r) => (
        <CircleMarker key={r.key} center={r.at} radius={5 + 18 * Math.sqrt(r.w / top)}
          pathOptions={{ color: r.color, weight: 3, opacity: r.dim ? 0.2 : 0.85, fillColor: r.color, fillOpacity: r.dim ? 0.03 : 0.12, dashArray: r.faint ? '3 4' : null }}
          eventHandlers={r.hotAs ? { mouseover: () => setHot(r.hotAs), mouseout: () => setHot({}), click: r.onPick } : undefined}>
          {r.tip}
        </CircleMarker>
      ))}
    </LayerGroup>
  )
}

/** A smoothed surface as a picture over the map; thin ground fades out. */
export function HeatImage({ surface, mid, span, full = 60 }) {
  const url = useMemo(() => {
    const { v, n, cols, rows } = surface
    const cv = document.createElement('canvas')
    cv.width = cols
    cv.height = rows
    const g = cv.getContext('2d')
    const img = g.createImageData(cols, rows)
    for (let i = 0; i < v.length; i++) {
      if (Number.isNaN(v[i])) continue
      const c = diverging(v[i], mid, span)
      img.data.set([c[0], c[1], c[2], Math.round(205 * Math.min(1, n[i] / full) ** 0.8)], i * 4)
    }
    g.putImageData(img, 0, 0)
    return cv.toDataURL()
  }, [surface, mid, span, full])
  const [s, w, n, e] = surface.box
  return <ImageOverlay url={url} bounds={[[s, w], [n, e]]} opacity={0.85} interactive={false} />
}
