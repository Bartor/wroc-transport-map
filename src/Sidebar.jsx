import { useMemo, useState } from 'react'
import {
  LAYERS, ROAD_METRICS, PRESETS, roadVolume, fmt, sumHours, HOUR_LABEL,
  coverageGap, BASIS_LABEL, expand, toPeople, activeCats, NET_MODES, resolveTarget,
} from './data'
import { NETWORK_LEGEND } from './NetworkLayer'
import { SIGNAL_FILTERS } from './SignalsLayer'
import { BASEMAPS } from './basemaps'

const COUNTS = {
  road: (d) => d.points.length,
  pt: (d) => d.pt.length,
  bike: (d) => d.bike.length,
  ped: (d) => d.ped.length,
  rail: (d) => d.rail.length,
  survey: (d) => d.survey?.length ?? 0,
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

/** A checkbox row with its own optional "?" explanation. */
function Option({ checked, onChange, label, swatch, count, help, children }) {
  const [showHelp, setShowHelp] = useState(false)
  return (
    <div className="opt">
      <div className="opt-row">
        <label className="row">
          <input type="checkbox" checked={checked} onChange={onChange} />
          {swatch && <i className="swatch" style={{ background: swatch }} />}
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

const activate = (fn) => ({
  role: 'button',
  tabIndex: 0,
  onClick: fn,
  onKeyDown: (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn() }
  },
})

/** Finding one street is the commonest action, so it stays pinned at the top. */
function Search({ data, markers, onSelect }) {
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

  const pick = (r) => { onSelect(resolveTarget(markers, r.kind, r.ref)); setQ('') }
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
              <span>{r.label}</span><em>{r.sub}</em>
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
  data, visible, setVisible, preset, setPreset, hour, setHour,
  metric, setMetric, areas, setAreas, hours, period, aggregate, setAggregate,
  wholeDay, setWholeDay, people, setPeople, occupancy, setOccupancy,
  net, setNet, basemap, setBasemap, sig, setSig, labels, setLabels,
  markers, onSelect, selected,
}) {
  const catOrder = data.meta.vehCatOrder
  // layers whose measurement window does not cover the selected period
  const gaps = ['pt', 'bike', 'ped', 'rail']
    .filter((k) => visible[k] && coverageGap(data.meta, k, hours))
  const netMeta = data[NET_MODES[net.mode].file]?.meta

  // The map's own marker objects, so selecting one always highlights its dot.
  const top = useMemo(
    () => [...(markers.road || [])].sort((a, b) => b.value - a.value).slice(0, 12),
    [markers],
  )

  const totals = useMemo(() => {
    const cats = activeCats(metric, people)
    const raw = {
      road: data.points.reduce(
        (a, p) => a + roadVolume(data.roadById[p.id], { cats, hours }, catOrder), 0),
      bike: data.bike.reduce((a, p) => a + sumHours(p.byHour, hours), 0),
      ped: data.ped.reduce((a, p) => a + sumHours(p.byHour, hours), 0),
      pt: data.pt.reduce(
        (a, p) => a + Object.values(p.byHour).reduce((b, arr) => b + sumHours(arr, hours), 0), 0),
    }
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [
      k, toPeople(expand(data.meta, k, v, wholeDay), k, occupancy, people),
    ]))
  }, [data, metric, hours, catOrder, wholeDay, people, occupancy])

  const signalRows = sig.on && data.signals
    ? data.signals.junctions.filter(SIGNAL_FILTERS[sig.filter].test).slice(0, 12)
    : []

  return (
    <aside className="sidebar">
      <header>
        <h1>KBR Wrocław 2024</h1>
        <p className="sub">Pomiary ruchu — przeglądarka map</p>
      </header>

      <Search data={data} markers={markers} onSelect={onSelect} />

      {/* ------------------------------------------------------ main controls */}
      <Panel title="Okres" help={(
        <p>
          Wszystkie liczby na mapie to sumy z wybranego okresu, nie wartości
          na godzinę. Suwak wybiera jedną godzinę zamiast okresu.
        </p>
      )}>
        <div className="chips">
          {Object.entries(PRESETS).map(([k, v]) => (
            <button key={k} type="button"
              className={hour == null && preset === k ? 'chip on' : 'chip'}
              onClick={() => { setPreset(k); setHour(null) }}>{v.label}</button>
          ))}
        </div>
        <label className="slider">
          <span>
            {hour == null ? 'Albo jedna godzina' : `Godzina ${HOUR_LABEL(hour)}`}
            {hour != null && (
              <button type="button" className="link" onClick={() => setHour(null)}>
                wróć do okresu
              </button>
            )}
          </span>
          <input type="range" min="0" max="23" value={hour ?? 8}
            onChange={(e) => setHour(Number(e.target.value))} />
        </label>
      </Panel>

      <Panel title="Co pokazać">
        {Object.entries(LAYERS).filter(([k]) => k !== 'survey' || data.survey).map(([k, v]) => (
          <Option key={k} checked={!!visible[k]} label={v.label} swatch={v.color}
            count={COUNTS[k](data)}
            onChange={() => setVisible({ ...visible, [k]: !visible[k] })} />
        ))}

        {gaps.length > 0 && !wholeDay && (
          <p className="warn">
            {gaps.map((g) => LAYERS[g].label).join(', ')}: pomiar tylko
            w szczytach, więc w tym okresie sumy nie są porównywalne z ruchem
            drogowym.{' '}
            <button type="button" className="link" onClick={() => setWholeDay(true)}>
              Szacuj całą dobę
            </button>
          </p>
        )}

        <div className="divider" />

        <Option checked={people} onChange={() => setPeople(!people)}
          label="Licz ludzi, nie pojazdy"
          help={(
            <>
              <p>
                Samochody osobowe są mnożone przez napełnienie (domyślnie{' '}
                {data.meta.carOccupancy.default} os./poj., zmienisz je
                w ustawieniach zaawansowanych).
              </p>
              <p>
                Dostawczych i ciężarowych nie przeliczamy — KBR nie bada ich
                napełnienia. Pasażerowie autobusów i tramwajów są liczeni osobno,
                w swojej warstwie.
              </p>
              <p>{data.meta.carOccupancy.note}</p>
            </>
          )} />

        <Option checked={aggregate} onChange={() => setAggregate(!aggregate)}
          label="Węzły jako całość — podział modalny"
          help={(
            <>
              <p>
                Przekroje jednego punktu (KW_08<b>A</b>, KW_08<b>B</b>…) łączą się
                w jeden węzeł, rysowany jako wykres kołowy podziału modalnego
                w osobach.
              </p>
              <p>
                Węzeł drogowy i punkt pomiaru komunikacji zbiorowej leżące do
                150 m od siebie łączą się w jeden znacznik. Autobusy i tramwaje to
                wtedy pojazdy z przekrojów drogowych × napełnienie zmierzone na
                miejscu; bez pary — średnie napełnienie z pomiarów KBR.
              </p>
              <p>
                W 10 węzłach przekroje leżą po obu stronach jednego skrzyżowania —
                tam suma liczy jadących na wprost podwójnie (dymek to sygnalizuje),
                ale udziały pozostają porównywalne.
              </p>
            </>
          )} />

        <Field label="Etykiety na mapie" help={(
          <p>
            Udziały (%) opisują podział modalny, więc pokazują się tylko na
            węzłach. Przy oddaleniu nakładające się etykiety są ukrywane — większe
            węzły mają pierwszeństwo; przybliż mapę, aby zobaczyć więcej.
          </p>
        )}>
          <select value={labels.mode} aria-label="Etykiety na mapie"
            onChange={(e) => setLabels({ ...labels, mode: e.target.value })}>
            <option value="hover">Tylko po najechaniu</option>
            <option value="num">Zawsze — liczby (#)</option>
            <option value="pct">Zawsze — udziały (%)</option>
          </select>
        </Field>
        {labels.mode === 'pct' && !aggregate && (
          <p className="warn">
            Udziały są liczone dla węzłów.{' '}
            <button type="button" className="link" onClick={() => setAggregate(true)}>
              Włącz węzły
            </button>
          </p>
        )}
      </Panel>

      {/* ------------------------------------------------------------ results */}
      <Panel title={`Wyniki — ${period}`}>
        <div className="totals">
          <div>
            <span>{people ? 'Osoby w samochodach osobowych' : 'Pojazdy'}</span>
            <b>{fmt(totals.road)}</b>
          </div>
          <div><span>Pasażerowie autobusów i tramwajów</span><b>{fmt(totals.pt)}</b></div>
          <div><span>Rowerzyści (punkty rowerowe)</span><b>{fmt(totals.bike)}</b></div>
          <div><span>Piesi (punkty piesze)</span><b>{fmt(totals.ped)}</b></div>
        </div>
        <h3>Najwyższe natężenia na drogach</h3>
        <ol className="top">
          {top.map((m) => (
            <li key={m.id} className={selected?.id === m.id ? 'on' : ''}
              {...activate(() => onSelect({ kind: 'road', id: m.id, ref: m.ref }))}>
              <span>{m.title}</span>
              <em>{m.sub}</em>
              <b>{fmt(m.value)}</b>
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
              <input type="range" min="0"
                max={net.mode === 'road' ? 20000 : 5000}
                step={net.mode === 'road' ? 500 : 100} value={net.min}
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
          <input type="range" min={data.meta.carOccupancy.min * 100}
            max={data.meta.carOccupancy.max * 100} step="5"
            value={(occupancy || 1.3) * 100} aria-label="Napełnienie samochodu"
            onChange={(e) => setOccupancy(Number(e.target.value) / 100)} />
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
                  <i className="swatch" style={{ background: LAYERS[k].color }} />
                  <span>{LAYERS[k].label}</span>
                  <b>×{e.factor}</b>
                  <em className={`basis ${e.basis}`}>{BASIS_LABEL[e.basis]}</em>
                </div>
              ))}
            </div>
          )}
        </Option>

        {labels.mode !== 'hover' && (
          <Option checked={labels.declutter}
            onChange={() => setLabels({ ...labels, declutter: !labels.declutter })}
            label="Ukrywaj nakładające się etykiety" />
        )}

        <Field label="Ruch drogowy — co liczyć" help={(
          <p>
            Wybór kategorii pojazdów dla warstwy ruchu drogowego. Przy włączonym
            „Licz ludzi, nie pojazdy" liczone są zawsze samochody osobowe.
            Obszary poniżej filtrują wyłącznie warstwę ruchu drogowego.
          </p>
        )}>
          <select value={metric} aria-label="Ruch drogowy — co liczyć" disabled={people}
            onChange={(e) => setMetric(e.target.value)}>
            {Object.entries(ROAD_METRICS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
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
