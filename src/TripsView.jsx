// The trips of the household survey (and the freight one): what is filtered,
// and what the map shows. The panel is apart, with the charts.
import { memo, useMemo } from 'react'
import {
  Chips, Field, Hint, LinkButton, Panel, Select, Slider, Toggle, fixed, fmt, fmtEst, labelBox, labelHtml, sqrtRadius,
} from '@bartor-net/ui-kit'
import { CircleLayer, MapLabels, MapTooltip, TipNote, TipRow } from '@bartor-net/ui-kit/map'
import ScenarioPanel from './ScenarioPanel'
import { Small, smallText } from './Small'
import { Arcs, Rings, ZoneLayer } from './ZoneLayer'
import { rng, scatter } from './arcs'
import { DAY_MODES, daysOf } from './days'
import { useHot } from './hot'
import { colorsOf, isOrdered } from './Stack'
import {
  PAINTS, PER, THIN, TRIPS0, TRIP_PRESETS, breaks, countMargin, describe, digitsFor, flowsOf, numberOf, pairs, passing, perPartner,
  perOf, perPlace, perPlaceDim, perSpot, perThousand, placeName, scale, shares, statOf, touching,
} from './trips'

export const pctText = (s) => (s == null ? '—' : s > 0 && s < 0.005 ? '<1%' : `${Math.round(100 * s)}%`)
export const WAYS = [['home', 'mieszkańców obszaru'], ['any', 'wszystkie z i do'], ['from', 'stąd'], ['to', 'tutaj']]
/** The same in a sentence, for a picture. */
export const WAY_TEXT = { home: 'podróże mieszkańców: z domu i do domu', any: 'wszystkie podróże z obszaru i do niego',
  from: 'podróże zaczynane w obszarze', to: 'podróże kończone w obszarze' }
// freight has no residents
const wayIn = (S, t) => (S?.freight && t.way === 'home' ? 'any' : t.way)
const perIn = (S, t) => (S.freight && t.per === 'pop' ? 'abs' : perOf(t.paint, t.per))

// The ways of showing it. A freight run has no day and no spots.
export const SHOW = {
  areas: { label: 'Obszary', note: 'kolor obszaru = liczba lub udział' },
  flows: { label: 'Przepływy', note: 'najczęstsze połączenia między obszarami' },
  trips: { label: 'Pojedyncze podróże', note: 'każda podróż z próby osobno' },
  spots: { label: 'Cele', note: 'miejsca, które odwiedziło co najmniej 5 badanych', people: true },
  days: { label: 'Całe dni', note: 'łańcuchy podróży: dom → praca → zakupy → dom', people: true },
}
const showIn = (S, t) => (S?.freight && SHOW[t.show].people ? 'areas' : t.show)
const MANY_TRIPS = 400
const MANY_DAYS = 220

/** Everything that follows from the settings, for the map and both panels. */
export function useTrips(S, t, hours, spots, days) {
  const passed = useMemo(() => (S ? passing(S, { filters: t.filters, hours }) : []), [S, t.filters, hours])
  const places = useMemo(
    () => (S ? t.picked.map((k) => S.levels[t.level].byKey.get(k)).filter(Boolean) : []),
    [S, t.level, t.picked],
  )
  const zones = useMemo(() => (places.length ? places.flatMap((p) => p.zones) : null), [places])
  const way = wayIn(S, t)
  const show = showIn(S, t)
  const idx = useMemo(() => (S ? touching(S, passed, zones, way) : []), [S, passed, zones, way])
  const stats = useMemo(() => (S ? describe(S, idx) : null), [S, idx])
  const sums = useMemo(() => (S ? perPlace(S, passed, t.level, way) : null), [S, passed, t.level, way])
  const partner = useMemo(
    () => (S && zones ? perPartner(S, idx, zones, t.level, way) : null),
    [S, idx, zones, t.level, way],
  )
  // days with a trip that passes, of the people who live in what is picked
  const dayRows = useMemo(() => (days && S && !S.freight ? daysOf(days, passed, zones) : null), [days, S, passed, zones])
  return useMemo(() => S && { S, t, hours, way, show, passed, places, zones, idx, stats, sums, partner, spots, days, dayRows },
    [S, t, hours, way, show, passed, places, zones, idx, stats, sums, partner, spots, days, dayRows])
}

export const unitOf = (S) => (S.freight ? 'przejazdów w badaniu' : 'podróży/dobę')

