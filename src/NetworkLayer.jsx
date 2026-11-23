import { useMemo } from 'react'
import { fmt, fmtEst, ramp, roundEst } from '@bartor-net/ui-kit'
import { LineLayer, MapTooltip, TipNote } from '@bartor-net/ui-kit/map'
import './kit'

// Estimated volume -> colour. Deliberately not the same palette as the measured
// point layers, so a modelled number never looks like a counted one.
const RAMP = ramp([
  [1000, '#3b82f6'], [3000, '#06b6d4'], [7000, '#22c55e'],
  [14000, '#eab308'], [25000, '#f97316'], [Infinity, '#ef4444'],
], fmt)

export const NETWORK_LEGEND = RAMP.legend()

export default function NetworkLayer({
  network, share, hours, minVolume, unit = 'poj.', measured = false,
}) {
  // Filter on the model's own window value, not the scaled one, so the set of
  // drawn streets stays put when you change period - only the numbers move.
  const shown = useMemo(
    () => network.edges.filter((e) => e.v >= minVolume),
    [network, minVolume],
  )
  const lines = shown.map((e, i) => {
    const value = measured ? e.v : e.v * share
    return { key: i, path: e.g, value, color: RAMP.color(value), e }
  })
  return (
    <LineLayer lines={lines} tip={({ e, value }) => (
      <MapTooltip sticky>
        <b>{e.n || '(bez nazwy)'}</b><br />
        {measured ? (
          <>
            <span>{fmt(e.v)} {unit} · 6–10 i 15–19</span><br />
            <TipNote>
              {e.tram ? `tramwaj ${e.tram}` : ''}{e.tram && e.bus ? ' · ' : ''}
              {e.bus ? `autobus ${e.bus}` : ''} · doba {fmt(e.day)}
            </TipNote>
          </>
        ) : e.m != null ? (
          <>
            <span>pomiar: {fmt(Math.round(e.m * share))} {unit}</span><br />
            <TipNote>model: {fmtEst(value)} {unit}</TipNote>
          </>
        ) : (
          <>
            <span>szacunek: {fmtEst(value)} {unit}</span><br />
            <TipNote>
              prawdopodobnie {fmt(roundEst(e.lo * share))}–{fmt(roundEst(e.hi * share))}
            </TipNote>
          </>
        )}
        <br />
        <TipNote>
          {e.c}{e.ow ? ' · jednokierunkowa' : ''} · {hours.length} godz.
        </TipNote>
      </MapTooltip>
    )} />
  )
}
