import { useMemo } from 'react'
import { Polyline, Tooltip, LayerGroup } from 'react-leaflet'
import L from 'leaflet'
import { fmt, fmtEst, roundEst } from './data'

// Estimated volume -> colour. Deliberately not the same palette as the measured
// point layers, so a modelled number never looks like a counted one.
const RAMP = [
  [1000, '#3b82f6'], [3000, '#06b6d4'], [7000, '#22c55e'],
  [14000, '#eab308'], [25000, '#f97316'], [Infinity, '#ef4444'],
]

const colourFor = (v) => RAMP.find(([t]) => v < t)[1]
// Wide enough to hit with a mouse; the canvas renderer hit-tests on weight.
const widthFor = (v) => Math.max(3, Math.min(16, 2 + Math.sqrt(v) / 28))

export const NETWORK_LEGEND = RAMP.slice(0, -1).map(([t, c], i) => ({
  color: c, label: i === 0 ? `< ${fmt(t)}` : `${fmt(RAMP[i - 1][0])}–${fmt(t)}`,
})).concat([{ color: RAMP.at(-1)[1], label: `> ${fmt(RAMP.at(-2)[0])}` }])

// Thousands of polylines: SVG would choke, so this layer alone draws to canvas.
const CANVAS = L.canvas({ padding: 0.4 })

export default function NetworkLayer({ network, share, hours, minVolume, unit = 'poj.', measured = false, showMeasured }) {
  // Filter on the model's own window value, not the scaled one, so the set of
  // drawn streets stays put when you change period - only the numbers move.
  const shown = useMemo(
    () => network.edges.filter((e) => e.v >= minVolume),
    [network, minVolume],
  )
  return (
    <LayerGroup>
      {shown.map((e, i) => {
        const v = measured ? e.v : e.v * share
        return (
          <Polyline
            key={i}
            positions={e.g}
            renderer={CANVAS}
            pathOptions={{
              color: e.m != null && showMeasured ? '#ffffff' : colourFor(v),
              weight: widthFor(v),
              opacity: e.m != null && showMeasured ? 0.95 : 0.75,
            }}
          >
            <Tooltip sticky>
              <b>{e.n || '(bez nazwy)'}</b><br />
              {measured ? (
                <>
                  <span>{fmt(e.v)} {unit} · 6–10 i 15–19</span><br />
                  <span className="period">
                    {e.tram ? `tramwaj ${e.tram}` : ''}{e.tram && e.bus ? ' · ' : ''}
                    {e.bus ? `autobus ${e.bus}` : ''} · doba {fmt(e.day)}
                  </span>
                </>
              ) : e.m != null ? (
                <>
                  <span>pomiar: {fmt(Math.round(e.m * share))} {unit}</span><br />
                  <span className="period">model: {fmtEst(v)} {unit}</span>
                </>
              ) : (
                <>
                  <span>szacunek: {fmtEst(v)} {unit}</span><br />
                  <span className="period">
                    prawdopodobnie {fmt(roundEst(e.lo * share))}–{fmt(roundEst(e.hi * share))}
                  </span>
                </>
              )}
              <br />
              <span className="period">
                {e.c}{e.ow ? ' · jednokierunkowa' : ''} · {hours.length} godz.
              </span>
            </Tooltip>
          </Polyline>
        )
      })}
    </LayerGroup>
  )
}