/** The panel's statistic that the map is painted by, where its dimension exists. */
export const statIn = (S, t) => {
  const d = S.D.find((q) => q.key === t.stat?.dim) || S.D[0]
  const opts = (t.stat?.opts || []).filter((o) => o < d.options.length)
  // a number is averaged, unless some of its ranges are picked
  return { d, opts, mean: opts.length ? null : numberOf(S, d.key) }
}
// A trip within one zone is 0 km long, and zones outside the city are large.
export const KM_NOTE = 'podróż w obrębie rejonu ma długość 0, więc w dużych rejonach poza centrum krótkich jest za dużo'
export const statText = ({ d, opts, mean }) => (mean ? `${d.label} — średnia` : opts.length ? `${d.label}: ${opts.map((o) => d.options[o].label).join(' + ')}` : `${d.label} — najczęściej`)

/** What each place is painted by: a value, how it reads, its colour, and how
 *  much it rests on - a place with a handful of trips is painted too, only
 *  faintly. */
export function painted({ S, t, sums, partner, idx, passed, zones, way }) {
  const { list } = S.levels[t.level]
  const P = PAINTS[t.paint]
  if (t.paint === 'stat') {
    const stat = statIn(S, t)
    const by = perPlaceDim(S, partner ? idx : passed, t.level, way, stat.d, partner ? zones : null)
    const got = statOf(by, stat.opts)
    if (stat.mean) {
      const { unit, digits } = stat.mean
      return withScale({ list, P, value: by.mean, n: got.map((g) => g.n), share: false, digits, figures: 3, unit, stat,
        title: `${statText(stat)} (${unit})${stat.d.note ? ` (${stat.d.note})` : ''}`,
        text: (x) => (x == null ? '—' : `${fixed(x, digits)}`) })
    }
    const value = got.map((g) => g.v)
    const kinds = !stat.opts.length
    const colors = (dark) => colorsOf(stat.d, isOrdered(stat.d.key), dark)
    const name = (o) => stat.d.options[o].label
    const base = { list, P, value, n: got.map((g) => g.n), share: true, digits: 0, unit: kinds ? '' : 'podróży', stat,
      title: statText(stat) + (stat.d.note ? ` (${stat.d.note})` : '') }
    if (kinds) {
      // the commonest of several, paler the less it leads
      return { ...base, text: pctText, textOf: (k) => (got[k].v == null ? '—' : `${name(got[k].best)} ${pctText(got[k].v)}`),
        colorOf: (dark) => { const c = colors(dark); return (k) => c[got[k].best] }, lead: (k) => Math.min(1, 0.35 + got[k].v),
        legend: (dark) => stat.d.options.map((o, q) => ({ color: colors(dark)[q], label: o.label })).filter((_, q) => got.some((g) => g.best === q)) }
    }
    return withScale({ ...base, text: pctText })
  }
  const per = PER[perIn(S, t)]
  const mine = new Set(t.picked)
  const plain = list.map((p, n) => {
    const d = per.of(p)
    // the picked place's own trips are no match for what it sends elsewhere
    if (partner) return partner.n[n] && d && !mine.has(p.key) ? partner.w[n] / d : null
    if (!P.fixed && !sums[n].n) return null
    const x = P.v(p, sums[n])
    return x == null || !P.count ? x : d ? x / d : null
  })
  const share = !partner && !!P.share
  const counted = !!partner || !!P.count
  // rates too small to read are per thousand
  const k = counted && perThousand(plain, per) ? 1000 : 1
  const value = k === 1 ? plain : plain.map((x) => (x == null ? null : x * k))
  const n = list.map((p, q) => (partner ? partner.n[q] : P.fixed ? THIN : sums[q].n))
  const digits = counted ? (per.many ? digitsFor(value) : 0) : P.digits || 0
  const noun = partner || !P.fixed ? (S.freight ? 'przejazdów' : 'podróży/dobę') : ''
  const unit = counted ? [noun, k > 1 ? per.many : per.unit].filter(Boolean).join(' ') : P.unit || ''
  const text = (x) => (x == null ? '—' : share ? pctText(x) : digits ? fixed(x, digits) : fmtEst(x))
  return withScale({ list, P, value, n, share, digits, unit, text,
    title: P.count && per.unit ? `${P.label} ${k > 1 ? per.many : per.unit}` : P.label })
}

