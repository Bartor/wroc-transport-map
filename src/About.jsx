import { useEffect, useMemo, useRef } from 'react'
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

export default function About({ data, onClose }) {
  const ref = useRef(null)
  // Opened as a modal for focus trapping and Esc. Not closed on unmount:
  // removing it does that, and a close() here fired onClose when React's
  // development mode re-ran the effect, shutting the dialog at once.
  // React 18 does not pass the dialog's own close event (Esc) to onClose,
  // so it is listened for here.
  const closed = useRef(onClose)
  closed.current = onClose
  useEffect(() => {
    const d = ref.current
    if (!d) return undefined
    if (!d.open) d.showModal()
    const done = () => closed.current()
    d.addEventListener('close', done)
    return () => d.removeEventListener('close', done)
  }, [])

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
    // the dialog closes on Esc by itself; a click on the backdrop closes it too
    <dialog ref={ref} className="about" aria-labelledby="about-title"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <div className="about-body">
        <header>
          <h2 id="about-title">O mapie</h2>
          <button type="button" onClick={onClose} aria-label="Zamknij">×</button>
        </header>

        <p>
          Niezależna przeglądarka wyników <b>Kompleksowych Badań Ruchu Wrocław 2024</b>{' '}
          (KBR 2024), zamówionych przez miasto i opublikowanych{' '}
          <a href={occ.url} target="_blank" rel="noreferrer">w BIP</a>. To nie jest narzędzie
          Urzędu Miejskiego. Liczby pochodzą z załączników do raportów KBR; tam, gdzie mapa
          coś szacuje albo przelicza, mówi to wprost.
        </p>

        <h3>Kiedy i jak liczono</h3>
        <table className="about-table">
          <thead>
            <tr><th>Badanie</th><th>Gdzie</th><th>Kiedy</th><th>Godziny</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Ruch drogowy<small>zał. 3.3</small></td>
              <td>{count(facts.road.n, SECTIONS)} w {facts.road.p} punktach</td>
              <td>{facts.road.when}, dni robocze, głównie wtorki i środy</td>
              <td>zwykle 5–21; {count(data.meta.fullDaySections, SECTIONS)} całą dobę;
                kordon obszaru (KO) 6–10 i 15–19</td>
            </tr>
            <tr>
              <td>Pasażerowie KZ<small>zał. 6.4</small></td>
              <td>{count(facts.pt.n, SECTIONS)} na przystankach w {facts.pt.p} punktach</td>
              <td>{facts.pt.when}, wtorki–czwartki</td>
              <td>5–9 i 14–18</td>
            </tr>
            <tr>
              <td>Rowery<small>zał. 3.4</small></td>
              <td>{count(facts.bike.n, SECTIONS)} w {facts.bike.p} punktach</td>
              <td>{facts.bike.when || '—'}</td>
              <td>6–10 i 15–19</td>
            </tr>
            <tr>
              <td>Piesi<small>zał. 3.5</small></td>
              <td>{count(facts.ped.n, SECTIONS)} w {facts.ped.p} punktach</td>
              <td>{facts.ped.when || '—'}</td>
              <td>6–10 i 15–19</td>
            </tr>
            <tr>
              <td>Pociągi<small>zał. 7.1</small></td>
              <td>{count(facts.rail.n, STATIONS)} na granicy miasta</td>
              <td>{facts.rail.when}</td>
              <td>6–10 i 14–19</td>
            </tr>
            <tr>
              <td>Napełnienie samochodów<small>zał. 2.2 do Raportu II</small></td>
              <td>ankiety w gospodarstwach domowych</td>
              <td>kwiecień–czerwiec 2024</td>
              <td>{occ.value} os./poj. w dzień roboczy</td>
            </tr>
          </tbody>
        </table>
        <p className="hint">
          Na przekrojach drogowych liczono pojazdy według kategorii, osobno dla każdego
          kierunku, w odstępach 15-minutowych; na przystankach — pojazdy i pasażerów w nich
          według linii i kierunku. Punkt to zwykle jeden dzień pomiaru: zwykły dzień
          roboczy, ale jeden — pogoda, wydarzenia czy awarie tego dnia są w liczbach.
        </p>

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
          <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            Pełny opis metody (README, po polsku) →
          </a>
        </p>

        <h3>Utrudnienia w czasie pomiarów</h3>
        <ul>
          <li>
            <b>ul. Pomorska</b> — przebudowa od sierpnia 2022. Tramwaje nie jeździły nią
            przez cały okres badań: ulicę otwarto dla aut 1 czerwca 2024, a tramwaje miały
            wrócić ok. 22 czerwca. Na początku przebudowy linie skierowano m.in. przez
            Kurkową i Dubois, więc ruch tramwajowy na przekrojach w tej okolicy (np. R1_20
            Dubois, R1_23 most Mieszczański) może obejmować objazdy, a na Pomorskiej go brak.{' '}
            <span className="src">
              <a href="https://www.wroclaw.pl/komunikacja/przebudowa-ulicy-pomorskiej-wroclaw-objazdy"
                target="_blank" rel="noreferrer">wroclaw.pl</a>,{' '}
              <a href="https://gazetawroclawska.pl/po-dwoch-latach-remontu-ulica-pomorska-we-wroclawiu-otwarta-na-tramwaje-jeszcze-poczekamy-zdjecia/ar/c1-18574685"
                target="_blank" rel="noreferrer">Gazeta Wrocławska</a>,{' '}
              <a href="https://www.rynek-kolejowy.pl/wiadomosci/wroclaw-niebawem-otwarcie-torowiska-na-pomorskiej-144099.html"
                target="_blank" rel="noreferrer">Rynek Kolejowy</a>
            </span>
          </li>
          <li>
            <b>Krótsze zamknięcia</b> — ZOO–Biskupin 11–12 maja (weekend) i Świdnicka przy
            DH Renoma 30 maja–2 czerwca — nie trafiły na żaden dzień pomiaru.{' '}
            <span className="src">
              <a href="https://wroclife.pl/artykul/4874/wroclaw-linie-1-i-4-zawieszone-2-i-10-zmienia-trasy"
                target="_blank" rel="noreferrer">wroclife.pl</a>,{' '}
              <a href="https://transinfo.pl/infotram/konieczna-naprawa-torowiska-przy-dh-renoma-cztery-linie-tramwajowe-mpk-wroclaw-zmieniaja-trasy/"
                target="_blank" rel="noreferrer">TransInfo</a>
            </span>
          </li>
        </ul>
        <p className="hint">
          Lista z komunikatów i doniesień prasowych — może nie być pełna. Znasz inne
          utrudnienia z okresu pomiarów?{' '}
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">Zgłoś na GitHubie</a>.
        </p>

        <h3>Źródła</h3>
        <ul className="sources">
          <li>
            <a href={occ.url} target="_blank" rel="noreferrer">KBR Wrocław 2024 — BIP Urzędu Miejskiego</a>
          </li>
          <li>
            <a href="https://www.gov.pl/attachment/e9416501-ec6e-4ffa-8eca-7b186c65ab26"
              target="_blank" rel="noreferrer">WR-D-13, Wytyczne wykonywania analiz i prognoz ruchu drogowego</a>
          </li>
          <li>OpenStreetMap (sygnalizacja, sieć ulic), rozkład jazdy GTFS z otwartych danych Wrocławia</li>
          <li>
            <a href={REPO} target="_blank" rel="noreferrer">Kod i dane przetworzone — GitHub</a>
          </li>
        </ul>
      </div>
    </dialog>
  )
}
