import { useMemo, useState } from 'react'
import {
  LAYERS, ROAD_METRICS, PRESETS, roadVolume, fmt, sumHours, HOUR_LABEL,
  coverageGap, BASIS_LABEL, expand, toPeople, activeCats, NET_MODES,
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
  survey: (d) => d.survey.length,
}


/** Finding one street is the commonest action, so it stays pinned at the top
 *  rather than behind a scroll through ten sections. */
function Search({ data, onSelect }) {
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

  return (
    <div className="search">
      <input type="text" value={q} aria-label="Szukaj punktu pomiarowego"
        placeholder="Szukaj ulicy, przystanku, numeru…"
        onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li key={`${r.kind}:${r.id}`} role="button" tabIndex={0}
              onClick={() => { onSelect({ kind: r.kind, id: r.id, ref: r.ref }); setQ('') }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect({ kind: r.kind, id: r.id, ref: r.ref })
                  setQ('')
                }
              }}>
              <i className="swatch" style={{ background: LAYERS[r.kind].color }} />
              <span>{r.label}</span><em>{r.sub}</em>
            </li>
          ))}
        </ul>
      )}
      {q.trim().length >= 2 && !results.length && (
        <p className="hint">Brak dopasowań.</p>
      )}
    </div>
  )
}

function Collapsible({ title, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section>
      <button className="collapse-head" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <h2>{title}</h2>
        <span className={open ? 'chevron open' : 'chevron'}>▾</span>
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </section>
  )
}

