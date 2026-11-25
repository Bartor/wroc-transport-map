// The panels of the smaller surveys, see MoreViews.
import {
  Block, DetailsPanel, Fact, Facts, Hint, LinkButton, Notes, ShareButtons, TextTable, fmt, hourRuns,
} from '@bartor-net/ui-kit'
import { HourBars } from '@bartor-net/ui-kit/charts'
import { KIND, airportYear, changeColor, changeLegend, signed, speedOf, sum } from './MoreViews'
import { ringChanges } from './compare'
import Stack, { Bar, partsOf } from './Stack'

const MODAL_COLORS = ['#b5179e', '#0ca30c', '#e4572e', '#3987e5', '#6b7385']
import { changeCard, draw } from './surveyCards'

export function ChangePanel({ C, rows, zones, sel, onRoad, onClose }) {
  const r = sel && rows.find((x) => x.key === sel.id)
  const rail = C.rail.filter((x) => x[0] === 'Wszystkie kordony')
  const st = (name) => C.stations.find((x) => x[0] === name)
  const table = (head, body) => <TextTable head={head} rows={body} />
  return (
    <DetailsPanel pill={r ? r.ids.join(' + ') : '2018 → 2024'} title={r ? r.name : 'Co się zmieniło od 2018 roku'}
      color={r ? changeColor(r.d) : '#676cad'} subtitle={r?.segment} onClose={onClose}
      actions={!r && <ShareButtons filename="kbr2024-zmiana-2018-2024.png" title="Ruch w 2024 wobec 2018" text="KBR Wrocław — ruch w 2024 wobec 2018"
        render={() => draw(changeCard({ rows, zones, rings: ringChanges(rows), legend: changeLegend(), color: changeColor }))} />}>
      {r ? (
        <>
          <Facts>
            <Fact label="2018 → 2024" tone="now">{signed(r.d)}</Fact>
            {r.v10 && <Fact label="2010">{fmt(r.v10)}</Fact>}
            <Fact label="2018">{fmt(r.v18)}</Fact>
            <Fact label="2024">{fmt(r.v24)}</Fact>
          </Facts>
          <Hint>Pojazdy {r.day ? 'w ciągu doby' : 'w godzinach 5:00–21:00'}, jeden dzień w każdej rundzie.</Hint>
          <LinkButton block onClick={() => onRoad(r.ids[0])}>Pokaż pomiar z 2024 na mapie dróg</LinkButton>
        </>
      ) : (
        <>
          <Block>
            <h4>Jak podróżują mieszkańcy</h4>
            {C.modal.rows.map(([l, v]) => (
              <div key={l}><small>{l}</small>
                <Bar height={18} parts={v.map((x, i) => ({ key: String(i), label: C.modal.modes[i], share: x / v.reduce((a, b) => a + b, 0), color: MODAL_COLORS[i] }))} /></div>
            ))}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
              {C.modal.modes.map((l, i) => <span key={l}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: MODAL_COLORS[i] }} /> {l}</span>)}
            </div>
            <Hint>{C.modal.where}. W 2024 inny dobór próby (random route zamiast próby adresowej), więc część zmian — zwłaszcza pieszych — może wynikać z metody. Pomijając pieszych, udział samochodu wzrósł z ok. 55% do 60%.</Hint>
          </Block>
          <Block>
            <h4>Pociągi na granicy miasta (pasażerowie)</h4>
            {table(['', 'rano 2018', 'rano 2024', 'po poł. 2018', 'po poł. 2024'], rail.map((x) => [x[1] === 'in' ? 'do Wrocławia' : 'z Wrocławia', fmt(x[2]), fmt(x[4]), fmt(x[3]), fmt(x[5])]))}
            <Hint>Zał. 7.1. W 2024 liczono też kordony K10 i K11 (rano 1040 osób do miasta), których w 2018 nie mierzono.</Hint>
          </Block>
          <Block>
            <h4>Autobusy i tramwaje na sześciu ulicach</h4>
            {table(['ulica', '2010', '2018', '2024'], C.transit.map(([n, , a, b, c]) => [n, fmt(a), fmt(b), fmt(c)]))}
            <Hint>Pasażerowie w szczytach, tab. 6.10 Raportu II. Legnicka: o połowę mniej niż w 2018.</Hint>
          </Block>
          <Block>
            <h4>Stacje — wsiadający i wysiadający</h4>
            {table(['', 'rano 2018', 'rano 2024', 'po poł. 2018', 'po poł. 2024'], ['Wrocław Główny', 'Wrocław Mikołajów', 'Wrocław Nadodrze', 'Wrocław Psie Pole']
              .map(st).filter(Boolean).map((x) => [x[0], fmt(x[1]), fmt(x[3]), fmt(x[2]), fmt(x[4])]))}
            <Hint>Zał. 8.1. Podwojenie na Wrocławiu Głównym raport podaje bez zastrzeżeń; sposób liczenia w 2018 nie jest opisany.</Hint>
          </Block>
          <Block>
            <h4>Rowery</h4>
            {table(['miejsce', '2018', '2024'], C.bikes.map(([n, a, b]) => [n, fmt(a), fmt(b)]))}
            <Hint>Wykres 4.11; 6–10 i 15–18. Rundy liczyły inne części ulicy (jezdnię albo drogę rowerową), więc sam raport nazywa to porównaniem tylko statystycznym.</Hint>
          </Block>
        </>
      )}
      <Notes><li>KBR 2010/11, 2018 i 2024; zestawienia z Raportu II i zał. 3.3, 7.1, 8.1.</li></Notes>
    </DetailsPanel>
  )
}

