import { useMemo } from 'react'
import { Hint, Modal, TextTable } from '@bartor-net/ui-kit'
import { parentOf } from './data'

// What the map is, how and when the counts were taken, how the map turns
// them into what it shows, and what was going on in the city meanwhile.
// Counts and dates are read from the data, so they cannot drift from it.

const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca',
  'sierpnia', 'września', 'października', 'listopada', 'grudnia']

const parse = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) || /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s)
  if (!m) return null
  return s.includes('-') ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(+m[3], +m[2] - 1, +m[1])
}

/** "21 marca – 14 maja 2024" from every date the records carry. */
function span(records, get) {
  const ds = records.flatMap(get).filter(Boolean).map(parse).filter(Boolean)
  if (!ds.length) return null
  const t = ds.map((d) => d.getTime())
  const [a, b] = [new Date(Math.min(...t)), new Date(Math.max(...t))]
  const day = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]}`
  if (a.getTime() === b.getTime()) return `${day(a)} ${a.getFullYear()}`
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${day(b)} ${b.getFullYear()}`
  return `${day(a)} – ${day(b)} ${b.getFullYear()}`
}

/** Polish number agreement: 1 przekrój, 2-4 przekroje, 5+ przekrojów -
 *  except 12-14, which take the last form. */
function count(n, [one, few, many]) {
  const word = n === 1 ? one
    : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many
  return `${n} ${word}`
}
const SECTIONS = ['przekrój', 'przekroje', 'przekrojów']
const STATIONS = ['stacja', 'stacje', 'stacji']

const points = (kind, list) => new Set(list.map((x) => parentOf(kind, x))).size

const REPO = 'https://github.com/Bartor/wroc-transport-map'

const Out = ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>

/** Sources of a paragraph, in smaller print. */
const Src = ({ children }) => (
  <span style={{ fontSize: '.76rem', color: 'var(--kit-dim)' }}>{children}</span>
)

/** A survey and the appendix it comes from. */
const survey = (name, where) => <>{name}<small>{where}</small></>

