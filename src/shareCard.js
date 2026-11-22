// A self-contained picture of one point, for pasting into documents and posts.
//
// Drawn straight onto a canvas rather than screenshotting the panel: no extra
// dependency, crisp at 2x, and no map tiles - tiles from another origin would
// taint the canvas and make the copy fail. Light background, because the
// picture ends up in documents and slides, not in this dark interface.
import {
  fmt, fmtEst, splitTotal, splitVehicles, splitShares, thinText, HOUR_LABEL, SHARE_ROW,
  carGap,
} from './data'
import { inkOn } from './pie'

const SITE = 'bartor.github.io/wroc-transport-map'
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
  const { split, pair, occupancy, occupancyDefault, occ, repeats } = spec
  const n = []
  if (split.basis === 'measured') {
    n.push(`Autobusy i tramwaje: pojazdy policzone na przekrojach drogowych × napełnienie `
      + `zmierzone w punkcie KZ ${pair.title} (${pair.dist} m): autobus `
      + `${split.load.bus.toFixed(1)}, tramwaj ${split.load.tram.toFixed(1)} os./poj.`
      + (thinText(split) ? ` Średnia miejska tam, gdzie próba była za mała (${thinText(split)}).` : ''))
  } else if (split.basis === 'estimate') {
    n.push(`Autobusy i tramwaje: pojazdy × średnie napełnienie z pomiarów KBR `
      + `(autobus ${occ.bus.toFixed(1)}, tramwaj ${occ.tram.toFixed(1)} os./poj.) — szacunek`
      + (thinText(split) ? `; próba na przystanku za mała (${thinText(split)})` : '') + '.')
  } else {
    n.push('Tylko pasażerowie autobusów i tramwajów — w pobliżu brak przekroju drogowego.')
  }
  if (split.basis !== 'transit') {
    // The occupancy is a cited number, so the card carries the citation: a
    // picture pasted elsewhere loses the app's "?" explanations.
    const cited = Math.abs(occupancy - occupancyDefault) < 1e-9
    const occSource = cited
      ? `KBR Wrocław 2024 podaje średnio ${spec.occupancyQuote || '1,207'} os. w samochodzie `
        + '(„Średnia liczba osób w samochodzie”, zał. 2.2 do Raportu II; podróże, w których '
        + 'respondenci byli kierowcami samochodu, dni robocze)'
      : `wartość ustawiona ręcznie; KBR Wrocław 2024 podaje ${spec.occupancyQuote || '1,207'}`
    n.push(`Samochody osobowe × ${occupancy.toFixed(2).replace('.', ',')} os./poj. — ${occSource}. Dostawcze, `
      + 'ciężarowe, motocykle i mikrobusy: tylko kierowca.')
    if (spec.pedNote) n.push(spec.pedNote)
  }
  if (spec.bikeNote) n.push(spec.bikeNote)
  if (repeats) {
    n.push('Przekroje leżą po obu stronach jednego skrzyżowania: suma zawyża ruch, '
      + 'udziały pozostają porównywalne.')
  }
  return n
}

