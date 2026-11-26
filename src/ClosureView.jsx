// Shut streets and see where their traffic goes: the closure model, run in a
// worker, drawn on its own street graph.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { Chips, Field, Hint, LinkButton, Panel, Slider, Warn, fmt, fmtEst, isPhone } from '@bartor-net/ui-kit'
import { DOWN, NOISE, UP, diffColor } from './closureColors'
import { ASSUME, CASES, KINDS, MOST, SOURCES } from './evaporation'
import { setHot, useHot } from './hot'
import { ink } from './ink'

export const CLOSE0 = { closed: [], narrow: [], reduce: 0, whole: false, tool: 'close' }

const both = (flow, k) => flow[2 * k] + flow[2 * k + 1]

/** The worker, what it knows, and the result of the current change. */
export function useClosure(json, c, active) {
  const worker = useRef(null)
  const [base, setBase] = useState(null)
  const [result, setResult] = useState(null)
  const [part, setPart] = useState(null)
  const [prep, setPrep] = useState(0)
  const [error, setError] = useState(null)
  const id = useRef(0)
  const asked = useRef(null)
  useEffect(() => {
    if (!json || !active || worker.current) return
    const w = new Worker(new URL('./assign.worker.js', import.meta.url), { type: 'module' })
    w.onmessage = ({ data }) => {
      if (data.type === 'ready') setBase({ segments: data.segments, meta: data.meta, before: data.before })
      else if (data.type === 'prep') setPrep(data.part)
      else if (data.type === 'step' && data.id === id.current) setPart(data.part)
      else if (data.type === 'done' && data.id === id.current) { setResult({ ...data, of: asked.current }); setPart(null) }
      else if (data.type === 'error') { setError(data.message); setPart(null) }
    }
    w.onerror = (e) => { setError(e.message || 'błąd obliczeń'); setPart(null) }
    w.postMessage({ type: 'load', json })
    worker.current = w
  }, [json, active])
  useEffect(() => () => { worker.current?.terminate(); worker.current = null }, [])
  // what is worked out is what was asked for, until it is asked for again
  const calculate = useCallback((change) => {
    if (!worker.current) return
    id.current += 1
    if (!change.closed.length && !change.narrow.length) { setResult(null); setPart(null); return }
    setPart(0)
    setError(null)
    asked.current = change
    worker.current.postMessage({ type: 'run', id: id.current, change: {
      closed: change.closed, capacity: change.narrow.map((k) => [k, 0.5]), reduce: change.reduce,
    } })
  }, [])
  // a link that came with streets shut shows what they do
  const first = useRef(true)
  useEffect(() => {
    if (!base || !first.current) return
    first.current = false
    if (c.closed.length || c.narrow.length) calculate(c)
  }, [base, c, calculate])
  const empty = !c.closed.length && !c.narrow.length
  const stale = !!result && keyOf(result.of) !== keyOf(c)
  return useMemo(() => base && { ...base, c, result: empty ? null : result, stale: stale && !empty, empty, part, prep, error, calculate,
    streets: streets(base.segments) }, [base, c, result, stale, empty, part, prep, error, calculate])
}
const keyOf = (c) => `${[...c.closed].sort().join('.')}|${[...c.narrow].sort().join('.')}|${c.reduce}`

