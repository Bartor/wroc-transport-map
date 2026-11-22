import { useMemo, useState } from 'react'
import {
  LAYERS, ROAD_METRICS, PRESETS, fmt, sameRange, coverageGap, BASIS_LABEL, NET_MODES,
  resolveTarget, headline, fmtEst, VIEWS, viewOf,
} from './data'
import { NETWORK_LEGEND } from './NetworkLayer'
import { SIGNAL_FILTERS } from './SignalsLayer'
import { BASEMAPS } from './basemaps'
import HourRange from './HourRange'
import { useSheetDrag } from './sheetDrag'

const COUNTS = {
  road: (d) => d.points.length,
  pt: (d) => d.pt.length,
  bike: (d) => d.bike.length,
  ped: (d) => d.ped.length,
  rail: (d) => d.rail.length,
  survey: (d) => d.survey?.length ?? 0,
}

// Touch screens cannot hover, so hover-only wording is wrong there.
const TOUCH = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

// What a view's totals and ranking are called.
const TOTAL_LABEL = {
  pt: 'Pasażerowie na badanych przystankach',
  bike: 'Rowerzyści',
  ped: 'Piesi',
  rail: 'Pasażerowie pociągów na kordonie',
}
const RANK_TITLE = {
  nodes: 'Najwięcej osób w węzłach — wszystkie środki',
  pt: 'Najwięcej pasażerów',
  active: 'Najwięcej rowerzystów i pieszych',
  rail: 'Kordony kolejowe',
}

// ---------------------------------------------------------------- building blocks

/** "?" that reveals the full explanation. The sidebar used to print every
 *  caveat in full, which buried the controls under paragraphs; the text is
 *  still one click away, next to the thing it explains. */
function HelpButton({ open, onClick }) {
  return (
    <button type="button" className={open ? 'help-btn on' : 'help-btn'}
      aria-expanded={open} aria-label="Wyjaśnienie" title="Wyjaśnienie" onClick={onClick}>
      ?
    </button>
  )
}

function Panel({ title, help, collapsible = false, defaultOpen = true, badge, children }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showHelp, setShowHelp] = useState(false)
  return (
    <section className={collapsible ? 'panel collapsible' : 'panel'}>
      <div className="panel-head">
        {collapsible ? (
          <button type="button" className="collapse-head" aria-expanded={open}
            onClick={() => setOpen(!open)}>
            <span className={open ? 'chevron open' : 'chevron'}>▸</span>
            <h2>{title}</h2>
            {badge != null && <span className="badge">{badge}</span>}
          </button>
        ) : <h2>{title}</h2>}
        {help && <HelpButton open={showHelp} onClick={() => setShowHelp(!showHelp)} />}
      </div>
      {showHelp && <div className="info-body">{help}</div>}
      {open && <div className="panel-body">{children}</div>}
    </section>
  )
}

/** A checkbox row with its own optional "?" explanation.
 *
 *  A layer (it has a colour) is a checkbox filled with that colour, which
 *  doubles as its legend swatch; a setting is drawn as a switch. Telling the two
 *  apart at a glance matters more than it seems: both used to look identical. */
function Option({ checked, onChange, label, swatch, count, help, children }) {
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div className="opt">
      <div className="opt-row">
        <label className="row">
          <input type="checkbox" checked={checked} onChange={onChange}
            className={swatch ? 'check' : 'switch'}
            style={swatch ? { '--c': swatch } : undefined} />
          <span>{label}</span>
          {count != null && <b>{count}</b>}
        </label>
        {help && <HelpButton open={showHelp} onClick={() => setShowHelp(!showHelp)} />}
      </div>
      {showHelp && <div className="info-body">{help}</div>}
      {children}
    </div>
  )
}

/** A labelled control (select, slider) with its own optional "?". */
function Field({ label, help, children }) {
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div className="field">
      <div className="field-head">
        <span>{label}</span>
        {help && <HelpButton open={showHelp} onClick={() => setShowHelp(!showHelp)} />}
      </div>
      {showHelp && <div className="info-body">{help}</div>}
      {children}
    </div>
  )
}

