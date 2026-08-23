import { useMemo } from 'react'
import { CircleMarker, Tooltip, LayerGroup } from 'react-leaflet'
import { fmt, fmtEst, radius } from './data'

export const SIGNAL_FILTERS = {
  all: { label: 'Wszystkie', test: () => true },
  candidates: {
    label: 'Tylko ulice lokalne bez tramwaju',
    test: (s) => s.kind === 'junction' && s.minor && !s.tram,
  },
  junctions: { label: 'Tylko skrzyżowania', test: (s) => s.kind === 'junction' },
  crossings: { label: 'Tylko przejścia', test: (s) => s.kind === 'crossing' },
}

// Green where little passes through, red where a lot: the map should make the
// low-traffic signals easy to pick out, since those are the ones worth a look.
const colourFor = (v) => (v < 4000 ? '#2fbf71' : v < 10000 ? '#e8b04b'
  : v < 20000 ? '#e8763b' : '#c1392b')

export default function SignalsLayer({ signals, filter, share, onSelect, selected }) {
  const shown = useMemo(
    () => signals.junctions.filter(SIGNAL_FILTERS[filter].test),
    [signals, filter],
  )
  const max = useMemo(
    () => Math.max(1, ...shown.map((s) => s.v)), [shown],
  )
  return (
    <LayerGroup>
      {shown.map((s, i) => {
        const v = s.v * share
        const on = selected?.kind === 'signal' && selected.id === `${s.lat},${s.lon}`
        return (
          <CircleMarker
            key={i}
            center={[s.lat, s.lon]}
            radius={radius(s.v, max, 4, 16)}
            pathOptions={{
              color: on ? '#fff' : '#1b1e26', weight: on ? 2.5 : 1,
              fillColor: colourFor(s.v), fillOpacity: 0.85,
            }}
            eventHandlers={{
              click: () => onSelect({ kind: 'signal', id: `${s.lat},${s.lon}`, ref: s }),
            }}
          >
            <Tooltip>
              <b>{s.streets.length ? s.streets.join(' × ') : 'sygnalizacja'}</b><br />
              {s.kind === 'crossing' ? 'przejście z sygnalizacją' : `${s.arms} wloty`}
              {' · '}{fmtEst(v)} poj.<br />
              <span className="period">
                {s.runs ? `${fmt(s.runs)} kursów KZ` : 'brak komunikacji zbiorowej'}
                {s.tram ? ' · tramwaj' : ''}{s.minor ? ' · ulice lokalne' : ''}
              </span>
            </Tooltip>
          </CircleMarker>
        )
      })}
    </LayerGroup>
  )
}
