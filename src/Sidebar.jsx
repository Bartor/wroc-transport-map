import { memo, useCallback, useMemo, useState } from 'react'
import {
  Chips, Citation, CitePlace, Divider, Field, Hint, HourRange, InfoButton, IS_TOUCH, LegendRow,
  LinkButton, Pair, Panel, RadioCards, RankList, SearchBox, Select, Sidebar as Shell, Slider,
  TaggedList, Toggle, Totals, TotalsTable, Warn, downloadCsv, fmt, fmtEst, sameRange, slug,
} from '@bartor-net/ui-kit'
import { basemapOptions } from '@bartor-net/ui-kit/map'
import {
  LAYERS, ROAD_METRICS, PRESETS, coverageGap, BASIS_LABEL, NET_MODES,
  resolveTarget, headline, VIEWS, viewOf, hourBands,
} from './data'
import { NETWORK_LEGEND } from './NetworkLayer'
import { SIGNAL_FILTERS, signalId } from './SignalsLayer'
import { markersTable } from './csv'
import About from './About'

const COUNTS = {
  road: (d) => d.points.length,
  pt: (d) => d.pt.length,
  bike: (d) => d.bike.length,
  ped: (d) => d.ped.length,
  rail: (d) => d.rail.length,
  survey: (d) => d.survey?.length ?? 0,
}

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

// the node view's mark: a pie of the modes' own colours
const PIE_MARK = 'conic-gradient(#e4572e 0 45%, #c98500 0 60%, #3987e5 0 95%, #0ca30c 0)'

const BASIS_TONE = { measured: 'good', derived: 'fair', assumed: 'weak' }

const options = (o, label = (v) => v.label) => Object.entries(o)
  .map(([value, v]) => ({ value, label: label(v) }))

/** Finding one street is the commonest action, so it stays pinned at the top. */
function Search({ data, markers, onSelect, view, setView }) {
  const search = useCallback((needle) => {
    const hit = (p) => [p.name, p.segment, p.stop, p.short, p.loc, p.id]
      .some((f) => (f || '').toLowerCase().includes(needle))
    const out = []
    const add = (rows, kind, label, sub) => {
      for (const p of rows) {
        if (p.lat && hit(p)) {
          out.push({
            key: `${kind}:${p.id}`, kind, id: p.id, ref: p, color: LAYERS[kind].color,
            label: label(p), sub: `${p.id} · ${sub(p)}`,
          })
        }
      }
    }
    add(data.points, 'road', (p) => p.name, (p) => p.segment)
    add(data.bike, 'bike', (p) => p.name, (p) => p.segment)
    add(data.ped, 'ped', (p) => p.short || p.name, (p) => p.segment)
    add(data.pt, 'pt', (p) => p.stop || p.name, (p) => p.loc)
    return out.slice(0, 20)
  }, [data])

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
  }
  return (
    <SearchBox search={search} onPick={pick} label="Szukaj punktu pomiarowego"
      placeholder="Szukaj ulicy, przystanku, numeru…" />
  )
}