/** The colours and the legend of values on a scale. */
function withScale(p) {
  const of = (dark) => scale(breaks(p.value, p.share, p.figures), dark)
  const f = (x) => (p.share ? `${Math.round(100 * x)}%` : p.digits ? fixed(x, p.digits) : fmt(x))
  return { ...p, textOf: (k) => p.text(p.value[k]), lead: () => 1,
    colorOf: (dark) => { const sc = of(dark); return (k) => sc.color(p.value[k]) },
    legend: (dark) => of(dark).steps.map((s) => ({
      color: s.color,
      label: s.from == null ? `poniżej ${f(s.to ?? 0)}` : s.to == null ? `${f(s.from)} i więcej` : `${f(s.from)} – ${f(s.to)}`,
    })) }
}
const alphaOf = (n) => 0.24 + 0.4 * Math.min(1, n / THIN)

// -------------------------------------------------------------------- the map
/** Where a trip's end is drawn: at its address, along its street, or anywhere
 *  in its zone. */
function endOf(S, spots, zone, spot, seed) {
  if (spots && spot >= 0) {
    const s = spots[spot]
    if (!s.street) return [s.lat, s.lon]
    const r = rng(seed + 11)
    return [s.lat + (r() - 0.5) * 0.0016, s.lon + (r() - 0.5) * 0.0025]
  }
  return zone < S.Z.count ? scatter(S.Z.zones[zone], seed) : null
}

/** An even handful of a list, the same every time. */
function sample(list, k, seed = 7) {
  if (list.length <= k) return list
  const r = rng(seed)
  const all = [...list]
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(r() * (all.length - i));
    [all[i], all[j]] = [all[j], all[i]]
  }
  return all.slice(0, k)
}

/** The curves and rings of a view. */
export function flowLines(x, hot = {}) {
  const { S, t, partner, places, show, idx, spots } = x
  const { list } = S.levels[t.level]
  const modeW = (f) => (hot.mode != null ? f.modes[hot.mode] : f.w)
  const color = (f) => S.modes[hot.mode != null ? hot.mode : f.mode].color
  if (show === 'trips') {
    const at = new Map()
    return { arcs: sample(idx, MANY_TRIPS).map((i) => {
      const c = S.T.cols
      const a = endOf(S, spots, c.f[i], c.pf ? c.pf[i] : -1, i * 2)
      const b = endOf(S, spots, c.t[i], c.pt ? c.pt[i] : -1, i * 2 + 1)
      const m = S.modeAt[c.m[i]]
      return a && b && { key: `t${i}`, from: a, to: b, w: 1, color: S.modes[m].color, faint: true, i,
        dim: hot.mode != null && hot.mode !== m, on: hot.trip === i }
    }).filter(Boolean), rings: [], at }
  }
  if (partner && (show === 'areas' || show === 'flows')) {
    const at = places.length === 1 ? places[0].c : [0, 1].map((k) => places.reduce((a, p) => a + p.c[k], 0) / places.length)
    const mine = new Set(t.picked)
    const all = flowsOf(S, partner, list)
    const out = all.filter((f) => !mine.has(f.key)).sort((a, b) => b.w - a.w).slice(0, show === 'flows' ? 200 : 30)
    const inside = all.filter((f) => mine.has(f.key))
    const top = Math.max(1, ...all.map((f) => f.w))
    const toward = x.way === 'to'
    const lit = hot.place != null && out.some((f) => f.b.key === hot.place)
    return {
      arcs: out.filter((f) => modeW(f) > 0).map((f) => ({ ...f, key: `f${f.key}`, from: toward ? f.b.c : at, to: toward ? at : f.b.c, w: modeW(f), color: color(f),
        faint: f.n < 3, end: x.way === 'from' || x.way === 'to', on: hot.place === f.b.key,
        // only a place at the other end of a line puts the rest in its shade
        dim: lit && hot.place !== f.b.key, hotAs: f.hotAs })),
      rings: inside.filter((f) => modeW(f) > 0).map((f) => ({ key: `r${f.key}`, at: f.b.c, w: modeW(f), n: f.n, top, color: color(f), faint: f.n < 3, place: f.b,
        all: partner.w.reduce((a, b) => a + b, 0) + partner.off.reduce((a, o) => a + o.w, 0) })),
    }
  }
  if (show === 'flows') {
    const all = pairs(S, x.passed, t.level, t.top)
    const top = Math.max(1, ...all.map((f) => f.w))
    const lit = hot.place != null && all.some((f) => f.a.key === hot.place || f.b.key === hot.place)
    return {
      arcs: all.filter((f) => !f.self && modeW(f) > 0).map((f) => ({ ...f, from: f.a.c, to: f.b.c, w: modeW(f), color: color(f), faint: f.n < 5,
        on: hot.pair === f.key, dim: (hot.pair != null && hot.pair !== f.key) || (lit && hot.place !== f.a.key && hot.place !== f.b.key) })),
      rings: all.filter((f) => f.self && modeW(f) > 0).map((f) => ({ key: f.key, at: f.a.c, w: modeW(f), n: f.n, top, color: color(f), faint: f.n < 5, place: f.a,
        dim: lit && hot.place !== f.a.key })),
    }
  }
  return { arcs: [], rings: [] }
}

