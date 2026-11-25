// The survey's questions on the map: who said what, by where they live.
import { useMemo } from 'react'
import {
  Block, Chips, DetailsPanel, Fact, Facts, Field, Hint, LinkButton, Notes, Panel, RankList,
  Select, ShareButtons, Slider, StatBlock, Toggle, Warn, downloadCsv, fmt, slug,
} from '@bartor-net/ui-kit'
import { MapTooltip, TipNote } from '@bartor-net/ui-kit/map'
import { HeatImage, ZoneLayer } from './ZoneLayer'
import Bars from './Bars'
import { answersCard, answersName, draw, everythingTable, viewTable } from './surveyCards'
import {
  answersTable, clampOpts, diverging, fullName, marginOf, optionShares, rgb, rowAt, shareOf, spanOf, startOpts,
  surface, valuesOf,
} from './answers'

// Too few answers for a colour of its own.
const ENOUGH = { d: 40, z: 15 }
// the city and what is just around it
const BOX = [51.02, 16.79, 51.23, 17.2]

const pctText = (s) => (s == null ? '—' : `${Math.round(100 * s)}%`)

export function useAnswers(A, Z, a) {
  const q = A && (A.questions.find((x) => x.key === a.q) || A.questions[0])
  const group = q && (q.tab[a.group] ? a.group : 'all')
  const opts = useMemo(() => (q ? clampOpts(q, a.opts?.length ? a.opts : startOpts(q)) : []), [q, a.opts])
  const places = Z && (a.level === 'd' ? Z.districts : Z.zones)
  const city = q && rowAt(q, group, 'a', 'wro')
  const mid = shareOf(city, opts) ?? 0
  const vals = useMemo(() => {
    if (!q || !places) return []
    // the smoothed map still answers a hover with the zone underneath
    return valuesOf(q, group, opts, a.level === 'd' ? 'd' : 'z', places, a.raw)
  }, [q, group, opts, a.level, a.raw, places])
  const span = useMemo(() => spanOf(vals, mid), [vals, mid])
  const heat = useMemo(() => (q && Z && a.level === 'h'
    ? surface(q, group, opts, Z.zones, { km: a.km, box: BOX, raw: a.raw }) : null), [q, group, opts, Z, a.level, a.km, a.raw])
  return q && Z ? { A, Z, a, q, group, opts, city, mid, vals, span, heat } : null
}

const optText = (q, opts) => opts.map((o) => q.options[o]).join(' + ')
const enough = (a) => ENOUGH[a.level === 'd' ? 'd' : 'z']

export function AnswersMap({ x, onPick }) {
  const { a, q, opts, mid, span, vals, heat } = x
  const picked = useMemo(() => new Set(a.place ? [a.place] : []), [a.place])
  const items = useMemo(() => vals.map((v) => ({
    ...v, color: v.v == null || v.n < enough(a) ? null : rgb(diverging(v.v, mid, span)),
    // a difference the sample cannot tell from none
    faint: v.v != null && Math.abs(v.v - mid) < marginOf(q, v.row, opts, a.raw),
  })), [vals, a, mid, span, q, opts])
  return (
    <>
      {heat && <HeatImage surface={heat} mid={mid} span={span} />}
      <ZoneLayer items={items} picked={picked} onPick={onPick} quiet={!!heat} tip={({ p, row, v, n }) => (
        <MapTooltip sticky>
          <b>{p.name}</b>{p.level === 'z' && <TipNote> · {p.district}</TipNote>}<br />
          {row ? (
            <>
              {optText(q, opts)}: <b>{pctText(v)}</b> ±{Math.round(100 * marginOf(q, row, opts, a.raw))} p.p.<br />
              <TipNote>{n} {n >= enough(a) ? 'odpowiedzi' : 'odpowiedzi — za mało na kolor'} · Wrocław {pctText(mid)}</TipNote>
            </>
          ) : <TipNote>za mało odpowiedzi</TipNote>}
        </MapTooltip>
      )} />
    </>
  )
}

export function answersLegend({ x }) {
  const { a, q, opts, mid, span } = x
  return [
    { title: fullName(q) },
    { note: optText(q, opts) },
    ...[-1, -0.5, 0, 0.5, 1].map((t) => ({
      color: rgb(diverging(mid + t * span, mid, span)),
      label: t === 0 ? `${pctText(mid)} — średnia Wrocławia` : `${pctText(Math.max(0, Math.min(1, mid + t * span)))}${Math.abs(t) === 1 ? (t < 0 ? ' i mniej' : ' i więcej') : ''}`,
    })),
    { note: a.level === 'h' ? `wygładzone w promieniu ok. ${String(a.km).replace('.', ',')} km; blade = mało odpowiedzi`
      : `blade = różnica od średniej w granicach błędu, szare = mniej niż ${enough(a)} odpowiedzi` },
  ]
}

