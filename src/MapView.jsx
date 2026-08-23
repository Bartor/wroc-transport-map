import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, LayerGroup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import NetworkLayer from './NetworkLayer'
import {
  LAYERS, ROAD_METRICS, roadVolume, radius, fmt, sumHours, spread, sectionOf,
  parentOf, expand, toPeople, expansionOf, coverageGap, BASIS_LABEL, activeCats,
} from './data'

const CENTRE = [51.1097, 17.0324]

/** One entry per drawn marker: position, size input, and what to select on click. */
function useMarkers(data, visible, hours, metric, areas, aggregate, wholeDay, people, occupancy) {
  return useMemo(() => {
    const catOrder = data.meta.vehCatOrder
    const out = {}

    if (visible.road) {
      const cats = activeCats(metric, people)
      out.road = data.points
        .filter((p) => p.lat && (!areas || areas.includes(p.area)))
        .map((p) => ({
          id: p.id, lat: p.lat, lon: p.lon, kind: 'road', ref: p,
          value: roadVolume(data.roadById[p.id], { cats, hours }, catOrder),
          title: `${p.id} · ${p.name}`, sub: sectionOf('road', p),
        }))
    }
    if (visible.pt) {
      out.pt = data.pt.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'pt', ref: p,
        value: Object.values(p.byHour).reduce((a, arr) => a + sumHours(arr, hours), 0),
        title: `${p.id} · ${p.stop || p.name}`, sub: sectionOf('pt', p),
      }))
    }
    if (visible.bike) {
      out.bike = data.bike.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'bike', ref: p,
        value: sumHours(p.byHour, hours),
        title: `${p.id} · ${p.name}`, sub: sectionOf('bike', p),
      }))
    }
    if (visible.ped) {
      out.ped = data.ped.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'ped', ref: p,
        value: sumHours(p.byHour, hours),
        title: `${p.id} · ${p.short || p.name}`, sub: sectionOf('ped', p),
      }))
    }
    if (visible.rail) {
      out.rail = data.rail.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'rail', ref: p,
        value: Object.values(p.byHour).reduce((a, arr) => a + sumHours(arr, hours), 0),
        title: `${p.id} · ${p.stations.join(' / ')}`,
      }))
    }
    for (const k of Object.keys(out)) {
      for (const m of out[k]) {
        m.raw = m.value
        m.value = toPeople(expand(data.meta, k, m.value, wholeDay), k, occupancy, people)
      }
      if (aggregate && k !== 'rail') out[k] = mergeToPoints(k, out[k])
      spread(out[k])
    }
    return out
  }, [data, visible, hours, metric, areas, aggregate, wholeDay, people, occupancy])
}

/** One marker per measurement point: its cross-sections are separate approaches
 *  of the same place, so their counts add up rather than overlap. */
function mergeToPoints(kind, list) {
  const by = new Map()
  for (const m of list) {
    const key = parentOf(kind, m.ref)
    if (!by.has(key)) by.set(key, [])
    by.get(key).push(m)
  }
  return [...by.entries()].map(([key, ms]) => {
    if (ms.length === 1) return ms[0]
    return {
      id: key, kind,
      lat: ms.reduce((a, m) => a + m.lat, 0) / ms.length,
      lon: ms.reduce((a, m) => a + m.lon, 0) / ms.length,
      value: ms.reduce((a, m) => a + m.value, 0),
      title: `${key} · ${ms[0].ref.name || ms[0].ref.stop || ''}`,
      sub: `suma ${ms.length} przekrojów: ${ms.map((m) => m.id.slice(-1)).join(', ')}`,
      ref: {
        aggregate: true, id: key, members: ms.map((m) => m.ref),
        name: ms[0].ref.name || ms[0].ref.stop || '',
      },
    }
  })
}

export default function MapView({
  data, visible, hours, metric, areas, period, aggregate,
  wholeDay, people, occupancy, net, selected, onSelect,
}) {
  const markers = useMarkers(data, visible, hours, metric, areas, aggregate,
    wholeDay, people, occupancy)

  return (
    <MapContainer className="map" center={CENTRE} zoom={12}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />

      {net.on && (
        <NetworkLayer network={data.network} daily={net.daily} minVolume={net.min} />
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
                    color: on ? '#111' : LAYERS[kind].color,
                    weight: on ? 2.5 : 1,
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
  )
}
