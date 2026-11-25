// What the filtered trips are, in numbers.
import { useMemo, useState } from 'react'
import {
  Block, DataTable, DetailsPanel, Donut, Fact, Facts, Hint, LinkButton, Notes, RankList, SplitBody,
  SplitTable, StatBlock, Warn, downloadCsv, fixed, fmt, fmtEst, hourRuns, slug, usePick,
} from '@bartor-net/ui-kit'
import { StackedHourBars } from '@bartor-net/ui-kit/charts'
import Bars from './Bars'
import { FEW, THIN, placeName, placesTable, shares, tripRow, tripsTable } from './trips'
import { WAYS, pctText, unitOf } from './TripsView'

const MANY = 200      // rows of single trips to show
const BARS = [['goal', 'Cel podróży'], ['why', 'Motyw (tam i z powrotem)'], ['km', 'Długość'], ['min', 'Czas podróży'],
  ['in', 'Osób w samochodzie — kierowcy'], ['park', 'Gdzie zaparkowano — kierowcy'],
  ['reason', 'Dlaczego samochodem — kierowcy'], ['cars', 'Samochody w gospodarstwie'], ['age', 'Wiek']]
const FREIGHT_BARS = [['goal', 'Cel'], ['from', 'Skąd'], ['to', 'Dokąd']]
const ORDERED = new Set(['km', 'min', 'in', 'cars', 'age'])

