// The survey's questions on the map: who said what, by where they live.
import { useMemo } from 'react'
import {
  Block, Chips, DetailsPanel, Fact, Facts, Field, Hint, LinkButton, Notes, Panel, RankList,
  Select, ShareButtons, Slider, StatBlock, Toggle, Warn, downloadCsv, fixed, fmt, slug,
} from '@bartor-net/ui-kit'
import { MapTooltip, TipNote } from '@bartor-net/ui-kit/map'
import { HeatImage, ZoneLayer } from './ZoneLayer'
import Bars from './Bars'
import { FEW_ANSWERS, Small } from './Small'
import Stack, { Bar, KINDS, ORDERED, SCALE } from './Stack'
import { answersCard, answersName, draw, everythingTable, viewTable } from './surveyCards'
import {
  answersTable, meanDigits, meanLabel, meanOf, onMean, perPeopleOf, valueOf, clampOpts, diverging, isNone, isWhole, pickWarning, togglePick, fullName, marginOf, optionShares, rgb, rowAt, sentiment, sentimentNote, sentimentOf,
  SENT_COLOR, shareOf, spanOf, startOpts, surface, valuesOf,
} from './answers'

// Too few answers for a colour of its own.
const ENOUGH = { d: 40, z: 15 }
// the city and what is just around it
const BOX = [51.02, 16.79, 51.23, 17.2]

const pctText = (s) => (s == null ? '—' : `${Math.round(100 * s)}%`)

/** The question that is open, or the first. */
export const questionOf = (A, a) => A && (A.questions.find((x) => x.key === a.q) || A.questions[0])

/** `tab` is the open question's figures, fetched by themselves. */
export function useAnswers(A, Z, a0, tab) {
  const q0 = questionOf(A, a0)
  const q = useMemo(() => (q0 && tab ? { ...q0, tab } : null), [q0, tab])
  const group = q && (q.tab[a0.group] ? a0.group : 'all')
  const a = a0
  const opts = useMemo(() => (q ? clampOpts(q, a.opts ?? startOpts(q)) : []), [q, a.opts])
  const places = Z && (a.level === 'd' ? Z.districts : Z.zones)
  const city = q && rowAt(q, group, 'a', 'wro')
  const mid = q ? valueOf(q, city, opts, true) ?? 0 : 0
  const vals = useMemo(() => {
    if (!q || !places) return []
    // the smoothed map still answers a hover with the zone underneath
    return valuesOf(q, group, opts, a.level === 'd' ? 'd' : 'z', places, a.raw)
  }, [q, group, opts, a.level, a.raw, places])
  const span = useMemo(() => spanOf(vals, mid), [vals, mid])
  const heat = useMemo(() => (q && Z && a.level === 'h'
    && !isNone(q, opts) ? surface(q, group, opts, Z.zones, { km: a.km, box: BOX, raw: a.raw }) : null), [q, group, opts, Z, a.level, a.km, a.raw])
  const sent = q ? sentiment(q, opts) : 0
  return q && Z ? { A, Z, a, q, group, opts, city, mid, vals, span, heat, sent } : null
}

/** Colours of a question's answers: good to bad, or kinds of things. */
export const optColors = (q) => q.options.map((_, i) => {
  // a number runs from dark to light
  if (q.number || q.key === 'school0') return ORDERED[Math.round((i * (ORDERED.length - 1)) / Math.max(1, q.options.length - 1))]
  if (q.multi) return SENT_COLOR[sentimentOf(q, i)]
  // modes have their colours everywhere
  if (q.key === 'usual') return ['#e4572e', '#3987e5', '#b5179e', '#0ca30c'][i]
  const marks = q.options.map((_o, k) => sentimentOf(q, k))
  if (!marks.some(Boolean)) return KINDS[i % KINDS.length]
  const s = marks[i]
  if (!s) return /nie wiem|nie mam|trudno/.test(q.options[i]) ? SCALE[5] : SCALE[2]
  // of several good ones the first is the strongest, of the bad the last
  const same = marks.map((m, k) => (m === s ? k : -1)).filter((k) => k >= 0)
  const at = same.indexOf(i) / Math.max(1, same.length - 1)
  return s > 0 ? mixHex(SCALE[0], SCALE[1], at) : mixHex(SCALE[3], SCALE[4], same.length > 1 ? at : 1)
})
const mixHex = (a, b, t) => `#${[1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('')}`

