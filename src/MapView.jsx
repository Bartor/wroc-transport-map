import { memo, useCallback, useMemo } from 'react'
import {
  fmt, fmtEst, hourRuns, labelBox, labelHtml, pieceKey, sqrtRadius,
} from '@bartor-net/ui-kit'
import {
  BaseMap, CircleLayer, FlyTo, HotArrows, Layer, MapLabels, MapLegend, MapTooltip, PieceDots,
  PointMarker, TipNote, TipRow, TipWarn,
} from '@bartor-net/ui-kit/map'
import NetworkLayer, { NETWORK_LEGEND } from './NetworkLayer'
import SignalsLayer from './SignalsLayer'
import {
  LAYERS, MODES, expansionOf, coverageGap, BASIS_LABEL, windowKind,
  periodShare, NET_MODES, markerIndex, splitTotal, headline,
  sectionLetter, sectionOf, dirKeys,
} from './data'
import { labelLines } from './labels'
import { MapKeys } from './MapKeys'
import { WorksLayer } from './WorksLayer'
import { WORKS_COLOR } from './works'

const CENTRE = [51.1097, 17.0324]

const hoursText = (hours) => hourRuns(hours, 'brak godzin wspólnych')

/** Colour key for whatever is currently drawn. Size encodes volume, which a
 *  colour swatch cannot show, so that is stated in words. */
function legendItems({ visible, net, sig, pies, people }) {
  const layers = Object.entries(LAYERS).filter(([k]) => visible[k] && k !== 'survey')
  if (!layers.length && !net.on && !sig?.on) return []
  return [
    ...(pies ? [
      { title: 'Podział modalny węzła (osoby)' },
      ...MODES.map((m) => ({ label: m.label, color: m.color })),
      { note: 'bez pieszych — nie liczono ich na przekrojach drogowych' },
    ] : layers.map(([, v]) => ({ label: v.label, color: v.color }))),
    ...(sig?.on ? [{ label: 'sygnalizacja', color: '#2fbf71' }] : []),
    ...(net.on ? NETWORK_LEGEND.map((l) => ({ ...l, line: true })) : []),
    ...(!layers.length ? [] : [{
      note: pies ? 'wielkość koła = liczba osób w węźle'
        : people ? 'wielkość znacznika = liczba osób, wspólna skala'
          : 'wielkość znacznika = natężenie, osobno dla każdej warstwy',
    }]),
  ]
}

function SplitTip({ m, titled }) {
  const total = splitTotal(m.split)
  const rows = [...m.split.slices].filter((s) => s.persons > 0)
    .sort((a, b) => b.persons - a.persons)
  return (
    <>
      <br /><TipNote>
        podział modalny{titled ? '' : `, osoby · ${hoursText(m.split.hours)}`}
      </TipNote>
      {rows.map((s) => (
        <TipRow key={s.key} color={s.color} label={s.label}
          value={s.est ? fmtEst(s.persons) : fmt(s.persons)}
          share={`${Math.round((100 * s.persons) / total)}%`} />
      ))}
      {m.pair && (
        <TipNote>
          napełnienie KZ z punktu {m.pair.title} ({m.pair.dist} m)
        </TipNote>
      )}
      {m.split.basis === 'estimate' && (
        <TipNote>autobusy i tramwaje szacowane z liczby pojazdów</TipNote>
      )}
    </>
  )
}

/** One drawn point: a pie for a node, a circle otherwise. Memoised, so a hover
 *  or a sheet opening does not redraw 150 pies. */
const Point = memo(function Point({
  kind, m, r, on, people, period, wholeDay, meta, hours, onSelect,
}) {
  const slices = useMemo(
    () => m.split?.slices.map((s) => ({ color: s.color, value: s.persons })),
    [m.split],
  )
  const pick = useCallback(() => onSelect({ kind, id: m.id, ref: m.ref }), [onSelect, kind, m])
  const wk = windowKind(kind, m.ref)
  // the pie's total, so the headline and the slices add up
  const all = headline(m, people) !== m.value
  const tip = (
    <MapTooltip>
      <b>{m.title}</b><br />
      {all ? (
        <>
          {fmtEst(headline(m, people))} osób — wszystkie środki
          <TipNote> · {hoursText(m.split.hours)}</TipNote>
        </>
      ) : (
        <>
          {fmt(m.value)}{' '}
          {people && kind === 'road' ? 'osób w samochodach' : LAYERS[kind].unit}
          <TipNote> · {period}</TipNote>
        </>
      )}
      {wholeDay && expansionOf(meta, wk)?.factor > 1 && (
        <><br /><TipNote>
          oszacowanie doby (×{expansionOf(meta, wk).factor},{' '}
          {BASIS_LABEL[expansionOf(meta, wk).basis]}) —
          zmierzono {fmt(m.raw)}
        </TipNote></>
      )}
      {!wholeDay && !m.split && coverageGap(meta, wk, hours) && (
        <><br /><TipWarn>
          pomiar tylko w szczytach — brak danych dla
          {' '}{coverageGap(meta, wk, hours).missing.length} z
          {' '}{hours.length} godzin okresu
        </TipWarn></>
      )}
      {m.sub && <><br /><TipNote>{m.sub}</TipNote></>}
      {m.ref?.repeatsStreet && (
        <><br /><TipWarn>
          przekroje po obu stronach skrzyżowania — jadący na wprost
          liczeni dwa razy, suma zawyżona
        </TipWarn></>
      )}
      {m.split && <SplitTip m={m} titled={all} />}
    </MapTooltip>
  )
  return (
    <PointMarker lat={m.lat} lon={m.lon} r={r} on={on} slices={slices}
      color={LAYERS[kind].color} empty={!m.value} onClick={pick} tip={tip} />
  )
})

