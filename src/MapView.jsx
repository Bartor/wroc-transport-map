import { useEffect, useMemo } from 'react'
import {
  MapContainer, TileLayer, CircleMarker, Tooltip, LayerGroup, useMap,
} from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import NetworkLayer, { NETWORK_LEGEND } from './NetworkLayer'
import SignalsLayer from './SignalsLayer'
import { BASEMAPS } from './basemaps'
import {
  LAYERS, radius, fmt, expansionOf, coverageGap, BASIS_LABEL,
  periodShare, NET_MODES, markerIndex,
} from './data'

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
    if (!map.getBounds().pad(-0.15).contains([m.lat, m.lon])) {
      map.flyTo([m.lat, m.lon], Math.max(map.getZoom(), 15), { duration: 0.6 })
    }
  }, [selected, index, map])
  return null
}

/** Colour key for whatever is currently drawn. Size encodes volume, which a
 *  colour swatch cannot show, so that is stated in words. */
function MapLegend({ visible, net, sig }) {
  const layers = Object.entries(LAYERS).filter(([k]) => visible[k] && k !== 'survey')
  if (!layers.length && !net.on && !sig?.on) return null
  return (
    <div className="map-legend">
      {layers.map(([k, v]) => (
        <span key={k}><i style={{ background: v.color }} />{v.label}</span>
      ))}
      {sig?.on && <span><i style={{ background: '#2fbf71' }} />sygnalizacja</span>}
      {net.on && NETWORK_LEGEND.map((l) => (
        <span key={l.label}><i className="line" style={{ background: l.color }} />{l.label}</span>
      ))}
      <span className="legend-note">wielkość znacznika = natężenie</span>
    </div>
  )
}

export default function MapView({
  data, visible, hours, period, wholeDay, people, net, basemap, sig,
  markers, selected, onSelect,
}) {
  const index = useMemo(() => markerIndex(markers), [markers])
  // The model was fitted on the 8-hour common window; scale it to whatever
  // period is selected using the measured city-wide daily shape.
  const netShare = periodShare(data.meta, hours)

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

        {Object.entries(markers).map(([kind, list]) => {
          const max = Math.max(1, ...list.map((m) => m.value))
          return (
            <LayerGroup key={kind}>
              {list.map((m) => {
                const on = selected && selected.kind === kind && selected.id === m.id
                return (
                  <CircleMarker
                    key={m.id}
                    center={[m.lat, m.lon]}
                    radius={radius(m.value, max)}
                    pathOptions={{
                      color: on ? '#fff' : LAYERS[kind].color,
                      weight: on ? 3 : 1,
                      fillColor: LAYERS[kind].color,
                      fillOpacity: m.value ? 0.6 : 0.15,
                    }}
                    eventHandlers={{ click: () => onSelect({ kind, id: m.id, ref: m.ref }) }}
                  >
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
                      {!wholeDay && coverageGap(data.meta, kind, hours) && (
                        <><br /><span className="warn">
                          pomiar tylko w szczytach — brak danych dla
                          {' '}{coverageGap(data.meta, kind, hours).missing.length} z
                          {' '}{hours.length} godzin okresu
                        </span></>
                      )}
                      {m.sub && <><br /><span className="period">{m.sub}</span></>}
                      {m.shifted && (
                        <><br /><span className="period">
                          {m.shifted} przekroje w tym samym miejscu — znaczniki rozsunięte
                        </span></>
                      )}
                    </Tooltip>
                  </CircleMarker>
                )
              })}
            </LayerGroup>
          )
        })}
      </MapContainer>
      <MapLegend visible={visible} net={net} sig={sig} />
    </div>
  )
}