const optText = (q, opts) => (onMean(q, opts) ? meanLabel(q) : isNone(q, opts) ? 'nie wybrano odpowiedzi' : isWhole(q, opts) ? 'wszystkie odpowiedzi' : opts.map((o) => q.options[o]).join(' + '))
/** A value as the question has it, and its margin. */
const valText = (q, opts, x) => (x == null ? '—' : onMean(q, opts) ? fixed(x, meanDigits(q)) : pctText(x))
const marginText = (q, opts, m) => (m == null ? '' : onMean(q, opts) ? `±${fixed(m, meanDigits(q))}` : `±${Math.round(100 * m)} p.p.`)
const enough = (a) => ENOUGH[a.level === 'd' ? 'd' : 'z']

export function AnswersMap({ x, onPick, dark }) {
  const { a, q, opts, mid, span, vals, heat, sent } = x
  const picked = useMemo(() => new Set(a.place ? [a.place] : []), [a.place])
  const items = useMemo(() => vals.map((v) => ({
    ...v, color: v.v == null ? null : rgb(diverging(v.v, mid, span, sent, dark)),
    alpha: v.v == null ? null : (0.12 + 0.5 * Math.min(1, v.n / enough(a))) * (Math.abs(v.v - mid) < marginOf(q, v.row, opts, a.raw) ? 0.5 : 1),
    // a difference the sample cannot tell from none
    faint: v.v != null && Math.abs(v.v - mid) < marginOf(q, v.row, opts, a.raw),
  })), [vals, a, mid, span, sent, q, opts, dark])
  return (
    <>
      {heat && <HeatImage surface={heat} mid={mid} span={span} sent={sent} dark={dark} />}
      <ZoneLayer items={items} picked={picked} onPick={onPick} quiet={!!heat} tip={({ p, row, v, n }) => (
        <MapTooltip sticky>
          <b>{p.name}</b>{p.level === 'z' && <TipNote> · {p.district}</TipNote>}<br />
          {row ? (
            <>
              {optText(q, opts)}: <b>{valText(q, opts, v)}</b> {marginText(q, opts, marginOf(q, row, opts, a.raw))}<Small n={n} few={FEW_ANSWERS} /><br />
              <TipNote>{n} odpowiedzi · Wrocław {valText(q, opts, mid)}{perPeopleOf(row) != null ? ` · ${fmt(perPeopleOf(row))} ${q.per}` : ''}</TipNote>
            </>
          ) : <TipNote>za mało odpowiedzi</TipNote>}
        </MapTooltip>
      )} />
    </>
  )
}

export function answersLegend({ x, dark = true }) {
  const { a, q, opts, mid, span, sent } = x
  const warning = pickWarning(q, opts)
  if (warning) return [{ title: fullName(q) }, { note: warning }, { note: 'wybierz odpowiedzi z listy albo z wykresu' }]
  return [
    { title: fullName(q) },
    { note: optText(q, opts) },
    ...[-1, -0.5, 0, 0.5, 1].map((t) => ({
      color: rgb(diverging(mid + t * span, mid, span, sent, dark)),
      label: t === 0 ? `${valText(q, opts, mid)} — średnia Wrocławia` : `${valText(q, opts, Math.max(0, onMean(q, opts) ? mid + t * span : Math.min(1, mid + t * span)))}${Math.abs(t) === 1 ? (t < 0 ? ' i mniej' : ' i więcej') : ''}`,
    })),
    { note: sentimentNote(q, opts, dark) },
    { note: a.level === 'h' ? `wygładzone w promieniu ok. ${String(a.km).replace('.', ',')} km; blade = mało odpowiedzi`
      : `blade = mało odpowiedzi lub różnica w granicach błędu; (!) = poniżej ${FEW_ANSWERS}` },
  ]
}