/** The pieces of the selected node, as dots: road sections round, the paired
 *  transit stops square. */
const dotsOf = (data, family, selected, off) => family.groups.flatMap((g) => g.members
  .filter((m) => m.lat)
  .map((m) => {
    const out = !!off?.has(pieceKey(g.kind, m.id))
    return {
      kind: g.kind, id: m.id, target: m, lat: m.lat, lon: m.lon,
      color: LAYERS[g.kind].color, letter: sectionLetter(m.id) || '·', square: g.kind === 'pt',
      on: selected?.kind === g.kind && selected.id === m.id, out,
      way: selected?.kind === g.kind && selected.id === m.id ? selected.dir : undefined,
      dirs: dirKeys(data, g.kind, m),
      tip: `${g.kind === 'pt' ? 'przystanek' : 'przekrój drogowy'} · ${m.id} · `
        + `${sectionOf(g.kind, m) || m.name}${out ? ' · wyłączony z węzła' : ''}`,
    }
  }))

export default function MapView({
  data, visible, hours, period, wholeDay, people, net, nets, basemap, sig,
  markers, labels, selected, onSelect, family, off, hot, setHot, own, ownLegend, ownOverlay, info, works, worksAreas,
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
          ? sqrtRadius(size(m), common, m.split ? 7 : 4, 24)
          : sqrtRadius(m.value, own)
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

  const target = useMemo(() => {
    if (!selected) return null
    const m = index[`${selected.kind}:${selected.id}`] || selected.ref
    return m?.lat ? { lat: m.lat, lon: m.lon } : null
  }, [selected, index])

  const network = net.on && nets[NET_MODES[net.mode].file]
  // drawn apart, sections are markers; as pieces of a node they are its dots
  const arrowsAt = (h) => {
    const m = index[`${h.kind}:${h.id}`]
    return m && { lat: m.lat, lon: m.lon, dirs: dirKeys(data, h.kind, m.ref || m) }
  }

  return (
    <BaseMap basemap={basemap} center={CENTRE} overlay={(
      <>
        <MapKeys info={info}>
          <MapLegend items={[...(ownLegend || []), ...legendItems({ visible, net, sig, pies, people }),
            ...(works?.length ? [{ label: 'remont w czasie badań', color: WORKS_COLOR, line: true }, ...(worksAreas?.length ? [{ label: 'osiedla, przez które przebiegał remont lub objazd', color: WORKS_COLOR }] : [])] : [])]} />
        </MapKeys>
        {ownOverlay}
      </>
    )}>
      <FlyTo target={target} />
      {own}
      {works?.length > 0 && <WorksLayer works={works} areas={worksAreas} />}

      {network && (
        <NetworkLayer key={net.mode} network={network}
          share={netShare} hours={hours} minVolume={net.min}
          unit={NET_MODES[net.mode].unit}
          measured={!!NET_MODES[net.mode].measured} />
      )}

      {sig?.on && data.signals && (
        <SignalsLayer signals={data.signals} filter={sig.filter} share={netShare}
          onSelect={onSelect} selected={selected} />
      )}

      {visible.survey && data.survey && (
        <CircleLayer
          points={data.survey.map((s, i) => ({
            key: i, lat: s.lat, lon: s.lon, r: 2.5, s,
            style: { color: LAYERS.survey.color, weight: 0, fillOpacity: 0.55 },
          }))}
          tip={({ s }) => <MapTooltip>punkt startowy ankietera<br />rejon {s.zone}</MapTooltip>} />
      )}

      {Object.entries(markers).map(([kind, list]) => (
        <Layer key={kind}>
          {list.map((m) => (
            <Point key={m.id} kind={kind} m={m} r={radii[`${kind}:${m.id}`]}
              // a node stays lit while one of its pieces is open
              on={!!selected && ((selected.kind === kind && selected.id === m.id)
                || (family?.node === m && !!family.current))}
              people={people} period={period} wholeDay={wholeDay} meta={data.meta}
              hours={hours} onSelect={onSelect} />
          ))}
        </Layer>
      ))}

      {family?.node && !family.lone ? (
        <PieceDots whole={family.node}
          wholeR={radii[`${family.node.kind}:${family.node.id}`] || undefined}
          pieces={dotsOf(data, family, selected, off)} hot={hot} setHot={setHot} onPick={onSelect} />
      ) : <HotArrows hot={hot || (selected?.dir ? selected : null)} find={arrowsAt} />}

      {(labels.num || labels.pct) && (
        <MapLabels entries={labelEntries} declutter={labels.declutter} />
      )}
    </BaseMap>
  )
}
