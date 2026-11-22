import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer, TileLayer, CircleMarker, Marker, Tooltip, LayerGroup, Polyline, Pane, useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import NetworkLayer, { NETWORK_LEGEND } from './NetworkLayer'
import SignalsLayer from './SignalsLayer'
import { BASEMAPS } from './basemaps'
import {
  LAYERS, MODES, radius, fmt, fmtEst, expansionOf, coverageGap, BASIS_LABEL, windowKind,
  periodShare, NET_MODES, markerIndex, splitTotal, headline, HOUR_LABEL,
  sectionLetter, sectionOf, pieceKey, dirKeys, BEARING,
} from './data'
import { pieSvg, labelLines, labelHtml, labelBox } from './pie'

const CENTRE = [51.1097, 17.0324]
const MAX_ZOOM = 20

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
    // On phones the details sheet covers the bottom of the map, so aim for
    // the middle of the strip above it. The panel loads on its own; when it
    // is not there yet (a link opened cold), assume its full 72% height.
    const cover = isPhone()
      ? document.querySelector('.details')?.offsetHeight || Math.round(window.innerHeight * 0.72)
      : 0
    const at = map.latLngToContainerPoint([m.lat, m.lon])
    const padX = size.x * 0.15
    const padY = (size.y - cover) * 0.15
    if (at.x > padX && at.x < size.x - padX
      && at.y > padY && at.y < size.y - cover - padY) return
    const zoom = Math.max(map.getZoom(), 15)
    const center = map.unproject(map.project([m.lat, m.lon], zoom).add([0, cover / 2]), zoom)
    try {
      map.flyTo(center, zoom, { duration: 0.6 })
    } catch {
      map.setView(center, zoom)
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

  // Their own pane, above every marker: a label is read on top of the pies
  // and section dots it sits beside, never under them. Below tooltips.
  return (
    <Pane name="node-labels" style={{ zIndex: 620, pointerEvents: 'none' }}>
      {placed.map((e) => <NodeLabel key={e.key} e={e} />)}
    </Pane>
  )
}

/** One label. Its icon is rebuilt only when its text or offset change: a new
 *  icon makes Leaflet replace the element, and every pan re-placed them all. */
const NodeLabel = memo(function NodeLabel({ e }) {
  const icon = useMemo(() => L.divIcon({
    className: 'node-label', html: e.html,
    iconSize: [e.box.w, e.box.h], iconAnchor: [-(e.r + 5), e.box.h / 2],
  }), [e.html, e.box.w, e.box.h, e.r])
  return (
    <Marker position={[e.lat, e.lon]} interactive={false} keyboard={false}
      pane="node-labels" icon={icon} />
  )
})

/** Colour key for whatever is currently drawn. Size encodes volume, which a
 *  colour swatch cannot show, so that is stated in words. */
const isPhone = () => typeof window !== 'undefined'
  && window.matchMedia('(max-width: 760px)').matches

function MapLegend({ visible, net, sig, pies, people }) {
  // collapsible; on a phone it starts folded, since it would cover the map
  const [open, setOpen] = useState(() => !isPhone())
  const layers = Object.entries(LAYERS).filter(([k]) => visible[k] && k !== 'survey')
  if (!layers.length && !net.on && !sig?.on) return null
  if (!open) {
    return (
      <button type="button" className="map-legend legend-closed" onClick={() => setOpen(true)}>
        Legenda
      </button>
    )
  }
  return (
    <div className="map-legend">
      <button type="button" className="legend-close" aria-label="Zwiń legendę"
        onClick={() => setOpen(false)}>×</button>
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
        {pies ? 'wielkość koła = liczba osób w węźle'
          : people ? 'wielkość znacznika = liczba osób, wspólna skala'
            : 'wielkość znacznika = natężenie, osobno dla każdej warstwy'}
      </span>
    </div>
  )
}