export function AnswersControls({ x, setA }) {
  const { A, a, q, group, opts } = x
  const set = (o) => setA({ ...a, ...o })
  const groups = [...new Set(A.questions.map((y) => y.group))]
  const toggle = (o) => set({ opts: q.multi ? [o] : opts.includes(o) ? (opts.length > 1 ? opts.filter((y) => y !== o) : opts) : [...opts, o].sort() })
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
            Odpowiedzi z badania ankietowego KBR 2024, według miejsca zamieszkania. Niebieski — rzadziej
            niż średnio we Wrocławiu, pomarańczowy — częściej.
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
        <Chips tight small label="Odpowiedzi" onPick={(k) => toggle(+k)}
          items={q.options.map((o, i) => ({ key: String(i), label: o, on: opts.includes(i) }))} />
        {q.multi ? <Hint>Można było wskazać kilka; mapa pokazuje jedną.</Hint>
          : <Hint>Zaznaczone odpowiedzi są dodawane.</Hint>}
        <Field label="Kto odpowiadał">
          <Select value={group} label="Kto odpowiadał" onChange={(g) => set({ group: g })}
            options={A.groups.map((g) => ({ value: g.key, label: g.label, disabled: !q.tab[g.key] }))} />
        </Field>
        <Field label="Widok" help={<p>Rejony i osiedla pokazują same odpowiedzi; mapa wygładzona uśrednia odpowiedzi z okolicy, więc mniej zależy od przypadku, ale rozmywa granice.</p>}>
          <Chips tight label="Widok" onPick={(level) => set({ level, place: null })} items={[
            { key: 'd', label: 'Osiedla', on: a.level === 'd' }, { key: 'z', label: 'Rejony', on: a.level === 'z' },
            { key: 'h', label: 'Mapa wygładzona', on: a.level === 'h' }]} />
        </Field>
        <Toggle checked={!a.raw} onChange={(on) => set({ raw: !on })} label="Skoryguj o ankietera" help={(
          <>
            <p>
              Odpowiedzi różnią się między ankieterami kilka razy bardziej niż między osiedlami — w pytaniu
              o wjazd do centrum sam numer ankietera wyjaśnia 38% różnic, a osiedle ponad to ok. 1%. Każdy z 46
              ankieterów pracował w kilku osiedlach, więc surowa mapa opinii pokazuje w dużej mierze, kto pytał.
            </p>
            <p>
              Korekta odejmuje od odpowiedzi to, o ile u danego ankietera różnią się one od reszty, z poprawką
              na osiedla, w których pytał. Nie usuwa całego wpływu, dlatego przedziały ± są szerokie.
            </p>
          </>
        )} />
        {a.level === 'h' && (
          <Slider min="0.5" max="2.5" step="0.25" value={a.km} label="Wygładzenie" onChange={(km) => set({ km })}
            caption={`Wygładzenie: ${String(a.km).replace('.', ',')} km`} />
        )}
      </Panel>
    </>
  )
}