/** Whole days as chains of curves. */
export function dayLines(x, hot = {}) {
  const { S, t, dayRows, spots } = x
  const key = hot.pattern || t.pattern
  let rows = (dayRows || []).filter((r) => !key || r.key === key)
  const one = hot.day != null && rows.find((r) => r.k === hot.day)
  rows = sample(rows, MANY_DAYS)
  if (one && !rows.includes(one)) rows.push(one)
  return rows.flatMap((r) => {
    // the same place and purpose is the same point: back home is where it began
    const at = r.stops.map((z, i) => {
      const first = r.stops.findIndex((e, k) => e === z && r.acts[k] === r.acts[i] && r.spots[k] === r.spots[i])
      return endOf(S, spots, z, r.spots[i], r.k * 16 + first)
    })
    return r.modes.map((m, i) => at[i] && at[i + 1] && { key: `${r.k}.${i}`, from: at[i], to: at[i + 1], w: 1, color: DAY_MODES[m].color,
      faint: true, strong: hot.day === r.k, dim: hot.day != null && hot.day !== r.k }).filter(Boolean)
  })
}

export function TripsMap({ x, dark, onPick, setT }) {
  const { S, t, sums, partner, show, spots } = x
  const hot = useHot()
  const p0 = useMemo(() => painted(x), [x])
  const { list, value: values, n: counts, P } = p0
  const picked = useMemo(() => new Set(t.picked), [t.picked])
  const colorAt = useMemo(() => p0.colorOf(dark), [p0, dark])
  const items = useMemo(() => list.map((p, k) => {
    const v = show === 'areas' ? values[k] : null
    return { p, k, v: values[k], color: v == null || (v === 0 && !P.share) ? null : colorAt(k), alpha: (P.fixed && !partner ? 0.6 : alphaOf(counts[k])) * p0.lead(k) }
  }), [list, values, counts, colorAt, p0, P, partner, show])
  const lines = useMemo(() => flowLines(x, { mode: hot.mode, place: hot.place, pair: hot.pair, trip: hot.trip }),
    [x, hot.mode, hot.place, hot.pair, hot.trip])
  const chains = useMemo(() => (show === 'days' ? dayLines(x, { pattern: hot.pattern, day: hot.day }) : []), [x, show, hot.pattern, hot.day])
  const perS = useMemo(() => (show === 'spots' && spots ? perSpot(S, x.idx, spots.length) : null), [show, spots, S, x.idx])
  const tip = useMemo(() => function Tip({ p, k, v }) {
    const s = sums[k]
    const own = picked.has(p.key)
    const mg = partner ? countMargin(partner.n[k]) : countMargin(s.n)
    return (
      <MapTooltip sticky>
        <b>{placeName(p)}</b>
        {p.level === 'z' && <TipNote> · rejon {p.id}, {p.district}</TipNote>}<br />
        {p0.stat ? (
          <>{p0.title}: <b>{p0.textOf(k)}</b><Small n={counts[k]} />
            <TipNote><br />{counts[k]} {counts[k] === 1 ? 'podróż' : 'podróży'} w próbie{partner ? ' z zaznaczonym obszarem' : ''}</TipNote></>
        ) : partner ? (
          <>{own ? 'w obrębie: ' : ''}{v != null && <><b>{p0.text(v)}</b> {p0.unit}</>}<Small n={partner.n[k]} />{v == null && !own && (partner.n[k] ? '' : 'brak podróży w próbie')}
            {partner.n[k] > 0 && <TipNote> {v != null && '· '}{fmtEst(partner.w[k])} {unitOf(S)} (±{Math.round(100 * mg)}%), {partner.n[k]} w próbie</TipNote>}</>
        ) : (
          <>{P.label}: {v == null ? 'brak danych' : <><b>{p0.text(v)}</b> {p0.unit}</>}{!P.fixed && <Small n={s.n} />}
            {!P.fixed && <TipNote><br />{fmtEst(s.any)} {unitOf(S)} (±{Math.round(100 * (mg ?? 1))}%) · {s.n} w próbie{p.pop ? ` · ${fmt(p.pop)} mieszkańców` : ''}</TipNote>}</>
        )}
        {!partner && !p0.stat && !P.fixed && s.n > 4 && S.main.map((m) => {
          const w = m.of.reduce((a, j) => a + s.modes[j], 0)
          return <TipRow key={m.key} color={m.color} label={m.label} value={fmtEst(w)} share={pctText(w / s.any)} />
        })}
      </MapTooltip>
    )
  }, [sums, partner, P, p0, S, picked, counts])
  const tipOf = useMemo(() => (item) => tip(item), [tip])
  const flowTip = (f) => (
    <MapTooltip sticky>
      {f.a && !f.self ? `${placeName(f.a)} ↔ ` : ''}{placeName(f.b || f.place)}{f.place ? ' — w obrębie' : ''}<br />
      <b>{fmtEst(f.w)}</b> {unitOf(S)}<Small n={f.n} /> <TipNote>· {f.n} w próbie{f.all ? ` · ${pctText(f.w / f.all)} podróży` : ''}</TipNote>
      {f.modes && [...f.modes].map((w, m) => [w, m]).filter(([w]) => w > 0).sort((a, b) => b[0] - a[0]).slice(0, 4)
        .map(([w, m]) => <TipRow key={m} color={S.modes[m].color} label={S.modes[m].label} value={fmtEst(w)} share={pctText(w / [...f.modes].reduce((a, b) => a + b, 0))} />)}
    </MapTooltip>
  )
  const single = show === 'trips' || show === 'days'
  const labels = useMemo(() => (!t.names || show === 'trips' ? [] : list.map((p, k) => {
    const v = values[k]
    const lines0 = [{ text: placeName(p).replace(/-/g, '\u2011'), bold: true },
      ...(show === 'areas' && v != null ? [{ text: p0.textOf(k) + (P.fixed ? '' : smallText(counts[k])) }] : partner && partner.n[k] ? [{ text: fmtEst(partner.w[k]) + smallText(partner.n[k]) }] : [])]
    return { key: p.key, lat: p.c[0], lon: p.c[1], r: 0, html: labelHtml(lines0), box: labelBox(lines0), weight: v ?? 0 }
  })), [t.names, show, list, values, p0, partner, counts, P])
  const topSpot = perS ? Math.max(1, ...perS.w) : 1
  return (
    <>
      <ZoneLayer items={items} picked={picked} onPick={onPick} tip={tipOf} plain={show !== 'areas'} hot={hot.place} />
      <Arcs width={single ? 1.6 : 9} flows={[...lines.arcs.map((f) => (single ? f : { ...f, tip: flowTip(f), hotAs: f.a ? f.hotAs || { pair: f.key } : HOT_PLACE(f.b.key) })), ...chains]} />
      <Rings rings={lines.rings.map((r) => ({ ...r, tip: flowTip(r), hotAs: HOT_PLACE(r.place.key), onPick: () => onPick(r.place) }))} />
      {perS && (
        <CircleLayer points={spots.map((s, i) => ({ s, i })).filter(({ i }) => perS.n[i] > 0).sort((a, b) => perS.w[b.i] - perS.w[a.i]).map(({ s, i }) => {
          const on = t.filters.spot?.[0] === i
          return { key: `${i}${on ? '+' : ''}${hot.spot === i ? '!' : ''}`, lat: s.lat, lon: s.lon, i, s, r: sqrtRadius(perS.w[i], topSpot, 4, 20),
            style: { color: on || hot.spot === i ? '#ffffff' : '#0b1016', weight: on || hot.spot === i ? 3 : 1, fillColor: S.modes[perS.mode(i)].color, fillOpacity: 0.85 } }
        })} onPick={(p) => setT((q) => { const { spot, ...rest } = q.filters; return { ...q, filters: spot?.[0] === p.i ? rest : { ...rest, spot: [p.i] } } })}
          tip={({ s, i }) => (
            <MapTooltip>
              <b>{s.name}</b>{s.street ? <TipNote> · ulica</TipNote> : null}<br />
              {fmtEst(perS.w[i])} podróży/dobę<Small n={perS.n[i]} /> <TipNote>· {perS.n[i]} w próbie</TipNote>
              {[...perS.modes(i)].map((w, m) => [w, m]).filter(([w]) => w > 0).sort((a, b) => b[0] - a[0]).slice(0, 4)
                .map(([w, m]) => <TipRow key={m} color={S.modes[m].color} label={S.modes[m].label} value={fmtEst(w)} share={pctText(w / perS.w[i])} />)}
            </MapTooltip>
          )} />
      )}
      {labels.length > 0 && <MapLabels entries={labels} declutter />}
    </>
  )
}
// one object a place, so that a line is not redrawn for a new one
const hotPlaces = new Map()
const HOT_PLACE = (key) => { if (!hotPlaces.has(key)) hotPlaces.set(key, { place: key }); return hotPlaces.get(key) }