function SplitTooltip({ m, titled }) {
  const total = splitTotal(m.split)
  const rows = [...m.split.slices].filter((s) => s.persons > 0)
    .sort((a, b) => b.persons - a.persons)
  return (
    <>
      <br /><span className="period">
        podział modalny{titled ? '' : `, osoby · ${hoursText(m.split.hours)}`}
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

const DOT = 22 // section dot size, px

/**
 * Nudge dots, in screen pixels, until none sits under the node's marker or on
 * another dot. Positions are good to ten metres or so anyway, and a dot you
 * cannot see or click is worse than one drawn a few metres off. Done in
 * pixels, so it holds at every zoom.
 */
function dodge(map, node, nodeR, dots) {
  const c = map.latLngToLayerPoint([node.lat, node.lon])
  const clear = nodeR + DOT / 2 + 4
  const pts = dots.map((d, i) => {
    const p = map.latLngToLayerPoint([d.lat, d.lon])
    // straight out from the node; dots right on top of it fan out by index
    let v = p.subtract(c)
    if (v.x * v.x + v.y * v.y < 1) {
      const a = (2 * Math.PI * i) / dots.length - Math.PI / 2
      v = L.point(Math.cos(a), Math.sin(a))
    }
    const len = Math.hypot(v.x, v.y)
    return len < clear ? c.add(v.multiplyBy(clear / len)) : p
  })
  // a few passes pushing overlapping dots apart
  for (let pass = 0; pass < 8; pass++) {
    let moved = false
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const v = pts[j].subtract(pts[i])
        const d = Math.hypot(v.x, v.y)
        if (d >= DOT + 2) continue
        const u = d < 0.5 ? L.point(1, 0) : v.multiplyBy(1 / d)
        const push = u.multiplyBy((DOT + 2 - d) / 2)
        pts[i] = pts[i].subtract(push)
        pts[j] = pts[j].add(push)
        moved = true
      }
    }
    if (!moved) break
  }
  return dots.map((d, i) => {
    const ll = map.layerPointToLatLng(pts[i])
    return { ...d, lat: ll.lat, lon: ll.lng }
  })
}

/**
 * The pieces of the selected node, each at its own position and tied to it:
 * road sections as round dots, the paired transit stops as square ones. Only
 * drawn when points are shown whole - drawn apart they are on the map already.
 */
function SectionDots({ data, family, nodeR, selected, onSelect, off, hot, setHot }) {
  const map = useMap()
  // re-place on zoom: the dodge is in pixels
  const [, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  if (!family?.node) return null
  const { node, groups } = family
  const dots = dodge(map, node, nodeR || 10, groups.flatMap((g) => g.members
    .filter((m) => m.lat).map((m) => ({ kind: g.kind, m, lat: m.lat, lon: m.lon }))))
  return (
    <LayerGroup>
      {dots.map(({ kind, m, lat, lon }) => (
        <SectionDot key={`${kind}:${m.id}`} kind={kind} m={m} lat={lat} lon={lon} node={node}
          on={selected?.kind === kind && selected.id === m.id}
          out={!!off?.has(pieceKey(kind, m.id))}
          hot={hot?.kind === kind && hot.id === m.id} hotDir={hot?.dir}
          dirs={dirKeys(data, kind, m).join()}
          onSelect={onSelect} setHot={setHot} />
      ))}
    </LayerGroup>
  )
}

const MOUSE = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

// the two ways of a section, coloured as their bar segments in the panel
const DIR_COLORS = ['#e4572e', '#f4a261']
const ARROWS_SIZE = 84

/**
 * A section's directions as arrows around its dot, each keeping to the right
 * of the dot as traffic keeps right, so a two-way street reads as two lanes.
 * With one direction lit, the other fades.
 */
function arrowsSvg(dirs, lit) {
  const c = ARROWS_SIZE / 2
  const x = c + 16                      // right of the dot, before rotating
  const ink = '#14161a'
  const ways = dirs.split(',').map((k, i) => {
    const turn = BEARING[k.split('>')[1]]
    if (turn == null) return ''
    const col = DIR_COLORS[i] || DIR_COLORS[1]
    return `<g transform="rotate(${turn} ${c} ${c})" opacity="${!lit || lit === k ? 1 : 0.2}">`
      + `<path d="M${x} ${c + 17}V${c - 8}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`
      + `<path d="M${x - 7} ${c - 7}L${x} ${c - 20}L${x + 7} ${c - 7}Z" fill="${col}" `
      + `stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>`
      + `<path d="M${x} ${c + 17}V${c - 7}" stroke="${col}" stroke-width="3" stroke-linecap="round"/>`
      + '</g>'
  }).join('')
  return `<svg width="${ARROWS_SIZE}" height="${ARROWS_SIZE}" fill="none">${ways}</svg>`
}

/** The arrows of a hovered section, under its dot and out of the mouse's way. */
function DirArrows({ lat, lon, dirs, lit }) {
  const icon = useMemo(() => L.divIcon({
    className: 'dir-arrows', html: arrowsSvg(dirs, lit),
    iconSize: [ARROWS_SIZE, ARROWS_SIZE], iconAnchor: [ARROWS_SIZE / 2, ARROWS_SIZE / 2],
  }), [dirs, lit])
  if (!dirs) return null
  return <Marker position={[lat, lon]} icon={icon} interactive={false} keyboard={false}
    zIndexOffset={900} />
}

/** Arrows for a hovered piece drawn as its own marker, not as a node's dot. */
function HotArrows({ data, index, hot, family }) {
  if (!hot || family?.node) return null
  const m = index[`${hot.kind}:${hot.id}`]
  if (!m?.lat) return null
  return <DirArrows lat={m.lat} lon={m.lon} dirs={dirKeys(data, hot.kind, m.ref || m).join()}
    lit={hot.dir} />
}

/** One piece of the selected node. The icon is kept while only the hover
 *  changes: a new icon is a new element under the mouse, which fires
 *  mouseout and mouseover again and flickers. Hover is a class instead. */
function SectionDot({ kind, m, lat, lon, node, on, out, hot, hotDir, dirs, onSelect, setHot }) {
  const color = LAYERS[kind].color
  const letter = sectionLetter(m.id) || '·'
  const icon = useMemo(() => L.divIcon({
    className: 'sec-dot-icon',
    html: `<span class="sec-dot ${kind}${on ? ' on' : ''}${out ? ' out' : ''}" `
      + `style="--c:${color}">${letter}</span>`,
    iconSize: [22, 22], iconAnchor: [11, 11],
  }), [kind, on, out, color, letter])
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.getElement()?.querySelector('.sec-dot')?.classList.toggle('hot', hot)
  }, [hot, icon])
  const handlers = useMemo(() => ({
    click: () => onSelect({ kind, id: m.id, ref: m }),
    ...(MOUSE && setHot ? {
      mouseover: () => setHot({ kind, id: m.id }),
      mouseout: () => setHot(null),
    } : {}),
  }), [kind, m, onSelect, setHot])
  return (
    <>
      <Polyline positions={[[node.lat, node.lon], [lat, lon]]} interactive={false}
        pathOptions={{
          color, weight: hot ? 2.5 : 1.5, opacity: hot ? 1 : out ? 0.2 : 0.7, dashArray: '3 4',
        }} />
      <Marker ref={ref} position={[lat, lon]} zIndexOffset={1000} eventHandlers={handlers}
        icon={icon}>
        <Tooltip>
          {kind === 'pt' ? 'przystanek · ' : 'przekrój drogowy · '}
          {m.id} · {sectionOf(kind, m) || m.name}
          {out ? ' · wyłączony z węzła' : ''}
        </Tooltip>
      </Marker>
      {hot && <DirArrows lat={lat} lon={lon} dirs={dirs} lit={hotDir} />}
    </>
  )
}