export function AnswersPanel({ x, setA, onClose }) {
  const { A, Z, a, q, group, opts, city, mid, vals } = x
  const set = (o) => setA({ ...a, ...o })
  const level = a.level === 'd' ? 'd' : 'z'
  const p = a.place && (level === 'd' ? Z.districts : Z.zones).find((y) => y.key === a.place)
  const row = p ? rowAt(q, group, level, p.i) : city
  const v = shareOf(row, opts, a.raw)
  const mg = (r, o = opts) => Math.round(100 * marginOf(q, r, o, a.raw))
  const gname = A.groups.find((g) => g.key === group).label
  const sure = (y) => Math.abs(y.v - mid) >= marginOf(q, y.row, opts, a.raw)
  const ranked = vals.filter((y) => y.v != null && y.n >= enough(a) && sure(y)).sort((s, t) => t.v - s.v)
  const by = A.groups.filter((g) => q.tab[g.key]).map((g) => {
    const r = p ? rowAt(q, g.key, level, p.i) : rowAt(q, g.key, 'a', 'wro')
    return r && { g, r, v: shareOf(r, opts, a.raw) }
  }).filter(Boolean)
  const around = !p && rowAt(q, group, 'a', 'out')
  const name = answersName(x, p)
  const spec = () => answersCard({ x, p, row, by, gname, ranked, legend: answersLegend({ x }).filter((l) => l.color) })
  return (
    <DetailsPanel pill={p ? (p.level === 'z' ? `rejon ${p.id}` : p.city ? 'osiedle' : 'gmina') : 'ankieta'} color="#d6541c"
      title={fullName(q)} subtitle={`${p ? p.name : 'Mieszkańcy Wrocławia'} · ${gname}`} onClose={onClose}
      actions={row && <ShareButtons render={() => draw(spec())} filename={`${name}.png`} title={fullName(q)} text={`KBR Wrocław 2024 — ${fullName(q)}`} />}>
      <Facts>
        <Fact label={optText(q, opts)} tone="now">{pctText(v)}{row && v != null ? ` ±${mg(row)} p.p.` : ''}</Fact>
        <Fact label="Odpowiedzi w próbie">{row ? fmt(row[0]) : '—'}</Fact>
        {p && <Fact label="Wrocław">{pctText(mid)}</Fact>}
        {around && <Fact label="Gminy wokół">{pctText(shareOf(around, opts))}</Fact>}
      </Facts>
      {row && row[0] < 30 && <Warn>Tylko {row[0]} odpowiedzi — to za mało, by oceniać ten obszar osobno.</Warn>}
      <Block>
        <h4>Wszystkie odpowiedzi{q.multi ? ' (można było wskazać kilka)' : ''}</h4>
        {row ? (
          <Bars whole color="#d6541c" onPick={(r) => set({ opts: q.multi ? [+r.key] : opts.includes(+r.key) && opts.length > 1 ? opts.filter((o) => o !== +r.key) : [...new Set([...opts, +r.key])].sort() })}
            rows={(q.multi ? optionShares(q, row, a.raw).sort((s, t) => t.share - s.share) : optionShares(q, row, a.raw)).map((o) => ({
              key: String(o.i), label: o.label, share: o.share, on: opts.includes(o.i), dim: !opts.includes(o.i),
              note: p && city ? `(Wrocław ${pctText(shareOf(city, [o.i]))})` : null,
            }))} />
        ) : <Hint>Za mało odpowiedzi.</Hint>}
      </Block>
      {by.length > 1 && (
        <Block>
          <h4>{optText(q, opts)} — kto tak odpowiada</h4>
          <Bars whole color="#3f8bd0" onPick={(r) => set({ group: r.key })} rows={by.map(({ g, r, v: s }) => ({
            key: g.key, label: g.label, share: s, on: g.key === group, note: `±${mg(r)} · n=${fmt(r[0])}`,
          }))} />
        </Block>
      )}
      <StatBlock title={`Wyraźnie inaczej niż Wrocław — ${level === 'd' ? 'osiedla i gminy' : 'rejony'}`}>
        {!ranked.length ? <Hint>Żaden obszar nie różni się od średniej bardziej, niż wynosi błąd.</Hint> : (
          <RankList items={(ranked.length > 14 ? [...ranked.slice(0, 7), ...ranked.slice(-7)] : ranked).map((y) => ({
            key: y.p.key, title: y.p.name, sub: `±${mg(y.row)} p.p. · ${y.n} odpowiedzi`, value: pctText(y.v),
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
      <LinkButton block onClick={() => downloadCsv(
        everythingTable(A, Z, group, a.raw), `kbr2024-ankieta-wszystkie-pytania-${group}.csv`,
      )}>Pobierz wszystkie pytania — osiedla (CSV)</LinkButton>
      <Notes>
        <li>Udziały ważone wagami KBR. ± to przybliżony przedział 95%, który uwzględnia, że odpowiedzi zależą od ankietera; różnice mniejsze niż on mogą być przypadkiem.</li>
        <li>Te same osoby pytały kierowców i niekierowców, więc różnice między grupami są pewniejsze niż same poziomy i niż różnice między osiedlami.</li>
        {p && !a.raw && <li>Wartości obszarów po korekcie o ankietera; poziom całego miasta bez niej.</li>}
        <li>Obszary z mniej niż {A.minN} odpowiedziami w ogóle nie są publikowane.</li>
        <li>KBR 2024, badanie ankietowe w gospodarstwach domowych (zał. do Raportu II).</li>
      </Notes>
    </DetailsPanel>
  )
}
