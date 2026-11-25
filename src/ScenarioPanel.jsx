// "What if it took longer by car": the mode-choice model on the filtered trips.
import { useDeferredValue, useMemo, useState } from 'react'
import { Chips, Field, Hint, LinkButton, Notes, Panel, Slider, TextTable, Warn, fmtEst } from '@bartor-net/ui-kit'
import { prepare, scenario } from './choice'
import { TRIP_PRESETS, modeAt, passing, touching } from './trips'

const ALT = ['walk', 'bike', 'car', 'car', 'pt', 'pt', 'pt', 'pt', 'other']   // by TRIP_MODES
const WHY = { 1: 'work', 10: 'work', 2: 'school', 3: 'uni', 4: 'shop', 5: 'shop' }
const NAMES = { car: 'samochód', pt: 'transport zbiorowy', walk: 'pieszo', bike: 'rower' }
const SCOPES = [['into', 'do centrum'], ['core', 'do lub z centrum'], ['all', 'wszystkie']]
const NONE = { carMin: 0, ptMin: 0, ptWait: 0, scope: 'into' }

// What is asked of one mode only would leave the others nothing to gain from.
const BOUND = ['mode', 'in', 'park', 'reason', 'change', 'easy']

/** The survey's rows as the model wants them. */
function rowsOf(S, idx) {
  const { T, Z } = S
  const c = T.cols
  const id = (k) => (k < Z.count ? Z.zones[k].id : Z.outside[k - Z.count].id)
  return idx.map((i) => ({
    from: id(c.f[i]), to: id(c.t[i]), mode: ALT[modeAt(c.m[i])],
    purpose: WHY[c.a1[i] === 0 ? c.a0[i] : c.a1[i]] || 'other',
    cars: c.hc[i], age: c.ag[i], pass: !!c.ps[i], licence: !!c.lc[i], w: c.w[i],
  }))
}

const pts = (x) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(100 * x).toFixed(1).replace('.', ',')}`
const range = ([a, b]) => `${pts(Math.min(a, b))} … ${pts(Math.max(a, b))}`

export default function ScenarioPanel({ x, choice, onOpen, setT }) {
  const [s, setS] = useState(NONE)
  const set = (o) => setS({ ...s, ...o })
  const late = useDeferredValue(s)
  const model = useMemo(() => (choice ? prepare(choice) : null), [choice])
  const dropped = BOUND.filter((k) => x.t.filters[k]?.length)
  const rows = useMemo(() => {
    if (!model) return []
    const filters = Object.fromEntries(Object.entries(x.t.filters).filter(([k]) => !BOUND.includes(k)))
    return rowsOf(x.S, touching(x.S, passing(x.S, { filters, hours: x.hours }), x.zones, x.way))
  }, [model, x.S, x.t.filters, x.way, x.hours, x.zones])
  const on = late.carMin || late.ptMin || late.ptWait
  const r = useMemo(() => (model && on && rows.length ? scenario(model, rows, late) : null), [model, rows, late, on])
  const core = TRIP_PRESETS[0]
  const isCore = JSON.stringify(x.t.filters.to) === JSON.stringify(core.filters.to)
  // the wider of what the sample and what the choice of model leaves open
  const wide = (k) => [Math.min(r.lo[k], r.spread[k][0]), Math.max(r.hi[k], r.spread[k][1])]
  return (
    <Panel title="Co gdyby — model wyboru środka" collapsible defaultOpen={false} onOpen={onOpen}
      badge={r ? 'wł.' : null} help={(
        <>
          <p>
            Model wyboru środka transportu (zagnieżdżony logit) oszacowany na 15 438 podróżach z badania:
            czas dojścia, jazdy i przesiadek, samochody, prawo jazdy, bilet, wiek, cel. Udziały „teraz” są
            z badania; model podaje tylko zmianę.
          </p>
          <p>
            Dobrze odtwarza, kto czym jeździ (ρ² 0,46 na danych odłożonych), ale na sam czas reaguje słabo
            i niepewnie. Traktuj wynik jako kierunek i rząd wielkości, nie prognozę.
          </p>
        </>
      )}>
      {!choice ? <Hint>Wczytywanie modelu…</Hint> : (
        <>
          <Field label="Których podróży dotyczy">
            <Chips tight small label="Zakres" onPick={(scope) => set({ scope })}
              items={SCOPES.map(([key, label]) => ({ key, label, on: s.scope === key }))} />
          </Field>
          {s.scope === 'into' && !isCore && (
            <Hint>Udziały liczone są dla wszystkich przefiltrowanych podróży.{' '}
              <LinkButton onClick={() => setT({ ...x.t, filters: core.filters })}>Tylko podróże do centrum</LinkButton>
            </Hint>
          )}
          {dropped.length > 0 && <Hint>Bez filtrów dotyczących samego środka transportu: model potrzebuje wszystkich.</Hint>}
          <Slider min="0" max="10" step="1" value={s.carMin} label="Samochód dłużej" onChange={(carMin) => set({ carMin })}
            caption={`Samochodem dłużej o ${s.carMin} min (objazd, szukanie miejsca, dojście z parkingu)`} />
          <Slider min="0" max="10" step="1" value={-s.ptMin} label="Przejazd szybciej" onChange={(v) => set({ ptMin: -v })}
            caption={`Tramwajem i autobusem szybciej o ${-s.ptMin} min jazdy`} />
          <Slider min="0" max="10" step="1" value={-s.ptWait} label="Czekanie krócej" onChange={(v) => set({ ptWait: -v })}
            caption={`Krótsze czekanie o ${-s.ptWait} min`} />
          {r ? (
            <>
              <TextTable head={['', 'teraz', 'po', 'zmiana (p.p.)']} rows={Object.keys(NAMES).map((k) => [
                NAMES[k], `${(100 * r.before[k]).toFixed(1).replace('.', ',')}%`, `${(100 * r.after[k]).toFixed(1).replace('.', ',')}%`,
                <span key={k}><b>{pts(r.delta[k])}</b> <small>({range(wide(k))})</small></span>,
              ])} />
              <Hint>
                Samochodem {fmtEst(Math.abs(r.carTrips.before - r.carTrips.after))} podróży{' '}
                {r.carTrips.after < r.carTrips.before ? 'mniej' : 'więcej'} — z {fmtEst(r.carTrips.before)}.
                W nawiasie zakres między wariantami modelu i próby. {r.n} podróży w próbie.
              </Hint>
              {r.n < 200 && <Warn>Mała próba — poszerz filtry lub okres.</Warn>}
            </>
          ) : <Hint>Przesuń suwak, aby zobaczyć zmianę udziałów.</Hint>}
          <Notes>
            <li>Model opisuje zadeklarowane podróże z jednego dnia, a nie to, co ludzie zrobiliby po zmianie.</li>
            <li>Ankieta nie pyta o ceny, więc nie ocenia opłat ani kosztu parkowania; scenariusze są w minutach.</li>
            <li>Przyjęto, że minuta w samochodzie znaczy tyle co minuta w tramwaju — osobno danych jest za mało.</li>
            <li>Rozkład jazdy z listopada 2026, ankieta z 2024; bez pociągów.</li>
            <li>Reakcje są raczej zaniżone. Nie uwzględnia zmiany celu, liczby podróży ani zatłoczenia.</li>
          </Notes>
        </>
      )}
    </Panel>
  )
}