export function StationsPanel({ S, C, hours, period, sel, onClose }) {
  if (sel.id === 'air') {
    return (
      <DetailsPanel pill="lotnisko" title="Port lotniczy Wrocław" color="#6b7385" subtitle="ruch pasażerski i dojazd (zał. 9.1)" onClose={onClose}>
        <Facts><Fact label="Pasażerowie w roku" tone="now">{fmt(airportYear(S))}</Fact></Facts>
        <Block><h4>Czym dojeżdżają na lotnisko — {fmt(S.airport.n)} pytanych</h4><Stack parts={partsOf(S.airport.access, 8, 'Inne')} /></Block>
        <Block><h4>Miesiące</h4><TextTable head={['', 'przyloty', 'odloty']} rows={S.airport.months.map((m) => [m[0], fmt(m[1]), fmt(m[2])])} /></Block>
      </DetailsPanel>
    )
  }
  const s = S.stations.find((x) => x.name === sel.id)
  if (!s) return null
  const was = C?.stations.find((x) => x[0] === s.name)
  return (
    <DetailsPanel pill={s.kind === 'rail' ? 'stacja' : 'dworzec'} title={s.name} color={KIND[s.kind].color}
      subtitle={`pomiar ${s.date}`} onClose={onClose}>
      <Facts>
        <Fact label={`W okresie ${period}`} tone="now">{fmt(sum(s.on, hours) + sum(s.off, hours))}</Fact>
        <Fact label="Wsiadło">{fmt(sum(s.on, hours))}</Fact>
        <Fact label="Wysiadło">{fmt(sum(s.off, hours))}</Fact>
        <Fact label="Kursy">{fmt(sum(s.runs, hours))}</Fact>
      </Facts>
      <Block><h4>Wsiadający</h4><HourBars values={s.on} hours={hours} color={KIND[s.kind].color} unit="osób" /></Block>
      <Block><h4>Wysiadający</h4><HourBars values={s.off} hours={hours} color={KIND[s.kind].color} unit="osób" /></Block>
      {was && was[1] != null && (
        <Block><h4>Wobec 2018 (wsiadający i wysiadający)</h4>
          <TextTable head={['', '2018', '2024']} rows={[['rano 6–9', fmt(was[1]), fmt(was[3])], ['po południu 14–18', fmt(was[2]), fmt(was[4])]]} /></Block>
      )}
      <Block><h4>Relacje — pasażerowie</h4><Stack parts={partsOf(Object.fromEntries(s.lines))} /></Block>
      <Hint>Liczono 6–9 i 14–18 (zał. 8.1).</Hint>
    </DetailsPanel>
  )
}

export function SpeedsPanel({ S, hours, sel, onClose }) {
  const s = S.sections.find((x) => x.id === sel.id)
  if (!s) return null
  const x = speedOf(s, hours)
  return (
    <DetailsPanel pill={`odcinek ${s.poly}`} title={s.name || s.type || 'Odcinek'} subtitle={s.type} color="#4aa36b" onClose={onClose}>
      <Facts>
        <Fact label={`W okresie ${hourRuns(hours)}`} tone={x ? 'now' : 'gap'}>{x ? `${Math.round(x.v)} km/h` : 'brak przejazdów'}</Fact>
        <Fact label="Wolny ruch (85. percentyl)">{s.free} km/h</Fact>
        <Fact label="Długość">{fmt(s.m)} m</Fact>
        <Fact label="Przejazdy">{fmt(s.n)}</Fact>
      </Facts>
      <Block><h4>Mediana prędkości w godzinie</h4><HourBars values={s.h.map((v) => v ?? 0)} hours={hours} color="#4aa36b" unit="km/h" /></Block>
      <Hint>Brak słupka = mniej niż 5 przejazdów w tej godzinie.{!s.road && ' Przebieg narysowany w linii prostej.'}</Hint>
    </DetailsPanel>
  )
}
