// Pictures of the survey views: what is asked or filtered, the map, the bars,
// and the notes that have to travel with them.
import { fixed, fmt, fmtEst, renderCard, slug, splitBlock } from '@bartor-net/ui-kit'
import { diverging, fullName, marginOf, optionShares, rgb, shareOf } from './answers'
import { breaks, scale } from './trips'

const SITE = 'bartor.github.io/wroc-transport-map'
const KBR = 'Kompleksowe Badania Ruchu Wrocław 2024'
const pctText = (s) => (s == null ? '—' : s > 0 && s < 0.005 ? '<1%' : `${Math.round(100 * s)}%`)

/** Horizontal bars with their labels above; the rest of the line is for what
 *  stands beside the share. */
export const barsBlock = ({ title, rows, color, whole }) => (ctx, y0, { W, PAD, INK, DIM, FAINT, font, wrap, para }) => {
  let y = title ? para(ctx, title.toUpperCase(), PAD, y0, W - 2 * PAD, 14, FAINT, 600) + 8 : y0
  // `whole`: the bar's full length is 100%, not the longest of them
  const top = whole ? 1 : Math.max(0.0001, ...rows.map((r) => r.share))
  for (const r of rows) {
    ctx.font = font(17, r.on === false ? 400 : 600)
    ctx.textBaseline = 'top'
    ctx.fillStyle = r.on === false ? DIM : INK
    const lines = wrap(ctx, r.label, W - 2 * PAD - 220)
    lines.forEach((line, i) => ctx.fillText(line, PAD, y + i * 22))
    ctx.textAlign = 'right'
    ctx.font = font(17, 700)
    ctx.fillText(pctText(r.share), W - PAD, y)
    if (r.note) {
      const w = ctx.measureText(pctText(r.share)).width
      ctx.font = font(14)
      ctx.fillStyle = FAINT
      ctx.fillText(r.note, W - PAD - w - 10, y + 2)
    }
    ctx.textAlign = 'left'
    y += lines.length * 22 + 4
    ctx.fillStyle = '#eceef2'
    ctx.fillRect(PAD, y, W - 2 * PAD, 10)
    ctx.globalAlpha = r.on === false ? 0.4 : 1
    ctx.fillStyle = r.color || color
    ctx.fillRect(PAD, y, ((W - 2 * PAD) * r.share) / top, 10)
    ctx.globalAlpha = 1
    y += 22
  }
  return y + 14
}

/** The view over some rings, in card pixels: x grows east, y grows south. */
function frame(rings, x, y, w, maxH) {
  let [s, n, west, e] = [90, -90, 180, -180]
  for (const r of rings) {
    for (const [la, lo] of r) {
      s = Math.min(s, la)
      n = Math.max(n, la)
      west = Math.min(west, lo)
      e = Math.max(e, lo)
    }
  }
  const k = Math.cos((((s + n) / 2) * Math.PI) / 180)
  const size = Math.min(w / ((e - west) * k), maxH / (n - s))
  const h = (n - s) * size
  const left = x + (w - (e - west) * k * size) / 2
  return { h, box: [s, west, n, e], at: ([la, lo]) => [left + (lo - west) * k * size, y + (n - la) * size] }
}

/**
 * The map of a view without its tiles: areas (and circles) with their colours,
 * a legend under it. `fit` are the rings that must be in the picture; `heat` a
 * smoothed surface drawn under the outlines.
 */
