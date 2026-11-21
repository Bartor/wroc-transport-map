import { useEffect, useMemo, useState } from 'react'
import {
  MapContainer, TileLayer, CircleMarker, Marker, Tooltip, LayerGroup, useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import NetworkLayer, { NETWORK_LEGEND } from './NetworkLayer'
import SignalsLayer from './SignalsLayer'
import { BASEMAPS } from './basemaps'
import {
  LAYERS, MODES, radius, fmt, fmtEst, expansionOf, coverageGap, BASIS_LABEL,
  periodShare, NET_MODES, markerIndex, splitTotal, HOUR_LABEL,
} from './data'
import { pieSvg, labelLines, labelHtml, labelBox } from './pie'

const CENTRE = [51.1097, 17.0324]

/** Bring the selected point into view, but only when it is off screen —
 *  recentring on something already visible is disorienting when you are
 *  comparing several junctions in the same area. */
function FlyToSelection({ selected, index }) {
  const map = useMap()
  useEffect(() => {
    if (!selected) return
    const m = index[`${selected.kind}:${selected.id}`]
      || (selected.ref?.lat ? selected.ref : null)
    if (!m?.lat) return
    // A map with no size (hidden tab, collapsed pane) makes Leaflet's fly
    // animation compute NaN coordinates and throw, which took the whole app
    // down with it. Nothing to fly to on an invisible map anyway.
    const size = map.getSize()
    if (!size.x || !size.y) return
    if (map.getBounds().pad(-0.15).contains([m.lat, m.lon])) return
    try {
      map.flyTo([m.lat, m.lon], Math.max(map.getZoom(), 15), { duration: 0.6 })
    } catch {
      map.setView([m.lat, m.lon], Math.max(map.getZoom(), 15))
    }
  }, [selected, index, map])
  return null
}

const hoursText = (hrs) => {
  if (!hrs.length) return 'brak godzin wspólnych'
  const runs = []
  for (const h of [...hrs].sort((a, b) => a - b)) {
    const last = runs.at(-1)
    if (last && last[1] === h - 1) last[1] = h
    else runs.push([h, h])
  }
  return runs.map(([a, b]) => `${HOUR_LABEL(a)}–${HOUR_LABEL((b + 1) % 24)}`).join(', ')
}

/** Permanent labels beside the markers. With declutter on, labels are placed
 *  biggest-first and any that would overlap one already placed are skipped;
 *  zooming in brings them back. */
function NodeLabels({ entries, declutter }) {
  const map = useMap()
  const [view, setView] = useState(0)
  useMapEvents({ zoomend: () => setView((v) => v + 1), moveend: () => setView((v) => v + 1) })

  const placed = useMemo(() => {
    const size = map.getSize()
    const taken = []
    const out = []
    const sorted = [...entries].sort((a, b) => b.weight - a.weight)
    for (const e of sorted) {
      const pt = map.latLngToContainerPoint([e.lat, e.lon])
      const box = { x: pt.x + e.r + 5, y: pt.y - e.box.h / 2, w: e.box.w, h: e.box.h }
      if (box.x > size.x || box.x + box.w < 0 || box.y > size.y || box.y + box.h < 0) continue
      if (declutter && taken.some((t) => box.x < t.x + t.w && t.x < box.x + box.w
        && box.y < t.y + t.h && t.y < box.y + box.h)) continue
      taken.push(box)
      out.push(e)
    }
    return out
    // `view` is a dependency on purpose: positions change on every pan and zoom
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, declutter, view, map])

  return placed.map((e) => (
    <Marker key={e.key} position={[e.lat, e.lon]} interactive={false} keyboard={false}
      icon={L.divIcon({
        className: 'node-label', html: e.html,
        iconSize: [e.box.w, e.box.h], iconAnchor: [-(e.r + 5), e.box.h / 2],
      })} />
  ))
}

/** Colour key for whatever is currently drawn. Size encodes volume, which a
 *  colour swatch cannot show, so that is stated in words. */
function MapLegend({ visible, net, sig, pies }) {
  const layers = Object.entries(LAYERS).filter(([k]) => visible[k] && k !== 'survey')
  if (!layers.length && !net.on && !sig?.on) return null
  return (
    <div className="map-legend">
      {pies ? (
        <>
          <b>Podział modalny węzła (osoby)</b>
          {MODES.map((m) => (
            <span key={m.key}><i style={{ background: m.color }} />{m.label}</span>
          ))}
          <span className="legend-note">bez pieszych — nie liczono ich na przekrojach drogowych</span>
        </>
      ) : layers.map(([k, v]) => (
        <span key={k}><i style={{ background: v.color }} />{v.label}</span>
      ))}
      {sig?.on && <span><i style={{ background: '#2fbf71' }} />sygnalizacja</span>}
      {net.on && NETWORK_LEGEND.map((l) => (
        <span key={l.label}><i className="line" style={{ background: l.color }} />{l.label}</span>
      ))}
      <span className="legend-note">
        {pies ? 'wielkość koła = liczba osób w węźle' : 'wielkość znacznika = natężenie'}
      </span>
    </div>
  )
}

function SplitTooltip({ m }) {
  const total = splitTotal(m.split)
  const rows = [...m.split.slices].filter((s) => s.persons > 0)
    .sort((a, b) => b.persons - a.persons)
  return (
    <>
      <br /><span className="period">
        podział modalny, osoby · {hoursText(m.split.hours)}
      </span>
      {rows.map((s) => (
        <div key={s.key} className="tt-row">
          <i style={{ background: s.color }} />{s.label}
          <b>{s.est ? fmtEst(s.persons) : fmt(s.persons)}</b>
          <em>{Math.round((100 * s.persons) / total)}%</em>
        </div>
      ))}
      {m.pair && (
        <span className="period">
          napełnienie KZ z punktu {m.pair.title} ({m.pair.dist} m)
        </span>
      )}
      {m.split.basis === 'estimate' && (
        <span className="period">autobusy i tramwaje szacowane z liczby pojazdów</span>
      )}
    </>
  )
}

export default function MapView({
  data, visible, hours, period, wholeDay, people, net, basemap, sig,
  markers, labels, selected, onSelect,
}) {
  const index = useMemo(() => markerIndex(markers), [markers])
  // The model was fitted on the 8-hour common window; scale it to whatever
  // period is selected using the measured city-wide daily shape.
  const netShare = periodShare(data.meta, hours)

  // Radius per marker, needed both to draw it and to offset its label.
  // A pie shows everyone passing the node, so it is sized by everyone - not by
  // the road layer's own value, which in people mode is car occupants only and
  // made transit-heavy nodes look small. Road and transit pies share one scale
  // because both are in people.
  const radii = useMemo(() => {
    const r = {}
    const pieMax = Math.max(1, ...Object.values(markers).flat()
      .filter((m) => m.split).map((m) => splitTotal(m.split)))
    for (const [kind, list] of Object.entries(markers)) {
      const max = Math.max(1, ...list.map((m) => m.value))
      for (const m of list) {
        r[`${kind}:${m.id}`] = m.split
          ? radius(splitTotal(m.split), pieMax, 7, 24)
          : radius(m.value, max)
      }
    }
    return r
  }, [markers])

  const pies = Object.values(markers).some((list) => list.some((m) => m.split))

  const labelEntries = useMemo(() => {
    if (labels.mode === 'hover') return []
    const out = []
    for (const [kind, list] of Object.entries(markers)) {
      const unit = people && kind === 'road' ? 'os.' : LAYERS[kind].unit
      for (const m of list) {
        const lines = labelLines(m, labels.mode, unit)
        if (!lines.length) continue
        out.push({
          key: `${kind}:${m.id}`, lat: m.lat, lon: m.lon, r: radii[`${kind}:${m.id}`],
          html: labelHtml(lines), box: labelBox(lines),
          weight: m.split ? splitTotal(m.split) : m.value,
        })
      }
    }
    return out
  }, [markers, labels.mode, radii, people])

  return (
    <div className="map-wrap">
      <MapContainer className={BASEMAPS[basemap].dark ? 'map dark' : 'map'}
        center={CENTRE} zoom={12}>
        <TileLayer key={basemap} url={BASEMAPS[basemap].url}
          attribution={BASEMAPS[basemap].attribution}
          maxZoom={BASEMAPS[basemap].maxZoom || 19}
          maxNativeZoom={BASEMAPS[basemap].maxZoom || 19} />
        {BASEMAPS[basemap].labels && (
          <TileLayer key={`${basemap}-labels`} url={BASEMAPS[basemap].labels}
            pane="shadowPane" maxZoom={BASEMAPS[basemap].maxZoom || 19}
            maxNativeZoom={BASEMAPS[basemap].maxZoom || 19} />
        )}

        <FlyToSelection selected={selected} index={index} />

        {net.on && data[NET_MODES[net.mode].file] && (
          <NetworkLayer key={net.mode} network={data[NET_MODES[net.mode].file]}
            share={netShare} hours={hours} minVolume={net.min}
            unit={NET_MODES[net.mode].unit}
            measured={!!NET_MODES[net.mode].measured} />
        )}

        {sig?.on && data.signals && (
          <SignalsLayer signals={data.signals} filter={sig.filter} share={netShare}
            onSelect={onSelect} selected={selected} />
        )}

        {visible.survey && (
          <LayerGroup>
            {data.survey.map((s, i) => (
              <CircleMarker key={i} center={[s.lat, s.lon]} radius={2.5}
                pathOptions={{ color: LAYERS.survey.color, weight: 0, fillOpacity: 0.55 }}>
                <Tooltip>{s.addr || 'adres z próby'}<br />rejon {s.zone}</Tooltip>
              </CircleMarker>
            ))}
          </LayerGroup>
        )}

        {Object.entries(markers).map(([kind, list]) => (
          <LayerGroup key={kind}>
            {list.map((m) => {
              const on = selected && selected.kind === kind && selected.id === m.id
              const r = radii[`${kind}:${m.id}`]
              const tip = (
                <Tooltip>
                  <b>{m.title}</b><br />
                  {fmt(m.value)}{' '}
                  {people && kind === 'road' ? 'osób w samochodach' : LAYERS[kind].unit}
                  <span className="period"> · {period}</span>
                  {wholeDay && expansionOf(data.meta, kind)?.factor > 1 && (
                    <><br /><span className="period">
                      oszacowanie doby (×{expansionOf(data.meta, kind).factor},{' '}
                      {BASIS_LABEL[expansionOf(data.meta, kind).basis]}) —
                      zmierzono {fmt(m.raw)}
                    </span></>
                  )}
                  {!wholeDay && !m.split && coverageGap(data.meta, kind, hours) && (
                    <><br /><span className="warn">
                      pomiar tylko w szczytach — brak danych dla
                      {' '}{coverageGap(data.meta, kind, hours).missing.length} z
                      {' '}{hours.length} godzin okresu
                    </span></>
                  )}
                  {m.sub && <><br /><span className="period">{m.sub}</span></>}
                  {m.ref?.repeatsStreet && (
                    <><br /><span className="warn">
                      przekroje po obu stronach skrzyżowania — jadący na wprost
                      liczeni dwa razy, suma zawyżona
                    </span></>
                  )}
                  {m.split && <SplitTooltip m={m} />}
                </Tooltip>
              )
              const click = { click: () => onSelect({ kind, id: m.id, ref: m.ref }) }
              if (m.split) {
                return (
                  <Marker key={m.id} position={[m.lat, m.lon]} eventHandlers={click}
                    icon={L.divIcon({
                      className: 'pie-icon', html: pieSvg(m.split, r, on),
                      iconSize: [2 * r + 6, 2 * r + 6], iconAnchor: [r + 3, r + 3],
                    })}>
                    {tip}
                  </Marker>
                )
              }
              return (
                <CircleMarker
                  key={m.id}
                  center={[m.lat, m.lon]}
                  radius={r}
                  pathOptions={{
                    color: on ? '#fff' : LAYERS[kind].color,
                    weight: on ? 3 : 1,
                    fillColor: LAYERS[kind].color,
                    fillOpacity: m.value ? 0.6 : 0.15,
                  }}
                  eventHandlers={click}
                >
                  {tip}
                </CircleMarker>
              )
            })}
          </LayerGroup>
        ))}

        {labels.mode !== 'hover' && (
          <NodeLabels entries={labelEntries} declutter={labels.declutter} />
        )}
      </MapContainer>
      <MapLegend visible={visible} net={net} sig={sig} pies={pies} />
    </div>
  )
}