/** The legend of what is shown. */
export function tripsLegend({ x, dark }) {
  const { S, t, partner, show } = x
  const p0 = painted(x)
  const { P } = p0
  const modes = (list) => list.map((m) => ({ label: m.label, color: m.color, line: true }))
  if (show === 'days') {
    return [{ title: 'Całe dni — czym' }, ...modes(DAY_MODES),
      { note: `do ${MANY_DAYS} losowych dni z podróżą, która spełnia filtry; domy wzdłuż ulicy lub w losowym punkcie rejonu` }]
  }
  if (show === 'spots') {
    return [{ title: 'Cele — najczęstszy środek' }, ...S.modes.map((m) => ({ label: m.label, color: m.color })),
      { note: 'wielkość koła = podróże; tylko miejsca, które podało co najmniej 5 badanych' }]
  }
  if (show !== 'areas') {
    return [{ title: show === 'flows' ? 'Przepływy — najczęstszy środek' : 'Pojedyncze podróże' }, ...modes(S.modes),
      { note: show === 'flows' ? 'grubość = podróże, kółko = w obrębie obszaru, blade = mniej niż 5 w próbie'
        : `do ${MANY_TRIPS} losowych podróży z próby; domy wzdłuż ulicy, rzadkie miejsca w losowym punkcie rejonu` }]
  }
  const to = { from: 'z', to: 'do', any: 'z i do', home: 'mieszkańców —' }[x.way]
  const whose = `Podróże ${to} ${x.places.length === 1 ? placeName(x.places[0]) : `${x.places.length} obszary`}`
  return [
    { title: partner && !p0.stat ? whose : p0.title },
    ...(partner ? [{ note: p0.stat ? whose : p0.unit }] : []),
    ...(!partner && !P.fixed && !S.freight ? [{ note: x.way === 'home' ? 'mieszkańców obszaru: z domu i do domu' : 'wszystkie, także przyjezdnych' }] : []),
    ...(p0.stat?.opts.length === p0.stat?.d.options.length && p0.stat ? [{ note: '(!) wybrano wszystkie odpowiedzi — wszędzie 100%' }] : p0.legend(dark)),
    ...(p0.stat?.d.key === 'km' ? [{ note: KM_NOTE }] : []),
    ...(p0.stat && !p0.stat.opts.length && !p0.stat.mean ? [{ note: 'kolor = najczęstsza odpowiedź, bledszy = mniejsza przewaga' }] : []),
    ...(partner ? [{ note: 'łuki: kolor = najczęstszy środek, kropka = dokąd; kółko = podróże w obrębie' }] : []),
    { note: `blade i (!) = mniej niż ${THIN} podróży w próbie` },
  ]
}

