// What the filtered trips are, in numbers. Every chart filters: a press on a
// part keeps only it, here, on the map and in the sidebar, while the chart
// itself goes on showing all of its parts.
import { Fragment, useMemo, useState } from 'react'
import {
  Block, Chips, DataTable, DetailsPanel, Donut, Fact, Facts, Hint, LinkButton, Notes, Select, ShareButtons,
  SplitBody, SplitTable, StatBlock, Warn, downloadCsv, fixed, fmt, fmtEst, hourRuns,
} from '@bartor-net/ui-kit'
import { StackedHourBars } from '@bartor-net/ui-kit/charts'
import { dayModes, dayText, daysTable, patterns } from './days'
import { hotOn, setHot, useHot } from './hot'
import { Small, isSmall } from './Small'
import Stack, { Bar, colorsOf, isOrdered } from './Stack'
import {
  FEW, THIN, averages, averagesTable, countMargin, meanFor, meanNote, meanText, crossTab, crossTable, passing, perSpot, placeName, placesTable, shares, touching, tripRow, tripsTable,
} from './trips'
import { draw, tripsCard, tripsName } from './surveyCards'
import { WorksBlock } from './WorksLayer'
import { districtOf, useWorks, worksIn } from './works'
import { KM_NOTE, StatChips, WAYS, WAY_TEXT, flowLines, painted, pctText, statIn, unitOf } from './TripsView'

const MANY = 200      // rows of single trips to show
const STACKS = [['goal', 'Cel podróży'], ['km', 'Długość (w linii prostej)'], ['min', 'Czas podróży'],
  ['in', 'Osób w samochodzie — kierowcy'], ['park', 'Gdzie zaparkowano — kierowcy'],
  ['reason', 'Dlaczego samochodem — kierowcy'], ['cars', 'Samochody w gospodarstwie'], ['size', 'Osób w gospodarstwie'], ['wa', 'Dojście na początku — bez pieszych'], ['wb', 'Dojście na końcu — bez pieszych'], ['age', 'Wiek'], ['job', 'Zajęcie'], ['edu', 'Wykształcenie'], ['sex', 'Płeć']]
const FREIGHT_STACKS = [['goal', 'Cel'], ['from', 'Skąd'], ['to', 'Dokąd']]

/** A chart's heading with its way onto the map. */
function Head({ children, on, onMap }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
      <h4>{children}</h4>
      <LinkButton aria-pressed={on} onClick={onMap} title="Pokoloruj obszary na mapie według tej statystyki"
        style={{ whiteSpace: 'nowrap', fontWeight: on ? 700 : 400 }}>{on ? '● na mapie' : 'na mapie'}</LinkButton>
    </div>
  )
}

const listRow = {
  display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 8, width: '100%', textAlign: 'left', border: 0,
  background: 'none', color: 'inherit', font: 'inherit', padding: '5px 6px', borderRadius: 4, cursor: 'pointer',
}
/** A ranking whose rows light up the map, and are lit by it. */
function HotList({ items, hotKey }) {
  return (
    <div>
      {items.map((r) => (
        <button key={r.key} type="button" onClick={r.onPick} {...(r.hot ? hotOn(r.hot) : {})}
          style={{ ...listRow, cursor: r.onPick ? 'pointer' : 'default', background: hotKey != null && r.hotKey === hotKey ? 'rgba(63,139,208,.28)' : r.on ? 'rgba(63,139,208,.18)' : 'none' }}>
          <span>{r.title}<br /><small style={{ opacity: 0.65 }}>{r.sub}</small></span>
          <b style={{ fontVariantNumeric: 'tabular-nums' }}>{r.value}<Small n={r.n} /></b>
        </button>
      ))}
    </div>
  )
}