export const mapBlock = ({ areas, fit, circles = [], heat, legend, title }) => (ctx, y0, { W, PAD, INK, DIM, FAINT, font, para }) => {
  let y = title ? para(ctx, title, PAD, y0, W - 2 * PAD, 16, INK, 600) + 10 : y0
  const f = frame(fit, PAD, y, W - 2 * PAD, 620)
  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD, y, W - 2 * PAD, f.h)
  ctx.clip()
  const trace = (rings) => {
    ctx.beginPath()
    for (const r of rings) {
      r.forEach((p, i) => { const [a, b] = f.at(p); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b) })
      ctx.closePath()
    }
  }
  if (heat) {
    const { v, n, cols, rows, box } = heat.surface
    const cv = document.createElement('canvas')
    cv.width = cols
    cv.height = rows
    const g = cv.getContext('2d')
    const img = g.createImageData(cols, rows)
    for (let i = 0; i < v.length; i++) {
      if (Number.isNaN(v[i])) continue
      img.data.set([...diverging(v[i], heat.mid, heat.span), Math.round(255 * Math.min(1, n[i] / 60) ** 0.8)], i * 4)
    }
    g.putImageData(img, 0, 0)
    const [a, b] = f.at([box[2], box[1]])
    const [c, d] = f.at([box[0], box[3]])
    ctx.drawImage(cv, a, b, c - a, d - b)
  }
  for (const s of areas) {
    trace(s.rings)
    if (!heat) {
      ctx.globalAlpha = s.color ? (s.faint ? 0.35 : 1) : 1
      ctx.fillStyle = s.color || '#f1f2f5'
      ctx.fill('evenodd')
    }
    ctx.globalAlpha = heat ? 0.35 : 1
    ctx.strokeStyle = heat ? '#5b6270' : '#ffffff'
    ctx.lineWidth = heat ? 0.6 : 1.2
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  for (const s of areas.filter((q) => q.on)) {
    trace(s.rings)
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    ctx.stroke()
  }
  for (const c of circles) {
    const [a, b] = f.at([c.lat, c.lon])
    ctx.beginPath()
    ctx.arc(a, b, c.r, 0, 2 * Math.PI)
    ctx.fillStyle = c.color
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }
  ctx.restore()
  y += f.h + 12
  // swatches in a row, wrapping
  let x = PAD
  ctx.textBaseline = 'middle'
  for (const l of legend.filter((q) => q.color)) {
    ctx.font = font(14)
    const w = ctx.measureText(l.label).width + 34
    if (x + w > W - PAD) { x = PAD; y += 26 }
    ctx.fillStyle = l.color
    ctx.fillRect(x, y + 2, 14, 14)
    ctx.fillStyle = DIM
    ctx.fillText(l.label, x + 20, y + 10)
    x += w
  }
  ctx.textBaseline = 'top'
  y += 28
  for (const l of legend.filter((q) => q.note)) y = para(ctx, l.note, PAD, y, W - 2 * PAD, 14, FAINT)
  return y + 18
}

const footer = () => ({
  footer: `KBR Wrocław 2024 — przeglądarka map · wygenerowano ${new Date().toLocaleDateString('pl-PL')}`, site: SITE,
})
// the city, unless what is picked lies outside it
const fitOf = (places, picked) => places.filter((p) => p.city || picked?.has(p.key)).flatMap((p) => p.rings)

// -------------------------------------------------------------------- answers
const optText = (q, opts) => opts.map((o) => q.options[o]).join(' + ')

/** The answers view as a card. `p` is the picked place, if any. */
export function answersCard({ x, p, row, by, gname, ranked, legend }) {
  const { Z, a, q, opts, mid, span, heat, vals } = x
  const v = shareOf(row, opts, a.raw)
  const m = row && marginOf(q, row, opts, a.raw)
  const picked = new Set(a.place ? [a.place] : [])
  const places = a.level === 'd' ? Z.districts : Z.zones
  const list = optionShares(q, row, a.raw)
  const enough = a.level === 'd' ? 40 : 15
  return {
    accent: '#d6541c', kicker: 'Badanie ankietowe KBR 2024 · odpowiedzi mieszkańców', title: fullName(q),
    subtitle: q.full ? `„${q.full}”` : undefined,
    when: `${p ? p.name : 'Wrocław'} · ${gname} · ${fmt(row?.[0])} odpowiedzi`,
    blocks: [
      barsBlock({ color: '#d6541c', whole: true, rows: (q.multi ? [...list].sort((s, t) => t.share - s.share).slice(0, 12) : list)
        .map((o) => ({ label: o.label, share: o.share, on: opts.includes(o.i), note: opts.length === 1 && opts[0] === o.i ? `±${Math.round(100 * m)} p.p.` : null })) }),
      ...(opts.length > 1 ? [(ctx, y, k) => k.para(ctx, `${optText(q, opts)}: ${pctText(v)} ±${Math.round(100 * m)} p.p.`, k.PAD, y, k.W - 2 * k.PAD, 21, '#c2410c', 700) + 18] : []),
      mapBlock({
        title: `${optText(q, opts)} — ${a.level === 'h' ? 'mapa wygładzona' : a.level === 'd' ? 'według osiedli' : 'według rejonów'}`,
        fit: fitOf(places, picked), legend, heat: heat && { surface: heat, mid, span },
        areas: vals.map((t) => ({
          rings: t.p.rings, on: picked.has(t.p.key),
          color: t.v == null || t.n < enough ? null : rgb(diverging(t.v, mid, span)),
          faint: t.v != null && Math.abs(t.v - mid) < marginOf(q, t.row, opts, a.raw),
        })),
      }),
      ...(by.length > 1 ? [barsBlock({ color: '#3f8bd0', whole: true, title: `${optText(q, opts)} — kto tak odpowiada`,
        rows: by.map(({ g, r, v: s }) => ({ label: g.label, share: s, note: `±${Math.round(100 * marginOf(q, r, opts, a.raw))} · n=${fmt(r[0])}` })) })] : []),
    ],
    notes: [
      'Udziały ważone. ± to przybliżony przedział 95%, który uwzględnia, że odpowiedzi zależą od ankietera.',
      a.raw ? 'Mapa bez korekty o ankietera: odpowiedzi różnią się między ankieterami bardziej niż między osiedlami.'
        : `Wartości obszarów skorygowane o ankietera. ${a.level === 'h' ? 'Blade miejsca: mało odpowiedzi.' : 'Blade pola: różnica od średniej w granicach błędu.'}`,
      ...(a.level !== 'h' && !ranked.length ? ['Żaden obszar nie różni się od średniej bardziej, niż wynosi błąd.'] : []),
      ...(q.multi ? ['Można było wskazać kilka odpowiedzi.'] : []),
    ],
    source: `Źródło: ${KBR}, badanie ankietowe w gospodarstwach domowych (zał. do Raportu II) — bip.um.wroc.pl. Granice: KBR, OpenStreetMap.`,
    ...footer(),
  }
}