/**
 * One drawn point: a pie for a node, a circle otherwise. Memoised, so a hover
 * or a sheet opening does not redraw 150 pies - and a pie's icon is kept until
 * its split, size or highlight change, since a new icon replaces the element.
 */
const PointMarker = memo(function PointMarker({
  kind, m, r, on, people, period, wholeDay, meta, hours, onSelect,
}) {
  const icon = useMemo(() => (m.split ? L.divIcon({
    className: 'pie-icon', html: pieSvg(m.split, r, on),
    iconSize: [2 * r + 6, 2 * r + 6], iconAnchor: [r + 3, r + 3],
  }) : null), [m.split, r, on])
  const click = useMemo(() => ({ click: () => onSelect({ kind, id: m.id, ref: m.ref }) }),
    [onSelect, kind, m])
  const wk = windowKind(kind, m.ref)
  // the pie's total, so the headline and the slices add up
  const all = headline(m, people) !== m.value
  const tip = (
    <Tooltip>
      <b>{m.title}</b><br />
      {all ? (
        <>
          {fmtEst(headline(m, people))} osób — wszystkie środki
          <span className="period"> · {hoursText(m.split.hours)}</span>
        </>
      ) : (
        <>
          {fmt(m.value)}{' '}
          {people && kind === 'road' ? 'osób w samochodach' : LAYERS[kind].unit}
          <span className="period"> · {period}</span>
        </>
      )}
      {wholeDay && expansionOf(meta, wk)?.factor > 1 && (
        <><br /><span className="period">
          oszacowanie doby (×{expansionOf(meta, wk).factor},{' '}
          {BASIS_LABEL[expansionOf(meta, wk).basis]}) —
          zmierzono {fmt(m.raw)}
        </span></>
      )}
      {!wholeDay && !m.split && coverageGap(meta, wk, hours) && (
        <><br /><span className="warn">
          pomiar tylko w szczytach — brak danych dla
          {' '}{coverageGap(meta, wk, hours).missing.length} z
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
      {m.split && <SplitTooltip m={m} titled={all} />}
    </Tooltip>
  )
  if (m.split) {
    return (
      <Marker position={[m.lat, m.lon]} eventHandlers={click} icon={icon}>
        {tip}
      </Marker>
    )
  }
  return (
    <CircleMarker
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
})

export default function MapView({
  data, visible, hours, period, wholeDay, people, net, nets, basemap, sig,
  markers, labels, selected, onSelect, family, off, hot, setHot,
}) {
  const index = useMemo(() => markerIndex(markers), [markers])
  // The model was fitted on the 8-hour common window; scale it to whatever
  // period is selected using the measured city-wide daily shape.
  const netShare = periodShare(data.meta, hours)

  // Radius per marker, needed both to draw it and to offset its label.
  // A pie shows everyone passing the node, so it is sized by everyone - not by
  // the road layer's own value, which in people mode is car occupants only and
  // made transit-heavy nodes look small.
  //
  // When counting people every layer is in people, so pies and plain circles
  // all share one scale. Sized per layer instead, a stop's circle was measured
  // against the busiest interchange and a road's against the busiest road, and
  // transit looked small next to roads only to jump in size as a pie.
  // Counting vehicles, the layers have different units and keep their own.
  const radii = useMemo(() => {
    const r = {}
    const size = (m) => (m.split ? splitTotal(m.split) : m.value)
    const all = Object.values(markers).flat()
    const common = Math.max(1, ...all.filter((m) => people || m.split).map(size))
    for (const [kind, list] of Object.entries(markers)) {
      const own = Math.max(1, ...list.map((m) => m.value))
      for (const m of list) {
        r[`${kind}:${m.id}`] = people || m.split
          ? radius(size(m), common, m.split ? 7 : 4, 24)
          : radius(m.value, own)
      }
    }
    return r
  }, [markers, people])

  const pies = Object.values(markers).some((list) => list.some((m) => m.split))

  const labelEntries = useMemo(() => {
    if (!labels.num && !labels.pct) return []
    const out = []
    for (const [kind, list] of Object.entries(markers)) {
      const unit = people && kind === 'road' ? 'os.' : LAYERS[kind].unit
      for (const m of list) {
        const lines = labelLines(m, labels, unit)
        if (!lines.length) continue
        out.push({
          key: `${kind}:${m.id}`, lat: m.lat, lon: m.lon, r: radii[`${kind}:${m.id}`],
          html: labelHtml(lines), box: labelBox(lines),
          weight: m.split ? splitTotal(m.split) : m.value,
        })
      }
    }
    return out
  }, [markers, labels, radii, people])

  return (
    <div className="map-wrap">
      {/* Sections of one point sit metres apart, so the map zooms past the
          basemap's own tiles; beyond its native zoom Leaflet scales them up. */}
      <MapContainer className={BASEMAPS[basemap].dark ? 'map dark' : 'map'}
        center={CENTRE} zoom={12} maxZoom={MAX_ZOOM}>
        <TileLayer key={basemap} url={BASEMAPS[basemap].url}
          attribution={BASEMAPS[basemap].attribution}
          maxZoom={MAX_ZOOM} maxNativeZoom={BASEMAPS[basemap].maxZoom || 19} />
        {BASEMAPS[basemap].labels && (
          <TileLayer key={`${basemap}-labels`} url={BASEMAPS[basemap].labels}
            pane="shadowPane" maxZoom={MAX_ZOOM}
            maxNativeZoom={BASEMAPS[basemap].maxZoom || 19} />
        )}

        <FlyToSelection selected={selected} index={index} />

        {net.on && nets[NET_MODES[net.mode].file] && (
          <NetworkLayer key={net.mode} network={nets[NET_MODES[net.mode].file]}
            share={netShare} hours={hours} minVolume={net.min}
            unit={NET_MODES[net.mode].unit}
            measured={!!NET_MODES[net.mode].measured} />
        )}

        {sig?.on && data.signals && (
          <SignalsLayer signals={data.signals} filter={sig.filter} share={netShare}
            onSelect={onSelect} selected={selected} />
        )}

        {visible.survey && data.survey && (
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
            {list.map((m) => (
              <PointMarker key={m.id} kind={kind} m={m} r={radii[`${kind}:${m.id}`]}
                // a node stays lit while one of its pieces is open
                on={!!selected && ((selected.kind === kind && selected.id === m.id)
                  || (family?.node === m && !!family.current))}
                people={people} period={period} wholeDay={wholeDay} meta={data.meta}
                hours={hours} onSelect={onSelect} />
            ))}
          </LayerGroup>
        ))}

        <HotArrows data={data} index={index} hot={hot} family={family} />
        <SectionDots data={data} family={family} selected={selected} onSelect={onSelect} off={off}
          hot={hot} setHot={setHot}
          nodeR={family?.node ? radii[`${family.node.kind}:${family.node.id}`] : 0} />

        {(labels.num || labels.pct) && (
          <NodeLabels entries={labelEntries} declutter={labels.declutter} />
        )}
      </MapContainer>
      <MapLegend visible={visible} net={net} sig={sig} pies={pies} people={people} />
    </div>
  )
}
