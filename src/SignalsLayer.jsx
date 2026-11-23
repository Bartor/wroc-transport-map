import { useMemo } from 'react'
import { fmt, fmtEst, ramp, sqrtRadius } from '@bartor-net/ui-kit'
import { CircleLayer, MapTooltip, TipNote } from '@bartor-net/ui-kit/map'

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
const RAMP = ramp([
  [4000, '#2fbf71'], [10000, '#e8b04b'], [20000, '#e8763b'], [Infinity, '#c1392b'],
])

/** A signal has no number of its own; it goes by its position. */
export const signalId = (s) => `${s.lat},${s.lon}`

export default function SignalsLayer({ signals, filter, share, onSelect, selected }) {
  const shown = useMemo(
    () => signals.junctions.filter(SIGNAL_FILTERS[filter].test),
    [signals, filter],
  )
  const max = useMemo(
    () => Math.max(1, ...shown.map((s) => s.v)), [shown],
  )
  const points = shown.map((s, i) => {
    const on = selected?.kind === 'signal' && selected.id === signalId(s)
    return {
      key: i, lat: s.lat, lon: s.lon, r: sqrtRadius(s.v, max, 4, 16), s,
      style: {
        color: on ? '#fff' : '#1b1e26', weight: on ? 2.5 : 1,
        fillColor: RAMP.color(s.v), fillOpacity: 0.85,
      },
    }
  })
  return (
    <CircleLayer points={points}
      onPick={({ s }) => onSelect({ kind: 'signal', id: signalId(s), ref: s })}
      tip={({ s }) => (
        <MapTooltip>
          <b>{s.streets.length ? s.streets.join(' × ') : 'sygnalizacja'}</b><br />
          {s.kind === 'crossing' ? 'przejście z sygnalizacją' : `${s.arms} wloty`}
          {' · '}{fmtEst(s.v * share)} poj.<br />
          <TipNote>
            {s.runs ? `${fmt(s.runs)} kursów KZ` : 'brak komunikacji zbiorowej'}
            {s.tram ? ' · tramwaj' : ''}{s.minor ? ' · ulice lokalne' : ''}
          </TipNote>
        </MapTooltip>
      )} />
  )
}
