// Three smaller surveys: the same roads counted in 2018 and 2024, boardings at
// stations, and travel times on 46 stretches of road.
import { useMemo } from 'react'
import {
  Hint, LinkButton, Panel, RankList, TextTable, Warn, csvNumber as num, downloadCsv, fmt, sqrtRadius,
} from '@bartor-net/ui-kit'
import { CircleLayer, LineLayer, MapTooltip, TipNote } from '@bartor-net/ui-kit/map'
import { diverging, rgb } from './answers'
import { ringChanges } from './compare'

export const sum = (arr, hours) => hours.reduce((a, h) => a + (arr[h] || 0), 0)
export const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(100 * x))}%`

// --------------------------------------------------------- 2018 against 2024
// falling is blue, rising orange, +-40% is as far as the colours go
export const changeColor = (d) => rgb(diverging(d, 0, 0.4))

export function ChangeMap({ rows, sel, onPick }) {
  const top = Math.max(...rows.map((r) => r.v24))
  const points = useMemo(() => [...rows].sort((a, b) => b.v24 - a.v24).map((r) => ({
    key: `${r.key}${sel?.id === r.key ? '+' : ''}`, lat: r.lat, lon: r.lon, r: sqrtRadius(r.v24, top, 5, 22), row: r,
    style: { color: sel?.id === r.key ? '#fff' : '#0b1016', weight: sel?.id === r.key ? 3 : 1, fillColor: changeColor(r.d), fillOpacity: 0.85 },
  })), [rows, sel, top])
  return (
    <CircleLayer points={points} onPick={(p) => onPick(p.row)} tip={({ row: r }) => (
      <MapTooltip>
        <b>{r.name}</b> <TipNote>{r.ids.join(' + ')}</TipNote><br />
        {fmt(r.v18)} → {fmt(r.v24)} poj. <b>{signed(r.d)}</b><br />
        <TipNote>{r.segment ? `${r.segment} · ` : ''}{r.day ? 'całą dobę' : '5:00–21:00'}</TipNote>
      </MapTooltip>
    )} />
  )
}

export const changeLegend = () => [
  { title: 'Ruch w 2024 wobec 2018' },
  ...[[-0.4, 'spadek 40% i więcej'], [-0.2, 'spadek 20%'], [0, 'bez zmian'], [0.2, 'wzrost 20%'], [0.4, 'wzrost 40% i więcej']]
    .map(([d, label]) => ({ color: changeColor(d), label })),
  { note: 'wielkość koła = ruch w 2024' },
]

export function ChangeControls({ rows, sel, onPick }) {
  const rings = ringChanges(rows)
  const order = [...rows].sort((a, b) => a.d - b.d)
  const item = (r) => ({ key: r.key, title: r.name, sub: `${r.ids.join(' + ')} · ${fmt(r.v18)} → ${fmt(r.v24)}`,
    value: signed(r.d), on: sel?.id === r.key, onPick: () => onPick(r) })
  return (
    <Panel title="Zmiana 2018 → 2024" help={(
      <>
        <p>{rows.length} miejsc policzonych w obu rundach KBR, w tych samych godzinach (zał. 3.3, „Porównanie KBR”).</p>
        <p>
          To pojedyncze dni, a między rundami otwarto m.in. aleję Wielkiej Wyspy, zmieniła się też praca
          zdalna i organizacja ruchu. Spadek w punkcie może oznaczać mniej ruchu albo ruch gdzie indziej —
          obwodnica urosła o 22%.
        </p>
        <p>
          W tekście raportu trzy największe spadki mają pomylone nazwy ulic; tu obowiązują numery punktów.
        </p>
      </>
    )}>
      <TextTable head={['obszar', 'punktów', '2018', '2024', 'zmiana']}
        rows={rings.map((r) => [r.label, `${r.n}`, fmt(r.v18), fmt(r.v24), <b key="d">{signed(r.d)}</b>])} />
      <Hint>Suma pojazdów w punktach wspólnych, nie w całym obszarze.</Hint>
      <h3>Największe spadki</h3>
      <RankList items={order.slice(0, 6).map(item)} />
      <h3>Największe wzrosty</h3>
      <RankList items={order.slice(-6).reverse().map(item)} />
      <LinkButton block onClick={() => downloadCsv([
        ['przekrój', 'nazwa', 'odcinek', '2010', '2018', '2024', 'zmiana 2018–2024 [%]', 'godziny'],
        ...rows.map((r) => [r.ids.join(' + '), r.name, r.segment, r.v10 ?? '', r.v18, r.v24, num(100 * r.d, 1), r.day ? '24 h' : '5:00–21:00']),
      ], 'kbr-zmiana-2018-2024.csv')}>Pobierz porównanie (CSV)</LinkButton>
    </Panel>
  )
}

// ------------------------------------------------------------------- stations
const PEAKS = [6, 7, 8, 14, 15, 16, 17]
export const KIND = { rail: { label: 'Stacje kolejowe', color: '#7048e8' }, bus: { label: 'Dworce autobusowe', color: '#c98500' } }
export const airportYear = (S) => S.airport.months.reduce((a, m) => a + m[1] + m[2], 0)

export function StationsMap({ S, hours, sel, onPick }) {
  const list = S.stations.map((s) => ({ s, v: sum(s.on, hours) + sum(s.off, hours) }))
  const top = Math.max(1, ...list.map((x) => x.v))
  return (
    <>
      <CircleLayer points={list.filter((x) => x.s.lat).map(({ s, v }) => ({
        key: `${s.name}${sel?.id === s.name ? '+' : ''}`, lat: s.lat, lon: s.lon, r: sqrtRadius(v, top, 4, 26), s, v,
        style: { color: sel?.id === s.name ? '#fff' : '#0b1016', weight: sel?.id === s.name ? 3 : 1, fillColor: KIND[s.kind].color, fillOpacity: v ? 0.85 : 0.2 },
      }))} onPick={(p) => onPick(p.s.name)} tip={({ s, v }) => (
        <MapTooltip><b>{s.name}</b><br />{fmt(v)} wsiadających i wysiadających<br />
          <TipNote>{fmt(sum(s.on, hours))} wsiadło · {fmt(sum(s.off, hours))} wysiadło</TipNote></MapTooltip>
      )} />
      <CircleLayer points={[{ key: `air${sel?.id === 'air' ? '+' : ''}`, lat: S.airport.lat, lon: S.airport.lon, r: 12,
        style: { color: sel?.id === 'air' ? '#fff' : '#0b1016', weight: sel?.id === 'air' ? 3 : 1, fillColor: '#6b7385', fillOpacity: 0.9 } }]}
        onPick={() => onPick('air')} tip={() => (
          <MapTooltip><b>Port lotniczy</b><br />{fmt(airportYear(S))} pasażerów w roku</MapTooltip>
        )} />
    </>
  )
}

export const stationsLegend = () => [
  ...Object.values(KIND).map((k) => ({ label: k.label, color: k.color })),
  { label: 'lotnisko (dane roczne)', color: '#6b7385' },
  { note: 'wielkość koła = wsiadający i wysiadający w okresie' },
]

export function StationsControls({ S, hours, sel, onPick, period }) {
  const missing = hours.filter((h) => !PEAKS.includes(h))
  const list = S.stations.map((s) => ({ s, v: sum(s.on, hours) + sum(s.off, hours) })).sort((a, b) => b.v - a.v)
  return (
    <Panel title={`Dworce i stacje — ${period}`} help={(
      <p>Wsiadający i wysiadający, liczeni w maju 2024 w godzinach 6–9 i 14–18 (zał. 8.1), oraz ruch na lotnisku (zał. 9.1).</p>
    )}>
      {missing.length > 0 && <Warn>Liczono tylko 6–9 i 14–18; reszta okresu to brak pomiaru, nie brak pasażerów.</Warn>}
      <RankList items={list.slice(0, 12).map(({ s, v }) => ({ key: s.name, title: s.name, sub: `${fmt(sum(s.runs, hours))} kursów`,
        value: fmt(v), on: sel?.id === s.name, onPick: () => onPick(s.name) }))} />
      <LinkButton block onClick={() => downloadCsv([
        ['stacja', 'rodzaj', 'data', 'godzina', 'wsiadło', 'wysiadło', 'kursy'],
        ...S.stations.flatMap((s) => PEAKS.map((h) => [s.name, KIND[s.kind].label, s.date, `${h}:00`, s.on[h], s.off[h], s.runs[h]])),
      ], 'kbr-dworce.csv')}>Pobierz (CSV)</LinkButton>
    </Panel>
  )
}

// --------------------------------------------------------------------- speeds
export const speedOf = (s, hours) => {
  let a = 0
  let k = 0
  for (const h of hours) if (s.h[h] != null) { a += s.h[h] * s.k[h]; k += s.k[h] }
  return k ? { v: a / k, k } : null
}
const SLOW = [[0.35, '#d6541c'], [0.55, '#efa364'], [0.75, '#e8d48b'], [9, '#4aa36b']]
const slowColor = (r) => SLOW.find(([b]) => r < b)[1]

export function SpeedsMap({ S, hours, onPick }) {
  const lines = S.sections.map((s) => ({ s, x: speedOf(s, hours) })).map(({ s, x }) => ({
    key: s.id, path: s.g, value: 1, color: x ? slowColor(x.v / s.free) : '#6b7385', s, x,
  }))
  return (
    <>
      <LineLayer lines={lines} width={() => 6} opacity={0.9} tip={({ s, x }) => (
        <MapTooltip sticky><b>{s.name || s.type || `odcinek ${s.poly}`}</b><br />
          {x ? <>{Math.round(x.v)} km/h <TipNote>· w wolnym ruchu {s.free} km/h · {x.k} przejazdów</TipNote></> : <TipNote>brak przejazdów w okresie</TipNote>}
        </MapTooltip>
      )} />
      <CircleLayer points={lines.map(({ s, color }) => ({ key: s.id, lat: s.g[0][0], lon: s.g[0][1], r: 5, s,
        style: { color: '#0b1016', weight: 1, fillColor: color, fillOpacity: 1 } }))} onPick={(p) => onPick(p.s.id)}
        tip={({ s }) => <MapTooltip>{s.name || s.type || `odcinek ${s.poly}`} — początek odcinka</MapTooltip>} />
    </>
  )
}

export const speedsLegend = () => [
  { title: 'Prędkość wobec wolnego ruchu' },
  ...[['poniżej 35%', 0], ['35–55%', 1], ['55–75%', 2], ['75% i więcej', 3]].map(([label, i]) => ({ label, color: SLOW[i][1], line: true })),
  { note: 'kropka = początek odcinka (kierunek jazdy)' },
]

export function SpeedsControls({ S, hours, period, onPick, sel }) {
  const list = S.sections.map((s) => ({ s, x: speedOf(s, hours) })).filter((r) => r.x)
    .map((r) => ({ ...r, r: r.x.v / r.s.free })).sort((a, b) => a.r - b.r)
  return (
    <Panel title={`Prędkości — ${period}`} help={(
      <>
        <p>Czasy przejazdu 69 tys. samochodów na 46 odcinkach (zał. 3.11), zmierzone do wyznaczenia funkcji oporu modelu ruchu miasta. Pokazana jest mediana w każdej godzinie z co najmniej 5 przejazdami.</p>
        <p>To odcinki dobrane po jednym na typ drogi, od 70 m do 14 km, w większości poza centrum — nie mapa korków. Krótkie odcinki przy światłach mierzą głównie postój. Sam raport uznaje część pomiarów za zbyt krótką, by wyznaczyć z nich funkcje.</p>
      </>
    )}>
      <RankList items={list.slice(0, 12).map(({ s, x, r }) => ({ key: s.id, title: s.name || s.type || `odcinek ${s.poly}`,
        sub: `${Math.round(x.v)} km/h, wolny ruch ${s.free} · ${s.m} m`, value: `${Math.round(100 * r)}%`, on: sel?.id === s.id, onPick: () => onPick(s.id) }))} />
    </Panel>
  )
}
