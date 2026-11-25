// The trips of the household survey (and the freight one): what is filtered,
// and what the map is painted with. The panel is apart, with the charts.
import { useMemo } from 'react'
import { Chips, Field, Hint, LinkButton, Panel, Select, Toggle, fixed, fmt, fmtEst } from '@bartor-net/ui-kit'
import { MapTooltip, TipNote, TipRow } from '@bartor-net/ui-kit/map'
import ScenarioPanel from './ScenarioPanel'
import { FlowLines, ZoneLayer } from './ZoneLayer'
import {
  PAINTS, PER, THIN, TRIPS0, TRIP_PRESETS, breaks, describe, pairs, passing, perPartner, perOf, perPlace, placeName, scale,
  shares, touching,
} from './trips'

export const pctText = (s) => (s == null ? '—' : s > 0 && s < 0.005 ? '<1%' : `${Math.round(100 * s)}%`)
export const WAYS = [['home', 'mieszkańców obszaru'], ['any', 'wszystkie z i do'], ['from', 'stąd'], ['to', 'tutaj']]
// freight has no residents
const wayIn = (S, t) => (S?.freight && t.way === 'home' ? 'any' : t.way)
const perIn = (S, t) => (S.freight && t.per === 'pop' ? 'abs' : perOf(t.paint, t.per))

/** Everything that follows from the settings, for the map and both panels. */
export function useTrips(S, t, hours) {
  const passed = useMemo(() => (S ? passing(S, { filters: t.filters, hours }) : []), [S, t.filters, hours])
  const places = useMemo(
    () => (S ? t.picked.map((k) => S.levels[t.level].byKey.get(k)).filter(Boolean) : []),
    [S, t.level, t.picked],
  )
  const zones = useMemo(() => (places.length ? places.flatMap((p) => p.zones) : null), [places])
  const way = wayIn(S, t)
  const idx = useMemo(() => (S ? touching(S, passed, zones, way) : []), [S, passed, zones, way])
  const stats = useMemo(() => (S ? describe(S, idx) : null), [S, idx])
  const sums = useMemo(() => (S ? perPlace(S, passed, t.level, way) : null), [S, passed, t.level, way])
  const partner = useMemo(
    () => (S && zones ? perPartner(S, idx, zones, t.level, way) : null),
    [S, idx, zones, t.level, way],
  )
  return useMemo(() => S && { S, t, hours, way, passed, places, zones, idx, stats, sums, partner },
    [S, t, hours, way, passed, places, zones, idx, stats, sums, partner])
}

export const unitOf = (S) => (S.freight ? 'przejazdów w badaniu' : 'podróży/dobę')

/** What each place is painted by: a value, and how it reads. */
function painted({ S, t, sums, partner }) {
  const { list } = S.levels[t.level]
  const P = PAINTS[t.paint]
  const per = PER[perIn(S, t)]
  // towards a picked place: of every thousand who live (or work) elsewhere
  const k = partner && per.many ? 1000 : 1
  const value = list.map((p, n) => {
    const s = sums[n]
    const d = per.of(p)
    if (partner) return partner.n[n] && d ? (k * partner.w[n]) / d : null
    // a share, a mean or a rate of a handful of trips is noise
    if (!P.fixed && (!P.count || per !== PER.abs) && s.n < THIN) return null
    const x = P.v(p, s)
    return x == null || !P.count ? x : d ? x / d : null
  })
  const digits = partner ? (k > 1 ? 1 : 0) : P.count ? per.digits || 0 : P.digits || 0
  const share = !partner && !!P.share
  const noun = partner || !P.fixed ? (S.freight ? 'przejazdów' : 'podróży/dobę') : ''
  const unit = partner || P.count ? [noun, k > 1 ? per.many : per.unit].filter(Boolean).join(' ') : P.unit || ''
  const text = (v) => (v == null ? '—' : share ? pctText(v) : digits ? fixed(v, digits) : fmtEst(v))
  return { list, P, value, share, digits, unit, text, title: P.count && per.unit ? `${P.label} ${per.unit}` : P.label }
}