function drawSplit(ctx, spec, y) {
  const { split } = spec
  const total = splitTotal(split)
  // the donut keeps the map's slice order, whose neighbours were checked
  // against each other; the table beside it goes largest first
  const ring = split.slices.filter((s) => s.persons > 0)
  const rows = [...ring].sort((a, b) => b.persons - a.persons)

  const vehTotal = splitVehicles(split)

  // donut
  const r = 132
  const cx = PAD + r + 4
  const cy = y + r + 4
  let a0 = -Math.PI / 2
  for (const s of ring) {
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

  // table: people and their share, then vehicles and theirs; a transit-only
  // node has no vehicles, and its people columns move right
  const tx = cx + r + 44
  const right = W - PAD
  const veh = vehTotal > 0
  const col = veh
    ? { persons: right - 214, pct: right - 150, veh: right - 62, vpct: right }
    : { persons: right - 70, pct: right }
  let ty = y + 6
  ctx.font = font(13, 600)
  ctx.fillStyle = FAINT
  ctx.textBaseline = 'top'
  ctx.textAlign = 'right'
  ctx.fillText('OSOBY', col.persons, ty)
  ctx.fillText('% OSÓB', col.pct, ty)
  if (veh) {
    ctx.fillText('POJAZDY', col.veh, ty)
    ctx.fillText('% POJ.', col.vpct, ty)
  }
  ctx.textAlign = 'left'
  ty += 28
  for (const s of rows) {
    ctx.beginPath()
    ctx.arc(tx + 7, ty + 10, 7, 0, 2 * Math.PI)
    ctx.fillStyle = s.color
    ctx.fill()
    ctx.font = font(17)
    ctx.fillStyle = INK
    const label = wrap(ctx, s.label, col.persons - 90 - (tx + 24))[0]
    ctx.fillText(label, tx + 24, ty)
    ctx.textAlign = 'right'
    ctx.fillText(s.est ? fmtEst(s.persons) : fmt(s.persons), col.persons, ty)
    ctx.font = font(17, 700)
    ctx.fillText(`${Math.round((100 * s.persons) / total)}`, col.pct, ty)
    if (veh && s.vehicles != null) {
      ctx.font = font(16)
      ctx.fillStyle = DIM
      ctx.fillText(fmt(s.vehicles), col.veh, ty)
      ctx.font = font(16, 700)
      ctx.fillText(`${Math.round((100 * s.vehicles) / vehTotal)}`, col.vpct, ty)
    }
    ctx.textAlign = 'left'
    ty += 34
  }
  let yb = Math.max(cy + r, ty) + 28
  // the same modes as people, vehicles and road capacity
  const bars = splitShares(split)
  if (bars) {
    const lx = PAD
    const bx = PAD + 230
    const bw = W - PAD - 70 - bx
    for (const row of bars) {
      ctx.font = font(15)
      ctx.fillStyle = DIM
      ctx.textBaseline = 'middle'
      ctx.fillText(SHARE_ROW[row.key], lx, yb + 15)
      let x = bx
      const parts = row.parts.filter((p) => p.share > 0)
      const gaps = 2 * (parts.length - 1)
      for (const p of parts) {
        const w = Math.max(2, (bw - gaps) * p.share)
        ctx.fillStyle = p.color
        ctx.fillRect(x, yb, w, 30)
        // the number inside when it fits; thin segments are in the table
        const label = `${Math.round(p.share * 100)}%`
        ctx.font = font(14, 700)
        if (w >= ctx.measureText(label).width + 10) {
          ctx.fillStyle = inkOn(p.color)
          ctx.textAlign = 'center'
          ctx.fillText(label, x + w / 2, yb + 16)
          ctx.textAlign = 'left'
        }
        x += w + 2
      }
      const car = row.parts.find((p) => p.key === 'car')
      ctx.font = font(16, 700)
      ctx.fillStyle = INK
      ctx.textAlign = 'right'
      ctx.fillText(`${Math.round(car.share * 100)}%`, W - PAD, yb + 15)
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      yb += 42
    }
    ctx.font = font(13)
    ctx.fillStyle = FAINT
    ctx.fillText('Liczba po prawej: samochody osobowe. Przepustowość jezdni w pojazdach umownych '
      + '(WR-D-13, tab. 4.3.1).', lx, yb + 2)
    yb += 40
    // the conclusion of the bars, where it is striking; it used to open the
    // card, before the evidence for it
    const gap = carGap(split)
    if (gap) yb = para(ctx, gap, PAD, yb - 6, W - 2 * PAD, 21, '#c2410c', 700, 1.3) + 22
  }
  return yb
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
  // where the picture came from, on the line with the date: a card shared
  // on its own still leads back to the map
  ctx.font = font(13, 600)
  ctx.fillStyle = DIM
  ctx.textAlign = 'right'
  ctx.textBaseline = 'top'
  ctx.fillText(SITE, W - PAD, y + 2)
  ctx.textAlign = 'left'
  y = para(ctx, `KBR Wrocław 2024 — przeglądarka map · wygenerowano ${stamp}`,
    PAD, y + 2, W - 2 * PAD - ctx.measureText(SITE).width - 24, 13, FAINT) + PAD - 16

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

/** Whether the system share sheet accepts image files - true on most phones,
 *  where it is the natural way to post a picture to a messenger. */
export function canShareImage() {
  try {
    const probe = new File([new Blob()], 'probe.png', { type: 'image/png' })
    return !!(navigator.canShare && navigator.canShare({ files: [probe] }))
  } catch {
    return false
  }
}

export async function shareCard(spec) {
  const blob = await renderCard(spec)
  const file = new File([blob], cardFilename(spec), { type: 'image/png' })
  try {
    await navigator.share({ files: [file], title: spec.title, text: `KBR Wrocław 2024 — ${spec.title}` })
    return 'shared'
  } catch (e) {
    if (e?.name === 'AbortError') return 'cancelled'   // user closed the sheet
    throw e
  }
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