// segments by street name, and by the junctions they share
const memo = new WeakMap()
function streets(segments) {
  if (memo.has(segments)) return memo.get(segments)
  const at = new Map()
  const end = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`
  for (const s of segments) {
    for (const p of [s.path[0], s.path[s.path.length - 1]]) {
      const k = end(p)
      if (!at.has(k)) at.set(k, [])
      at.get(k).push(s.id)
    }
  }
  const out = { at, end }
  memo.set(segments, out)
  return out
}

/** The whole street a segment is of: the same name, joined up, over a gap of
 *  one segment at most - the two carriageways of a street and its crossings. */
export function streetOf(x, k) {
  const s0 = x.segments[k]
  if (!s0.name) return [k]
  const { at, end } = x.streets
  const near = (s) => [s.path[0], s.path[s.path.length - 1]].flatMap((p) => at.get(end(p)))
  const out = new Set([k])
  const queue = [k]
  while (queue.length) {
    const s = x.segments[queue.pop()]
    for (const n of near(s)) {
      const hops = x.segments[n].name === s0.name ? [n] : near(x.segments[n]).filter((m) => x.segments[m].name === s0.name)
      for (const m of hops) if (!out.has(m)) { out.add(m); queue.push(m) }
    }
  }
  return [...out]
}

/** Streets by name of some segments, with how much of each. */
export const namesOf = (x, ids) => {
  const by = new Map()
  for (const k of ids) {
    const n = x.segments[k].name || '(bez nazwy)'
    by.set(n, [...(by.get(n) || []), k])
  }
  return [...by].map(([name, list]) => ({ name, list, m: list.reduce((a, k) => a + x.segments[k].len, 0) }))
}

/** What changed, a row a street, at the place where it changes most. */
export function changesOf(x) {
  if (!x.result) return []
  const shut = new Set(x.result.of.closed)
  const by = new Map()
  for (const s of x.segments) {
    if (shut.has(s.id) || !s.name) continue
    const a = both(x.result.before, s.id)
    const b = both(x.result.after, s.id)
    const was = by.get(s.name)
    if (!was || Math.abs(b - a) > Math.abs(was.d)) by.set(s.name, { name: s.name, id: s.id, a, b, d: b - a })
  }
  return [...by.values()].filter((r) => Math.abs(r.d) >= NOISE).sort((p, q) => Math.abs(q.d) - Math.abs(p.d))
}

// ------------------------------------------------------------------- the map
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link'])

function styleOf(x, s, hot) {
  const closed = x.shut.has(s.id)
  const narrow = x.thin.has(s.id)
  const on = hot === s.id || (hot != null && typeof hot === 'string' && s.name === hot)
  if (closed) return { color: '#ff3b5c', weight: on ? 7 : 5, opacity: 1, dashArray: '2 7' }
  const base = x.result ? x.result.before : x.before
  const v = both(base, s.id)
  if (x.result) {
    const d = both(x.result.after, s.id) - v
    if (Math.abs(d) >= NOISE) {
      return { color: on ? ink() : diffColor(d), weight: Math.min(13, 2 + Math.sqrt(Math.abs(d)) / 9) + (on ? 2 : 0), opacity: 0.95, dashArray: narrow ? '6 6' : null }
    }
  }
  if (narrow) return { color: '#ffd166', weight: on ? 6 : 4, opacity: 1, dashArray: '6 6' }
  return { color: on ? ink() : '#7f93ad', weight: (MAJOR.has(s.cls) ? 1.2 : 0.8) + Math.sqrt(Math.max(0, v)) / 60 + (on ? 2 : 0),
    opacity: on ? 1 : x.result ? 0.28 : 0.6, dashArray: null }
}

const CLS = { motorway: 'autostrada', trunk: 'droga ekspresowa', primary: 'główna', secondary: 'zbiorcza', tertiary: 'lokalna', residential: 'osiedlowa', unclassified: 'inna' }

/** Ten thousand segments, so made once by hand and only restyled. */
export function ClosureMap({ x, onPick }) {
  const map = useMap()
  const hot = useHot()
  const lines = useRef(null)
  const now = useRef(null)
  const state = useMemo(() => ({ ...x, shut: new Set(x.c.closed), thin: new Set(x.c.narrow) }), [x])
  now.current = { x: state, onPick }
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.3, tolerance: 6 })
    const group = L.layerGroup()
    const tip = L.tooltip({ sticky: true, className: 'leaflet-tooltip' })
    const list = x.segments.map((s) => {
      const line = L.polyline(s.path, { renderer, ...styleOf(now.current.x, s, null) })
      line.on('mouseover', (e) => {
        setHot({ seg: s.id })
        const { x: y } = now.current
        const a = both(y.result ? y.result.before : y.before, s.id)
        const b = y.result ? both(y.result.after, s.id) : null
        const d = b == null ? 0 : b - a
        tip.setLatLng(e.latlng).setContent(`<b>${s.name || '(bez nazwy)'}</b> <small>${CLS[s.cls] || s.cls}${s.oneway ? ', jednokierunkowa' : ''}</small><br>`
          + (y.shut.has(s.id) ? 'zamknięta — ' : '') + (b == null ? `${fmtEst(a)} poj. w 8 godz.`
            : Math.abs(d) < NOISE ? `${fmtEst(a)} poj. — bez wyraźnej zmiany` : `${fmtEst(a)} → ${fmtEst(b)} poj. <b>${d > 0 ? '+' : '−'}${fmt(Math.round(Math.abs(d) / 100) * 100)}</b>`))
        map.openTooltip(tip)
      })
      line.on('mousemove', (e) => tip.setLatLng(e.latlng))
      line.on('mouseout', () => { setHot({}); map.closeTooltip(tip) })
      line.on('click', (e) => now.current.onPick(s.id, e.originalEvent?.shiftKey))
      return line
    })
    // the busier on top: where streets are close, a click is for them
    x.segments.map((s) => s.id).sort((a, b) => both(x.before, a) - both(x.before, b)).forEach((k) => list[k].addTo(group))
    group.addTo(map)
    lines.current = list
    return () => { map.closeTooltip(tip); group.remove(); lines.current = null }
  }, [map, x.segments])
  // restyle what differs: everything after a result, two lines on a hover
  useEffect(() => {
    if (!lines.current) return
    x.segments.forEach((s, i) => lines.current[i].setStyle(styleOf(state, s, null)))
    // what changes most is drawn last
    if (state.result) {
      x.segments.map((s) => [Math.abs(both(state.result.after, s.id) - both(state.result.before, s.id)), s.id])
        .filter(([d]) => d >= NOISE).sort((a, b) => a[0] - b[0]).forEach(([, k]) => lines.current[k].bringToFront())
    }
    for (const k of state.c.closed) lines.current[k].bringToFront()
  }, [state, x.segments])
  const last = useRef([])
  useEffect(() => {
    if (!lines.current) return
    const want = hot.seg != null ? [hot.seg] : hot.street ? x.segments.filter((s) => s.name === hot.street).map((s) => s.id) : []
    for (const k of last.current) lines.current[k].setStyle(styleOf(state, x.segments[k], null))
    for (const k of want) lines.current[k].setStyle(styleOf(state, x.segments[k], k))
    last.current = want
  }, [hot.seg, hot.street, state, x.segments])
  return null
}

export const closureLegend = ({ x }) => [
  { title: x.result ? 'Zmiana ruchu po zamknięciu' : 'Ruch dziś (model)' },
  { label: 'zamknięte', color: '#ff3b5c', line: true },
  ...(x.c.narrow.length ? [{ label: 'zwężone o połowę', color: '#ffd166', line: true }] : []),
  ...(x.result ? [
    { label: `więcej o ${NOISE}–1500`, color: UP[0][1], line: true }, { label: 'więcej o 1500–4000', color: UP[1][1], line: true }, { label: 'więcej o ponad 4000', color: UP[2][1], line: true },
    { label: `mniej o ${NOISE}–1500`, color: DOWN[0][1], line: true }, { label: 'mniej o 1500–4000', color: DOWN[1][1], line: true }, { label: 'mniej o ponad 4000', color: DOWN[2][1], line: true },
  ] : [{ note: 'naciśnij ulicę, aby ją zamknąć' }]),
  { note: 'pojazdy w 8 godzinach: 6–10 i 15–19; model, nie pomiar' },
]

// --------------------------------------------------------------- the controls
// Streets to start from, by a name the graph has.
const IDEAS = ['Kazimierza Wielkiego', 'most Grunwaldzki', 'Świdnicka', 'Podwale', 'Piotra Skargi', 'Generała Romualda Traugutta']

export function pickIn(x, k, tool, whole) {
  const ids = whole ? streetOf(x, k) : [k]
  const { c } = x
  const list = tool === 'close' ? 'closed' : 'narrow'
  const other = tool === 'close' ? 'narrow' : 'closed'
  const has = new Set(c[list])
  const out = has.has(k)
  const set = new Set(ids)
  return { ...c, [list]: out ? c[list].filter((y) => !set.has(y)) : [...new Set([...c[list], ...ids])], [other]: c[other].filter((y) => !set.has(y)) }
}

export function ClosureControls({ x, setC }) {
  const { c } = x
  const shut = namesOf(x, c.closed)
  const thin = namesOf(x, c.narrow)
  const ideas = useMemo(() => IDEAS.map((name) => {
    const s = x.segments.filter((y) => y.name === name).sort((a, b) => both(x.before, b.id) - both(x.before, a.id))[0]
    return s && { name, id: s.id }
  }).filter(Boolean), [x.segments, x.before])
  const drop = (list, ids) => { const d = new Set(ids); setC({ ...c, [list]: c[list].filter((k) => !d.has(k)) }) }
  return (
    <>
      <Panel title="Zamknij ulicę" help={(
        <>
          <p>
            Naciśnij odcinki na mapie albo wyszukaj ulicę na górze, potem „Oblicz objazdy”. Model rozkłada 556 tys. przejazdów samochodów na sieć
            ulic tak, by każdy jechał najszybszą trasą przy ruchu, jaki tworzą wszyscy, i pokazuje, gdzie go ubędzie
            i przybędzie.
          </p>
          <p>
            Jest dopasowany do liczb z 228 przekrojów. Dla przekrojów, których nie widział, mediana błędu to 17%,
            a co dziesiąty myli się o ponad 52%. Nadaje się do pytania „które ulice i mniej więcej o ile”, nie do
            dokładnych liczb na małych ulicach, minut opóźnienia ani przepustowości skrzyżowań.
          </p>
        </>
      )}>
        <Field label="Naciśnięcie ulicy">
          <Chips tight label="Co robi naciśnięcie" onPick={(tool) => setC({ ...c, tool })} items={[
            { key: 'close', label: 'zamyka', on: c.tool === 'close' }, { key: 'narrow', label: 'zwęża o połowę', on: c.tool === 'narrow' }]} />
          <Chips tight label="Ile" onPick={(k) => setC({ ...c, whole: k === 'whole' })} items={[
            { key: 'one', label: 'jeden odcinek', on: !c.whole }, { key: 'whole', label: 'całą ulicę', on: c.whole }]} />
          <Hint>Shift + naciśnięcie: {c.whole ? 'jeden odcinek' : 'cała ulica'}.</Hint>
        </Field>
        {!c.closed.length && !c.narrow.length && (
          <Field label="Na początek">
            <Chips tight small label="Przykłady" onPick={(name) => setC(pickIn(x, ideas.find((i) => i.name === name).id, 'close', true))}
              items={ideas.map((i) => ({ key: i.name, label: i.name }))} />
          </Field>
        )}
        {shut.length > 0 && (
          <Field label="Zamknięte">
            <Chips tight small label="Zamknięte — naciśnij, aby otworzyć" onPick={(name) => drop('closed', shut.find((s) => s.name === name).list)}
              items={shut.map((s) => ({ key: s.name, on: true, label: `${s.name}, ${fmt(s.m)} m ×` }))} />
          </Field>
        )}
        {thin.length > 0 && (
          <Field label="Zwężone o połowę">
            <Chips tight small label="Zwężone — naciśnij, aby cofnąć" onPick={(name) => drop('narrow', thin.find((s) => s.name === name).list)}
              items={thin.map((s) => ({ key: s.name, on: true, label: `${s.name}, ${fmt(s.m)} m ×` }))} />
          </Field>
        )}
        {(c.closed.length > 0 || c.narrow.length > 0) && <LinkButton block onClick={() => setC({ ...c, closed: [], narrow: [] })}>Otwórz wszystko</LinkButton>}
        <Vanish c={c} setC={setC} />
        {x.error && <Warn>Nie udało się policzyć: {x.error}</Warn>}
      </Panel>
    </>
  )
}

// ------------------------------------------------------- how much will disappear
const STEP = 5              // percent a column of dots
const FROM = -30
const TO = 105              // and everything above
const COLS = (TO - FROM) / STEP
const colOf = (v) => Math.floor((Math.max(FROM, Math.min(TO - 1, v)) - FROM) / STEP)
const CW = 10
const CH = 8.4

const DOTS = (() => {
  const high = new Array(COLS).fill(0)
  return ['b', 'c', 'l', ''].flatMap((kind) => CASES.filter((q) => q.kind === kind))
    .map((q) => { const col = colOf(q.v); return { ...q, col, at: high[col]++ } })
})()
const TALL = Math.max(...DOTS.map((d) => d.at)) + 1
const pct = (v) => `${v > 0 ? '−' : v < 0 ? '+' : ''}${String(Math.abs(v)).replace('.', ',')}%`

/** What was measured elsewhere, a dot a case; a press takes its share. */
function Cases({ share, onPick }) {
  const [at, setAt] = useState(null)
  const H = TALL * CH
  const X = (v) => ((v - FROM) / STEP) * CW
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 6 }}>O ile ubyło ruchu w {CASES.length} zmierzonych przypadkach</div>
      <svg viewBox={`0 0 ${COLS * CW} ${H + 16}`} width="100%" role="img" style={{ display: 'block', overflow: 'visible' }}
        aria-label="63 zmierzone przypadki: o ile ubyło ruchu" onPointerLeave={() => setAt(null)}>
        <rect x={X(1.2)} width={X(33.5) - X(1.2)} y={0} height={H} fill="currentColor" opacity="0.07" />
        <line x1={X(100 * share)} x2={X(100 * share)} y1={-2} y2={H + 2} stroke="currentColor" strokeWidth="1.4" />
        {DOTS.map((d) => (
          <circle key={d.name + d.v} cx={(d.col + 0.5) * CW} cy={H - (d.at + 0.5) * CH} r={at === d ? 4.4 : 3.3} fill={KINDS[d.kind].color}
            stroke={at === d ? 'currentColor' : 'none'} />
        ))}
        {/* targets bigger than the dots */}
        {DOTS.map((d) => (
          <rect key={d.name + d.v} x={d.col * CW} y={H - (d.at + 1) * CH} width={CW} height={CH} fill="transparent" style={{ cursor: d.v >= 0 && d.v <= MOST ? 'pointer' : 'default' }}
            onPointerEnter={() => setAt(d)} onClick={() => { setAt(d); if (d.v >= 0 && d.v <= MOST) onPick(Math.round(d.v)) }} />
        ))}
        <line x1={0} x2={COLS * CW} y1={H + 0.5} y2={H + 0.5} stroke="currentColor" opacity="0.3" />
        {[[-25, '+25%'], [0, '0'], [25, '−25%'], [50, '−50%'], [75, '−75%'], [100, '−100%']].map(([q, label]) => (
          <text key={q} x={X(q)} y={H + 13} fontSize="9.5" textAnchor={q === 100 ? 'end' : 'middle'} dx={q === 100 ? 5 : 0} fill="currentColor" opacity="0.7">{label}</text>
        ))}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 11, marginTop: 4, minHeight: 32, alignContent: 'flex-start' }}>
        {at ? <span><b>{pct(at.v)}</b> {at.name}</span> : Object.entries(KINDS).map(([k, q]) => (
          <span key={k} style={{ whiteSpace: 'nowrap', opacity: 0.85 }}><span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: 4, background: q.color, marginRight: 4 }} />{q.label}</span>
        ))}
      </div>
    </div>
  )
}

function Vanish({ c, setC }) {
  const now = Math.round(100 * c.reduce)
  const set = (v) => setC({ ...c, reduce: v / 100 })
  const known = ASSUME.find((a) => a.key === now)
  return (
    <Field label={`Przejazdów, które znikną: ${now}%`} help={(
      <>
        <p>
          Część kierowców zmienia środek transportu, cel albo porę, zamiast jechać objazdem. To założenie, nie wynik
          modelu: wybierz je według tego, co zmierzono gdzie indziej. Liczy się od przejazdów przez zamknięte
          i zwężone odcinki — tak samo, jak w badaniach.
        </p>
        <p>
          Kropka to jeden zmierzony przypadek; szare tło — środkowa połowa wyników (od −1 do −34%). Mosty i tunele mają
          rozrzut od +2 do −80%, ale zwykle liczono je kilka tygodni po zamknięciu. Duże spadki
          w śródmieściach to zwykle wiele zmian naraz, przez lata. Część ruchu mogła pojechać ulicami, na których nie liczono.
        </p>
        <p>We Wrocławiu tego nie zmierzono. Najlepiej policzyć dwa razy: przy 0% i przy 11%.</p>
        <ul style={{ paddingLeft: 16, margin: 0 }}>
          {SOURCES.map((s) => (
            <li key={s.name}><a href={s.url} target="_blank" rel="noreferrer">{s.name}</a>: {s.says}{s.brief ? ' (za streszczeniem)' : ''}</li>
          ))}
        </ul>
      </>
    )}>
      <Slider min="0" max={String(MOST)} step="1" value={now} label="Przejazdów, które znikną" onChange={set} />
      <Chips tight small label="Założenia z badań" onPick={(k) => set(+k)} items={ASSUME.map((a) => ({ key: String(a.key), label: `${a.key}%`, on: a.key === now }))} />
      {known && <Hint>{known.key}%: {known.note}</Hint>}
      <Cases share={c.reduce} onPick={set} />
    </Field>
  )
}

// ---------------------------------------------------------- the button on the map
const bar = {
  position: 'absolute', top: 14, left: '50%', zIndex: 1000, whiteSpace: 'nowrap', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12,
  padding: '8px 10px 8px 14px', borderRadius: 10, background: 'var(--kit-float)', color: 'var(--kit-text)', fontSize: 13,
  boxShadow: '0 4px 18px var(--kit-shadow)', border: '1px solid var(--kit-line)', maxWidth: 'calc(100% - 24px)', flexWrap: 'wrap', justifyContent: 'center',
}
const button = { border: 0, borderRadius: 7, padding: '8px 14px', font: '600 13px system-ui', cursor: 'pointer', background: '#ff3b5c', color: '#fff' }

/** What is picked, and working it out: over the map. */
export function ClosureBar({ x, setC }) {
  // clear of the panel where it lies over the map
  const box = useRef(null)
  const [side, setSide] = useState(0)
  useEffect(() => {
    const measure = () => {
      const map = box.current?.offsetParent?.getBoundingClientRect()
      const panel = document.querySelector('.kit-details')?.getBoundingClientRect()
      setSide(map && panel && !isPhone() ? Math.max(0, Math.min(map.right - panel.left, map.width - 180)) : 0)
    }
    measure()
    const seen = new ResizeObserver(measure)
    if (box.current?.offsetParent) seen.observe(box.current.offsetParent)
    return () => seen.disconnect()
  }, [x.empty])
  if (x.empty) return null
  const { c } = x
  const n = c.closed.length + c.narrow.length
  const m = [...c.closed, ...c.narrow].reduce((a, k) => a + x.segments[k].len, 0)
  const busy = x.part != null
  const warming = busy && x.prep < 1
  const share = warming ? x.prep : x.part
  const done = x.result && !x.stale
  return (
    <div ref={box} style={isPhone() ? { ...bar, top: 'auto', bottom: 96 } : { ...bar, left: `calc((100% - ${side}px) / 2)`, maxWidth: `calc(100% - ${side + 24}px)` }} role="region" aria-label="Zamknięte ulice">
      {busy ? (
        <div style={{ width: 240 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <span>{warming ? 'Przygotowanie modelu…' : 'Liczenie objazdów…'}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(100 * share)}%</span>
          </div>
          <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * share)}
            style={{ height: 8, borderRadius: 4, background: 'var(--kit-track)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${100 * share}%`, background: '#ff3b5c' }} />
          </div>
        </div>
      ) : (
        <>
          <span>
            <b>{n} {n === 1 ? 'odcinek' : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? 'odcinki' : 'odcinków'}</b>
            <span style={{ opacity: 0.7 }}> · {fmt(m)} m{x.stale ? ' · wynik nieaktualny' : done ? ' · policzone' : ''}</span>
          </span>
          {!done && <button type="button" style={button} onClick={() => x.calculate(c)}>Oblicz objazdy</button>}
          <button type="button" style={{ ...button, background: 'transparent', color: 'var(--kit-text)', border: '1px solid var(--kit-line-strong)', padding: '7px 10px' }}
            onClick={() => setC({ ...c, closed: [], narrow: [] })}>Wyczyść</button>
        </>
      )}
    </div>
  )
}
