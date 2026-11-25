// What is on the map right now, in short: a row a choice, with the way to undo
// the ones that can be undone.
import { fmt, fmtEst } from '@bartor-net/ui-kit'
import { VIEWS, NET_MODES, ROAD_METRICS, coverageGap, markerIndex } from './data'
import { fullName, isNone, onMean, pickWarning } from './answers'
import { SHOW, WAYS, painted } from './TripsView'
import { namesOf } from './ClosureView'
import { placeName } from './trips'

const plural = (n, one, some, many) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? some : many)
const few = (list, k = 3) => (list.length > k ? `${list.slice(0, k).join(', ')} i ${list.length - k} więcej` : list.join(', '))

function ofTrips({ x, t, setT, period, spots }) {
  const { S, stats, places, show } = x
  const rows = [
    { label: 'Dane', value: S.freight ? 'przewozy towarów' : 'podróże mieszkańców' },
    { label: 'Okres', value: period },
    { label: 'Widok', value: `${SHOW[show].label.toLowerCase()}, ${t.level === 'd' ? 'osiedla i gminy' : 'rejony'}` },
    { label: places.length > 1 ? 'Zaznaczone' : 'Obszar', value: places.length ? few(places.map(placeName)) : 'wszystkie',
      clear: places.length ? () => setT((q) => ({ ...q, picked: [] })) : null },
    { label: 'Czyje', value: WAYS.find((w) => w[0] === x.way)[1] },
  ]
  if (show === 'areas') {
    const p = painted(x)
    rows.push({ label: 'Kolor', value: x.partner && !p.stat ? `druga strona podróży, ${p.unit}` : p.title,
      clear: t.paint !== 'any' ? () => setT((q) => ({ ...q, paint: 'any' })) : null })
  }
  for (const d of S.D) {
    const on = t.filters[d.key]
    if (!on?.length) continue
    rows.push({ label: d.label, value: few(on.map((i) => d.options[i]?.label), 4), filter: true,
      clear: () => setT((q) => { const { [d.key]: _, ...rest } = q.filters; return { ...q, filters: rest } }) })
  }
  if (t.filters.easy?.length) {
    rows.push({ label: 'Tylko', value: 'z wygody lub dla czasu, do 5 km albo centrum', filter: true,
      clear: () => setT((q) => { const { easy: _, ...rest } = q.filters; return { ...q, filters: rest } }) })
  }
  if (t.filters.spot && spots) {
    rows.push({ label: 'Cel', value: spots[t.filters.spot[0]]?.name, filter: true,
      clear: () => setT((q) => { const { spot: _, ...rest } = q.filters; return { ...q, filters: rest } }) })
  }
  rows.push({ label: 'Próba', value: S.freight ? `${fmt(stats.n)} przejazdów`
    : `${fmt(stats.n)} podróży, ${fmtEst(stats.w)} na dobę`, warn: stats.n < 100 })
  return rows
}

function ofAnswers({ x, setA }) {
  const { A, Z, a, q, group, opts, city } = x
  const level = a.level === 'd' ? 'd' : 'z'
  const p = a.place && (level === 'd' ? Z.districts : Z.zones).find((y) => y.key === a.place)
  return [
    { label: 'Pytanie', value: fullName(q) },
    { label: 'Odpowiedź', value: onMean(q, opts) ? 'średnia' : isNone(q, opts) ? 'nie wybrano' : few(opts.map((o) => q.options[o]), 4),
      warn: !!pickWarning(q, opts) },
    { label: 'Kto', value: A.groups.find((g) => g.key === group).label, clear: group !== 'all' ? () => setA((s) => ({ ...s, group: 'all' })) : null },
    { label: 'Widok', value: { d: 'osiedla', z: 'rejony', h: `wygładzony, ok. ${String(a.km).replace('.', ',')} km` }[a.level] },
    ...(q.opinion ? [{ label: 'Ankieter', value: a.raw ? 'bez korekty' : 'skorygowane', clear: a.raw ? () => setA((s) => ({ ...s, raw: false })) : null }] : []),
    ...(p ? [{ label: 'Obszar', value: p.name, clear: () => setA((s) => ({ ...s, place: null })) }] : []),
    { label: 'Próba', value: `${fmt(city?.[0])} ${q.home ? 'gospodarstw' : 'osób'} we Wrocławiu` },
  ]
}

