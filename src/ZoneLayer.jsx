import { memo, useMemo } from 'react'
import { ImageOverlay, LayerGroup, Polygon, Polyline } from 'react-leaflet'
import L from 'leaflet'
import { diverging } from './answers'

// Hundreds of outlines: one canvas rather than an element each. It sits under
// the markers, which have a pane of their own above it.
let canvas = null
const shared = () => { canvas ||= L.canvas({ padding: 0.4 }); return canvas }

const Zone = memo(function Zone({ item, on, onPick, tip, quiet }) {
  const style = {
    color: on ? '#ffffff' : '#0b1016', weight: on ? 2.5 : 0.7, opacity: on ? 1 : 0.55,
    fillColor: item.color || '#5c6675', fillOpacity: quiet ? 0.001 : !item.color ? 0.08 : item.faint ? 0.22 : 0.62,
  }
  const handlers = useMemo(() => ({
    click: (e) => onPick(item.p, e.originalEvent?.shiftKey || e.originalEvent?.ctrlKey),
  }), [item.p, onPick])
  return (
    <Polygon positions={item.p.rings} renderer={shared()} pathOptions={style} eventHandlers={handlers}>
      {tip(item)}
    </Polygon>
  )
})

/** Areas coloured by value; an item without a colour is only outlined. */
export function ZoneLayer({ items, picked, onPick, tip, quiet }) {
  // the picked ones last, so their outline is on top
  const order = picked?.size
    ? [...items].sort((a, b) => picked.has(a.p.key) - picked.has(b.p.key)) : items
  return (
    <LayerGroup>
      {order.map((x) => (
        <Zone key={`${x.p.key}${picked?.has(x.p.key) ? '+' : ''}`} item={x} on={!!picked?.has(x.p.key)}
          onPick={onPick} tip={tip} quiet={quiet} />
      ))}
    </LayerGroup>
  )
}

/** Lines between places, as wide as what runs between them. */
export function FlowLines({ flows, tip }) {
  const top = Math.max(1, ...flows.map((f) => f.w))
  return (
    <LayerGroup>
      {flows.map((f) => (
        <Polyline key={f.key} positions={[f.a.c, f.b.c]}
          pathOptions={{ color: f.color || '#ffd166', weight: 1 + 9 * Math.sqrt(f.w / top), opacity: 0.55, lineCap: 'round' }}>
          {tip?.(f)}
        </Polyline>
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