export const answersName = (x, p) => slug(`kbr2024-ankieta-${fullName(x.q)}-${p ? p.name : 'wroclaw'}-${x.group}`)

// ---------------------------------------------------------------------- trips
/** The filters in words: "środek transportu: pieszo, autobus; długość: do 1 km". */
export function filterText(S, filters) {
  const out = S.D.filter((d) => filters[d.key]?.length)
    .map((d) => `${d.label.toLowerCase()}: ${filters[d.key].map((i) => d.options[i]?.label.toLowerCase()).join(', ')}`)
  if (filters.easy?.length) out.push('z wygody, dla czasu lub kosztu, do 5 km albo do lub z centrum')
  return out.join('; ')
}

/** The trips view as a card. `paint` is what the map is painted with. */
export function tripsCard({ x, title, period, wayName, paint, legendTitle, goals }) {
  const { S, t, stats, places } = x
  const { list, value, share } = paint
  const sc = scale(breaks(value, share), false)
  const f = (v) => (share ? `${Math.round(100 * v)}%` : paint.digits ? fixed(v, paint.digits) : fmt(v))
  const picked = new Set(t.picked)
  const filters = filterText(S, t.filters)
  const own = places.length && places.every((p) => p.pop) ? places.reduce((s, p) => s + p.pop, 0) : 0
  return {
    accent: '#3f8bd0', kicker: S.freight ? 'Badanie przewozów towarów KBR 2024' : 'Badanie ankietowe KBR 2024 · podróże mieszkańców',
    title, subtitle: [places.length ? wayName : null, filters || null].filter(Boolean).join(' · ') || undefined,
    when: `${period} · ${S.freight ? `${fmt(stats.n)} przejazdów w próbie` : `${fmtEst(stats.w)} podróży na dobę (${fmt(stats.n)} w próbie)`}`
      + `${!S.freight && own >= 500 ? ` · ${fixed(stats.w / own, 2)} na mieszkańca` : ''}`,
    blocks: [
      splitBlock({
        unit: S.freight ? 'przejazdów' : 'podróży', columns: { value: S.freight ? 'PRZEJAZDY' : 'PODRÓŻE', share: '%' },
        slices: S.modes.map((m, i) => ({ key: m.key, label: m.label, color: m.color, value: stats.mode.w[i], est: !S.freight })),
      }),
      ...(goals.length > 1 ? [barsBlock({ title: 'Cel podróży', whole: true, color: '#3f8bd0', rows: goals.slice(0, 8) })] : []),
      mapBlock({
        title: legendTitle, fit: fitOf(list, picked),
        areas: list.map((p, k) => ({ rings: p.rings, on: picked.has(p.key), color: value[k] == null ? null : sc.color(value[k]) })),
        legend: [...sc.steps.map((s) => ({ color: s.color, label: s.from == null ? `poniżej ${f(s.to ?? 0)}` : s.to == null ? `${f(s.from)} i więcej` : `${f(s.from)} – ${f(s.to)}` })),
          { note: [paint.unit, 'szare: za mało podróży lub mieszkańców'].filter(Boolean).join(' · ') }],
      }),
    ],
    notes: S.freight ? ['Przejazdy w próbie, nie przeliczone na cały ruch ciężarowy.'] : [
      'Dzienniczki podróży z jednego dnia roboczego (wtorek–czwartek), przeliczone na mieszkańców Wrocławia i 9 gmin wagami KBR. Bez przyjezdnych z dalszych okolic.',
      // filtered by mode, the shares of modes are the filter's
      ...(t.filters.mode ? [] : [`${stats.main.map((m) => `${m.label} ${pctText(m.share)}${m.margin ? ` ±${Math.round(100 * m.margin)} p.p.` : ''}`).join(', ')} (95%).`]),
      ...(stats.n < 100 ? [`Tylko ${fmt(stats.n)} podróży w próbie — udziały orientacyjne.`] : []),
    ],
    source: `Źródło: ${KBR}, ${S.freight ? 'zał. 10.3' : 'badanie ankietowe w gospodarstwach domowych; mieszkańcy: zał. 3.1'} — bip.um.wroc.pl.`,
    ...footer(),
  }
}