// --------------------------------------------------------------- the controls
function FilterField({ S, d, t, setT, base }) {
  const on = t.filters[d.key] || []
  const toggle = (i) => {
    const next = on.includes(i) ? on.filter((k) => k !== i) : [...on, i]
    const { [d.key]: _, ...rest } = t.filters
    setT({ ...t, filters: next.length ? { ...rest, [d.key]: next } : rest })
  }
  const sh = shares(S, base, d.key)
  return (
    <Field label={d.note ? `${d.label} (${d.note})` : d.label} help={d.help && <p>{d.help}</p>}>
      <Chips tight small label={d.label} onPick={(k) => toggle(+k)}
        items={sh.filter((o) => o.n > 0 || on.includes(o.i)).map((o) => ({
          key: String(o.i), label: o.label, on: on.includes(o.i), color: o.color,
          title: `${fmt(o.n)} podróży w próbie`,
        })).map((o) => ({ ...o, label: <>{o.label} <small style={{ opacity: 0.6 }}>{pctText(sh[+o.key].share)}</small></> }))} />
    </Field>
  )
}

/** Which part of a statistic the map shows: the average of a number or the
 *  commonest option, or a share. */
export function StatChips({ S, t, setT }) {
  const { d, opts } = statIn(S, t)
  const number = numberOf(S, d.key)
  const set = (next) => setT({ ...t, paint: 'stat', show: 'areas', stat: { dim: d.key, opts: next } })
  const colors = colorsOf(d, isOrdered(d.key))
  return (
    <Chips tight small label="Co na mapie" onPick={(k) => set(k === 'top' ? [] : opts.includes(+k) ? opts.filter((o) => o !== +k) : [...opts, +k].sort((a, b) => a - b))}
      items={[{ key: 'top', label: number ? 'średnia' : 'najczęstsze', on: !opts.length, title: number ? 'kolor = średnia w obszarze' : 'kolor = najczęstsza opcja w obszarze' },
        ...d.options.map((o, i) => ({ key: String(i), label: `udział: ${o.label}`, on: opts.includes(i), color: colors[i] }))]} />
  )
}