/** A styled range input. The filled part of the track is drawn from --pct,
 *  since only Firefox can style a range's progress natively. `idle` greys it
 *  out for a control that is present but not currently in effect. */
function Range({ value, min, max, idle, ticks, ...rest }) {
  const lo = Number(min)
  const hi = Number(max)
  const pct = hi > lo ? ((Number(value) - lo) / (hi - lo)) * 100 : 0
  return (
    <div className={idle ? 'range-wrap idle' : 'range-wrap'}>
      <input type="range" className="range" value={value} min={min} max={max}
        style={{ '--pct': `${pct}%` }} {...rest} />
      {ticks && (
        <div className="range-ticks" aria-hidden="true">
          {ticks.map((t) => (
            // thumb centres travel between 9px and (width - 9px)
            <span key={t} style={{ left: `calc(9px + (100% - 18px) * ${(t - lo) / (hi - lo)})` }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const activate = (fn) => ({
  role: 'button',
  tabIndex: 0,
  onClick: fn,
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
  },
})

/** Finding one street is the commonest action, so it stays pinned at the top. */
function Search({ data, markers, onSelect, view, setView }) {
  const [q, setQ] = useState('')
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (needle.length < 2) return []
    const hit = (p) => [p.name, p.segment, p.stop, p.short, p.loc, p.id]
      .some((f) => (f || '').toLowerCase().includes(needle))
    const out = []
    const add = (rows, kind, label, sub) => {
      for (const p of rows) {
        if (p.lat && hit(p)) out.push({ kind, id: p.id, ref: p, label: label(p), sub: sub(p) })
      }
    }
    add(data.points, 'road', (p) => p.name, (p) => p.segment)
    add(data.bike, 'bike', (p) => p.name, (p) => p.segment)
    add(data.ped, 'ped', (p) => p.short || p.name, (p) => p.segment)
    add(data.pt, 'pt', (p) => p.stop || p.name, (p) => p.loc)
    return out.slice(0, 20)
  }, [q, data])

  // A result from another survey switches to its view; the markers of that
  // view do not exist yet, so the raw record is selected and found inside
  // its point by the panel.
  const pick = (r) => {
    const next = viewOf(r.kind, view)
    if (next !== view) {
      setView(next)
      onSelect({ kind: r.kind, id: r.id, ref: r.ref })
    } else {
      onSelect(resolveTarget(markers, r.kind, r.ref))
    }
    setQ('')
  }
  return (
    <div className="search">
      <input type="text" value={q} aria-label="Szukaj punktu pomiarowego"
        placeholder="Szukaj ulicy, przystanku, numeru…"
        onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={`${r.kind}:${r.id}`} {...activate(() => pick(r))}>
              <i className="swatch" style={{ background: LAYERS[r.kind].color }} />
              <span>{r.label}</span><em>{r.id} · {r.sub}</em>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !results.length && <p className="hint">Brak dopasowań.</p>}
    </div>
  )
}

// ----------------------------------------------------------------------- sidebar

export default function Sidebar({
  data, view, setView, visible, survey, setSurvey, range, setRange,
  metric, setMetric, areas, setAreas, hours, period, aggregate, setAggregate,
  wholeDay, setWholeDay, people, roadPeople, setPeople, occupancy, setOccupancy,
  net, setNet, basemap, setBasemap, sig, setSig, labels, setLabels,
  markers, onSelect, selected, sheetOpen, setSheetOpen,
}) {
  const V = VIEWS[view]
  // phones: the sidebar is a bottom sheet, dragged by its header
  const sheet = useSheetDrag(sheetOpen, setSheetOpen)
  // layers whose measurement window does not cover the selected period
  const gaps = ['pt', 'bike', 'ped', 'rail']
    .filter((k) => visible[k] && coverageGap(data.meta, k, hours))
    .map((k) => LAYERS[k].label)
  if (visible.road && coverageGap(data.meta, 'roadPeak', hours)
    && data.points.some((p) => p.window && (!areas || areas.includes(p.area)))) {
    gaps.unshift('Ruch drogowy na kordonie obszaru (KO)')
  }
  const netMeta = data[NET_MODES[net.mode].file]?.meta

  // Everything drawn in this view, as the map draws it: the totals and the
  // ranking are sums of the markers themselves, so they always agree with it.
  const drawn = useMemo(() => V.layers.flatMap((k) => markers[k] || []), [V, markers])

  // Ranked by the same number the tooltip leads with.
  const top = useMemo(
    () => [...drawn].sort((a, b) => headline(b, people) - headline(a, people)).slice(0, 12),
    [drawn, people],
  )

  // Per mode across the node pies, or per layer otherwise.
  const totals = useMemo(() => {
    if (V.split) {
      const by = {}
      for (const m of drawn) {
        for (const s of m.split?.slices || []) {
          by[s.key] = by[s.key]
            || { key: s.key, label: s.label, color: s.color, v: 0, veh: 0, est: false }
          by[s.key].v += s.persons
          by[s.key].veh += s.vehicles || 0
          by[s.key].est ||= s.est
        }
      }
      return Object.values(by).filter((r) => r.v > 0).sort((a, b) => b.v - a.v)
    }
    return V.layers.map((k) => ({
      key: k,
      label: k === 'road'
        ? (people ? 'Osoby w samochodach osobowych' : `Pojazdy — ${ROAD_METRICS[metric].label.toLowerCase()}`)
        : TOTAL_LABEL[k],
      color: LAYERS[k].color,
      v: (markers[k] || []).reduce((a, m) => a + m.value, 0),
    }))
  }, [V, drawn, markers, people, metric])
  const totalSum = totals.reduce((a, r) => a + r.v, 0)
  const vehSum = totals.reduce((a, r) => a + (r.veh || 0), 0)

  const signalRows = sig.on && data.signals
    ? data.signals.junctions.filter(SIGNAL_FILTERS[sig.filter].test).slice(0, 12)
    : []

  return (
    <aside className={`sidebar${sheetOpen ? ' open' : ''}${sheet.dy != null ? ' dragging' : ''}`}
      style={sheet.dy != null ? {
        transform: sheetOpen ? `translateY(${sheet.dy}px)`
          : `translateY(calc(100% - 62px + ${sheet.dy}px))`,
      } : undefined}>
      {/* On phones the header is the sheet's handle; on desktop the button is
          hidden and the header is just a title. */}
      <header>
        <button type="button" className="sheet-handle" aria-expanded={sheetOpen}
          aria-label={sheetOpen ? 'Zwiń panel' : 'Rozwiń panel ustawień i wyników'}
          onClick={() => setSheetOpen(!sheetOpen)} {...sheet.handlers}>
          <span className="grip" />
          <span className="sheet-title">
            <b>KBR Wrocław 2024</b>
            <em>{sheetOpen ? 'Zwiń' : `${period} · ustawienia i wyniki`}</em>
          </span>
          <span className={sheetOpen ? 'chevron open' : 'chevron'}>▴</span>
        </button>
        <h1>KBR Wrocław 2024</h1>
        <p className="sub">Pomiary ruchu — przeglądarka map</p>
      </header>

      <Search data={data} markers={markers} onSelect={onSelect} view={view} setView={setView} />

      {/* ------------------------------------------------------ main controls */}
      <Panel title="Okres" help={(
        <p>
          Wszystkie liczby na mapie to sumy z wybranego okresu, nie wartości
          na godzinę. Przyciski to gotowe okresy; suwak ustawia dowolny —
          przeciągnij uchwyty albo kliknij pasek. Początek za końcem oznacza
          okres przez północ.
        </p>
      )}>
        <div className="chips">
          {Object.entries(PRESETS).map(([k, v]) => (
            <button key={k} type="button"
              className={sameRange(range, v.range) ? 'chip on' : 'chip'}
              onClick={() => setRange(v.range)}>{v.label}</button>
          ))}
        </div>
        <HourRange data={data} visible={visible} range={range} setRange={setRange} />
        {/* sits by the slider: moving it is what fixes the gap */}
        {gaps.length > 0 && !wholeDay && (
          <p className="warn">
            {gaps.join(', ')}: pomiar tylko
            w szczytach — wybrany okres wychodzi poza paski pomiaru, więc część
            jego godzin nie była mierzona.{' '}
            <button type="button" className="link" onClick={() => setWholeDay(true)}>
              Szacuj całą dobę
            </button>
          </p>
        )}
      </Panel>

      <Panel title="Co pokazać" help={(
        <>
          <p>
            Każdy widok to jedno badanie KBR: własna jednostka, godziny i zasięg.
            Liczby z różnych badań nie są porównywalne — pojazdy na przekrojach
            drogowych to nie pasażerowie na kilku przystankach — więc mapa
            pokazuje jedno naraz.
          </p>
          <p>
            <b>Węzły</b> to jedyne miejsce, gdzie badania się spotykają, celowo
            i w jednej jednostce — osobach. Przekroje jednego punktu łączą się
            w węzeł, a punkt pomiaru komunikacji zbiorowej do 150 m dalej daje
            mu napełnienie: autobusy i tramwaje to pojazdy z przekrojów
            drogowych × pasażerowie na pojazd zmierzeni na miejscu (bez pary —
            średnia z pomiarów KBR).
          </p>
          <p>
            W 10 węzłach przekroje leżą po obu stronach jednego skrzyżowania —
            tam suma liczy jadących na wprost podwójnie (dymek to sygnalizuje),
            ale udziały pozostają porównywalne.
          </p>
        </>
      )}>
        <div className="views" role="radiogroup" aria-label="Widok">
          {Object.entries(VIEWS).map(([k, v]) => (
            <label key={k} className={view === k ? 'view on' : 'view'}>
              <input type="radio" name="view" checked={view === k}
                onChange={() => setView(k)} />
              <i className={v.split ? 'view-mark pie' : 'view-mark'}
                style={{ '--c': v.color }} />
              <span className="view-text">
                <b>{v.label}</b>
                <em>{v.sub}</em>
              </span>
              {!v.split && <small>{v.layers.reduce((a, l) => a + COUNTS[l](data), 0)}</small>}
            </label>
          ))}
        </div>

        {/* options that mean something only in the chosen view */}
        {view === 'road' && (
          <>
            <Option checked={roadPeople} onChange={() => setPeople(!roadPeople)}
              label="Licz osoby w samochodach, nie pojazdy"
              help={(
                <>
                  <p>
                    Samochody osobowe są mnożone przez napełnienie (domyślnie{' '}
                    {data.meta.carOccupancy.default} os./poj., zmienisz je
                    w ustawieniach zaawansowanych).
                  </p>
                  <p>
                    Dostawczych i ciężarowych nie przeliczamy — KBR nie bada ich
                    napełnienia. Pasażerowie autobusów i tramwajów są w widoku
                    węzłów.
                  </p>
                  <p>{data.meta.carOccupancy.note}</p>
                </>
              )} />
            <Field label="Kategorie pojazdów">
              {/* counting people means counting cars; say so rather than
                  leave the last choice showing */}
              <select value={roadPeople ? 'car' : metric} aria-label="Kategorie pojazdów"
                disabled={roadPeople}
                onChange={(e) => setMetric(e.target.value)}>
                {Object.entries(ROAD_METRICS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        {['road', 'pt', 'active'].includes(view) && (
          <Option checked={aggregate} onChange={() => setAggregate(!aggregate)}
            label="Punkty jako całość — sumuj przekroje"
            help={(
              <p>
                Przekroje jednego punktu (KW_08<b>A</b>, KW_08<b>B</b>…) to osobne
                wloty, jezdnie lub strony ulicy w tym samym miejscu. Razem dają
                ruch przez punkt; osobno — każdy we własnym położeniu.
              </p>
            )} />
        )}

        <div className="divider" />

        <Field label="Etykiety na mapie" help={(
          <p>
            Etykiety stale widoczne przy punktach. Liczby i udziały można
            włączyć razem. Udziały (%) opisują podział modalny, więc pokazują się
            tylko na węzłach. Bez etykiet szczegóły pojawiają się{' '}
            {TOUCH ? 'po dotknięciu punktu' : 'po najechaniu na punkt'}. Przy
            oddaleniu nakładające się etykiety są ukrywane — większe węzły mają
            pierwszeństwo; przybliż mapę, aby zobaczyć więcej.
          </p>
        )}>
          <div className="pair">
            <Option checked={labels.num} label="Liczby (#)"
              onChange={() => setLabels({ ...labels, num: !labels.num })} />
            <Option checked={labels.pct} label="Udziały (%)"
              onChange={() => setLabels({ ...labels, pct: !labels.pct })} />
          </div>
        </Field>
        {labels.pct && !V.split && (
          <p className="warn">
            Udziały opisują podział modalny, więc są tylko w widoku węzłów.{' '}
            <button type="button" className="link" onClick={() => setView('nodes')}>
              Pokaż węzły
            </button>
          </p>
        )}

        {data.survey && (
          <>
            <div className="divider" />
            <Option checked={survey} onChange={() => setSurvey(!survey)}
              label={LAYERS.survey.label} swatch={LAYERS.survey.color}
              count={COUNTS.survey(data)} />
          </>
        )}
      </Panel>

      {/* ------------------------------------------------------------ results */}
      <Panel title={`Wyniki — ${period}`}>
        {V.split && totalSum > 0 ? (
          // modes: people, their share, and the share of vehicles beside it
          <table className="totals-table">
            <thead>
              <tr><th /><th>osoby</th><th>% osób</th>{vehSum > 0 && <th>% poj.</th>}</tr>
            </thead>
            <tbody>
              {totals.map((r) => (
                <tr key={r.key}>
                  <td><i className="swatch" style={{ background: r.color }} />{r.label}</td>
                  <td>{r.est ? fmtEst(r.v) : fmt(r.v)}</td>
                  <td className="pp">{Math.round((100 * r.v) / totalSum)}%</td>
                  {vehSum > 0 && <td>{Math.round((100 * r.veh) / vehSum)}%</td>}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="totals">
            {totals.map((r) => (
              <div key={r.key}>
                <span><i className="swatch" style={{ background: r.color }} />{r.label}</span>
                <b>{r.est ? fmtEst(r.v) : fmt(r.v)}</b>
              </div>
            ))}
          </div>
        )}
        {V.split && (
          <p className="hint">
            Suma po wszystkich węzłach: kto przejeżdża przez kilka węzłów, jest
            liczony w każdym z nich.
          </p>
        )}
        <h3>
          {RANK_TITLE[view]
            || (people ? 'Najwięcej osób w samochodach' : 'Najwyższe natężenia na drogach')}
        </h3>
        <ol className="top">
          {top.map((m) => (
            <li key={`${m.kind}:${m.id}`}
              className={selected?.kind === m.kind && selected?.id === m.id ? 'on' : ''}
              {...activate(() => onSelect({ kind: m.kind, id: m.id, ref: m.ref }))}>
              <span>{m.title}</span>
              <em>{m.sub}</em>
              <b>{headline(m, people) !== m.value ? fmtEst(headline(m, people)) : fmt(m.value)}</b>
            </li>
          ))}
        </ol>
      </Panel>

      {/* ------------------------------------------------------ further down */}
      <Panel title="Sygnalizacja świetlna" collapsible defaultOpen={false}
        badge={sig.on ? 'wł.' : null}
        help={data.signals && (
          <>
            <p>
              {data.signals.meta.signalNodes} sygnalizatorów w OSM tworzy{' '}
              {data.signals.meta.junctions} obiektów, w tym{' '}
              {data.signals.meta.crossings} samodzielnych przejść dla pieszych.{' '}
              {data.signals.meta.minorNoTram} skrzyżowań łączy wyłącznie ulice
              lokalne i nie obsługuje tramwaju.
            </p>
            <p>{data.signals.meta.note}</p>
          </>
        )}>
        <Option checked={sig.on} onChange={() => setSig({ ...sig, on: !sig.on })}
          label="Pokaż skrzyżowania z sygnalizacją"
          count={data.signals?.meta.junctions ?? '—'} />
        {sig.on && data.signals && (
          <>
            <select value={sig.filter} aria-label="Filtr sygnalizacji"
              onChange={(e) => setSig({ ...sig, filter: e.target.value })}>
              {Object.entries(SIGNAL_FILTERS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <ol className="top">
              {signalRows.map((s, i) => (
                <li key={i}
                  {...activate(() => onSelect({ kind: 'signal', id: `${s.lat},${s.lon}`, ref: s }))}>
                  <span>{s.streets.length ? s.streets.join(' × ') : 'bez nazwy'}</span>
                  <em>
                    {s.kind === 'crossing' ? 'przejście' : `${s.arms} wloty`}
                    {s.tram ? ' · tramwaj' : ''}{s.runs ? ` · ${fmt(s.runs)} kursów` : ''}
                  </em>
                  <b>{fmt(s.v)}</b>
                </li>
              ))}
            </ol>
            <p className="hint">Natężenie z modelu — mediana błędu 24%.</p>
          </>
        )}
      </Panel>

      <Panel title="Model dla całej sieci" collapsible defaultOpen={false}
        badge={net.on ? 'wł.' : null}
        help={(
          <>
            <p>
              Model, nie pomiar. Graf skierowany z OSM, rozkład ruchu najszybszymi
              trasami ze źródeł w miejscach zamieszkania z próby ankietowej, potem
              regresja na log natężenia, z liczbą ulic zbiegających się na obu
              końcach odcinka jako miarą rangi drogi. Skala podąża za wybranym
              okresem.
            </p>
            {netMeta?.ceiling && <p>{netMeta.ceiling}</p>}
            {netMeta?.measured && <p>{netMeta.note} Źródło: {netMeta.source}.</p>}
          </>
        )}>
        <Option checked={net.on} onChange={() => setNet({ ...net, on: !net.on })}
          label="Pokaż szacunek dla wszystkich ulic" count={netMeta?.edges ?? '—'} />
        {net.on && (
          <>
            <select value={net.mode} aria-label="Co modelować"
              onChange={(e) => setNet({ ...net, mode: e.target.value })}>
              {Object.entries(NET_MODES).map(([k, v]) => (
                <option key={k} value={k} disabled={!data[v.file]}>
                  {v.label}{data[v.file] ? '' : ' — brak modelu'}
                </option>
              ))}
            </select>
            <label className="slider">
              <span>
                Pokazuj powyżej {fmt(net.min)} {NET_MODES[net.mode].unit} w oknie 6–10 i 15–19
              </span>
              <Range min="0"
                max={net.mode === 'road' ? 20000 : 5000}
                step={net.mode === 'road' ? 500 : 100} value={net.min}
                aria-label="Próg wyświetlania odcinków"
                onChange={(e) => setNet({ ...net, min: Number(e.target.value) })} />
            </label>
            <div className="legend">
              {NETWORK_LEGEND.map((l) => (
                <span key={l.label}><i style={{ background: l.color }} />{l.label}</span>
              ))}
            </div>
            {netMeta?.measured && <p className="hint"><b>Dane rozkładowe, nie model.</b></p>}
            {netMeta && !netMeta.measured && (
              <p className={netMeta.r2cv < 0.4 ? 'warn' : 'hint'}>
                R² {netMeta.r2cv}, mediana błędu {Math.round(netMeta.mapeCv * 100)}%
                {netMeta.r2cv < 0.4 && ' — model słaby, tylko „gdzie dużo, gdzie mało"'}.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Ustawienia zaawansowane" collapsible defaultOpen={false}>
        <Field label={`Napełnienie samochodu: ${occupancy?.toFixed(2)} os./poj.`}
          help={<p>{data.meta.carOccupancy.note}</p>}>
          <Range min={data.meta.carOccupancy.min * 100}
            max={data.meta.carOccupancy.max * 100} step="5"
            value={Math.round((occupancy ?? data.meta.carOccupancy.default) * 100)}
            aria-label="Napełnienie samochodu"
            onChange={(e) => setOccupancy(Number(e.target.value) / 100)} />
          {/* The default is a cited number, so the citation sits with it. */}
          <figure className="cite">
            <blockquote>
              <p>„{data.meta.carOccupancy.table}”</p>
              <p>
                „{data.meta.carOccupancy.question}” — średnio{' '}
                <b>{data.meta.carOccupancy.value}</b>
              </p>
              <p>„{data.meta.carOccupancy.basis}”</p>
            </blockquote>
            <figcaption>
              {data.meta.carOccupancy.scope}.{' '}
              {data.meta.carOccupancy.source}:{' '}
              <a href={data.meta.carOccupancy.url} target="_blank" rel="noopener noreferrer">
                strona KBR 2024 w BIP
              </a>
              {' · '}
              <a href={data.meta.carOccupancy.file} target="_blank" rel="noopener noreferrer">
                pobierz załączniki (zip, 33 MB)
              </a>
              <br />
              <span className="cite-where">{data.meta.carOccupancy.where}</span>
            </figcaption>
          </figure>
          {Math.abs((occupancy ?? 0) - data.meta.carOccupancy.default) > 1e-9 && (
            <p className="warn">
              Ustawiono ręcznie, inaczej niż w KBR 2024.{' '}
              <button type="button" className="link"
                onClick={() => setOccupancy(data.meta.carOccupancy.default)}>
                Przywróć {String(data.meta.carOccupancy.default).replace('.', ',')}
              </button>
            </p>
          )}
        </Field>

        <Option checked={wholeDay} onChange={() => setWholeDay(!wholeDay)}
          label="Szacuj całą dobę dla pomiarów szczytowych"
          help={(
            <p>
              Ruch drogowy liczono 24 h lub 5:00–21:00. Pasażerów, rowerzystów
              i pieszych liczono tylko w szczytach (6–10 i 15–19; pasażerów 5–9
              i 14–18), więc bez przeliczenia ich „doba" to w rzeczywistości
              8 godzin. Najedź na współczynnik, żeby zobaczyć, skąd pochodzi.
            </p>
          )}>
          {wholeDay && (
            <div className="factors">
              {Object.entries(data.meta.expansion).map(([k, e]) => (
                <div key={k} title={e.note}>
                  <i className="swatch" style={{ background: (LAYERS[k] || LAYERS.road).color }} />
                  <span>{LAYERS[k]?.label || 'Ruch drogowy — kordon obszaru (KO)'}</span>
                  <b>×{e.factor}</b>
                  <em className={`basis ${e.basis}`}>{BASIS_LABEL[e.basis]}</em>
                </div>
              ))}
            </div>
          )}
        </Option>

        {(labels.num || labels.pct) && (
          <Option checked={labels.declutter}
            onChange={() => setLabels({ ...labels, declutter: !labels.declutter })}
            label="Ukrywaj nakładające się etykiety" />
        )}

        <Field label="Obszary — przekroje drogowe" help={(
          <p>
            Obszary KBR, z których pokazywane są przekroje drogowe — w widoku
            pomiarów drogowych i w węzłach. Pozostałych badań nie filtrują.
          </p>
        )}>
          <div className="chips tight">
            {data.meta.areas.map((a) => {
              const on = !areas || areas.includes(a)
              return (
                <button key={a} type="button" className={on ? 'chip on' : 'chip'}
                  onClick={() => {
                    const cur = areas || data.meta.areas
                    const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]
                    setAreas(next.length === data.meta.areas.length ? null : next)
                  }}>{a}</button>
              )
            })}
          </div>
        </Field>

        <Field label="Podkład mapy">
          <select value={basemap} aria-label="Podkład mapy"
            onChange={(e) => setBasemap(e.target.value)}>
            {Object.entries(BASEMAPS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </Field>
      </Panel>

      <footer>
        Dane: Kompleksowe Badania Ruchu Wrocław 2024, OpenStreetMap, rozkład
        jazdy GTFS Wrocławia. Punkty rowerowe i piesze są geokodowane z opisu
        odcinka, więc ich położenie jest przybliżone.
      </footer>
    </aside>
  )
}