export default function Sidebar({
  data, visible, setVisible, preset, setPreset, hour, setHour,
  metric, setMetric, areas, setAreas, hours, period, aggregate, setAggregate,
  wholeDay, setWholeDay, people, setPeople, occupancy, setOccupancy,
  net, setNet, basemap, setBasemap, sig, setSig, markers, onSelect, selected,
}) {
  const catOrder = data.meta.vehCatOrder
  // layers whose measurement window does not cover the selected period
  const gaps = ['pt', 'bike', 'ped', 'rail']
    .filter((k) => visible[k] && coverageGap(data.meta, k, hours))
  const netMeta = data[NET_MODES[net.mode].file]?.meta

  // Top cross-sections for the current filter. These are the map's own marker
  // objects, so selecting one always highlights the matching dot - including in
  // aggregate mode, where this list used to carry cross-section ids the map no
  // longer had.
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

  return (
    <aside className="sidebar">
      <header>
        <h1>KBR Wrocław 2024</h1>
        <p className="sub">Pomiary ruchu — przeglądarka map</p>
      </header>

      <Search data={data} onSelect={onSelect} />

      <section>
        <h2>Okres</h2>
        <div className="chips">
          {Object.entries(PRESETS).map(([k, v]) => (
            <button key={k} className={hour == null && preset === k ? 'chip on' : 'chip'}
              onClick={() => { setPreset(k); setHour(null) }}>{v.label}</button>
          ))}
        </div>
        <label className="slider">
          <span>{hour == null ? 'Pojedyncza godzina' : `Godzina ${HOUR_LABEL(hour)}`}</span>
          <input type="range" min="0" max="23" value={hour ?? 8}
            onChange={(e) => setHour(Number(e.target.value))} />
          {hour != null && (
            <button className="link" onClick={() => setHour(null)}>wróć do okresu</button>
          )}
        </label>
      </section>

      <Collapsible title="Podkład">
        <select value={basemap} aria-label="Podkład mapy"
          onChange={(e) => setBasemap(e.target.value)}>
          {Object.entries(BASEMAPS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </Collapsible>

      <Collapsible title="Porównywalność danych">
        {gaps.length > 0 && !wholeDay && (
          <p className="warn">
            W wybranym okresie {gaps.map((g) => LAYERS[g].label.toLowerCase()).join(', ')}
            {' '}mierzono tylko w części godzin — sumy tych warstw nie są
            porównywalne z ruchem drogowym.
          </p>
        )}
        <label className="row">
          <input type="checkbox" checked={wholeDay}
            onChange={() => setWholeDay(!wholeDay)} />
          <span>Szacuj całą dobę dla pomiarów szczytowych</span>
        </label>
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
        <p className="hint">
          Ruch drogowy liczono 24 h lub 5:00–21:00. Pasażerów, rowerzystów
          i pieszych liczono wyłącznie w szczytach (6–10 i 15–19; pasażerów
          5–9 i 14–18), więc bez przeliczenia ich „doba” to w rzeczywistości
          8 godzin.
        </p>
      </Collapsible>

      <Collapsible title="Pojazdy czy ludzie">
        <label className="row">
          <input type="checkbox" checked={people}
            onChange={() => setPeople(!people)} />
          <span>Przeliczaj samochody na osoby</span>
        </label>
        {people && (
          <label className="slider">
            <span>Napełnienie samochodu: {occupancy?.toFixed(2)} os./poj.</span>
            <input type="range" min={data.meta.carOccupancy.min * 100}
              max={data.meta.carOccupancy.max * 100} step="5"
              value={(occupancy || 1.3) * 100}
              onChange={(e) => setOccupancy(Number(e.target.value) / 100)} />
          </label>
        )}
        {people && (
          <p className="warn">
            Liczone są tylko samochody osobowe — napełnienia dostawczych
            i ciężarowych KBR nie bada, a pasażerowie autobusów i tramwajów są
            liczeni osobno w warstwie komunikacji zbiorowej.
          </p>
        )}
        <p className="hint">{data.meta.carOccupancy.note}</p>
      </Collapsible>

      <section>
        <h2>Sygnalizacja świetlna</h2>
        <label className="row">
          <input type="checkbox" checked={sig.on}
            onChange={() => setSig({ ...sig, on: !sig.on })} />
          <span>Pokaż skrzyżowania z sygnalizacją</span>
          <b>{data.signals?.meta.junctions ?? '—'}</b>
        </label>
        {sig.on && data.signals && (
          <>
            <select value={sig.filter} aria-label="Filtr sygnalizacji"
              onChange={(e) => setSig({ ...sig, filter: e.target.value })}>
              {Object.entries(SIGNAL_FILTERS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
            <ol className="top">
              {data.signals.junctions
                .filter(SIGNAL_FILTERS[sig.filter].test)
                .slice(0, 12)
                .map((s, i) => (
                  <li key={i} role="button" tabIndex={0}
                    onClick={() => onSelect({ kind: 'signal', id: `${s.lat},${s.lon}`, ref: s })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        onSelect({ kind: 'signal', id: `${s.lat},${s.lon}`, ref: s })
                      }
                    }}>
                    <span>{s.streets.length ? s.streets.join(' × ') : 'bez nazwy'}</span>
                    <em>
                      {s.kind === 'crossing' ? 'przejście' : `${s.arms} wloty`}
                      {s.tram ? ' · tramwaj' : ''}{s.runs ? ` · ${fmt(s.runs)} kursów` : ''}
                    </em>
                    <b>{fmt(s.v)}</b>
                  </li>
                ))}
            </ol>
            <p className="hint">
              {data.signals.meta.signalNodes} sygnalizatorów w OSM tworzy{' '}
              {data.signals.meta.junctions} skrzyżowań, w tym{' '}
              {data.signals.meta.crossings} to samodzielne przejścia dla pieszych.
              {' '}<b>{data.signals.meta.minorNoTram}</b> skrzyżowań łączy wyłącznie
              ulice lokalne i nie obsługuje tramwaju.
            </p>
            <p className="warn">{data.signals.meta.note}</p>
          </>
        )}
      </section>

      <section>
        <h2>Model — cała sieć</h2>
        <label className="row">
          <input type="checkbox" checked={net.on}
            onChange={() => setNet({ ...net, on: !net.on })} />
          <span>Pokaż szacunek dla wszystkich ulic</span>
          <b>{netMeta?.edges ?? '—'}</b>
        </label>
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
                Pokazuj powyżej {fmt(net.min)} {NET_MODES[net.mode].unit} w oknie
                {' '}6–10 i 15–19
              </span>
              <input type="range" min="0"
                max={net.mode === 'road' ? 20000 : 5000}
                step={net.mode === 'road' ? 500 : 100} value={net.min}
                onChange={(e) => setNet({ ...net, min: Number(e.target.value) })} />
            </label>
            <div className="legend">
              {NETWORK_LEGEND.map((l) => (
                <span key={l.label}>
                  <i style={{ background: l.color }} />{l.label}
                </span>
              ))}
            </div>
            {netMeta?.measured && (
              <p className="hint">
                <b>Dane rozkładowe, nie model.</b> {netMeta.note} Źródło:{' '}
                {netMeta.source}.
              </p>
            )}
            {netMeta && !netMeta.measured && (
              <p className={netMeta.r2cv < 0.4 ? 'warn' : 'hint'}>
                Sprawdzian krzyżowy na {netMeta.n} pomiarach:{' '}
                <b>R² {netMeta.r2cv}</b>, mediana błędu{' '}
                <b>{Math.round(netMeta.mapeCv * 100)}%</b>, dla 10% najgorszych
                odcinków błąd sięga {Math.round(netMeta.p90ApeCv * 100)}%.
                {netMeta.r2cv < 0.4 && ' Model słaby — traktuj wyłącznie jako wskazanie, gdzie jest dużo, a gdzie mało.'}
              </p>
            )}
          </>
        )}
        <p className="hint">
          Model, nie pomiar. Graf skierowany z OSM, rozkład ruchu najszybszymi
          trasami ze źródeł w miejscach zamieszkania z próby ankietowej, potem
          regresja na log natężenia, z liczbą ulic zbiegających się na obu
          końcach odcinka jako miarą rangi drogi. Skala podąża za wybranym
          okresem.
        </p>
        {netMeta?.ceiling && (
          <p className="hint">{netMeta.ceiling}</p>
        )}
      </section>

      <Collapsible title="Punkty i przekroje">
        <label className="row">
          <input type="checkbox" checked={aggregate}
            onChange={() => setAggregate(!aggregate)} />
          <span>Sumuj przekroje do punktu pomiarowego</span>
        </label>
        <p className="hint">
          Litera w numerze (KW_08<b>A</b>, KW_08<b>B</b>) to przekrój — osobny
          wlot, jezdnia lub strona ulicy w tym samym miejscu. Włącz, żeby
          zobaczyć ruch całego punktu zamiast pojedynczego wlotu.
        </p>
      </Collapsible>

      <section>
        <h2>Warstwy</h2>
        {Object.entries(LAYERS).map(([k, v]) => (
          <label key={k} className="row">
            <input type="checkbox" checked={!!visible[k]}
              onChange={() => setVisible({ ...visible, [k]: !visible[k] })} />
            <i className="swatch" style={{ background: v.color }} />
            <span>{v.label}</span>
            <b>{COUNTS[k](data)}</b>
          </label>
        ))}
      </section>

      <Collapsible title="Ruch drogowy — co liczyć">
        <select value={metric} aria-label="Ruch drogowy — co liczyć"
          onChange={(e) => setMetric(e.target.value)}>
          {Object.entries(ROAD_METRICS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <p className="hint">Poniższe obszary filtrują wyłącznie warstwę ruchu drogowego.</p>
        <div className="chips tight">
          {data.meta.areas.map((a) => {
            const on = !areas || areas.includes(a)
            return (
              <button key={a} className={on ? 'chip on' : 'chip'}
                onClick={() => {
                  const cur = areas || data.meta.areas
                  const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]
                  setAreas(next.length === data.meta.areas.length ? null : next)
                }}>{a}</button>
            )
          })}
        </div>
      </Collapsible>

      <section className="totals">
        <h2>Suma — {period}</h2>
        <div><span>{people ? 'Osoby w samochodach osobowych' : 'Pojazdy'} (wszystkie przekroje)</span><b>{fmt(totals.road)}</b></div>
        <div><span>Pasażerowie autobusów i tramwajów</span><b>{fmt(totals.pt)}</b></div>
        <div><span>Rowerzyści (punkty rowerowe)</span><b>{fmt(totals.bike)}</b></div>
        <div><span>Piesi (punkty piesze)</span><b>{fmt(totals.ped)}</b></div>
      </section>

      <section>
        <h2>Najwyższe natężenia — {period}</h2>
        <ol className="top">
          {top.map((m) => (
            <li key={m.id} role="button" tabIndex={0}
              className={selected?.id === m.id ? 'on' : ''}
              onClick={() => onSelect({ kind: 'road', id: m.id, ref: m.ref })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect({ kind: 'road', id: m.id, ref: m.ref })
                }
              }}>
              <span>{m.title}</span>
              <em>{m.sub}</em>
              <b>{fmt(m.value)}</b>
            </li>
          ))}
        </ol>
      </section>

      <footer>
        Dane: Kompleksowe Badania Ruchu Wrocław 2024. Podkład: OpenStreetMap.<br />
        Punkty rowerowe i piesze nie mają współrzędnych w źródle — są
        geokodowane z opisu odcinka, więc ich położenie jest przybliżone.
      </footer>
    </aside>
  )
}