export default function TripsPanel({ x, setT, period, onClose }) {
  const { S, t, stats, idx, places, partner, sums, show, spots } = x
  const hot = useHot()
  const [list, setList] = useState(false)
  const one = places.length === 1 ? places[0] : null
  const spot = t.filters.spot && spots ? spots[t.filters.spot[0]] : null
  const title = spot ? spot.name : one ? placeName(one) : places.length ? `${places.length} obszary razem` : 'Wszystkie obszary'
  const { list: drawn } = S.levels[t.level]
  const perHead = !S.freight && t.per === 'pop'
  const many = S.freight ? 'przejazdów' : 'podróży'

  // a chart is counted without its own filter, or it would show one part only
  const baseOf = useMemo(() => {
    const memo = {}
    return (key) => (!t.filters[key]?.length ? idx
      : memo[key] ||= touching(S, passing(S, { filters: t.filters, hours: x.hours }, key), x.zones, x.way))
  }, [S, idx, t.filters, x.hours, x.zones, x.way])
  const toggle = (key) => (k) => {
    const i = +k
    const on = t.filters[key] || []
    const next = on.includes(i) ? on.filter((y) => y !== i) : [...on, i]
    const { [key]: _, ...rest } = t.filters
    setT({ ...t, filters: next.length ? { ...rest, [key]: next } : rest })
  }
  const onOf = (key) => new Set((t.filters[key] || []).map(String))

  // the modes: hover lights the map, a press filters
  const modes = useMemo(() => {
    const sh = shares(S, baseOf('mode'), 'mode')
    return sh.map((o) => ({ key: String(o.i), label: o.label, color: S.modes[o.i].color, value: o.w, n: o.n, share: o.share })).filter((o) => o.n > 0)
  }, [S, baseOf])
  const modeOn = onOf('mode')
  const pick = {
    active: hot.mode != null ? new Set([...modeOn, String(hot.mode)]) : modeOn, pinned: modeOn, toggle: toggle('mode'),
    on: (key) => ({ onMouseEnter: () => setHot({ mode: +key }), onMouseLeave: () => setHot({}), onClick: () => toggle('mode')(key) }),
  }

  const top = useMemo(() => {
    const out = partner
      ? [...drawn.map((p, k) => ({ key: p.key, name: placeName(p), p, w: partner.w[k], n: partner.n[k] })),
        ...partner.off.map((o) => ({ key: `o${o.id}`, name: o.name, w: o.w, n: o.n }))]
      : drawn.map((p, k) => ({ key: p.key, name: placeName(p), p, w: x.way === 'from' ? sums[k].from : x.way === 'to' ? sums[k].to : sums[k].any, n: sums[k].n }))
    return out.map((r) => ({ ...r, rate: r.p?.w >= FEW ? r.w / r.p.w : null }))
      .filter((r) => r.n > 0 && (!perHead || r.rate != null))
      .sort((a, b) => (perHead ? b.rate - a.rate : b.w - a.w))
  }, [partner, drawn, sums, x.way, perHead])
  // the places by the statistic the map is painted with; few trips go last
  const ranked = useMemo(() => {
    if (t.paint !== 'stat' || show !== 'areas') return null
    const paint = painted(x)
    const rows = drawn.map((q, k) => ({ key: q.key, p: q, name: placeName(q), v: paint.value[k], n: paint.n[k], text: paint.textOf(k) })).filter((r) => r.v != null)
    return { title: paint.title, rows: rows.sort((a, b) => (b.n >= THIN) - (a.n >= THIN) || b.v - a.v) }
  }, [t.paint, show, x, drawn])
  const small = perHead && Math.max(0, ...top.map((r) => r.rate)) < 0.25 ? 1000 : 1
  const own = places.length && places.every((q) => q.w) ? places.reduce((a, q) => a + q.w, 0) : 0
  const spotTop = useMemo(() => {
    if (!spots || S.freight) return []
    const s = perSpot(S, idx, spots.length)
    return spots.map((q, i) => ({ i, name: q.name, w: s.w[i], n: s.n[i], street: q.street })).filter((r) => r.n > 0).sort((a, b) => b.w - a.w)
  }, [spots, S, idx])
  const tab = useMemo(() => {
    const has = (k) => S.D.some((d) => d.key === k)
    return crossTab(S, idx, has(t.rows) ? t.rows : 'mode', has(t.split) ? t.split : 'goal')
  }, [S, idx, t.rows, t.split])
  const day = useMemo(() => (x.dayRows ? { ...patterns(x.dayRows), modes: dayModes(x.dayRows) } : null), [x.dayRows])

  const means = useMemo(() => averages(S, idx), [S, idx])
  const works = worksIn(useWorks(), places.map(districtOf))
  const fname = tripsName(title, period, x.way, t.filters)
  const spec = () => {
    const paint = painted(x)
    return tripsCard({
      x, title, period, paint, wayName: WAY_TEXT[x.way], lines: flowLines(x),
      legendTitle: show !== 'areas' ? 'Połączenia — pasy: środki transportu' : paint.stat ? paint.title : partner ? `${x.way === 'from' ? 'Dokąd' : x.way === 'to' ? 'Skąd' : 'Druga strona podróży'} — ${paint.unit}` : paint.title,
      means,
      stacks: (S.freight ? FREIGHT_STACKS : STACKS.slice(0, 2)).map(([key, label]) => stackOf(key, label)).filter(Boolean),
      top: top.slice(0, 12), small, perHead, ranked, note: paint.stat?.d.key === 'km' ? KM_NOTE : null,
    })
  }
  function stackOf(key, label) {
    const d = S.D.find((q) => q.key === key)
    const sh = shares(S, baseOf(key), key)
    if (sh.filter((o) => o.n > 0).length < 2) return null
    const colors = colorsOf(d, isOrdered(key))
    const mean = meanFor(S, idx, key)
    return { key, label: mean ? `${label} — śr. ${fixed(mean.v, mean.digits)} ${mean.unit}` : label, n: sh.reduce((a, o) => a + o.n, 0), parts: sh.filter((o) => o.n > 0).map((o) => ({ key: String(o.i), label: o.label, share: o.share, n: o.n, color: colors[o.i],
      title: `${S.freight ? fmt(o.w) : fmtEst(o.w)} ${unitOf(S)} · ${o.n} w próbie` })) }
  }
  // onto the map and off it; a chart that is already filtered starts with that
  const statOn = (key) => t.paint === 'stat' && show === 'areas' && statIn(S, t).d.key === key
  const onMap = (key) => () => setT(statOn(key) ? { ...t, paint: 'any' }
    : { ...t, paint: 'stat', show: 'areas', stat: { dim: key, opts: [] } })
  const mapped = (key) => statOn(key) && (
    <>
      <StatChips S={S} t={t} setT={setT} />
      {key === 'km' && <Hint>{KM_NOTE[0].toUpperCase() + KM_NOTE.slice(1)}.</Hint>}
      {t.filters[key]?.length > 0 && <Hint>Filtr zostawia tylko część — usuń go, by porównać obszary.</Hint>}
    </>
  )
  const pickPlace = (p) => p && setT({ ...t, picked: t.picked.includes(p.key) && t.picked.length === 1 ? [] : [p.key] })
  const thin = stats.n < 100
  const active = S.D.filter((d) => t.filters[d.key]?.length)
  const dimOpts = S.D.map((d) => ({ value: d.key, label: d.note ? `${d.label} (${d.note})` : d.label }))
  const splitColors = colorsOf(tab.split, isOrdered(tab.split.key))

  return (
    <DetailsPanel pill={spot ? 'cel podróży' : one ? (one.level === 'z' ? `rejon ${one.id}` : one.city ? 'osiedle' : 'gmina') : S.freight ? 'towary' : 'podróże'}
      title={title} color="#3f8bd0" onClose={onClose}
      actions={stats.n > 0 && <ShareButtons render={() => draw(spec())} filename={`${fname}.png`} title={title} text={`KBR Wrocław 2024 — podróże: ${title}`} />}
      subtitle={`${S.freight ? 'Przewozy towarów' : 'Podróże mieszkańców'} · ${period}${places.length ? ` · ${WAYS.find((w) => w[0] === x.way)[1]}` : ''}`}>
      {active.length > 0 && (
        <Chips small label="Aktywne filtry — naciśnij, aby usunąć" onPick={(key) => { const { [key]: _, ...rest } = t.filters; setT({ ...t, filters: rest }) }}
          items={active.map((d) => ({ key: d.key, on: true, label: `${d.label}: ${t.filters[d.key].map((i) => d.options[i]?.label).join(', ')} ×` }))} />
      )}
      <Facts>
        <Fact label={S.freight ? 'Przejazdy w próbie' : 'Podróży na dobę'} tone="now">{S.freight ? fmt(stats.n) : `${fmtEst(stats.w)}${stats.n ? ` ±${Math.round(100 * countMargin(stats.n))}%` : ''}`}</Fact>
        {!S.freight && own >= FEW && <Fact label="Na mieszkańca (6+)">{fixed(stats.w / own, 2)}</Fact>}
        {!S.freight && <Fact label="W próbie">{fmt(stats.n)}<Small n={stats.n} /></Fact>}
        {stats.km != null && <Fact label="Średnio w linii prostej">{fixed(stats.km)} km</Fact>}
        {stats.min != null && <Fact label="Średni czas">{Math.round(stats.min)} min</Fact>}
        {stats.inCar != null && <Fact label="Osób w samochodzie">{fixed(stats.inCar, 2)}</Fact>}
        {one?.pop != null && <Fact label={one.popEst ? 'Mieszkańcy (szacunek)' : 'Mieszkańcy'}>{fmt(one.pop)}</Fact>}
        {one?.jobs != null && <Fact label="Miejsca pracy">{fmt(one.jobs)}</Fact>}
      </Facts>
      {thin && stats.n > 0 && (
        <Warn>Tylko {fmt(stats.n)} {many} w próbie — udziały są orientacyjne. Poszerz okres, filtry albo obszar.</Warn>
      )}
      <WorksBlock works={works} hint="Podróże z tego czasu mogą odbiegać od zwykłych, zwłaszcza tramwajem i samochodem." />
      {!stats.n ? <Hint>Brak podróży, które spełniają filtry.</Hint> : (
        <>
          <Block>
            <Head on={statOn('mode')} onMap={onMap('mode')}>{S.freight ? 'Rodzaj pojazdu' : 'Podział modalny — podróże'}</Head>
            {mapped('mode')}
            <SplitBody>
              <Donut pick={pick} label="Podział" rows={modes} />
              <SplitTable pick={pick}
                columns={[{ label: S.freight ? 'przejazdy' : 'na dobę' }, { label: '%', tone: 'strong' }, ...(S.freight ? [] : [{ label: 'próba', tone: 'dim' }])]}
                rows={[...modes].sort((a, b) => b.value - a.value).map((r) => ({
                  key: r.key, label: r.label, color: r.color,
                  cells: [S.freight ? fmt(r.value) : fmtEst(r.value), pctText(r.share), ...(S.freight ? [] : [<>{fmt(r.n)}<Small n={r.n} /></>])],
                }))} />
            </SplitBody>
            <Hint>
              {!S.freight && !t.filters.mode && `${stats.main.map((m) => `${m.label} ${pctText(m.share)}${m.margin ? ` ±${Math.round(100 * m.margin)}` : ''}`).join(' · ')} (± p.p., 95%). `}
              Naciśnij część dowolnego wykresu, aby zostawić tylko ją — w panelu i na mapie.
            </Hint>
          </Block>
          {means && (
            <StatBlock title="Średnie">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '3px 10px', fontSize: 12, alignItems: 'baseline' }}>
                {means.list.map((m) => (
                  <Fragment key={m.key}>
                    <span>{m.label}</span>
                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><b>{meanText(m)}</b> <small style={{ opacity: 0.7 }}>{meanNote(m)}<Small n={m.n} /></small></span>
                  </Fragment>
                ))}
              </div>
              <LinkButton block onClick={() => downloadCsv(averagesTable(means), `${fname}-srednie.csv`)}>Pobierz średnie (CSV)</LinkButton>
            </StatBlock>
          )}
          {(S.freight ? FREIGHT_STACKS : STACKS).map(([key, label]) => {
            const s = stackOf(key, label)
            return s && (
              <Block key={key}>
                <Head on={statOn(key)} onMap={onMap(key)}>{s.label}<Small n={s.n} /></Head>
                {mapped(key)}
                <Stack parts={s.parts} on={onOf(key)} onPick={toggle(key)} />
              </Block>
            )
          })}
          <Block>
            <h4>{S.freight ? 'Przejazdy' : 'Podróże'} według godziny rozpoczęcia</h4>
            <StackedHourBars kind="trips" hours={x.hours} unit={unitOf(S).replace('/dobę', '')}
              pieces={S.modes.map((m, i) => ({ id: m.key, name: m.label, values: stats.hours[i], fill: m.color }))
                .filter((p) => p.values.some((v) => v))} />
            {x.hours.length < 24 && <Hint>Tylko podróże rozpoczęte w godzinach {hourRuns(x.hours)}.</Hint>}
          </Block>

          <StatBlock title="Zestawienie — jedno według drugiego">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label><small>Wiersze</small><Select label="Wiersze" value={tab.row.key} options={dimOpts} onChange={(rows) => setT({ ...t, rows })} /></label>
              <label><small>Podział paska</small><Select label="Podział paska" value={tab.split.key} options={dimOpts} onChange={(split) => setT({ ...t, split })} /></label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 11, margin: '6px 0' }}>
              {tab.cols.filter((c) => tab.rows.some((r) => r.parts[c.i] > 0)).map((c) => (
                <span key={c.i} style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: splitColors[c.i] }} />{c.label}
                </span>
              ))}
            </div>
            {tab.rows.map((r) => (
              <div key={r.i} style={{ marginBottom: 6, opacity: isSmall(r.n) ? 0.7 : 1 }}>
                <button type="button" style={{ ...listRow, padding: 0 }} onClick={() => toggle(tab.row.key)(r.i)} title="Zostaw tylko ten wiersz">
                  <span style={{ fontWeight: onOf(tab.row.key).has(String(r.i)) ? 700 : 400 }}>{r.label}</span>
                  <small style={{ opacity: 0.75 }}>
                    <b>{pctText(r.share)}</b> · {S.freight ? fmt(r.w) : fmtEst(r.w)}{r.km != null ? ` · ${fixed(r.km)} km` : ''}{r.min != null ? ` · ${Math.round(r.min)} min` : ''} · n={fmt(r.n)}<Small n={r.n} />
                  </small>
                </button>
                <Bar height={16} parts={r.parts.map((share, i) => ({ key: String(i), share, label: tab.cols[i].label, color: splitColors[i] }))} onPick={toggle(tab.split.key)} />
              </div>
            ))}
            <Hint>(!) — mniej niż 20 podróży w próbie, wartość orientacyjna.</Hint>
            <LinkButton block onClick={() => downloadCsv(crossTable(tab), `${fname}-zestawienie.csv`)}>Pobierz zestawienie (CSV)</LinkButton>
          </StatBlock>

          {day && day.n > 0 && (
            <StatBlock title="Całe dni — łańcuchy podróży">
              <Hint>
                {fmt(day.n)} osób z próby{places.length ? ' mieszkających tutaj' : ''} z co najmniej jedną podróżą, która spełnia filtry:
                średnio {fixed(day.trips)} podróży w ciągu dnia, {pctText(day.more)} dni to więcej niż tam i z powrotem.
              </Hint>
              <Stack parts={day.modes} />
              <HotList hotKey={hot.pattern} items={day.list.slice(0, 12).map((p) => ({
                key: p.key, title: p.label, sub: `${fmt(p.n)} w próbie`, value: pctText(p.share), n: p.n, on: t.pattern === p.key,
                hot: show === 'days' ? { pattern: p.key } : null, hotKey: p.key,
                onPick: () => setT({ ...t, show: 'days', pattern: t.pattern === p.key ? null : p.key }),
              }))} />
              {show !== 'days' && <Hint>Naciśnij łańcuch, aby zobaczyć te dni na mapie.</Hint>}
              {show === 'days' && (
                <HotList hotKey={hot.day} items={x.dayRows.filter((r) => !t.pattern || r.key === t.pattern).slice(0, 25).map((r) => ({
                  key: r.k, title: dayText(S, spots, r).join(' · '), sub: `${S.T.ages[S.T.cols.ag[r.trips[0]]]} lat, ${S.T.jobs[S.T.cols.jb[r.trips[0]]]}`, value: '', hot: { day: r.k }, hotKey: r.k,
                }))} />
              )}
              <Hint>Osoby, które nie wyszły z domu, są pominięte.</Hint>
              <LinkButton block onClick={() => downloadCsv(daysTable(S, spots, x.dayRows), `${fname}-dni.csv`)}>
                Pobierz dni (CSV, {fmt(day.n)} wierszy)
              </LinkButton>
            </StatBlock>
          )}

          {ranked && (
            <StatBlock title={`Obszary — ${ranked.title}`}>
              <HotList hotKey={hot.place} items={ranked.rows.slice(0, 15).map((r) => ({
                key: r.key, title: r.name, sub: `${fmt(r.n)} w próbie`, value: r.text, n: r.n,
                on: t.picked.includes(r.key), hot: { place: r.key }, hotKey: r.key, onPick: () => pickPlace(r.p),
              }))} />
            </StatBlock>
          )}
          <StatBlock title={`${partner ? (x.way === 'from' ? 'Dokąd' : x.way === 'to' ? 'Skąd' : 'Z czym połączone') : 'Najwięcej podróży'}${perHead ? (partner ? ` — na ${small} ${small > 1 ? 'mieszkańców' : 'mieszkańca'} tamtego obszaru` : ` na ${small > 1 ? '1000 mieszkańców' : 'mieszkańca'}`) : ''}`}>
            <HotList hotKey={hot.place} items={top.slice(0, 20).map((r) => ({
              key: r.key, title: r.p && t.picked.includes(r.key) && partner ? `${r.name} — w obrębie` : r.name,
              sub: `${S.freight ? '' : `${fmtEst(r.w)} na dobę · `}${pctText(partner ? r.w / stats.w : null).replace('—', '') ? (partner ? `${pctText(r.w / stats.w)} · ` : '') : ''}${fmt(r.n)} w próbie`,
              value: S.freight ? fmt(r.w) : perHead ? fixed(small * r.rate, small > 1 ? 1 : 2) : fmtEst(r.w), n: r.n,
              on: t.picked.includes(r.key), hot: r.p ? { place: r.key } : null, hotKey: r.key, onPick: r.p ? () => pickPlace(r.p) : undefined,
            }))} />
          </StatBlock>
          {spotTop.length > 0 && (
            <StatBlock title="Konkretne cele">
              <HotList hotKey={hot.spot} items={spotTop.slice(0, 12).map((r) => ({
                key: r.i, title: r.name, sub: `${fmt(r.n)} w próbie`, value: fmtEst(r.w), n: r.n, on: t.filters.spot?.[0] === r.i,
                hot: { spot: r.i }, hotKey: r.i, onPick: () => toggle('spot')(r.i),
              }))} />
              <Hint>Adresy albo ulice w rejonie, poza domem, które podało co najmniej 5 badanych.</Hint>
            </StatBlock>
          )}
          <StatBlock title={`Pojedyncze ${S.freight ? 'przejazdy' : 'podróże'}`}>
            <LinkButton onClick={() => setList(!list)}>
              {list ? 'Ukryj listę' : `Pokaż listę (${fmt(Math.min(MANY, stats.n))} z ${fmt(stats.n)})`}
            </LinkButton>
            {list && (
              <DataTable caption="Pojedyncze podróże" sortBy="column" density="compact" maxHeight="26rem"
                labelHead="skąd" labelWidth="8rem"
                columns={[{ key: 't', head: 'dokąd', align: 'left' }, { key: 'h', head: 'godz.' }, { key: 'm', head: 'czym', align: 'left' },
                  { key: 'a', head: 'cel', align: 'left' }, ...(S.freight ? [] : [{ key: 'km', head: 'km' }, { key: 'd', head: 'min' }, { key: 'o', head: 'os.' }])]}
                rows={idx.slice(0, MANY).map((i) => {
                  const r = tripRow(S, i)
                  const txt = (s) => ({ content: s, value: s })
                  const end = (k, q) => (spots && k >= 0 ? spots[k].name : q.name)
                  const c = S.T.cols
                  return {
                    id: String(i), label: end(c.pf ? c.pf[i] : -1, r.from), labelValue: r.from.name,
                    cells: [txt(end(c.pt ? c.pt[i] : -1, r.to)), r.hour == null ? null : { content: `${r.hour}`, value: r.hour }, txt(r.mode), txt(r.act),
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
          <LinkButton block onClick={() => downloadCsv(placesTable(S, sums, t.level, x.passed, x.way), `${fname}-obszary.csv`)}>
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
            <li>Dzienniczki podróży, wtorek–czwartek, kwiecień–czerwiec 2024; wagi KBR odtwarzają opublikowane 1 397 390 podróży mieszkańców Wrocławia na dobę (1 729 009 z gminami).</li>
            <li>„Na mieszkańca” dzieli przez osoby od 6 lat, które reprezentuje próba. Liczba podróży na osobę zależy od ankietera bardziej niż od osiedla (od 1,1 do 2,6), więc różnice między osiedlami do ok. 25% mogą być przypadkiem.</li>
            <li>Mieszkańcy Wrocławia i 9 gmin, od 6 lat. Bez przyjezdnych z dalszych okolic, taksówek pustych i dostaw.</li>
            <li>Miejsca: adres albo ulica w rejonie, jeśli podało je co najmniej 5 badanych (dom — ulica); pozostałe z dokładnością do rejonu.</li>
          </>
        )}
      </Notes>
    </DetailsPanel>
  )
}