export const tripsName = (title, period, wayKey, filters) => slug(
  `kbr2024-podroze-${title}-${period}${wayKey === 'home' ? '' : `-${wayKey}`}${Object.keys(filters).length ? '-filtr' : ''}`,
)

// ---------------------------------------------------------------- 2018 - 2024
export function changeCard({ rows, rings, legend, color, zones }) {
  const signed = (d) => { const r = Math.round(100 * d); return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}%` }
  const top = Math.max(...rows.map((r) => r.v24))
  const inCity = rows.filter((r) => r.ring !== 'KW' && r.ring !== 'AOW' && r.ring !== 'KO')
  const pts = (zones || []).filter((z) => z.city)
  return {
    accent: '#676cad', kicker: 'Pomiary ruchu drogowego KBR', title: 'Ruch w 2024 wobec 2018',
    when: `${rows.length} miejsc policzonych w obu badaniach`,
    blocks: [
      (ctx, y0, { W, PAD, INK, DIM, FAINT, font }) => {
        let y = y0
        const col = [PAD, W - PAD - 360, W - PAD - 240, W - PAD - 110, W - PAD]
        ctx.textBaseline = 'top'
        const line = (cells, size, weight, ink) => {
          ctx.font = font(size, weight)
          ctx.fillStyle = ink
          cells.forEach((c, i) => { ctx.textAlign = i ? 'right' : 'left'; ctx.fillText(c, col[i], y) })
          ctx.textAlign = 'left'
          y += size + 13
        }
        line(['OBSZAR', 'MIEJSC', '2018', '2024', 'ZMIANA'], 13, 600, FAINT)
        for (const r of rings) line([r.label, `${r.n}`, fmt(r.v18), fmt(r.v24), signed(r.d)], 17, 600, r.n ? INK : DIM)
        return y + 16
      },
      mapBlock({
        title: 'Miejsca pomiaru we Wrocławiu', legend: legend.filter((l) => !l.title),
        fit: pts.length ? pts.flatMap((z) => z.rings) : [inCity.map((r) => [r.lat, r.lon])],
        areas: pts.map((z) => ({ rings: z.rings, color: null })),
        circles: [...rows].sort((s, t) => t.v24 - s.v24).map((r) => ({ lat: r.lat, lon: r.lon, r: 4 + 14 * Math.sqrt(r.v24 / top), color: color(r.d) })),
      }),
    ],
    notes: ['Suma pojazdów w miejscach wspólnych, w tych samych godzinach. Pojedyncze dni pomiaru; między rundami otwarto m.in. aleję Wielkiej Wyspy.'],
    source: `Źródło: ${KBR}, zał. 3.3, „Porównanie KBR” — bip.um.wroc.pl.`,
    ...footer(),
  }
}

export const draw = (spec) => renderCard(spec)

// ----------------------------------------------------------------- the tables
const pp = (v) => (v == null ? '' : `${Math.round(1000 * v) / 10}`.replace('.', ','))

/** The open question as a table: an answer a row, who answered across. */
export function viewTable(q, groups, level, key, raw) {
  const cols = groups.map((g) => ({ g, row: q.tab[g.key]?.[level]?.[key] })).filter((c) => c.row)
  return [
    ['odpowiedź', ...cols.flatMap(({ g }) => [`${g.label} — %`, `${g.label} — ± p.p.`])],
    ...q.options.map((o, i) => [o, ...cols.flatMap(({ row }) => [pp(shareOf(row, [i], raw)), pp(marginOf(q, row, [i], raw))])]),
    ['odpowiedzi w próbie', ...cols.flatMap(({ row }) => [row[0], ''])],
  ]
}

/** Every question, for a group: the whole city and around it, then districts. */
export function everythingTable(A, Z, group, raw) {
  const where = [['a', 'wro', 'Wrocław'], ['a', 'out', 'gminy wokół'], ...Z.districts.map((d) => ['d', d.i, d.name])]
  return [
    ['temat', 'pytanie', 'odpowiedź', 'obszar', 'kto', '%', '± p.p.', 'odpowiedzi w próbie'],
    ...A.questions.flatMap((q) => {
      const g = q.tab[group] ? group : null
      if (!g) return []
      const label = A.groups.find((y) => y.key === g).label
      return where.flatMap(([lv, key, name]) => {
        const row = q.tab[g][lv]?.[key]
        return !row ? [] : q.options.map((o, i) => [q.group, q.label, o, name, label, pp(shareOf(row, [i], raw)), pp(marginOf(q, row, [i], raw)), row[0]])
      })
    }),
  ]
}