export default function TripsPanel({ x, setT, period, onClose }) {
  const { S, t, stats, idx, places, partner, sums } = x
  const pick = usePick()
  const [list, setList] = useState(false)
  const one = places.length === 1 ? places[0] : null
  const title = one ? placeName(one) : places.length ? `${places.length} obszary razem` : 'Wszystkie obszary'
  const rows = S.modes.map((m, i) => ({ key: m.key, label: m.label, color: m.color, value: stats.mode.w[i], n: stats.mode.n[i] }))
    .filter((r) => r.n > 0)
  const { list: drawn } = S.levels[t.level]
  const perHead = !S.freight && t.per === 'pop'
  const top = useMemo(() => {
    const out = partner
      ? [...drawn.map((p, k) => ({ key: p.key, name: placeName(p), p, w: partner.w[k], n: partner.n[k] })),
        ...partner.off.map((o) => ({ key: `o${o.id}`, name: o.name, w: o.w, n: o.n }))]
      : drawn.map((p, k) => ({ key: p.key, name: placeName(p), p, w: x.way === 'from' ? sums[k].from : x.way === 'to' ? sums[k].to : sums[k].any, n: sums[k].n }))
    // per resident by default; a handful of trips, or of people, has no rate
    return out.map((r) => ({ ...r, rate: r.p?.pop >= FEW ? r.w / r.p.pop : null }))
      .filter((r) => r.n > 0 && (!perHead || (r.rate != null && r.n >= (partner ? 5 : THIN))))
      .sort((a, b) => (perHead ? b.rate - a.rate : b.w - a.w))
  }, [partner, drawn, sums, x.way, perHead])
  const own = places.length && places.every((q) => q.pop) ? places.reduce((a, q) => a + q.pop, 0) : 0
  const fname = `kbr-podroze-${slug(title)}-${slug(period)}`
  const pickPlace = (p) => p && setT({ ...t, picked: [p.key] })
  const thin = stats.n < 100
  const many = S.freight ? 'przejazdów' : 'podróży'
  const names = { f: 'skąd', t: 'dokąd' }

  return (
    <DetailsPanel pill={one ? (one.level === 'z' ? `rejon ${one.id}` : one.city ? 'osiedle' : 'gmina') : S.freight ? 'towary' : 'podróże'}
      title={title} color="#3f8bd0" onClose={onClose}
      subtitle={`${S.freight ? 'Przewozy towarów' : 'Podróże mieszkańców'} · ${period}${places.length ? ` · ${WAYS.find((w) => w[0] === x.way)[1]}` : ''}`}>
      <Facts>
        <Fact label={S.freight ? 'Przejazdy w próbie' : 'Podróży na dobę'} tone="now">{S.freight ? fmt(stats.n) : fmtEst(stats.w)}</Fact>
        {!S.freight && own >= FEW && <Fact label="Na mieszkańca">{fixed(stats.w / own, 2)}</Fact>}
        {!S.freight && <Fact label="W próbie">{fmt(stats.n)}</Fact>}
        {stats.km != null && <Fact label="Średnio w linii prostej">{fixed(stats.km)} km</Fact>}
        {stats.min != null && <Fact label="Średni czas">{Math.round(stats.min)} min</Fact>}
        {stats.inCar != null && <Fact label="Osób w samochodzie">{fixed(stats.inCar, 2)}</Fact>}
        {one?.pop != null && <Fact label={one.popEst ? 'Mieszkańcy (szacunek)' : 'Mieszkańcy'}>{fmt(one.pop)}</Fact>}
        {one?.jobs != null && <Fact label="Miejsca pracy">{fmt(one.jobs)}</Fact>}
      </Facts>
      {thin && stats.n > 0 && (
        <Warn>Tylko {fmt(stats.n)} {many} w próbie — udziały są orientacyjne. Poszerz okres, filtry albo obszar.</Warn>
      )}
      {!stats.n ? <Hint>Brak podróży, które spełniają filtry.</Hint> : (
        <>
          <Block>
            <h4>{S.freight ? 'Rodzaj pojazdu' : 'Podział modalny — podróże'}</h4>
            <SplitBody>
              <Donut pick={pick} label="Podział" rows={rows} />
              <SplitTable pick={pick}
                columns={[{ label: S.freight ? 'przejazdy' : 'na dobę' }, { label: '%', tone: 'strong' }, ...(S.freight ? [] : [{ label: 'próba', tone: 'dim' }])]}
                rows={[...rows].sort((a, b) => b.value - a.value).map((r) => ({
                  key: r.key, label: r.label, color: r.color,
                  cells: [S.freight ? fmt(r.value) : fmtEst(r.value), pctText(r.value / stats.w), ...(S.freight ? [] : [fmt(r.n)])],
                }))} />
            </SplitBody>
            {!S.freight && (
              <Hint>
                {stats.main.map((m) => `${m.label} ${pctText(m.share)}${m.margin ? ` ±${Math.round(100 * m.margin)}` : ''}`).join(' · ')}
                {' '}(± punkty procentowe, 95%, z uwzględnieniem różnic między ankieterami).
              </Hint>
            )}
          </Block>
          <Block>
            <h4>{S.freight ? 'Przejazdy' : 'Podróże'} według godziny rozpoczęcia</h4>
            <StackedHourBars kind="trips" hours={x.hours} unit={unitOf(S).replace('/dobę', '')}
              pieces={S.modes.map((m, i) => ({ id: m.key, name: m.label, values: stats.hours[i], fill: m.color }))
                .filter((p) => p.values.some((v) => v))} />
            {x.hours.length < 24 && <Hint>Tylko podróże rozpoczęte w godzinach {hourRuns(x.hours)}.</Hint>}
          </Block>
          {(S.freight ? FREIGHT_BARS : BARS).map(([key, label]) => {
            const sh = shares(S, idx, key).filter((o) => o.n > 0)
            if (sh.length < 2) return null
            return (
              <Block key={key}>
                <h4>{label}</h4>
                <Bars rows={(ORDERED.has(key) ? sh : [...sh].sort((a, b) => b.w - a.w)).map((o) => ({
                  key: String(o.i), label: o.label, share: o.share, title: `${S.freight ? fmt(o.w) : fmtEst(o.w)} ${unitOf(S)} · ${o.n} w próbie`,
                }))} />
              </Block>
            )
          })}
          <StatBlock title={`${partner ? (x.way === 'from' ? 'Dokąd' : x.way === 'to' ? 'Skąd' : 'Z czym połączone') : 'Najwięcej podróży'}${perHead ? (partner ? ' — na 1000 mieszkańców tamtego obszaru' : ' na mieszkańca') : ''}`}>
            <RankList items={top.slice(0, 15).map((r) => ({
              key: r.key, title: r.name, sub: `${perHead ? `${fmtEst(r.w)} na dobę · ` : ''}${fmt(r.n)} w próbie`,
              value: S.freight ? fmt(r.w) : !perHead ? fmtEst(r.w) : partner ? fixed(1000 * r.rate, 0) : fixed(r.rate, 2), on: t.picked.includes(r.key), onPick: () => pickPlace(r.p),
            }))} />
          </StatBlock>
          <StatBlock title={`Pojedyncze ${S.freight ? 'przejazdy' : 'podróże'}`}>
            <LinkButton onClick={() => setList(!list)}>
              {list ? 'Ukryj listę' : `Pokaż listę (${fmt(Math.min(MANY, stats.n))} z ${fmt(stats.n)})`}
            </LinkButton>
            {list && (
              <DataTable caption="Pojedyncze podróże" sortBy="column" density="compact" maxHeight="26rem"
                labelHead={names.f} labelWidth="8rem"
                columns={[{ key: 't', head: names.t, align: 'left' }, { key: 'h', head: 'godz.' }, { key: 'm', head: 'czym', align: 'left' },
                  { key: 'a', head: 'cel', align: 'left' }, ...(S.freight ? [] : [{ key: 'km', head: 'km' }, { key: 'd', head: 'min' }, { key: 'o', head: 'os.' }])]}
                rows={idx.slice(0, MANY).map((i) => {
                  const r = tripRow(S, i)
                  const txt = (s) => ({ content: s, value: s })
                  return {
                    id: String(i), label: r.from.name, labelValue: r.from.name,
                    cells: [txt(r.to.name), r.hour == null ? null : { content: `${r.hour}`, value: r.hour }, txt(r.mode), txt(r.act),
                      ...(S.freight ? [] : [r.km == null ? null : { content: fixed(r.km), value: r.km },
                        r.min == null ? null : { content: `${r.min}`, value: r.min },
                        r.inCar == null ? null : { content: `${r.inCar}`, value: r.inCar }])],
                  }
                })} />
            )}
          </StatBlock>
          <LinkButton block onClick={() => downloadCsv(tripsTable(S, idx), `${fname}.csv`)}>
            Pobierz te {many === 'podróży' ? 'podróże' : 'przejazdy'} (CSV, {fmt(stats.n)} wierszy)
          </LinkButton>
          <LinkButton block onClick={() => downloadCsv(placesTable(S, sums, t.level), `${fname}-obszary.csv`)}>
            Pobierz tabelę obszarów (CSV)
          </LinkButton>
        </>
      )}
      <Notes>
        {S.freight ? (
          <>
            <li>Badanie przewozów towarów (zał. 10.3): 1291 przejazdów, głównie z centrów logistycznych. Nie są przeliczone na cały ruch ciężarowy.</li>
            <li>Dotyczy firm, które zgodziły się wziąć udział, więc proporcje obszarów są orientacyjne.</li>
          </>
        ) : (
          <>
            <li>Dzienniczki podróży, dni wtorek–czwartek, kwiecień–czerwiec 2024; wagi KBR odtwarzają opublikowane przez miasto 1 397 390 podróży na dobę.</li>
            <li>Mieszkańcy Wrocławia i 9 gmin, od 6 lat. Bez przyjezdnych z dalszych okolic, taksówek pustych i dostaw.</li>
            <li>Najdokładniejszym miejscem jest rejon; nie ma adresów ani niczego, co łączy podróże jednej osoby.</li>
          </>
        )}
      </Notes>
    </DetailsPanel>
  )
}