const FIRST = ['mode', 'goal', 'km', 'in', 'to']
const TRIP_KEYS = ['why', 'min', 'from', 'park', 'reason', 'change']
const WHO_KEYS = ['live', 'age', 'sex', 'job', 'edu', 'size', 'kids', 'house', 'cars', 'pass', 'lic']

export const TripsControls = memo(function TripsControls({ x, setT, hasFreight, choice, onChoice }) {
  const { S, t, stats } = x
  const set = (o) => setT({ ...t, ...o })
  const active = Object.keys(t.filters).length
  const dim = (k) => S.D.find((d) => d.key === k)
  // a filter's own choices are counted without it, or they would vanish
  const baseOf = useMemo(() => {
    const memo = {}
    return (key) => (memo[key] ||= touching(S, passing(S, { filters: t.filters, hours: x.hours }, key), x.zones, x.way))
  }, [S, x.hours, x.zones, t.filters, x.way])
  const fields = (keys) => keys.map(dim).filter(Boolean)
    .map((d) => <FilterField key={d.key} S={S} d={d} t={t} setT={setT} base={baseOf(d.key)} />)
  const same = (p) => JSON.stringify(p.filters) === JSON.stringify(t.filters)
  return (
    <>
      <Panel title="Podróże" help={(
        <>
          <p>
            Dzienniczki podróży z badania ankietowego KBR 2024: 10 566 mieszkańców Wrocławia i 9 gmin
            opisało 16 781 podróży z jednego dnia roboczego. Każda osoba reprezentuje ok. 100 innych,
            więc liczby to szacunek podróży wszystkich mieszkańców na dobę.
          </p>
          <p>
            Kliknij obszar, aby zobaczyć podróże z niego i do niego; Shift lub Ctrl dodaje kolejne.
            Wybrany wyżej okres to godzina rozpoczęcia podróży.
          </p>
          <p>
            Badanie nie obejmuje przyjezdnych spoza 9 gmin ani ruchu towarowego. W rejonie mieszka
            zwykle ok. 30 przebadanych osób, więc pojedyncze rejony są przybliżone — osiedla pewniejsze.
          </p>
        </>
      )}>
        {hasFreight && (
          <Chips label="Zbiór danych" onPick={(k) => setT({ ...TRIPS0, set: k, level: t.level })}
            items={[{ key: 'people', label: 'Mieszkańcy', on: t.set === 'people' },
              { key: 'freight', label: 'Towary (dostawcze i ciężarowe)', on: t.set === 'freight' }]} />
        )}
        <Field label="Widok">
          <Chips tight label="Widok" onPick={(show) => set({ show })}
            items={Object.entries(SHOW).filter(([, s]) => !(S.freight && s.people))
              .map(([key, s]) => ({ key, label: s.label, on: x.show === key, title: s.note }))} />
          <Hint>{SHOW[x.show].note}</Hint>
        </Field>
        {x.show === 'flows' && !x.partner && (
          <Slider min="10" max="300" step="10" value={t.top} label="Ile połączeń" onChange={(top) => set({ top })}
            caption={`Najczęstsze ${t.top} połączeń`} />
        )}
        <Field label="Obszary">
          <Chips tight label="Obszary" onPick={(level) => set({ level, picked: [] })} items={[
            { key: 'd', label: 'Osiedla i gminy', on: t.level === 'd' },
            { key: 'z', label: 'Rejony', on: t.level === 'z' }]} />
        </Field>
        {x.show === 'areas' && <Field label="Kolor obszarów">
          <Select value={t.paint === 'stat' ? `stat:${statIn(S, t).d.key}` : t.paint} label="Kolor obszarów"
            onChange={(val) => set(val.startsWith('stat:') ? { paint: 'stat', stat: { dim: val.slice(5), opts: [] } } : { paint: val })}
            options={[
              ...Object.entries(PAINTS).filter(([k]) => k !== 'stat' && (!S.freight || ['any', 'from', 'to', 'jobs', 'pop'].includes(k)))
                .map(([value, p]) => ({ value, label: p.label })),
              ...S.D.map((d) => ({ value: `stat:${d.key}`, label: `Statystyka: ${d.label}${d.note ? ` (${d.note})` : ''}` })),
            ]} />
          {t.paint === 'stat' && <StatChips S={S} t={t} setT={setT} />}
        </Field>}
        <Field label="Czyje podróże" help={(
          <p>
            „Mieszkańców obszaru” to podróże z domu i do domu, przypisane do miejsca zamieszkania — porównują
            osiedla między sobą. „Wszystkie z i do” liczą też przyjezdnych, więc w centrum jest ich wielokrotnie
            więcej niż mieszkańców. Podróże między dwoma miejscami poza domem (ok. 7%) są tylko we „wszystkich”.
          </p>
        )}>
          <Chips tight small label="Czyje podróże" onPick={(w) => set({ way: w })}
            items={WAYS.filter(([k]) => !(S.freight && k === 'home') && (x.places.length || k === 'home' || k === 'any'))
              .map(([key, label]) => ({ key, label, on: x.way === key }))} />
        </Field>
        <Field label="Przelicz" help={(
          <p>
            Na mieszkańca od 6 lat, których reprezentuje próba (suma wag) — te same wagi co w liczbie podróży. Miejsca
            pracy: szacunek z danych telefonii komórkowej (zał. 12). Obszary poniżej 300 osób nie mają wskaźnika.
          </p>
        )}>
          <Chips tight small label="Przelicz" onPick={(per) => set({ per })}
            items={Object.entries(PER).filter(([k]) => !(S.freight && k === 'pop'))
              .map(([key, p]) => ({ key, label: p.label, on: perIn(S, t) === key }))} />
        </Field>
        {x.partner && t.paint !== 'stat' && <Hint>Z zaznaczonym obszarem kolor pokazuje, skąd i dokąd są podróże; „Statystyka” — jakie one są.</Hint>}
        <Toggle checked={t.names} onChange={(names) => set({ names })} label="Nazwy i wartości na mapie" />
        {x.places.length > 0 && (
          <Field label={x.places.length === 1 ? placeName(x.places[0]) : `${x.places.length} zaznaczone obszary`}>
            <Toggle checked={t.many} onChange={(many) => set({ many })} label="Klikaj kolejne, aby dodawać" />
            <LinkButton onClick={() => set({ picked: [] })}>Wszystkie obszary</LinkButton>
          </Field>
        )}
      </Panel>
      <Panel title="Filtry" collapsible defaultOpen badge={active ? `${active}` : null}>
        {!S.freight && (
          <Field label="Gotowe" help={<p>{TRIP_PRESETS.find((p) => p.help).help}</p>}>
            <Chips tight small label="Gotowe filtry" onPick={(k) => {
              const p = TRIP_PRESETS.find((q) => q.key === k)
              set({ filters: same(p) ? {} : p.filters })
            }} items={TRIP_PRESETS.map((p) => ({ key: p.key, label: p.label, on: same(p), title: p.help }))} />
          </Field>
        )}
        {t.filters.easy && (
          <Hint>Tylko podróże kierowców z wygody, dla czasu lub kosztu, do 5 km albo do lub z centrum.{' '}
            <LinkButton onClick={() => { const { easy: _, ...rest } = t.filters; set({ filters: rest }) }}>Usuń ten warunek</LinkButton>
          </Hint>
        )}
        {t.filters.spot && (
          <Hint>Tylko podróże do lub z: <b>{x.spots?.[t.filters.spot[0]]?.name}</b>{' '}
            <LinkButton onClick={() => { const { spot: _, ...rest } = t.filters; set({ filters: rest }) }}>Usuń</LinkButton>
          </Hint>
        )}
        {fields(FIRST)}
        {active > 0 && <LinkButton block onClick={() => set({ filters: {} })}>Wyczyść filtry</LinkButton>}
        <Hint>{fmt(stats.n)} {S.freight ? 'przejazdów' : 'podróży'} w próbie{S.freight ? '' : ` = ${fmtEst(stats.w)} na dobę`}</Hint>
      </Panel>
      {!S.freight && (
        <>
          <Panel title="Więcej o podróży" collapsible defaultOpen={false}
            badge={TRIP_KEYS.filter((k) => t.filters[k]).length || null}>{fields(TRIP_KEYS)}</Panel>
          <Panel title="Kto podróżuje" collapsible defaultOpen={false}
            badge={WHO_KEYS.filter((k) => t.filters[k]).length || null}>{fields(WHO_KEYS)}</Panel>
          <ScenarioPanel x={x} choice={choice} onOpen={onChoice} setT={setT} />
        </>
      )}
    </>
  )
})
