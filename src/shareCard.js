// A self-contained picture of one point, for pasting into documents and posts.
//
// Drawn straight onto a canvas rather than screenshotting the panel: no extra
// dependency, crisp at 2x, and no map tiles - tiles from another origin would
// taint the canvas and make the copy fail. Light background, because the
// picture ends up in documents and slides, not in this dark interface.
import { fmt, fmtEst, splitTotal, HOUR_LABEL } from './data'

const W = 1000
const PAD = 56
const SCALE = 2
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
const INK = '#14161a'
const DIM = '#5b6270'
const FAINT = '#8a919e'

const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`

function wrap(ctx, text, maxW) {
  const lines = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line)
        line = word
      } else {
        line = test
      }
    }
    lines.push(line)
  }
  return lines
}

/** Draws wrapped text and returns the y below it. */
function para(ctx, text, x, y, maxW, size, color, weight = 400, lh = 1.4) {
  ctx.font = font(size, weight)
  ctx.fillStyle = color
  ctx.textBaseline = 'top'
  for (const line of wrap(ctx, text, maxW)) {
    ctx.fillText(line, x, y)
    y += size * lh
  }
  return y
}

export function hoursText(hrs) {
  if (!hrs?.length) return 'brak godzin wspólnych'
  const runs = []
  for (const h of [...hrs].sort((a, b) => a - b)) {
    const last = runs.at(-1)
    if (last && last[1] === h - 1) last[1] = h
    else runs.push([h, h])
  }
  return runs.map(([a, b]) => `${HOUR_LABEL(a)}–${HOUR_LABEL((b + 1) % 24)}`).join(', ')
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The method notes that must travel with a split, wherever it is pasted. */
export function splitNotes(spec) {
  const { split, pair, occupancy, occ, repeats } = spec
  const n = []
  if (split.basis === 'measured') {
    n.push(`Autobusy i tramwaje: pojazdy policzone na przekrojach drogowych × napełnienie `
      + `zmierzone w punkcie KZ ${pair.title} (${pair.dist} m): autobus `
      + `${split.load.bus.toFixed(1)}, tramwaj ${split.load.tram.toFixed(1)} os./poj.`)
  } else if (split.basis === 'estimate') {
    n.push(`Autobusy i tramwaje: pojazdy × średnie napełnienie z pomiarów KBR `
      + `(autobus ${occ.bus.toFixed(1)}, tramwaj ${occ.tram.toFixed(1)} os./poj.) — szacunek.`)
  } else {
    n.push('Tylko pasażerowie autobusów i tramwajów — w pobliżu brak przekroju drogowego.')
  }
  if (split.basis !== 'transit') {
    n.push(`Samochody osobowe × ${occupancy.toFixed(2)} os./poj. — założenie. Dostawcze, `
      + 'ciężarowe, motocykle i mikrobusy: tylko kierowca. Bez pieszych — nie liczono ich '
      + 'na przekrojach drogowych.')
  }
  if (repeats) {
    n.push('Przekroje leżą po obu stronach jednego skrzyżowania: suma zawyża ruch, '
      + 'udziały pozostają porównywalne.')
  }
  return n
}

function drawSplit(ctx, spec, y) {
  const { split } = spec
  const total = splitTotal(split)
  const rows = split.slices.filter((s) => s.persons > 0)
    .sort((a, b) => b.persons - a.persons)

  // headline: the vehicle share against the people share, for road nodes
  const car = split.slices.find((s) => s.key === 'car')
  const vehTotal = split.slices.reduce((a, s) => a + (s.vehicles || 0), 0)
  if (car && vehTotal > 0 && total > 0) {
    const vp = Math.round((100 * car.vehicles) / vehTotal)
    const pp = Math.round((100 * car.persons) / total)
    y = para(ctx, `Samochody osobowe: ${vp}% pojazdów, ale ${pp}% osób`,
      PAD, y, W - 2 * PAD, 26, '#c2410c', 700, 1.3) + 18
  }

  // donut
  const r = 132
  const cx = PAD + r + 4
  const cy = y + r + 4
  let a0 = -Math.PI / 2
  for (const s of rows) {
    const a1 = a0 + (2 * Math.PI * s.persons) / total
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.arc(cx, cy, r, a0, a1)
    ctx.closePath()
    ctx.fillStyle = s.color
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2
    ctx.stroke()
    a0 = a1
  }
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.58, 0, 2 * Math.PI)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = INK
  ctx.font = font(30, 700)
  ctx.fillText(fmtEst(total), cx, cy - 10)
  ctx.font = font(15)
  ctx.fillStyle = DIM
  ctx.fillText('osób', cx, cy + 20)
  ctx.textAlign = 'left'

  // table
  const tx = cx + r + 44
  const right = W - PAD
  const col = { persons: right - 190, pct: right - 105, veh: right }
  let ty = y + 6
  ctx.font = font(13, 600)
  ctx.fillStyle = FAINT
  ctx.textBaseline = 'top'
  ctx.textAlign = 'right'
  ctx.fillText('OSOBY', col.persons, ty)
  ctx.fillText('%', col.pct, ty)
  if (split.basis !== 'transit') ctx.fillText('POJAZDY', col.veh, ty)
  ctx.textAlign = 'left'
  ty += 28
  for (const s of rows) {
    ctx.beginPath()
    ctx.arc(tx + 7, ty + 10, 7, 0, 2 * Math.PI)
    ctx.fillStyle = s.color
    ctx.fill()
    ctx.font = font(17)
    ctx.fillStyle = INK
    const label = wrap(ctx, s.label, col.persons - 120 - (tx + 24))[0]
    ctx.fillText(label, tx + 24, ty)
    ctx.textAlign = 'right'
    ctx.fillText(s.est ? fmtEst(s.persons) : fmt(s.persons), col.persons, ty)
    ctx.font = font(17, 700)
    ctx.fillText(`${Math.round((100 * s.persons) / total)}`, col.pct, ty)
    if (split.basis !== 'transit') {
      ctx.font = font(16)
      ctx.fillStyle = DIM
      ctx.fillText(s.vehicles == null ? '' : fmt(s.vehicles), col.veh, ty)
    }
    ctx.textAlign = 'left'
    ty += 34
  }
  return Math.max(cy + r, ty) + 28
}

function drawProfile(ctx, spec, y) {
  const { big, profile } = spec
  if (big) {
    ctx.font = font(52, 700)
    ctx.fillStyle = INK
    ctx.textBaseline = 'top'
    ctx.fillText(big.value, PAD, y)
    const w = ctx.measureText(big.value).width
    para(ctx, big.unit, PAD + w + 14, y + 26, W - 2 * PAD - w - 14, 19, DIM)
    y += 72
  }
  if (!profile) return y + 8
  const { values, hours, color } = profile
  const h = 170
  const top = y + 14
  const chartW = W - 2 * PAD
  const bw = chartW / 24
  const max = Math.max(1, ...values)
  ctx.font = font(13)
  ctx.fillStyle = FAINT
  ctx.fillText(`profil dobowy · maks. ${fmt(max)}`, PAD, y - 4)
  for (let i = 0; i < 24; i++) {
    const bh = (values[i] / max) * h
    ctx.globalAlpha = hours.includes(i) ? 1 : 0.25
    ctx.fillStyle = color
    ctx.fillRect(PAD + i * bw + 2, top + h - bh, bw - 4, bh)
  }
  ctx.globalAlpha = 1
  ctx.strokeStyle = '#d9dce2'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, top + h + 0.5)
  ctx.lineTo(PAD + chartW, top + h + 0.5)
  ctx.stroke()
  ctx.fillStyle = FAINT
  ctx.font = font(13)
  for (let i = 0; i < 24; i += 3) ctx.fillText(HOUR_LABEL(i), PAD + i * bw, top + h + 8)
  return top + h + 40
}

/** Renders the card and resolves to a PNG blob. */
export function renderCard(spec) {
  const scratch = document.createElement('canvas')
  scratch.width = W * SCALE
  scratch.height = 2600 * SCALE
  const ctx = scratch.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, 2600)
  ctx.fillStyle = spec.accent || '#e4572e'
  ctx.fillRect(0, 0, W, 8)

  let y = PAD - 8
  y = para(ctx, spec.kicker.toUpperCase(), PAD, y, W - 2 * PAD, 14, FAINT, 600) + 6
  y = para(ctx, spec.title, PAD, y, W - 2 * PAD, 36, INK, 700, 1.2) + 6
  if (spec.subtitle) y = para(ctx, spec.subtitle, PAD, y, W - 2 * PAD, 18, DIM) + 4
  const when = spec.split
    ? `${cap(spec.period)} · podział liczony dla ${hoursText(spec.split.hours)}`
    : cap(spec.period)
  y = para(ctx, when, PAD, y + 6, W - 2 * PAD, 17, INK, 600) + 24

  y = spec.split ? drawSplit(ctx, spec, y) : drawProfile(ctx, spec, y)

  const notes = [...(spec.split ? splitNotes(spec) : []), ...(spec.notes || [])]
  for (const n of notes) {
    ctx.font = font(15)
    ctx.fillStyle = FAINT
    ctx.fillText('•', PAD, y)
    y = para(ctx, n, PAD + 18, y, W - 2 * PAD - 18, 15, DIM) + 6
  }

  y += 14
  ctx.strokeStyle = '#e6e8ec'
  ctx.beginPath()
  ctx.moveTo(PAD, y)
  ctx.lineTo(W - PAD, y)
  ctx.stroke()
  y = para(ctx, `Źródło: ${spec.source}`, PAD, y + 14, W - 2 * PAD, 14, DIM)
  const stamp = new Date().toLocaleDateString('pl-PL')
  y = para(ctx, `KBR Wrocław 2024 — przeglądarka map · wygenerowano ${stamp}`,
    PAD, y + 2, W - 2 * PAD, 13, FAINT) + PAD - 16

  const out = document.createElement('canvas')
  out.width = W * SCALE
  out.height = Math.ceil(y * SCALE)
  out.getContext('2d').drawImage(scratch, 0, 0)
  return new Promise((resolve, reject) => {
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  })
}

export const cardFilename = (spec) =>
  `kbr2024-${spec.id}-${spec.period}`.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.png'

export async function downloadCard(spec) {
  const blob = await renderCard(spec)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = cardFilename(spec)
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Copies the card as an image. Falls back to a download where the browser
 *  will not put images on the clipboard. */
export async function copyCard(spec) {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      throw new Error('clipboard images unsupported')
    }
    // A promise inside ClipboardItem keeps the user-gesture alive while the
    // canvas renders, which Safari requires.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderCard(spec) })])
    return 'copied'
  } catch {
    await downloadCard(spec)
    return 'downloaded'
  }
}
