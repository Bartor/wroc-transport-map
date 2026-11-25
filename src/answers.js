// Answers to the survey's questions, by where the people who gave them live.
// answers.json holds, per question and group of people, rows for zones,
// districts and wholes: [people, their weight, how bunched they are by
// interviewer, and by round, thousandths on each option, the same corrected].
//
// Who asked matters more than where: between interviewers the answers differ
// several times as much as between districts. The corrected weights have the
// interviewer's part taken off (etl/trips.py), and margins allow for it.

// What the answers view starts with.
export const ASK0 = { q: 'tram', opts: null, group: 'all', level: 'd', km: 1, place: null, raw: false }

/** A row for a place, or null where too few were asked. */
export const rowAt = (q, group, level, key) => q.tab[group]?.[level]?.[key] || null

/** Share of those asked who chose any of the options. For questions with one
 *  answer that is a plain sum; with several it can pass 100%, so it is shown
 *  for one option at a time (see clampOpts). */
export function shareOf(row, opts, raw = false) {
  if (!row || !row[1]) return null
  const w = (!raw && row[5]) || row[4]
  return Math.max(0, Math.min(1, opts.reduce((a, o) => a + (w[o] || 0), 0) / 1000))
}

/** How alike answers are between interviewers, and between rounds. */
function rhoOf(q, opts) {
  if (q.rhoGood && opts.length === q.good.length && opts.every((o) => q.good.includes(o))) return q.rhoGood
  return [0, 1].map((k) => Math.max(...opts.map((o) => q.rho[o][k])))
}

/**
 * 95% margin of a share: people asked by one interviewer, or on one round,
 * count for less than as many picked apart. Corrected shares have the
 * interviewer taken off, all but what he shares with the place.
 */
export function marginOf(q, row, opts, raw = false) {
  if (!row || row[0] < 2) return null
  // the city's share: a place's own is extreme by chance as often as not
  const s = Math.min(0.95, Math.max(0.05, shareOf(rowAt(q, 'all', 'a', 'wro') || row, opts, true)))
  const [byAsker, byRound] = rhoOf(q, opts)
  const corrected = !raw && row[5]
  const deff = 1 + byRound * (row[3] - 1) + (corrected ? 0.25 : 1) * byAsker * (row[2] - 1)
  return Math.min(1, 1.96 * Math.sqrt((s * (1 - s) * deff) / row[0]))
}

/** The options a map of this question starts with. */
export const startOpts = (q) => (q.multi || !q.good.length ? [biggest(q)] : q.good)
function biggest(q) {
  const row = rowAt(q, 'all', 'a', 'wro')
  if (!row) return 0
  let best = 0
  // "nothing bothers me" and "other" say least about a place
  q.options.forEach((o, i) => {
    if (/^(nie odczuwam|inne)/.test(o)) return
    if (row[4][i] > row[4][best]) best = i
  })
  return best
}
/** Options can be added up where a person has one answer. */
export const clampOpts = (q, opts) => {
  const ok = opts.filter((o) => o < q.options.length)
  return q.multi ? ok.slice(0, 1) : ok
}

/** A question's name where its group is not beside it. */
export const fullName = (q) => (/^Co utrudnia/.test(q.group) ? `${q.group}: ${q.label.toLowerCase()}`
  : /^Oceny/.test(q.group) ? `Ocena komunikacji zbiorowej: ${q.label.toLowerCase()}` : q.label)

/** Every option's share in one place, for bars. */
export const optionShares = (q, row, raw) => q.options.map((label, i) => ({
  i, label, share: shareOf(row, [i], raw) ?? 0,
}))

/** Value per drawn place. */
export function valuesOf(q, group, opts, level, places, raw) {
  return places.map((p) => {
    const row = rowAt(q, group, level, p.i)
    return { p, row, n: row ? row[0] : 0, v: shareOf(row, opts, raw) }
  })
}

const KY = 111.32
const KX = KY * Math.cos((51.11 * Math.PI) / 180)

/**
 * The share as a surface: at every cell of a grid, the answers of the people
 * around it, nearer ones counting more (a normal curve of `km`). People are
 * placed at the middle of their zone. `n` is how many effectively speak there.
 */
export function surface(q, group, opts, zones, { km = 1, cols = 130, box, raw } = {}) {
  const pts = []
  for (const z of zones) {
    const row = rowAt(q, group, 'z', z.i)
    if (!row) continue
    pts.push({ x: z.c[1] * KX, y: z.c[0] * KY, n: row[0], w: row[1],
      k: shareOf(row, opts, raw) * row[1] })
  }
  const [s, west, n, east] = box
  const rows = Math.round((cols * (n - s) * KY) / ((east - west) * KX))
  const v = new Float32Array(cols * rows).fill(NaN)
  const m = new Float32Array(cols * rows)
  const cut = (3 * km) ** 2
  const h = 2 * km * km
  for (let r = 0; r < rows; r++) {
    const y = (n - ((r + 0.5) / rows) * (n - s)) * KY
    for (let c = 0; c < cols; c++) {
      const x = (west + ((c + 0.5) / cols) * (east - west)) * KX
      let a = 0
      let b = 0
      let ne = 0
      for (const p of pts) {
        const d = (p.x - x) ** 2 + (p.y - y) ** 2
        if (d > cut) continue
        const g = Math.exp(-d / h)
        a += g * p.k
        b += g * p.w
        ne += g * p.n
      }
      if (b > 0) { v[r * cols + c] = a / b; m[r * cols + c] = ne }
    }
  }
  return { v, n: m, cols, rows, box }
}

// Below and above what the whole city says: blue to orange through grey.
const DIV = [[33, 102, 172], [103, 169, 207], [120, 126, 138], [239, 163, 100], [214, 84, 28]]
const mix = (a, b, t) => a.map((x, i) => Math.round(x + (b[i] - x) * t))

/** Colour of a share against the city's own; `span` is a whole half of it. */
export function diverging(v, mid, span) {
  const t = Math.max(0, Math.min(1, (v - mid) / span / 2 + 0.5)) * (DIV.length - 1)
  const i = Math.min(DIV.length - 2, Math.floor(t))
  return mix(DIV[i], DIV[i + 1], t - i)
}
export const rgb = (c) => `rgb(${c.join(',')})`

/** How far places differ: the span that keeps the odd one from washing out
 *  the rest, weighted by how many answered. */
export function spanOf(vals, mid) {
  const d = vals.filter((x) => x.v != null && x.n >= 15).map((x) => Math.abs(x.v - mid)).sort((a, b) => a - b)
  if (!d.length) return 0.2
  return Math.max(0.05, d[Math.floor(0.9 * (d.length - 1))])
}

/** One row per place and option. */
export function answersTable(q, groups, group, places, level, raw) {
  const g = groups.find((x) => x.key === group)?.label
  return [
    ['obszar', 'grupa', 'odpowiedzi w próbie', ...q.options.map((o) => `% ${o}`)],
    ...places.map((p) => [p, rowAt(q, group, level, p.i)]).filter(([, r]) => r)
      .map(([p, r]) => [p.name, g, r[0], ...optionShares(q, r, raw).map((o) => Math.round(1000 * o.share) / 10)]),
  ]
}