export function AnswersControls({ x, setA }) {
  const { A, a, q, group, opts } = x
  const set = (o) => setA({ ...a, ...o })
  const groups = [...new Set(A.questions.map((y) => y.group))]
  const toggle = (o) => set({ opts: togglePick(q, opts, o) })
  const cell = (r) => (
    <Field key={r} label={r}>
      <Chips tight small label={r} onPick={(k) => set({ q: k, opts: null })}
        items={A.questions.filter((y) => y.group === r).map((y) => ({ key: y.key, label: y.label, on: y.key === q.key }))} />
    </Field>
  )
  return (
    <>
      <Panel title="Pytanie" help={(
        <>
          <p>
            Odpowiedzi z badania ankietowego KBR 2024, według miejsca zamieszkania. Kolor
            mówi, czy odpowiedź jest tam częstsza niż średnio we Wrocławiu i co to znaczy: zielony — lepiej albo
            większe poparcie zmiany, pomarańczowy — gorzej albo mniejsze. Fakty i liczby, jak wiek, nie są dobre ani złe: mają
            jeden kolor, jaśniejszy tam, gdzie więcej (na jasnym podkładzie — ciemniejszy).
          </p>
          <p>
            Nikogo nie pytano, czy zrezygnuje z samochodu. O oceny i utrudnienia pytano tylko osoby, które
            na co dzień tak się poruszają: pasażerów o komunikację, pieszych o chodniki.
          </p>
        </>
      )}>
        {groups.map(cell)}
        {q.full && <Hint>„{q.full}”</Hint>}
      </Panel>
      <Panel title="Odpowiedź na mapie">
        <Chips tight small label="Odpowiedzi" onPick={(k) => (k === 'mean' ? set({ opts: [] }) : toggle(+k))}
          items={[...(q.number ? [{ key: 'mean', label: 'średnia', on: !opts.length }] : []), ...q.options.map((o, i) => ({ key: String(i), label: o, on: opts.includes(i), color: optColors(q)[i] }))]} />
        {pickWarning(q, opts) && <Warn>{pickWarning(q, opts)}</Warn>}
        {q.multi ? <Hint>Można było wskazać kilka; mapa pokazuje jedną.</Hint>
          : <Hint>{q.number ? 'Średnia albo udział zaznaczonych odpowiedzi.' : 'Zaznaczone odpowiedzi są dodawane.'}</Hint>}
        <Field label="Kto odpowiadał">
          <Select value={group} label="Kto odpowiadał" onChange={(g) => set({ group: g })}
            options={A.groups.map((g) => ({ value: g.key, label: g.label, disabled: !q.tab[g.key] }))} />
        </Field>
        <Field label="Widok" help={<p>Rejony i osiedla pokazują same odpowiedzi; mapa wygładzona uśrednia odpowiedzi z okolicy, więc mniej zależy od przypadku, ale rozmywa granice.</p>}>
          <Chips tight label="Widok" onPick={(level) => set({ level, place: null })} items={[
            { key: 'd', label: 'Osiedla', on: a.level === 'd' },
            { key: 'z', label: 'Rejony', on: a.level === 'z' }, { key: 'h', label: 'Mapa wygładzona', on: a.level === 'h' }]} />
        </Field>
        {!!q.opinion && <Toggle checked={!a.raw} onChange={(on) => set({ raw: !on })} label="Skoryguj o ankietera" help={(
          <>
            <p>
              Odpowiedzi różnią się między ankieterami kilka razy bardziej niż między osiedlami — w pytaniu
              o wjazd do centrum sam numer ankietera wyjaśnia 38% różnic, a osiedle ponad to ok. 1%. Każdy z 42
              ankieterów pracował w kilku osiedlach Wrocławia, więc surowa mapa opinii pokazuje w dużej mierze, kto pytał.
            </p>
            <p>
              To nie skutek tego, że ankieter pracował w jednej okolicy: w tym samym rejonie odpowiedzi osób pytanych
              przez różnych ankieterów prawie się nie zgadzają (korelacja ok. 1%), a pytanych przez tego samego —
              także ponad 4 km od siebie — zgadzają się wyraźnie (8–48%). Jeden ankieter zapisał „wszystkie auta do
              centrum” u 98% z 492 osób; inni w tych samych rejonach u 51%.
            </p>
            <p>
              Korekta odejmuje od odpowiedzi to, o ile u danego ankietera różnią się one od reszty, z poprawką
              na osiedla, w których pytał. Wygładza też część prawdziwych różnic — zostaje z nich ok. połowa —
              bo ankieterzy pracowali na swoich terenach. Faktów, jak liczba samochodów, nie poprawiamy.
            </p>
          </>
        )} />}
        {a.level === 'h' && (
          <Slider min="0.5" max="2.5" step="0.25" value={a.km} label="Wygładzenie" onChange={(km) => set({ km })}
            caption={`Wygładzenie: ${String(a.km).replace('.', ',')} km`} />
        )}
      </Panel>
    </>
  )
}

