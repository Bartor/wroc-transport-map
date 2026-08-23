import { useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, LayerGroup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { LAYERS, ROAD_METRICS, roadVolume, radius, fmt, sumHours } from './data'

const CENTRE = [51.1097, 17.0324]

/** One entry per drawn marker: position, size input, and what to select on click. */
function useMarkers(data, visible, hours, metric, areas) {
  return useMemo(() => {
    const catOrder = data.meta.vehCatOrder
    const out = {}

    if (visible.road) {
      const cats = ROAD_METRICS[metric].cats
      out.road = data.points
        .filter((p) => p.lat && (!areas || areas.includes(p.area)))
        .map((p) => ({
          id: p.id, lat: p.lat, lon: p.lon, kind: 'road', ref: p,
          value: roadVolume(data.roadById[p.id], { cats, hours }, catOrder),
          title: `${p.id} · ${p.name}`,
        }))
    }
    if (visible.pt) {
      out.pt = data.pt.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'pt', ref: p,
        value: Object.values(p.byHour).reduce((a, arr) => a + sumHours(arr, hours), 0),
        title: `${p.id} · ${p.stop || p.name}`,
      }))
    }
    if (visible.bike) {
      out.bike = data.bike.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'bike', ref: p,
        value: sumHours(p.byHour, hours),
        title: `${p.id} · ${p.name}`,
      }))
    }
    if (visible.ped) {
      out.ped = data.ped.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'ped', ref: p,
        value: sumHours(p.byHour, hours),
        title: `${p.id} · ${p.short || p.name}`,
      }))
    }
    if (visible.rail) {
      out.rail = data.rail.filter((p) => p.lat).map((p) => ({
        id: p.id, lat: p.lat, lon: p.lon, kind: 'rail', ref: p,
        value: Object.values(p.byHour).reduce((a, arr) => a + sumHours(arr, hours), 0),
        title: `${p.id} · ${p.stations.join(' / ')}`,
      }))
    }
    return out
  }, [data, visible, hours, metric, areas])
}

export default function MapView({ data, visible, hours, metric, areas, selected, onSelect }) {
  const markers = useMarkers(data, visible, hours, metric, areas)

  return (
    <MapContainer className="map" center={CENTRE} zoom={12}>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />

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
                    {fmt(m.value)} {LAYERS[kind].unit}
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
