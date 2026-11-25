import { memo, useMemo, useState } from 'react'
import { ImageOverlay, LayerGroup, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { arc, arrowed, headSizes, loop } from './arcs'
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

const Arc = memo(function Arc({ path, color, weight, opacity, tip, hotAs, cased, end, start, inner, zoom, onPick }) {
  const map = useMap()
  // the heads are so many pixels long, whatever the zoom
  const { line, heads } = useMemo(() => {
    if (!end && !start) return { line: path, heads: [] }
    const px = (p) => { const q = map.project(p, zoom); return [q.x, q.y] }
    const back = (p) => { const q = map.unproject(p, zoom); return [q.lat, q.lng] }
    const out = arrowed(path.map(px), { end, start, inner })
    return { line: out.line.map(back), heads: out.heads.map((h) => h.map(back)) }
  }, [map, zoom, path, end, start, inner])
  const handlers = useMemo(() => (hotAs ? {
    mouseover: () => setHot(hotAs), mouseout: () => setHot({}), ...(onPick ? { click: onPick } : {}),
  } : undefined), [hotAs, onPick])
  return (
    <>
      {/* a dark edge, so that it stands off whatever is under it */}
      {cased && <Polyline positions={line} interactive={false} pathOptions={{ color: '#0b1016', weight: weight + 2.5, opacity: opacity * 0.55, lineCap: 'round' }} />}
      {cased && heads.map((h, i) => <Polygon key={i} positions={h} interactive={false} pathOptions={{ color: '#0b1016', weight: 2.5, opacity: opacity * 0.55, fill: false, lineJoin: 'round' }} />)}
      <Polyline positions={line} interactive={!!hotAs} eventHandlers={handlers}
        pathOptions={{ color, weight, opacity, lineCap: heads.length ? 'butt' : 'round' }}>
        {tip}
      </Polyline>
      {heads.map((h, i) => <Polygon key={i} positions={h} interactive={false} pathOptions={{ stroke: false, fillColor: color, fillOpacity: opacity }} />)}
    </>
  )
})

/** Curves between places, the wider the more there is of it, with an arrow each
 *  way it runs; a loop where it stays in a place. */
export function Arcs({ flows, width = 6 }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  // what stays is often most of it: it must not make threads of the rest
  const top = Math.max(1, ...flows.filter((f) => !f.loop).map((f) => f.w))
  const drawn = useMemo(() => flows.map((f) => ({ ...f, path: f.loop ? loop(f.from, f.loop) : arc(f.from, f.to) })), [flows])
  return (
    <LayerGroup>
      {drawn.map((f) => {
        const weight = Math.max(f.hotAs ? 2 : 1, width * Math.sqrt(Math.min(1, f.w / top))) + (f.on ? 1.5 : f.strong ? 2 : 0)
        const heads = headSizes(f, weight)
        return (
          <Arc key={f.key} path={f.path} color={f.on ? '#ffffff' : f.color} tip={f.tip} hotAs={f.hotAs} onPick={f.onPick}
            cased={!!f.hotAs && !f.dim} end={heads?.end} start={heads?.start} inner={heads?.inner} zoom={heads ? zoom : 0}
            weight={weight} opacity={f.on || f.strong ? 1 : f.dim ? 0.2 : f.faint ? (f.hotAs ? 0.6 : 0.45) : 0.9} />
        )
      })}
    </LayerGroup>
  )
}

/** A smoothed surface as a picture over the map; thin ground fades out. */
export function HeatImage({ surface, mid, span, sent, dark, full = 60 }) {
  const url = useMemo(() => {
    const { v, n, cols, rows } = surface
    const cv = document.createElement('canvas')
    cv.width = cols
    cv.height = rows
    const g = cv.getContext('2d')
    const img = g.createImageData(cols, rows)
    for (let i = 0; i < v.length; i++) {
      if (Number.isNaN(v[i])) continue
      const c = diverging(v[i], mid, span, sent, dark)
      img.data.set([c[0], c[1], c[2], Math.round(205 * Math.min(1, n[i] / full) ** 0.8)], i * 4)
    }
    g.putImageData(img, 0, 0)
    return cv.toDataURL()
  }, [surface, mid, span, sent, dark, full])
  const [s, w, n, e] = surface.box
  return <ImageOverlay url={url} bounds={[[s, w], [n, e]]} opacity={0.85} interactive={false} />
}