export function AnswersPanel({ x, setA, onClose, loadAll }) {
  const { A, Z, a, q, group, opts, city, mid, vals } = x
  const set = (o) => setA({ ...a, ...o })
  const level = a.level === 'd' ? 'd' : 'z'
  const p = a.place && (level === 'd' ? Z.districts : Z.zones).find((y) => y.key === a.place)
  const row = p ? rowAt(q, group, level, p.i) : city
  const v = valueOf(q, row, opts, a.raw)
  const mg = (r, o = opts) => marginText(q, o, marginOf(q, r, o, a.raw))
  const gname = A.groups.find((g) => g.key === group).label
  const sure = (y) => Math.abs(y.v - mid) >= marginOf(q, y.row, opts, a.raw)
  const ranked = vals.filter((y) => y.v != null && y.n >= enough(a) && sure(y)).sort((s, t) => t.v - s.v)
  const by = A.groups.filter((g) => q.tab[g.key]).map((g) => {
    const r = p ? rowAt(q, g.key, level, p.i) : rowAt(q, g.key, 'a', 'wro')
    return r && { g, r, v: valueOf(q, r, opts, a.raw) }
  }).filter(Boolean)
  const colors = optColors(q)
  const toggle = (o) => set({ opts: togglePick(q, opts, o) })
  const warning = pickWarning(q, opts)
  const around = !p && rowAt(q, group, 'a', 'out')
  const name = answersName(x, p)
  const spec = () => answersCard({ x, p, row, by, gname, ranked, colors, optLabel: optText(q, opts), text: (y) => valText(q, opts, y), mtext: (r) => mg(r), legend: answersLegend({ x, dark: false }).filter((l) => l.color) })
  return (
    <DetailsPanel pill={p ? (p.level === 'z' ? `rejon ${p.id}` : p.city ? 'osiedle' : 'gmina') : 'ankieta'} color="#d6541c"
      title={fullName(q)} subtitle={`${p ? p.name : 'Mieszkańcy Wrocławia'} · ${gname}`} onClose={onClose}
      actions={row && <ShareButtons render={() => draw(spec())} filename={`${name}.png`} title={fullName(q)} text={`KBR Wrocław 2024 — ${fullName(q)}`} />}>
      <Facts>
        <Fact label={optText(q, opts).length > 34 ? 'Wybrana odpowiedź' : optText(q, opts)} tone="now">{valText(q, opts, v)}{row && v != null ? ` ${mg(row)}` : ''}</Fact>
        <Fact label={q.home ? 'Gospodarstwa w próbie' : 'Odpowiedzi w próbie'}>{row ? <>{fmt(row[0])}<Small n={row[0]} few={FEW_ANSWERS} /></> : '—'}</Fact>
        {!!q.number && !onMean(q, opts) && <Fact label={meanLabel(q)[0].toUpperCase() + meanLabel(q).slice(1)}>{fixed(meanOf(row), meanDigits(q))}</Fact>}
        {perPeopleOf(row) != null && <Fact label={q.per[0].toUpperCase() + q.per.slice(1)}>{fmt(perPeopleOf(row))}{p ? ` (Wrocław ${fmt(perPeopleOf(city))})` : ''}</Fact>}
        {p && <Fact label="Wrocław">{valText(q, opts, mid)}</Fact>}
        {around && <Fact label="Gminy wokół">{valText(q, opts, valueOf(q, around, opts))}</Fact>}
      </Facts>
      {warning && <Warn>{warning}</Warn>}
      {optText(q, opts).length > 34 && <Hint>„{optText(q, opts)}”</Hint>}
      {row && row[0] < 30 && <Warn>Tylko {row[0]} odpowiedzi — to za mało, by oceniać ten obszar osobno.</Warn>}
      <Block>
        <h4>Wszystkie odpowiedzi{q.multi ? ' (można było wskazać kilka)' : ''}</h4>
        {!row ? <Hint>Za mało odpowiedzi.</Hint> : q.multi ? (
          <Bars whole onPick={(r) => toggle(+r.key)}
            rows={optionShares(q, row, a.raw).sort((s, t) => t.share - s.share).map((o) => ({
              key: String(o.i), label: o.label, share: o.share, color: colors[o.i], on: opts.includes(o.i), dim: !opts.includes(o.i),
              note: p && city ? `(Wrocław ${pctText(shareOf(city, [o.i]))})` : null,
            }))} />
        ) : (
          <>
            <Stack on={new Set(opts.map(String))} onPick={(key) => toggle(+key)}
              parts={optionShares(q, row, a.raw).map((o) => ({ key: String(o.i), label: o.label, share: o.share, color: colors[o.i],
                note: p && city ? `(Wrocław ${pctText(shareOf(city, [o.i]))})` : null }))} />
            <Hint>Naciśnij odpowiedź, aby dodać ją do mapy albo usunąć.</Hint>
          </>
        )}
      </Block>
      {by.length > 1 && !(q.multi && isNone(q, opts)) && (
        <Block>
          <h4>{q.multi ? `${optText(q, opts)} — kto tak odpowiada` : q.opinion ? 'Kto jak odpowiada' : 'Według grup'}</h4>
          {q.multi ? (
            <Bars whole color={SENT_COLOR[x.sent]} onPick={(r) => set({ group: r.key })} rows={by.map(({ g, r, v: s }) => ({
              key: g.key, label: g.label, share: s, on: g.key === group, note: `${mg(r)} · n=${fmt(r[0])}`,
            }))} />
          ) : by.map(({ g, r, v: s }) => (
            <div key={g.key} style={{ marginBottom: 4 }}>
              <button type="button" onClick={() => set({ group: g.key })} style={{ display: 'flex', justifyContent: 'space-between', width: '100%', border: 0, padding: 0, background: 'none', color: 'inherit', font: 'inherit', fontSize: 12, cursor: 'pointer', fontWeight: g.key === group ? 700 : 400 }}>
                <span>{g.label}</span><span><b>{valText(q, opts, s)}</b> <small style={{ opacity: 0.7 }}>{mg(r)} · n={fmt(r[0])}<Small n={r[0]} few={FEW_ANSWERS} /></small></span>
              </button>
              <Bar height={16} on={new Set(opts.map(String))} onPick={(key) => toggle(+key)}
                parts={optionShares(q, r, a.raw).map((o) => ({ key: String(o.i), label: o.label, share: o.share, color: colors[o.i] }))} />
            </div>
          ))}
        </Block>
      )}
      <StatBlock title={`Wyraźnie inaczej niż Wrocław — ${level === 'd' ? 'osiedla i gminy' : 'rejony'}`}>
        {warning ? <Hint>Wybierz odpowiedzi, aby porównać obszary.</Hint> : !ranked.length ? <Hint>Żaden obszar nie różni się od średniej bardziej, niż wynosi błąd.</Hint> : (
          <RankList items={(ranked.length > 14 ? [...ranked.slice(0, 7), ...ranked.slice(-7)] : ranked).map((y) => ({
            key: y.p.key, title: y.p.name, sub: `${mg(y.row)} · ${y.n} ${q.home ? 'gospodarstw' : 'odpowiedzi'}`, value: <>{valText(q, opts, y.v)}<Small n={y.n} few={FEW_ANSWERS} /></>,
            on: y.p.key === a.place, onPick: () => set({ place: y.p.key === a.place ? null : y.p.key }),
          }))} />
        )}
      </StatBlock>
      {p && <LinkButton block onClick={() => set({ place: null })}>Pokaż cały Wrocław</LinkButton>}
      <LinkButton block onClick={() => downloadCsv(
        viewTable(q, A.groups, p ? level : 'a', p ? p.i : 'wro', a.raw), `${name}.csv`,
      )}>Pobierz te odpowiedzi (CSV)</LinkButton>
      <LinkButton block onClick={() => downloadCsv(
        answersTable(q, A.groups, group, level === 'd' ? Z.districts : Z.zones, level, a.raw), `kbr-ankieta-${slug(fullName(q))}-${group}.csv`,
      )}>Pobierz odpowiedzi według obszarów (CSV)</LinkButton>
      <LinkButton block onClick={() => loadAll().then((all) => downloadCsv(
        everythingTable(all, Z, group, a.raw), `kbr2024-ankieta-wszystkie-pytania-${group}.csv`,
      ))}>Pobierz wszystkie pytania — osiedla (CSV)</LinkButton>
      <Notes>
        <li>Udziały ważone wagami KBR. ± to przybliżony przedział 95%, który uwzględnia, że odpowiedzi zależą od ankietera; różnice mniejsze niż on mogą być przypadkiem.</li>
        {q.note && <li>{q.note}</li>}
        <li>Te same osoby pytały kierowców i niekierowców, więc różnice między grupami są pewniejsze niż same poziomy i niż różnice między osiedlami.</li>
        {!!q.home && <li>Liczone po gospodarstwach, ich wagami; grupa = gospodarstwa, w których jest choć jedna taka osoba.</li>}
        {p && !a.raw && !!q.opinion && <li>Wartości obszarów po korekcie o ankietera; poziom całego miasta bez niej.</li>}
        <li>Obszary z mniej niż {A.minN} odpowiedziami są puste. Na udział w badaniu zgodziło się ok. 31% gospodarstw; przedziały tego nie obejmują.</li>
        <li>KBR 2024, badanie ankietowe w gospodarstwach domowych (zał. do Raportu II).</li>
      </Notes>
    </DetailsPanel>
  )
}
