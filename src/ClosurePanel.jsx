// What a closure does, in numbers.
import { useMemo } from 'react'
import { Block, DetailsPanel, Fact, Facts, Hint, LinkButton, Notes, ShareButtons, StatBlock, Warn, csvNumber as num, downloadCsv, fmt, fmtEst, slug } from '@bartor-net/ui-kit'
import { NOISE, diffColor } from './closureColors'
import { changesOf, namesOf } from './ClosureView'
import { hotOn, useHot } from './hot'
import { closureCard, draw } from './surveyCards'

const row = { display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, width: '100%', border: 0, background: 'none', color: 'inherit', font: 'inherit', textAlign: 'left', padding: '4px 6px', borderRadius: 4 }
const signed = (d) => `${d > 0 ? '+' : '−'}${fmt(Math.round(Math.abs(d) / 100) * 100)}`

const kmText = (s) => {
  const d = 100 * (s.after.vehKm / s.before.vehKm - 1)
  return Math.abs(d) < 0.005 ? 'bez zmian' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2).replace('.', ',')}%`
}

function List({ rows, hot }) {
  return rows.map((r) => (
    <div key={r.name} {...hotOn({ street: r.name })} style={{ ...row, background: hot.street === r.name ? 'rgba(63,139,208,.25)' : 'none' }}>
      <span>{r.name}<br /><small style={{ opacity: 0.65 }}>{fmtEst(r.a)} → {fmtEst(r.b)}</small></span>
      <b style={{ color: diffColor(r.d), fontVariantNumeric: 'tabular-nums' }}>{signed(r.d)}{r.a > NOISE ? ` (${r.d > 0 ? '+' : '−'}${Math.round((100 * Math.abs(r.d)) / r.a)}%)` : ''}</b>
    </div>
  ))
}

export default function ClosurePanel({ x, onClose }) {
  const hot = useHot()
  const { c, result } = x
  // the panel is of what was worked out, as long as there is something
  const of = result?.of || c
  const shut = namesOf(x, of.closed)
  const thin = namesOf(x, of.narrow)
  const rows = useMemo(() => changesOf(x), [x])
  const up = rows.filter((r) => r.d > 0)
  const down = rows.filter((r) => r.d < 0)
  const title = [...shut.map((s) => s.name), ...thin.map((s) => `${s.name} (zwężona)`)].join(', ') || 'Wybierz ulicę'
  const s = result?.summary
  const name = slug(`kbr2024-zamkniecie-${title}`).slice(0, 80)
  return (
    <DetailsPanel pill="model" title={title} color="#d6541c" onClose={onClose}
      subtitle="Zamknięcie ulicy — gdzie pojadą samochody"
      actions={result && <ShareButtons render={() => draw(closureCard({ x, title, up, down }))} filename={`${name}.png`} title={title} text={`KBR Wrocław 2024 — zamknięcie: ${title}`} />}>
      {!c.closed.length && !c.narrow.length ? (
        <Hint>Naciśnij odcinki na mapie, wyszukaj ulicę na górze albo wybierz jeden z przykładów po lewej.</Hint>
      ) : !result ? (
        <Hint>{x.part != null ? x.prep < 1 ? 'Przygotowanie modelu…' : 'Liczenie objazdów…' : 'Wybierz wszystkie odcinki i naciśnij „Oblicz objazdy” na mapie.'}</Hint>
      ) : (
        <>
          {x.stale && <Warn>Wynik nie obejmuje ostatnich zmian — naciśnij „Oblicz objazdy”.</Warn>}
          <Facts>
            <Fact label={of.narrow.length ? 'Przejazdy przez zmienione odcinki' : 'Przejazdy przez zamknięte odcinki'} tone="now">{fmtEst(s.affected)}</Fact>
            {s.gone > 0 && <Fact label={`Z tego znika (założenie ${Math.round(100 * of.reduce)}%)`}>{fmtEst(s.gone)}</Fact>}
            <Fact label="Przejechane km, cała sieć">{kmText(s)}</Fact>
            <Fact label="Ulice z wyraźną zmianą">{up.length} więcej, {down.length} mniej</Fact>
            {s.lost > 1 && <Fact label="Przejazdy bez dojazdu">{fmtEst(s.lost)}</Fact>}
          </Facts>
          {s.lost > 1 && <Warn>Część miejsc nie ma innego dojazdu w modelu — zamknięcie odcina je od sieci.</Warn>}
          <StatBlock title="Przybywa"><List rows={up.slice(0, 15)} hot={hot} />{!up.length && <Hint>Żadna ulica nie zyskuje wyraźnie.</Hint>}</StatBlock>
          <StatBlock title="Ubywa"><List rows={down.slice(0, 10)} hot={hot} />{!down.length && <Hint>Poza zamkniętymi — żadna wyraźnie.</Hint>}</StatBlock>
          <Block>
            <LinkButton block onClick={() => downloadCsv([
              ['ulica', 'pojazdy przed', 'pojazdy po', 'zmiana', 'zmiana [%]'],
              ...rows.map((r) => [r.name, num(r.a), num(r.b), num(r.d), r.a > NOISE ? num((100 * r.d) / r.a, 1) : '']),
            ], `${name}.csv`)}>Pobierz zmiany (CSV, {rows.length} ulic)</LinkButton>
          </Block>
        </>
      )}
      <Notes>
        <li>Model, nie pomiar. Dla przekrojów, których nie widział, mediana błędu to 17%, a co dziesiąty myli się o ponad 52%.</li>
        <li>Pojazdy w 8 godzinach (6–10 i 15–19). Zmian poniżej ok. {NOISE} pojazdów nie pokazujemy — to szum obliczeń.</li>
        <li>{of.reduce > 0 ? `Założenie: znika ${Math.round(100 * of.reduce)}% przejazdów przez te odcinki.` : 'Założenie: nikt nie rezygnuje z jazdy.'} W 63 przypadkach z przeglądu Cairnsa i in. (2002) mediana to 11%, środkowa połowa 1–34%.</li>
        <li>Nie zna zakazów skrętu, programów sygnalizacji ani objazdów wyznaczonych przez miasto; liczy stan po przyzwyczajeniu się kierowców.</li>
        <li>Przy innych kalibracjach zmiany powyżej 500 pojazdów zachowują kierunek w 98–99% przypadków, a ich wielkość różni się zwykle o 8–11%.</li>
        <li>Sprawdzono na otwarciu al. Wielkiej Wyspy: kierunek zmian 2018–2024 zgodny w 85% z 13 miejsc w promieniu 2 km (sama wspólna tendencja dałaby 69%).</li>
      </Notes>
    </DetailsPanel>
  )
}