function ofClosure({ x, setC }) {
  const { c } = x
  const names = (ids) => few(namesOf(x, ids).map((s) => s.name))
  return [
    { label: 'Okres', value: '6–10 i 15–19, model' },
    { label: 'Zamknięte', value: c.closed.length ? names(c.closed) : 'nic', clear: c.closed.length ? () => setC((q) => ({ ...q, closed: [] })) : null },
    ...(c.narrow.length ? [{ label: 'Zwężone', value: names(c.narrow), clear: () => setC((q) => ({ ...q, narrow: [] })) }] : []),
    { label: 'Znika', value: `${Math.round(100 * c.reduce)}% przejazdów`, clear: c.reduce ? () => setC((q) => ({ ...q, reduce: 0 })) : null },
    { label: 'Mapa', value: x.result ? 'zmiana ruchu' : 'ruch dziś', warn: x.stale, note: x.stale ? 'wynik nieaktualny' : null },
  ]
}

function ofCounts({ data, view, period, hours, wholeDay, setWholeDay, people, metric, setMetric, areas, setAreas, aggregate, markers, off, setOff }) {
  const V = VIEWS[view]
  const drawn = V.layers.flatMap((k) => markers[k] || [])
  const gap = ['pt', 'bike', 'ped', 'rail'].some((k) => V.layers.includes(k) && coverageGap(data.meta, k, hours))
  return [
    { label: 'Okres', value: wholeDay ? `${period}, przeliczone na dobę` : period, warn: gap, note: gap ? 'poza godzinami pomiaru' : null,
      clear: wholeDay ? () => setWholeDay(false) : null },
    ...(V.layers.includes('road') ? [{ label: 'Miara', value: people ? 'osoby' : ROAD_METRICS[metric].label.toLowerCase(),
      clear: !people && metric !== 'all' ? () => setMetric('all') : null }] : []),
    ...(aggregate && !V.split ? [{ label: 'Punkty', value: 'złączone w węzły' }] : []),
    { label: 'Na mapie', value: `${fmt(drawn.length)} ${plural(drawn.length, 'punkt', 'punkty', 'punktów')}`, warn: !drawn.length },
    ...(areas ? [{ label: 'Kordony', value: few(areas, 5), clear: () => setAreas(null) }] : []),
    ...(off.size ? [{ label: 'Pominięte', value: `${off.size} ${plural(off.size, 'odcinek lub kierunek', 'odcinki lub kierunki', 'odcinków lub kierunków')}`, clear: () => setOff(new Set()) }] : []),
  ]
}

/** Title and rows for whatever is open. */
export function showing(s) {
  const V = VIEWS[s.view]
  const rows = s.view === 'trips' ? s.tripsX && ofTrips({ x: s.tripsX, t: s.trip, setT: s.setTrip, period: s.period, spots: s.spots })
    : s.view === 'answers' ? s.askX && ofAnswers({ x: s.askX, setA: s.setAsk })
      : s.view === 'closure' ? s.closureX && ofClosure({ x: s.closureX, setC: s.setClosure })
                : V.own ? [{ label: 'Okres', value: V.period ? s.period : 'te same godziny w obu badaniach' },
          ...(s.ownName ? [{ label: 'Zaznaczone', value: s.ownName, clear: s.clearOwn }] : [])]
          : ofCounts(s)
  if (!rows) return null
  const m = s.selected && markerIndex(s.markers)[`${s.selected.kind}:${s.selected.id}`]
  const name = s.selected && (m?.title || m?.name || s.selected.ref?.name || s.selected.ref?.title || s.selected.id)
  return {
    title: V.label,
    color: V.color,
    rows: [
      ...rows,
      ...(s.selected ? [{ label: 'Zaznaczone', value: name, clear: s.close }] : []),
      ...(s.net.on ? [{ label: 'Model sieci', value: NET_MODES[s.net.mode].label.toLowerCase(), clear: () => s.setNet((n) => ({ ...n, on: false })) }] : []),
      ...(s.sig.on ? [{ label: 'Sygnalizacja', value: 'pokazana', clear: () => s.setSig((n) => ({ ...n, on: false })) }] : []),
    ],
  }
}