// -------------------------------------------------------------------- the map
export function TripsMap({ x, dark, onPick }) {
  const { S, t, sums, partner, places } = x
  const p0 = useMemo(() => painted(x), [x])
  const { list, value: values, P } = p0
  const picked = useMemo(() => new Set(t.picked), [t.picked])
  const sc = useMemo(() => scale(breaks(values, p0.share), dark), [values, p0, dark])
  const items = useMemo(() => list.map((p, k) => ({
    p, k, v: values[k], color: values[k] == null || (values[k] === 0 && !P.share) ? null : sc.color(values[k]),
  })), [list, values, sc, P])
  const flows = useMemo(() => {
    if (!t.lines) return []
    if (partner) {
      const at = places.length === 1 ? places[0] : { c: [0, 1].map((i) => places.reduce((a, p) => a + p.c[i], 0) / places.length) }
      return list.map((p, k) => ({ key: p.key, a: at, b: p, w: partner.w[k], n: partner.n[k] }))
        .filter((f) => f.n > 1 && !picked.has(f.key)).sort((a, b) => b.w - a.w).slice(0, 25)
    }
    return pairs(S, x.passed, t.level, 40).filter((f) => f.n > 1)
      .map((f) => ({ ...f, key: `${f.a.key}-${f.b.key}` }))
  }, [t.lines, partner, places, list, picked, S, x.passed, t.level])
  const tip = ({ p, k, v }) => {
    const s = sums[k]
    return (
      <MapTooltip sticky>
        <b>{placeName(p)}</b>
        {p.level === 'z' && <TipNote> · rejon {p.id}, {p.district}</TipNote>}<br />
        {partner ? (
          <>{v == null ? (partner.n[k] ? 'za mało mieszkańców' : 'brak podróży w próbie') : <><b>{p0.text(v)}</b> {p0.unit}</>}
            {partner.n[k] > 0 && <TipNote> · {fmtEst(partner.w[k])} {unitOf(S)}, {partner.n[k]} w próbie</TipNote>}</>
        ) : (
          <>{P.label}: {v == null ? (!P.fixed && s.n < THIN ? 'za mało podróży w próbie' : 'brak danych')
            : <><b>{p0.text(v)}</b> {p0.unit}</>}
          {!P.fixed && <TipNote><br />{fmtEst(s.any)} {unitOf(S)} · {s.n} w próbie{p.pop ? ` · ${fmt(p.pop)} mieszkańców` : ''}</TipNote>}</>
        )}
        {!partner && !P.fixed && s.any > 0 && s.n >= THIN && S.main.map((m) => {
          const w = m.of.reduce((a, j) => a + s.modes[j], 0)
          return <TipRow key={m.key} color={m.color} label={m.label} value={fmtEst(w)} share={pctText(w / s.any)} />
        })}
      </MapTooltip>
    )
  }
  return (
    <>
      <ZoneLayer items={items} picked={picked} onPick={onPick} tip={tip} />
      <FlowLines flows={flows} tip={(f) => (
        <MapTooltip sticky>
          {f.a.level ? `${placeName(f.a)} ↔ ` : ''}{placeName(f.b)}<br />
          {fmtEst(f.w)} {unitOf(S)} <TipNote>· {f.n} w próbie</TipNote>
        </MapTooltip>
      )} />
    </>
  )
}

/** The legend of what is painted. */
export function tripsLegend({ x, dark }) {
  const { S, t, partner } = x
  const p0 = painted(x)
  const { P } = p0
  const sc = scale(breaks(p0.value, p0.share), dark)
  const f = (v) => (p0.share ? `${Math.round(100 * v)}%` : p0.digits ? fixed(v, p0.digits) : fmt(v))
  const to = { from: 'z', to: 'do', any: 'z i do', home: 'mieszkańców —' }[x.way]
  const title = partner ? `Podróże ${to} ${x.places.length === 1 ? placeName(x.places[0]) : `${x.places.length} obszary`}` : p0.title
  return [
    { title }, ...(partner && p0.unit ? [{ note: p0.unit }] : []),
    ...(!partner && !P.fixed && !S.freight ? [{ note: x.way === 'home' ? 'mieszkańców obszaru: z domu i do domu' : 'wszystkie, także przyjezdnych' }] : []),
    ...sc.steps.map((s) => ({
      color: s.color,
      label: s.from == null ? `poniżej ${f(s.to ?? 0)}` : s.to == null ? `${f(s.from)} i więcej` : `${f(s.from)} – ${f(s.to)}`,
    })),
    ...(t.lines ? [{ note: 'linie: najczęstsze połączenia, grubość = liczba podróży' }] : []),
    { note: partner || !P.fixed ? (S.freight ? 'przejazdy w próbie, nie przeliczone na miasto' : 'podróże w dniu roboczym, przeliczone na mieszkańców') : 'dane KBR 2024' },
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
        }))} />
    </Field>
  )
}

const FIRST = ['mode', 'goal', 'km', 'in', 'to']
const TRIP_KEYS = ['why', 'min', 'from', 'park', 'reason', 'change']
const WHO_KEYS = ['live', 'cars', 'pass', 'lic', 'age', 'job']

export function TripsControls({ x, setT, hasFreight, choice, onChoice }) {
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
        <Field label="Obszary">
          <Chips tight label="Obszary" onPick={(level) => set({ level, picked: [] })} items={[
            { key: 'd', label: 'Osiedla i gminy', on: t.level === 'd' },
            { key: 'z', label: 'Rejony', on: t.level === 'z' }]} />
        </Field>
        <Field label="Kolor obszarów">
          <Select value={t.paint} label="Kolor obszarów" disabled={!!x.partner} onChange={(paint) => set({ paint })}
            options={Object.entries(PAINTS).filter(([k]) => !S.freight || ['any', 'from', 'to', 'jobs', 'pop'].includes(k))
              .map(([value, p]) => ({ value, label: p.label }))} />
        </Field>
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
            Mieszkańcy: szacunek użyty przez KBR (zał. 3.1), w gminach wokół — z wag badania. Miejsca pracy:
            szacunek z danych telefonii komórkowej (zał. 12). Obszary poniżej 500 osób nie mają wskaźnika.
          </p>
        )}>
          <Chips tight small label="Przelicz" onPick={(per) => set({ per })}
            items={Object.entries(PER).filter(([k]) => !(S.freight && k === 'pop'))
              .map(([key, p]) => ({ key, label: p.label, on: perIn(S, t) === key }))} />
        </Field>
        {x.partner && <Hint>Z zaznaczonym obszarem kolor pokazuje, skąd i dokąd są podróże.</Hint>}
        <Toggle checked={t.lines} onChange={(lines) => set({ lines })} label="Linie najczęstszych połączeń" />
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
}
