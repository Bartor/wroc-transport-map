// Pictures of the survey views: what is asked or filtered, the map, the bars,
// and the notes that have to travel with them.
import { fixed, fmt, fmtEst, renderCard, slug, splitBlock } from '@bartor-net/ui-kit'
import { SENT_COLOR, diverging, fullName, marginOf, meanDigits, meanLabel, meanOf, optionShares, perPeopleOf, pickWarning, rgb, sentimentNote, shareOf, valueOf } from './answers'
import { ORDERED } from './Stack'
import { diffColor } from './closureColors'
import { arc } from './arcs'
import { FEW_ANSWERS, smallText } from './Small'
import { placeName } from './trips'

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

/** An order runs dark to light on the dark page, and the other way on paper. */
const paper = (color) => {
  const i = ORDERED.indexOf(color)
  return i < 0 ? color : ORDERED[ORDERED.length - 1 - i]
}

/** Parts of a whole as one bar with a legend; several rows share the legend. */
export const stackBlock = ({ title, parts, rows }) => (ctx, y0, { W, PAD, INK, DIM, FAINT, font, para }) => {
  let y = title ? para(ctx, title.toUpperCase(), PAD, y0, W - 2 * PAD, 14, FAINT, 600) + 8 : y0
  const bar = (list, h) => {
    const some = list.filter((p) => p.share > 0)
    let x = PAD
    const room = W - 2 * PAD - 2 * (some.length - 1)
    const sum = some.reduce((a, p) => a + p.share, 0) || 1
    for (const p of some) {
      const w = (room * p.share) / sum
      ctx.globalAlpha = p.on === false ? 0.45 : 1
      ctx.fillStyle = paper(p.color)
      ctx.fillRect(x, y, w, h)
      const text = pctText(p.share)
      ctx.font = font(14, 700)
      if (w > ctx.measureText(text).width + 8) {
        ctx.fillStyle = dark(paper(p.color)) ? '#ffffff' : INK
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(text, x + w / 2, y + h / 2 + 1)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
      }
      ctx.globalAlpha = 1
      x += w + 2
    }
    y += h
  }
  const key = (list) => {
    let x = PAD
    ctx.textBaseline = 'middle'
    for (const p of list.filter((q) => q.share > 0)) {
      const text = `${p.label}${rows ? '' : ` ${pctText(p.share)}`}`
      ctx.font = font(14, p.on ? 700 : 400)
      const w = ctx.measureText(text).width + 34
      if (x + w > W - PAD + 14) { x = PAD; y += 24 }
      ctx.fillStyle = paper(p.color)
      ctx.fillRect(x, y + 3, 13, 13)
      ctx.fillStyle = DIM
      ctx.fillText(text, x + 19, y + 10)
      x += w
    }
    ctx.textBaseline = 'top'
    y += 28
  }
  if (!rows) {
    bar(parts, 30)
    y += 8
    key(parts)
    return y + 12
  }
  key(rows[0].parts.map((p) => ({ ...p, share: 1 })))
  for (const r of rows) {
    ctx.font = font(15)
    ctx.fillStyle = INK
    ctx.textBaseline = 'top'
    ctx.fillText(r.label, PAD, y)
    if (r.note) {
      ctx.textAlign = 'right'
      ctx.font = font(14)
      ctx.fillStyle = FAINT
      ctx.fillText(r.note, W - PAD, y)
      ctx.textAlign = 'left'
    }
    y += 22
    bar(r.parts, 22)
    y += 10
  }
  return y + 14
}
const dark = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b < 150
}