export default function About({ data, onClose }) {
  const facts = useMemo(() => ({
    road: { n: data.points.length, p: points('road', data.points), when: span(data.points, (p) => [p.date]) },
    pt: { n: data.pt.length, p: points('pt', data.pt), when: span(data.pt, (p) => p.dates || []) },
    bike: { n: data.bike.length, p: points('bike', data.bike), when: span(data.bike, (p) => [p.date]) },
    ped: { n: data.ped.length, p: points('ped', data.ped), when: span(data.ped, (p) => [p.date]) },
    rail: { n: data.rail.length, when: span(data.rail, (p) => p.dates || [p.date]) },
  }), [data])
  const occ = data.meta.carOccupancy
  const avg = data.transitOcc

  return (
    <Modal title="O mapie" onClose={onClose}>
      <p>
        Niezależna przeglądarka wyników <b>Kompleksowych Badań Ruchu Wrocław 2024</b>{' '}
        (KBR 2024), zamówionych przez miasto i opublikowanych{' '}
        <Out href={occ.url}>w BIP</Out>. To nie jest narzędzie
        Urzędu Miejskiego. Liczby pochodzą z załączników do raportów KBR; tam, gdzie mapa
        coś szacuje albo przelicza, mówi to wprost.
      </p>

      <h3>Kiedy i jak liczono</h3>
      <TextTable head={['Badanie', 'Gdzie', 'Kiedy', 'Godziny']} rows={[
        [
          survey('Ruch drogowy', 'zał. 3.3'),
          <>{count(facts.road.n, SECTIONS)} w {facts.road.p} punktach</>,
          <>{facts.road.when}, dni robocze, głównie wtorki i środy</>,
          <>zwykle 5–21; {count(data.meta.fullDaySections, SECTIONS)} całą dobę;
            kordon obszaru (KO) 6–10 i 15–19</>,
        ],
        [
          survey('Pasażerowie KZ', 'zał. 6.4'),
          <>{count(facts.pt.n, SECTIONS)} na przystankach w {facts.pt.p} punktach</>,
          <>{facts.pt.when}, wtorki–czwartki</>,
          '5–9 i 14–18',
        ],
        [
          survey('Rowery', 'zał. 3.4'),
          <>{count(facts.bike.n, SECTIONS)} w {facts.bike.p} punktach</>,
          facts.bike.when || '—',
          '6–10 i 15–19',
        ],
        [
          survey('Piesi', 'zał. 3.5'),
          <>{count(facts.ped.n, SECTIONS)} w {facts.ped.p} punktach</>,
          facts.ped.when || '—',
          '6–10 i 15–19',
        ],
        [
          survey('Pociągi', 'zał. 7.1'),
          <>{count(facts.rail.n, STATIONS)} na granicy miasta</>,
          facts.rail.when,
          '6–10 i 14–19',
        ],
        [
          survey('Napełnienie samochodów', 'zał. 2.2 do Raportu II'),
          'ankiety w gospodarstwach domowych',
          'kwiecień–czerwiec 2024',
          <>{occ.value} os./poj. w dzień roboczy</>,
        ],
      ]} />
      <Hint>
        Na przekrojach drogowych liczono pojazdy według kategorii, osobno dla każdego
        kierunku, w odstępach 15-minutowych; na przystankach — pojazdy i pasażerów w nich
        według linii i kierunku. Punkt to zwykle jeden dzień pomiaru: zwykły dzień
        roboczy, ale jeden — pogoda, wydarzenia czy awarie tego dnia są w liczbach.
      </Hint>

      <h3>Jak liczy mapa</h3>
      <ul>
        <li>
          <b>Jedno badanie naraz.</b> Badania mają różne godziny, miejsca i jednostki, więc
          ich warstwy nie są rysowane razem — tylko widok węzłów łączy je świadomie,
          w jednej jednostce: osobach.
        </li>
        <li>
          <b>Węzeł</b> to zsumowane przekroje jednego punktu pomiarowego. Każdy z nich
          można pominąć w drzewie węzła.
        </li>
        <li>
          <b>Podział modalny w osobach.</b> Samochody osobowe × {occ.value} os./poj.
          Autobusy i tramwaje policzone na przekrojach drogowych × napełnienie zmierzone
          na przystanku KZ w promieniu 150 m — a gdy go nie ma albo widział za mało pojazdów,
          średnia miejska z pomiarów KBR ({avg.bus.toFixed(1).replace('.', ',')} w autobusie,
          {' '}{avg.tram.toFixed(1).replace('.', ',')} w tramwaju). Dostawcze, ciężarowe
          i inne — tylko kierowca. Rowery jak policzono na przekroju; pieszych na przekrojach
          drogowych nie liczono.
        </li>
        <li>
          <b>Przepustowość jezdni</b> w pojazdach umownych według WR-D-13 (Ministerstwo
          Infrastruktury, 2023), tab. 4.3.1, dla skrzyżowań z sygnalizacją.
        </li>
        <li>
          <b>„Szacuj całą dobę”</b> rozciąga pomiary ze szczytów na dobę współczynnikiem
          z dobowego rozkładu ruchu — to szacunek, opisany przy każdej warstwie.
        </li>
        <li>
          <b>Model dla całej sieci</b> to regresja na grafie ulic, nie pomiar; jego błąd
          jest podany przy warstwie. Sygnalizacja świetlna pochodzi z OpenStreetMap.
        </li>
        <li>
          <b>Położenie:</b> przystanki według numeru słupka w rozkładzie GTFS, przekroje
          według opisu odcinka w KBR.
        </li>
      </ul>
      <p>
        <Out href={`${REPO}#readme`}>
          Pełny opis metody (README, po polsku) →
        </Out>
      </p>

      <h3>Utrudnienia w czasie pomiarów</h3>
      <ul>
        <li>
          <b>ul. Pomorska</b> — przebudowa od sierpnia 2022. Tramwaje nie jeździły nią
          przez cały okres badań: ulicę otwarto dla aut 1 czerwca 2024, a tramwaje miały
          wrócić ok. 22 czerwca. Na początku przebudowy linie skierowano m.in. przez
          Kurkową i Dubois, więc ruch tramwajowy na przekrojach w tej okolicy (np. R1_20
          Dubois, R1_23 most Mieszczański) może obejmować objazdy, a na Pomorskiej go brak.{' '}
          <Src>
            <Out href="https://www.wroclaw.pl/komunikacja/przebudowa-ulicy-pomorskiej-wroclaw-objazdy">wroclaw.pl</Out>,{' '}
            <Out href="https://gazetawroclawska.pl/po-dwoch-latach-remontu-ulica-pomorska-we-wroclawiu-otwarta-na-tramwaje-jeszcze-poczekamy-zdjecia/ar/c1-18574685">Gazeta Wrocławska</Out>,{' '}
            <Out href="https://www.rynek-kolejowy.pl/wiadomosci/wroclaw-niebawem-otwarcie-torowiska-na-pomorskiej-144099.html">Rynek Kolejowy</Out>
          </Src>
        </li>
        <li>
          <b>Krótsze zamknięcia</b> — ZOO–Biskupin 11–12 maja (weekend) i Świdnicka przy
          DH Renoma 30 maja–2 czerwca — nie trafiły na żaden dzień pomiaru.{' '}
          <Src>
            <Out href="https://wroclife.pl/artykul/4874/wroclaw-linie-1-i-4-zawieszone-2-i-10-zmienia-trasy">wroclife.pl</Out>,{' '}
            <Out href="https://transinfo.pl/infotram/konieczna-naprawa-torowiska-przy-dh-renoma-cztery-linie-tramwajowe-mpk-wroclaw-zmieniaja-trasy/">TransInfo</Out>
          </Src>
        </li>
      </ul>
      <Hint>
        Lista z komunikatów i doniesień prasowych — może nie być pełna. Znasz inne
        utrudnienia z okresu pomiarów?{' '}
        <Out href={`${REPO}/issues`}>Zgłoś na GitHubie</Out>.
      </Hint>

      <h3>Źródła</h3>
      <ul>
        <li>
          <Out href={occ.url}>KBR Wrocław 2024 — BIP Urzędu Miejskiego</Out>
        </li>
        <li>
          <Out href="https://www.gov.pl/attachment/e9416501-ec6e-4ffa-8eca-7b186c65ab26">WR-D-13, Wytyczne wykonywania analiz i prognoz ruchu drogowego</Out>
        </li>
        <li>OpenStreetMap (sygnalizacja, sieć ulic), rozkład jazdy GTFS z otwartych danych Wrocławia</li>
        <li>
          <Out href={REPO}>Kod i dane przetworzone — GitHub</Out>
        </li>
      </ul>
    </Modal>
  )
}
