import { memo, useMemo, useState } from 'react'
import { ImageOverlay, LayerGroup, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { layout } from './arcs'
import { diverging } from './answers'
import { setHot } from './hot'
import { ink } from './ink'

// Hundreds of outlines: one canvas rather than an element each. Lines stay
// elements: a second canvas on top would take the pointer from the areas.
let areas = null
const areaCanvas = () => { areas ||= L.canvas({ padding: 0.4 }); return areas }

const Zone = memo(function Zone({ item, on, hot, onPick, tip, quiet, plain }) {
  const fill = quiet ? 0.001 : !item.color ? 0.05 : item.alpha ?? (item.faint ? 0.22 : 0.62)
  const style = {
    color: on || hot ? ink() : plain ? '#8d99ae' : '#0b1016', weight: on ? 2.5 : hot ? 2 : 0.7,
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

const Arc = memo(function Arc({ it, tip, hotAs, onPick, opacity, cased, on }) {
  const handlers = useMemo(() => (hotAs ? {
    mouseover: () => setHot(hotAs), mouseout: () => setHot({}), ...(onPick ? { click: onPick } : {}),
  } : undefined), [hotAs, onPick])
  const edge = on ? ink() : '#0b1016'
  return (
    <>
      {/* an edge, so that it stands off whatever is under it */}
      {(cased || on) && <Polyline positions={it.line} interactive={false} pathOptions={{ color: edge, weight: it.weight + (on ? 4 : 2.5), opacity: on ? 1 : opacity * 0.55, lineCap: it.heads.length ? 'butt' : 'round' }} />}
      {(cased || on) && it.outlines.map((h, i) => <Polygon key={i} positions={h} interactive={false} pathOptions={{ color: edge, weight: on ? 4 : 2.5, opacity: on ? 1 : opacity * 0.55, fill: false, lineJoin: 'round' }} />)}
      {it.strands.map((s, i) => <Polyline key={i} positions={s.pts} interactive={false} pathOptions={{ color: s.color, weight: s.weight, opacity, lineCap: it.heads.length ? 'butt' : 'round' }} />)}
      {it.heads.map((h, i) => <Polygon key={i} positions={h.pts} interactive={false} pathOptions={{ stroke: false, fillColor: h.color, fillOpacity: opacity }} />)}
      {/* what is pointed at: wider than it looks */}
      {hotAs && (
        <Polyline positions={it.line} eventHandlers={handlers} pathOptions={{ color: '#000000', weight: it.weight + 5, opacity: 0, lineCap: 'round' }}>
          {tip}
        </Polyline>
      )}
    </>
  )
})

/** Curves between places, the wider the more there is of it, a strand a mode and
 *  an arrow each way it runs; a loop where it stays in a place. */
export function Arcs({ flows, width = 6 }) {
  const map = useMap()
  const [zoom, setZoom] = useState(map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  // strands and heads are so many pixels, whatever the zoom
  const drawn = useMemo(() => {
    const px = (p) => { const q = map.project(p, zoom); return [q.x, q.y] }
    const back = (p) => { const q = map.unproject(p, zoom); return [q.lat, q.lng] }
    return layout(flows, px, width).map((it) => ({ f: it.f, weight: it.weight, line: it.line.map(back), outlines: it.outlines.map((h) => h.map(back)),
      strands: it.strands.map((s) => ({ ...s, pts: s.pts.map(back) })), heads: it.heads.map((h) => ({ ...h, pts: h.pts.map(back) })) }))
  }, [flows, map, zoom, width])
  return (
    <LayerGroup>
      {drawn.map((it) => {
        const { f } = it
        return (
          <Arc key={f.key} it={it} tip={f.tip} hotAs={f.hotAs} onPick={f.onPick} on={f.on} cased={!!f.hotAs && !f.dim}
            opacity={f.on || f.strong ? 1 : f.dim ? 0.2 : f.faint ? (f.hotAs ? 0.6 : 0.45) : 0.95} />
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