/** A ranking in two columns: what, how much, and what it rests on. */
export const listBlock = ({ title, rows }) => (ctx, y0, { W, PAD, INK, DIM, FAINT, font, para, wrap }) => {
  const top = para(ctx, title.toUpperCase(), PAD, y0, W - 2 * PAD, 14, FAINT, 600) + 8
  const half = Math.ceil(rows.length / 2)
  const cw = (W - 2 * PAD - 40) / 2
  const valueW = (text) => { ctx.font = font(16, 600); return ctx.measureText(text).width + 20 }
  rows.forEach((r, i) => {
    const x = PAD + (i < half ? 0 : cw + 40)
    const y = top + (i % half) * 44
    ctx.textBaseline = 'top'
    ctx.font = font(16, 600)
    ctx.fillStyle = INK
    ctx.fillText(`${i + 1}. ${wrap(ctx, r.label, cw - 20 - valueW(r.value))[0]}`, x, y)
    ctx.textAlign = 'right'
    ctx.fillText(r.value, x + cw, y)
    ctx.textAlign = 'left'
    ctx.font = font(13)
    ctx.fillStyle = DIM
    ctx.fillText(r.sub, x + 22, y + 20)
  })
  return top + half * 44 + 12
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
export const mapBlock = ({ areas, fit, circles = [], arcs = [], rings = [], heat, legend, title, border }) => (ctx, y0, { W, PAD, INK, DIM, FAINT, font, para }) => {
  let y = title ? para(ctx, title, PAD, y0, W - 2 * PAD, 16, INK, 600) + 10 : y0
  const f = frame(fit, PAD, y, W - 2 * PAD, 780)
  ctx.save()
  ctx.beginPath()
  ctx.rect(PAD, y, W - 2 * PAD, f.h)
  ctx.clip()
  const trace = (list) => {
    ctx.beginPath()
    for (const r of list) {
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
      img.data.set([...diverging(v[i], heat.mid, heat.span, heat.sent, false), Math.round(255 * Math.min(1, n[i] / 60) ** 0.8)], i * 4)
    }
    g.putImageData(img, 0, 0)
    const [a, b] = f.at([box[2], box[1]])
    const [c, d] = f.at([box[0], box[3]])
    ctx.drawImage(cv, a, b, c - a, d - b)
  }
  for (const s of areas) {
    trace(s.rings)
    if (!heat) {
      ctx.fillStyle = '#f5f6f8'
      ctx.fill('evenodd')
      if (s.color) {
        ctx.globalAlpha = s.alpha ?? (s.faint ? 0.35 : 1)
        ctx.fillStyle = s.color
        ctx.fill('evenodd')
        ctx.globalAlpha = 1
      }
    }
    ctx.strokeStyle = heat ? 'rgba(60,68,82,.35)' : 'rgba(60,68,82,.4)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }
  // the city itself, heavier
  if (border) {
    ctx.strokeStyle = 'rgba(30,36,46,.75)'
    ctx.lineWidth = 2
    for (const seg of border) {
      ctx.beginPath()
      seg.forEach((p, i) => { const [a, b] = f.at(p); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b) })
      ctx.stroke()
    }
  }
  for (const s of areas.filter((q) => q.on)) {
    trace(s.rings)
    ctx.strokeStyle = INK
    ctx.lineWidth = 3
    ctx.stroke()
  }
  ctx.lineCap = 'round'
  const topW = Math.max(1, ...arcs.map((a) => a.w))
  for (const c of arcs) {
    ctx.beginPath()
    c.path.forEach((p, i) => { const [a, b] = f.at(p); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b) })
    ctx.strokeStyle = c.color
    ctx.globalAlpha = c.fixed ? 1 : c.faint ? 0.35 : 0.7
    ctx.lineWidth = c.fixed ?? Math.max(1, (c.width || 8) * Math.sqrt(c.w / topW))
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  for (const r of rings) {
    const [a, b] = f.at(r.at)
    ctx.beginPath()
    ctx.arc(a, b, 6 + 22 * Math.sqrt(r.w / (r.top || r.w)), 0, 2 * Math.PI)
    ctx.strokeStyle = r.color
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
  // names and numbers, where they fit: the picked one first, then the biggest
  const taken = []
  const halo = (text, x, yy) => { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, yy); ctx.fillText(text, x, yy) }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const s of [...areas].filter((q) => q.name).sort((p, q) => (q.on || 0) - (p.on || 0) || (q.weight || 0) - (p.weight || 0))) {
    const [a, b] = f.at(s.c)
    if (a < PAD + 20 || a > W - PAD - 20 || b < y + 10 || b > y + f.h - 14) continue
    const lines = [...split2(s.name).map((t) => [t, font(12, 600), INK]), ...(s.text ? [[s.text, font(13, 700), '#0b3a66']] : []), ...(s.sub ? [[s.sub, font(11, 600), '#3a4250']] : [])]
    const w = Math.max(...lines.map(([t, ft]) => { ctx.font = ft; return ctx.measureText(t).width }))
    const h = lines.length * 15
    const box = [a - w / 2 - 2, b - h / 2, a + w / 2 + 2, b + h / 2]
    if (taken.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue
    taken.push(box)
    lines.forEach(([t, ft, ink], i) => { ctx.font = ft; ctx.fillStyle = ink; halo(t, a, b - h / 2 + 8 + i * 15) })
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
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

/** A long name on two lines. */
function split2(name) {
  if (name.length < 15) return [name]
  const parts = name.split(/(?<=[-\s])/)
  if (parts.length < 2) return [name]
  let best = 1
  for (let i = 1; i < parts.length; i++) {
    const d = (k) => Math.abs(parts.slice(0, k).join('').length - name.length / 2)
    if (d(i) < d(best)) best = i
  }
  return [parts.slice(0, best).join('').trim(), parts.slice(best).join('').trim()]
}

/** The edge of the city: borders of its areas that no other of them shares. */
function cityBorder(places) {
  const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`
  const seen = new Map()
  for (const p of places.filter((q) => q.city)) {
    for (const r of p.rings) {
      r.forEach((a, i) => {
        const b = r[(i + 1) % r.length]
        const k = [key(a), key(b)].sort().join('|')
        seen.set(k, seen.has(k) ? null : [a, b])
      })
    }
  }
  return [...seen.values()].filter(Boolean)
}

const footer = () => ({
  footer: `KBR Wrocław 2024 — przeglądarka map · wygenerowano ${new Date().toLocaleDateString('pl-PL')}`, site: SITE,
})
// the city, unless what is picked lies outside it
const fitOf = (places, picked) => places.filter((p) => p.city || picked?.has(p.key)).flatMap((p) => p.rings)

// -------------------------------------------------------------------- answers
const optText = (q, opts) => opts.map((o) => q.options[o]).join(' + ')

/** The answers view as a card. `p` is the picked place, if any. */
export function answersCard({ x, p, row, by, gname, ranked, colors, legend, optLabel, text, mtext }) {
  const { Z, a, q, opts, mid, span, heat, vals, sent } = x
  const v = valueOf(q, row, opts, a.raw)
  const m = row && marginOf(q, row, opts, a.raw)
  const picked = new Set(a.place ? [a.place] : [])
  const places = a.level === 'd' ? Z.districts : Z.zones
  const list = optionShares(q, row, a.raw)
  const enough = a.level === 'd' ? 40 : 15
  return {
    accent: '#d6541c', kicker: `Badanie ankietowe KBR 2024 · ${q.home ? 'gospodarstwa domowe' : 'odpowiedzi mieszkańców'}`, title: fullName(q),
    subtitle: q.full ? `„${q.full}”` : undefined,
    when: `${p ? p.name : 'Wrocław'} · ${gname} · ${fmt(row?.[0])} odpowiedzi`,
    blocks: [
      q.multi ? barsBlock({ color: '#d6541c', whole: true, rows: [...list].sort((s, t) => t.share - s.share).slice(0, 12)
        .map((o) => ({ label: o.label, share: o.share, color: colors[o.i], on: opts.includes(o.i), note: opts[0] === o.i ? `±${Math.round(100 * m)} p.p.` : null })) })
        : stackBlock({ parts: list.map((o) => ({ label: o.label, share: o.share, color: colors[o.i], on: opts.length ? opts.includes(o.i) : undefined })) }),
      ...(!q.multi ? [(ctx, y, k) => k.para(ctx, `${optLabel}: ${text(v)} ${mtext(row)}${perPeopleOf(row) != null ? ` · ${fmt(perPeopleOf(row))} ${q.per}` : ''}`, k.PAD, y, k.W - 2 * k.PAD, 21, '#c2410c', 700) + 18] : []),
      mapBlock({
        title: `${optLabel} — ${a.level === 'h' ? 'mapa wygładzona' : a.level === 'd' ? 'według osiedli' : 'według rejonów'}`,
        fit: fitOf(places, picked), legend: pickWarning(q, opts) ? [{ note: pickWarning(q, opts) }] : [...legend, { note: sentimentNote(q, opts, false) }], heat: heat && { surface: heat, mid, span, sent }, border: cityBorder(places),
        areas: vals.map((t) => ({
          rings: t.p.rings, on: picked.has(t.p.key), c: t.p.c,
          color: t.v == null ? null : rgb(diverging(t.v, mid, span, sent, false)),
          alpha: t.v == null ? null : (0.25 + 0.75 * Math.min(1, t.n / enough)) * (Math.abs(t.v - mid) < marginOf(q, t.row, opts, a.raw) ? 0.5 : 1),
          faint: t.v != null && Math.abs(t.v - mid) < marginOf(q, t.row, opts, a.raw),
          name: a.level === 'h' ? null : t.p.name, text: t.v == null ? null : text(t.v) + smallText(t.n, FEW_ANSWERS),
          sub: t.v == null ? null : `${mtext(t.row)} · n=${t.n}`, weight: t.n,
        })),
      }),
      ...(by.length > 1 && !(q.multi && !opts.length) ? [q.multi ? barsBlock({ color: SENT_COLOR[sent], whole: true, title: `${optText(q, opts)} — kto tak odpowiada`,
        rows: by.map(({ g, r, v: s }) => ({ label: g.label, share: s, note: `±${Math.round(100 * marginOf(q, r, opts, a.raw))} · n=${fmt(r[0])}` })) })
        : stackBlock({ title: q.opinion ? 'Kto jak odpowiada' : 'Według grup', rows: by.map(({ g, r, v: s }) => ({ label: g.label,
          note: `${optLabel} ${text(s)} ${mtext(r)} · n=${fmt(r[0])}`,
          parts: optionShares(q, r, a.raw).map((o) => ({ label: o.label, share: o.share, color: colors[o.i], on: opts.length ? opts.includes(o.i) : undefined })) })) })] : []),
    ],
    notes: [
      ...(q.note ? [q.note] : []),
      `(!) — mniej niż ${FEW_ANSWERS} odpowiedzi.`,
      'Udziały ważone. ± to przybliżony przedział 95%, który uwzględnia, że odpowiedzi zależą od ankietera.',
      !q.opinion ? 'Blade pola: różnica od średniej w granicach błędu.' : a.raw ? 'Mapa bez korekty o ankietera: odpowiedzi różnią się między ankieterami bardziej niż między osiedlami.'
        : `Wartości obszarów skorygowane o ankietera. ${a.level === 'h' ? 'Blade miejsca: mało odpowiedzi.' : 'Blade pola: różnica od średniej w granicach błędu.'}`,
      ...(a.level !== 'h' && !ranked.length && !pickWarning(q, opts) ? ['Żaden obszar nie różni się od średniej bardziej, niż wynosi błąd.'] : []),
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
export function tripsCard({ x, title, period, wayName, paint, legendTitle, stacks, lines, top, small, perHead, ranked, note }) {
  const { S, t, stats, places, partner, show, sums } = x
  const { list, value, n } = paint
  const colorAt = paint.colorOf(false)
  const picked = new Set(t.picked)
  const filters = filterText(S, t.filters)
  const own = places.length && places.every((p) => p.w) ? places.reduce((s, p) => s + p.w, 0) : 0
  const painting = show === 'areas'
  const num = (w) => (S.freight ? fmt(w) : fmtEst(w))
  const label = (p, k) => {
    if (paint.stat && painting) {
      return value[k] == null ? {} : { name: placeName(p), text: paint.textOf(k) + smallText(n[k]), sub: `n=${n[k]}`, weight: n[k] }
    }
    if (partner) {
      const w = partner.w[k]
      return !w ? {} : { name: placeName(p), text: `${pctText(w / stats.w)} · ${num(w)}${smallText(partner.n[k])}`, sub: `${painting && value[k] != null ? `${paint.textOf(k)} · ` : ''}n=${partner.n[k]}`, weight: w }
    }
    const s = sums[k]
    return { name: placeName(p), text: painting && value[k] != null ? paint.textOf(k) + smallText(s.n) : null, sub: s.any ? `${num(s.any)} · n=${s.n}` : null, weight: s.any }
  }
  return {
    accent: '#3f8bd0', kicker: S.freight ? 'Badanie przewozów towarów KBR 2024' : 'Badanie ankietowe KBR 2024 · podróże mieszkańców',
    title, subtitle: [places.length ? wayName : null, filters || null].filter(Boolean).join(' · ') || undefined,
    when: `${period} · ${S.freight ? `${fmt(stats.n)} przejazdów w próbie` : `${fmtEst(stats.w)} podróży na dobę (${fmt(stats.n)} w próbie)`}`
      + `${!S.freight && own >= 300 ? ` · ${fixed(stats.w / own, 2)} na mieszkańca` : ''}`,
    blocks: [
      splitBlock({
        unit: S.freight ? 'przejazdów' : 'podróży', columns: { value: S.freight ? 'PRZEJAZDY' : 'PODRÓŻE', share: '%' },
        slices: S.modes.map((m, i) => ({ key: m.key, label: m.label, color: m.color, value: stats.mode.w[i], est: !S.freight })),
      }),
      ...stacks.map((s) => stackBlock({ title: s.label, parts: s.parts })),
      mapBlock({
        title: legendTitle, fit: fitOf(list, picked), border: cityBorder(list),
        areas: list.map((p, k) => ({ rings: p.rings, on: picked.has(p.key), c: p.c, color: !painting || value[k] == null ? null : colorAt(k),
          alpha: (0.3 + 0.7 * Math.min(1, n[k] / 20)) * paint.lead(k), ...label(p, k) })),
        arcs: lines.arcs.map((a) => ({ ...a, path: arc(a.from, a.to), width: show === 'trips' ? 1.4 : 8 })), rings: lines.rings,
        legend: painting ? [...paint.legend(false),
          ...(note ? [{ note }] : []), { note: [paint.unit, 'bladsze i (!): mniej niż 20 podróży w próbie'].filter(Boolean).join(' · ') }]
          : S.modes.map((m) => ({ color: m.color, label: m.label })),
      }),
      ...(ranked ? [listBlock({ title: ranked.title, rows: ranked.rows.slice(0, 12).map((r) => ({ label: r.name, value: r.text + smallText(r.n), sub: `n=${fmt(r.n)}` })) })]
        : top.length > 1 ? [listBlock({ title: `${partner ? 'Druga strona podróży' : 'Najwięcej podróży'}${perHead ? ` na ${small > 1 ? '1000 mieszkańców' : 'mieszkańca'}` : ''}`,
        rows: top.map((r) => ({ label: r.name, value: (S.freight ? fmt(r.w) : perHead ? fixed(small * r.rate, small > 1 ? 1 : 2) : fmtEst(r.w)) + smallText(r.n),
          sub: `${partner ? `${pctText(r.w / stats.w)} · ` : ''}${num(r.w)}${S.freight ? '' : ' na dobę'} · n=${fmt(r.n)}` })) })] : []),
    ],
    notes: S.freight ? ['Przejazdy w próbie, nie przeliczone na cały ruch ciężarowy.'] : [
      'Dzienniczki podróży z jednego dnia roboczego (wtorek–czwartek), przeliczone na mieszkańców Wrocławia i 9 gmin wagami KBR. Bez przyjezdnych z dalszych okolic.',
      // filtered by mode, the shares of modes are the filter's
      ...(t.filters.mode ? [] : [`${stats.main.map((m) => `${m.label} ${pctText(m.share)}${m.margin ? ` ±${Math.round(100 * m.margin)} p.p.` : ''}`).join(', ')} (95%).`]),
      ...(stats.n < 100 ? [`Tylko ${fmt(stats.n)} podróży w próbie — udziały orientacyjne.`] : []),
    ],
    source: `Źródło: ${KBR}, ${S.freight ? 'zał. 10.3' : 'badanie ankietowe w gospodarstwach domowych; na mieszkańca: od 6 lat, z wag badania'} — bip.um.wroc.pl.`,
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

// -------------------------------------------------------------------- closure
/** A closure: the streets around it, coloured by how their traffic changes. */
export function closureCard({ x, title, up, down }) {
  const shut = new Set(x.result.of.closed)
  const thin = new Set(x.result.of.narrow)
  const both = (f, k) => f[2 * k] + f[2 * k + 1]
  const d = (s) => both(x.result.after, s.id) - both(x.result.before, s.id)
  const moved = x.segments.filter((s) => Math.abs(d(s)) >= 300 || shut.has(s.id))
  // what is near: far off, one of two like routes can flip for the other
  const own = x.segments.filter((y) => shut.has(y.id) || thin.has(y.id)).map((y) => y.path[0])
  const mid = [0, 1].map((i) => own.reduce((a, p) => a + p[i], 0) / own.length)
  const close = (y) => Math.hypot(y.path[0][0] - mid[0], (y.path[0][1] - mid[1]) * 0.63) < 0.036
  const box = moved.filter(close).filter((s) => Math.abs(d(s)) >= 800 || shut.has(s.id) || thin.has(s.id)).map((s) => s.path)
  const fit = box.length ? box : moved.map((s) => s.path)
  const [s0, n0, w0, e0] = fit.flat().reduce(([s, n, w, e], [la, lo]) => [Math.min(s, la), Math.max(n, la), Math.min(w, lo), Math.max(e, lo)], [90, -90, 180, -180])
  const pad = 0.004
  const frame4 = [[s0 - pad, w0 - pad], [n0 + pad, w0 - pad], [n0 + pad, e0 + pad], [s0 - pad, e0 + pad]]
  const near = x.segments.filter((s) => s.path.some(([la, lo]) => la > s0 - pad && la < n0 + pad && lo > w0 - pad && lo < e0 + pad))
  const line = (s) => {
    if (shut.has(s.id)) return { path: s.path, w: 1, fixed: 6, color: '#ff3b5c', rank: 3 }
    const v = d(s)
    if (Math.abs(v) >= 300) return { path: s.path, w: 1, fixed: Math.min(13, 2 + Math.sqrt(Math.abs(v)) / 9), color: diffColor(v), rank: 1 + Math.abs(v) / 1e6 }
    return { path: s.path, w: 1, fixed: ['motorway', 'trunk', 'primary', 'secondary'].includes(s.cls) ? 2 : 1, color: thin.has(s.id) ? '#c98500' : '#d5dae2', rank: 0 }
  }
  const s = x.result.summary
  const sgn = (v) => `${v > 0 ? '+' : '−'}${fmt(Math.round(Math.abs(v) / 100) * 100)}`
  const list = (rows) => rows.slice(0, 10).map((r) => ({ label: r.name, value: sgn(r.d), sub: `${fmtEst(r.a)} → ${fmtEst(r.b)} pojazdów` }))
  const km = 100 * (s.after.vehKm / s.before.vehKm - 1)
  return {
    accent: '#ff3b5c', kicker: 'Model zamknięcia ulicy · KBR Wrocław 2024', title,
    when: `Przez ${thin.size ? 'zmienione' : 'zamknięte'} odcinki jeździ ${fmtEst(s.affected)} przejazdów w 8 godzinach (6–10 i 15–19)${s.gone > 0 ? `; założenie: znika ${Math.round(100 * x.result.of.reduce)}% z nich` : ''}`,
    blocks: [
      mapBlock({
        fit: [frame4], areas: [], arcs: near.map(line).sort((a, b) => a.rank - b.rank),
        legend: [{ label: 'zamknięte', color: '#ff3b5c' }, { label: 'więcej ruchu', color: diffColor(2000) }, { label: 'dużo więcej', color: diffColor(6000) },
          { label: 'mniej ruchu', color: diffColor(-2000) }, { note: 'grubość = zmiana; poniżej 300 pojazdów nie pokazujemy' }],
      }),
      ...(up.length ? [listBlock({ title: 'Przybywa', rows: list(up) })] : []),
      ...(down.length ? [listBlock({ title: 'Ubywa', rows: list(down).slice(0, 6) })] : []),
    ],
    notes: [
      `Przejechane kilometry w całej sieci: ${km >= 0 ? '+' : '−'}${Math.abs(km).toFixed(2).replace('.', ',')}%.`,
      'Model, nie pomiar: mediana błędu dla przekrojów, których nie widział, 17%, co dziesiąty myli się o ponad 52%.',
      x.result.of.reduce > 0 ? 'Ile przejazdów znika, to założenie; mediana 63 przypadków z przeglądu Cairnsa i in. (2002) to 11%.' : 'Założenie: nikt nie rezygnuje z jazdy; w 63 przypadkach z przeglądu Cairnsa i in. (2002) mediana spadku to 11%.',
      'Nie zna zakazów skrętu, sygnalizacji ani wyznaczonych objazdów; liczy stan po przyzwyczajeniu się kierowców.',
    ],
    source: `Źródło: ${KBR} (zał. 3.3, badanie ankietowe, zał. 12.3), OpenStreetMap; model własny.`,
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
    ...(q.number ? [[meanLabel(q), ...cols.flatMap(({ row }) => [String(Math.round(10 ** meanDigits(q) * meanOf(row)) / 10 ** meanDigits(q)).replace('.', ','), ''])]] : []),
    ...(q.per ? [[q.per, ...cols.flatMap(({ row }) => [perPeopleOf(row), ''])]] : []),
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