/** Memoised: a hover on the map must not redraw the whole panel. */
export default memo(function Sidebar({
  data, view, setView, visible, survey, setSurvey, range, setRange,
  metric, setMetric, areas, setAreas, hours, period, aggregate, setAggregate,
  wholeDay, setWholeDay, people, roadPeople, setPeople, occupancy, setOccupancy,
  net, setNet, nets, loadNet, basemap, setBasemap, sig, setSig, labels, setLabels,
  markers, onSelect, selected, sheetOpen, setSheetOpen, off,
}) {
  const [about, setAbout] = useState(false)   // the "O mapie" dialog
  const V = VIEWS[view]
  // layers whose measurement window does not cover the selected period
  const gaps = ['pt', 'bike', 'ped', 'rail']
    .filter((k) => visible[k] && coverageGap(data.meta, k, hours))
    .map((k) => LAYERS[k].label)
  if (visible.road && coverageGap(data.meta, 'roadPeak', hours)
    && data.points.some((p) => p.window && (!areas || areas.includes(p.area)))) {
    gaps.unshift('Ruch drogowy na kordonie obszaru (KO)')
  }
  const netMeta = nets[NET_MODES[net.mode].file]?.meta
  const occ = data.meta.carOccupancy

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
  const totalText = (r) => (r.est ? fmtEst(r.v) : fmt(r.v))

  const signalRows = sig.on && data.signals
    ? data.signals.junctions.filter(SIGNAL_FILTERS[sig.filter].test).slice(0, 12)
    : []

  const toggleArea = (a) => {
    const cur = areas || data.meta.areas
    const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]
    setAreas(next.length === data.meta.areas.length ? null : next)
  }

  return (
    <Shell title="KBR Wrocław 2024" subtitle="Pomiary ruchu — przeglądarka map"
      peek={`${period} · ustawienia i wyniki`} expandLabel="Rozwiń panel ustawień i wyników"
      open={sheetOpen} setOpen={setSheetOpen}
      action={(
        <InfoButton label="O mapie i metodzie" onClick={() => setAbout(true)}
          title="O mapie: metoda, terminy pomiarów, utrudnienia" />
      )}
      footer={(
        <>
          Dane: Kompleksowe Badania Ruchu Wrocław 2024, OpenStreetMap, rozkład
          jazdy GTFS Wrocławia. Punkty rowerowe i piesze są geokodowane z opisu
          odcinka, więc ich położenie jest przybliżone.
        </>
      )}>
      {about && <About data={data} onClose={() => setAbout(false)} />}

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
        <Chips onPick={(k) => setRange(PRESETS[k].range)}
          items={Object.entries(PRESETS).map(([key, v]) => (
            { key, label: v.label, on: sameRange(range, v.range) }))} />
        <HourRange range={range} setRange={setRange} bands={hourBands(data, visible)} />
        {/* sits by the slider: moving it is what fixes the gap */}
        {gaps.length > 0 && !wholeDay && (
          <Warn>
            {gaps.join(', ')}: pomiar tylko
            w szczytach — wybrany okres wychodzi poza paski pomiaru, więc część
            jego godzin nie była mierzona.{' '}
            <LinkButton onClick={() => setWholeDay(true)}>Szacuj całą dobę</LinkButton>
          </Warn>
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
        <RadioCards label="Widok" name="view" value={view} onChange={setView}
          options={Object.entries(VIEWS).map(([value, v]) => ({
            value, label: v.label, sub: v.sub, color: v.split ? PIE_MARK : v.color,
            count: v.split ? null : v.layers.reduce((a, l) => a + COUNTS[l](data), 0),
          }))} />

        {/* options that mean something only in the chosen view */}
        {view === 'road' && (
          <>
            <Toggle checked={roadPeople} onChange={setPeople}
              label="Licz osoby w samochodach, nie pojazdy"
              help={(
                <>
                  <p>
                    Samochody osobowe są mnożone przez napełnienie (domyślnie{' '}
                    {occ.default} os./poj., zmienisz je
                    w ustawieniach zaawansowanych).
                  </p>
                  <p>
                    Dostawczych i ciężarowych nie przeliczamy — KBR nie bada ich
                    napełnienia. Pasażerowie autobusów i tramwajów są w widoku
                    węzłów.
                  </p>
                  <p>{occ.note}</p>
                </>
              )} />
            <Field label="Kategorie pojazdów">
              {/* counting people means counting cars; say so rather than
                  leave the last choice showing */}
              <Select value={roadPeople ? 'car' : metric} label="Kategorie pojazdów"
                disabled={roadPeople} onChange={setMetric} options={options(ROAD_METRICS)} />
            </Field>
          </>
        )}
        {['road', 'pt', 'active'].includes(view) && (
          <Toggle checked={aggregate} onChange={setAggregate}
            label="Punkty jako całość — sumuj przekroje"
            help={(
              <p>
                Przekroje jednego punktu (KW_08<b>A</b>, KW_08<b>B</b>…) to osobne
                wloty, jezdnie lub strony ulicy w tym samym miejscu. Razem dają
                ruch przez punkt; osobno — każdy we własnym położeniu.
              </p>
            )} />
        )}

        <Divider />

        <Field label="Etykiety na mapie" help={(
          <p>
            Etykiety stale widoczne przy punktach. Liczby i udziały można
            włączyć razem. Udziały (%) opisują podział modalny, więc pokazują się
            tylko na węzłach. Bez etykiet szczegóły pojawiają się{' '}
            {IS_TOUCH ? 'po dotknięciu punktu' : 'po najechaniu na punkt'}. Przy
            oddaleniu nakładające się etykiety są ukrywane — większe węzły mają
            pierwszeństwo; przybliż mapę, aby zobaczyć więcej.
          </p>
        )}>
          <Pair>
            <Toggle checked={labels.num} label="Liczby (#)"
              onChange={(num) => setLabels({ ...labels, num })} />
            <Toggle checked={labels.pct} label="Udziały (%)"
              onChange={(pct) => setLabels({ ...labels, pct })} />
          </Pair>
        </Field>
        {labels.pct && !V.split && (
          <Warn>
            Udziały opisują podział modalny, więc są tylko w widoku węzłów.{' '}
            <LinkButton onClick={() => setView('nodes')}>Pokaż węzły</LinkButton>
          </Warn>
        )}

        {data.survey && (
          <>
            <Divider />
            <Toggle checked={survey} onChange={setSurvey}
              label={LAYERS.survey.label} swatch={LAYERS.survey.color}
              count={COUNTS.survey(data)} />
          </>
        )}
      </Panel>

      {/* ------------------------------------------------------------ results */}
      <Panel title={`Wyniki — ${period}`}>
        {V.split && totalSum > 0 ? (
          // modes: people, their share, and the share of vehicles beside it
          <TotalsTable
            columns={[{ label: 'osoby' }, { label: '% osób', strong: true },
              ...(vehSum > 0 ? [{ label: '% poj.' }] : [])]}
            rows={totals.map((r) => ({
              key: r.key, label: r.label, color: r.color,
              cells: [totalText(r), `${Math.round((100 * r.v) / totalSum)}%`,
                `${Math.round((100 * r.veh) / vehSum)}%`],
            }))} />
        ) : (
          <Totals rows={totals.map((r) => ({ ...r, value: totalText(r) }))} />
        )}
        {V.split && (
          <Hint>
            Suma po wszystkich węzłach: kto przejeżdża przez kilka węzłów, jest
            liczony w każdym z nich.
          </Hint>
        )}
        <LinkButton block onClick={() => downloadCsv(
          markersTable({ markers, layers: V.layers, period, people, data, off }),
          `kbr-${view}-${slug(period)}.csv`,
        )}>
          Pobierz tabelę wszystkich punktów (CSV)
        </LinkButton>
        <h3>
          {RANK_TITLE[view]
            || (people ? 'Najwięcej osób w samochodach' : 'Najwyższe natężenia na drogach')}
        </h3>
        <RankList items={top.map((m) => ({
          key: `${m.kind}:${m.id}`, title: m.title, sub: m.sub,
          value: headline(m, people) !== m.value ? fmtEst(headline(m, people)) : fmt(m.value),
          on: selected?.kind === m.kind && selected?.id === m.id,
          onPick: () => onSelect({ kind: m.kind, id: m.id, ref: m.ref }),
        }))} />
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
        <Toggle checked={sig.on} onChange={(on) => setSig({ ...sig, on })}
          label="Pokaż skrzyżowania z sygnalizacją"
          count={data.signals?.meta.junctions ?? '—'} />
        {sig.on && data.signals && (
          <>
            <Select value={sig.filter} label="Filtr sygnalizacji"
              onChange={(filter) => setSig({ ...sig, filter })} options={options(SIGNAL_FILTERS)} />
            <RankList items={signalRows.map((s, i) => ({
              key: i, title: s.streets.length ? s.streets.join(' × ') : 'bez nazwy',
              sub: `${s.kind === 'crossing' ? 'przejście' : `${s.arms} wloty`}`
                + `${s.tram ? ' · tramwaj' : ''}${s.runs ? ` · ${fmt(s.runs)} kursów` : ''}`,
              value: fmt(s.v),
              onPick: () => onSelect({ kind: 'signal', id: signalId(s), ref: s }),
            }))} />
            <Hint>Natężenie z modelu — mediana błędu 24%.</Hint>
          </>
        )}
      </Panel>

      <Panel title="Model dla całej sieci" collapsible defaultOpen={false}
        onOpen={() => loadNet(net.mode)}
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
        <Toggle checked={net.on} onChange={(on) => setNet({ ...net, on })}
          label="Pokaż szacunek dla wszystkich ulic" count={netMeta?.edges ?? '—'} />
        {net.on && (
          <>
            <Select value={net.mode} label="Co modelować"
              onChange={(mode) => setNet({ ...net, mode })}
              options={Object.entries(NET_MODES).map(([value, v]) => ({
                value, disabled: nets[v.file] === null,
                label: `${v.label}${data[v.file] ? '' : ' — brak modelu'}`,
              }))} />
            <Slider min="0" max={net.mode === 'road' ? 20000 : 5000}
              step={net.mode === 'road' ? 500 : 100} value={net.min}
              label="Próg wyświetlania odcinków"
              caption={<>Pokazuj powyżej {fmt(net.min)} {NET_MODES[net.mode].unit} w oknie 6–10 i 15–19</>}
              onChange={(min) => setNet({ ...net, min })} />
            <LegendRow items={NETWORK_LEGEND} />
            {netMeta?.measured && <Hint><b>Dane rozkładowe, nie model.</b></Hint>}
            {netMeta && !netMeta.measured && (() => {
              const weak = netMeta.r2cv < 0.4
              const Tone = weak ? Warn : Hint
              return (
                <Tone>
                  R² {netMeta.r2cv}, mediana błędu {Math.round(netMeta.mapeCv * 100)}%
                  {weak && ' — model słaby, tylko „gdzie dużo, gdzie mało"'}.
                </Tone>
              )
            })()}
          </>
        )}
      </Panel>

      <Panel title="Ustawienia zaawansowane" collapsible defaultOpen={false}>
        <Field label={`Napełnienie samochodu: ${occupancy?.toFixed(2)} os./poj.`}
          help={<p>{occ.note}</p>}>
          <Slider min={occ.min * 100} max={occ.max * 100} step="5"
            value={Math.round((occupancy ?? occ.default) * 100)}
            label="Napełnienie samochodu"
            onChange={(v) => setOccupancy(v / 100)} />
          {/* The default is a cited number, so the citation sits with it. */}
          <Citation quote={[
            <>„{occ.table}”</>,
            <>„{occ.question}” — średnio{' '}<b>{occ.value}</b></>,
            <>„{occ.basis}”</>,
          ]}>
            {occ.scope}.{' '}
            {occ.source}:{' '}
            <a href={occ.url} target="_blank" rel="noopener noreferrer">
              strona KBR 2024 w BIP
            </a>
            {' · '}
            <a href={occ.file} target="_blank" rel="noopener noreferrer">
              pobierz załączniki (zip, 33 MB)
            </a>
            <br />
            <CitePlace>{occ.where}</CitePlace>
          </Citation>
          {Math.abs((occupancy ?? 0) - occ.default) > 1e-9 && (
            <Warn>
              Ustawiono ręcznie, inaczej niż w KBR 2024.{' '}
              <LinkButton onClick={() => setOccupancy(occ.default)}>
                Przywróć {String(occ.default).replace('.', ',')}
              </LinkButton>
            </Warn>
          )}
        </Field>

        <Toggle checked={wholeDay} onChange={setWholeDay}
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
            <TaggedList items={Object.entries(data.meta.expansion).map(([k, e]) => ({
              key: k, color: (LAYERS[k] || LAYERS.road).color, title: e.note,
              label: LAYERS[k]?.label || 'Ruch drogowy — kordon obszaru (KO)',
              value: `×${e.factor}`, tag: BASIS_LABEL[e.basis], tone: BASIS_TONE[e.basis],
            }))} />
          )}
        </Toggle>

        {(labels.num || labels.pct) && (
          <Toggle checked={labels.declutter}
            onChange={(declutter) => setLabels({ ...labels, declutter })}
            label="Ukrywaj nakładające się etykiety" />
        )}

        <Field label="Obszary — przekroje drogowe" help={(
          <p>
            Obszary KBR, z których pokazywane są przekroje drogowe — w widoku
            pomiarów drogowych i w węzłach. Pozostałych badań nie filtrują.
          </p>
        )}>
          <Chips tight onPick={toggleArea} items={data.meta.areas.map((a) => (
            { key: a, label: a, on: !areas || areas.includes(a) }))} />
        </Field>

        <Field label="Podkład mapy">
          <Select value={basemap} label="Podkład mapy" onChange={setBasemap}
            options={basemapOptions()} />
        </Field>
      </Panel>
    </Shell>
  )
})
