import { useMemo } from 'react'
import { Polyline, Tooltip, LayerGroup } from 'react-leaflet'
import L from 'leaflet'
import { fmt } from './data'

// Estimated volume -> colour. Deliberately not the same palette as the measured
// point layers, so a modelled number never looks like a counted one.
const RAMP = [
  [1000, '#3b4252'], [3000, '#2f6f7f'], [7000, '#3f9e5a'],
  [14000, '#c9a227'], [25000, '#d9722b'], [Infinity, '#c1392b'],
]

const colourFor = (v) => RAMP.find(([t]) => v < t)[1]
const widthFor = (v) => Math.max(1, Math.min(9, 1 + Math.sqrt(v) / 45))

export const NETWORK_LEGEND = RAMP.slice(0, -1).map(([t, c], i) => ({
  color: c, label: i === 0 ? `< ${fmt(t)}` : `${fmt(RAMP[i - 1][0])}–${fmt(t)}`,
})).concat([{ color: RAMP.at(-1)[1], label: `> ${fmt(RAMP.at(-2)[0])}` }])

// Thousands of polylines: SVG would choke, so this layer alone draws to canvas.
const CANVAS = L.canvas({ padding: 0.4 })

export default function NetworkLayer({ network, daily, minVolume, showMeasured }) {
  const shown = useMemo(
    () => network.edges.filter((e) => (daily ? e.d : e.v) >= minVolume),
    [network, daily, minVolume],
  )
  return (
    <LayerGroup>
      {shown.map((e, i) => {
        const v = daily ? e.d : e.v
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
              {e.m != null ? (
                <>
                  <span>pomiar: {fmt(daily ? e.m * network.meta.dailyFactor : e.m)} poj.</span><br />
                  <span className="period">model: {fmt(v)} poj.</span>
                </>
              ) : (
                <>
                  <span>szacunek: {fmt(v)} poj.</span><br />
                  <span className="period">
                    zakres {fmt(daily ? e.lo * network.meta.dailyFactor : e.lo)}–
                    {fmt(daily ? e.hi * network.meta.dailyFactor : e.hi)}
                  </span>
                </>
              )}
              <br />
              <span className="period">
                {e.c}{e.ow ? ' · jednokierunkowa' : ''}
                {daily ? ' · doba' : ' · 6–10 i 15–19'}
              </span>
            </Tooltip>
          </Polyline>
        )
      })}
    </LayerGroup>
  )
}
