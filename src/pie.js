// Pie markers and permanent node labels, as HTML strings for Leaflet DivIcons.
import { fmt, fmtEst, splitTotal } from './data'

/** SVG pie of a node's modal split. `ring` outlines the selected node. */
export function pieSvg(split, r, ring) {
  const size = 2 * r + 6
  const c = r + 3
  const total = splitTotal(split)
  const outline = ring
    ? `<circle cx="${c}" cy="${c}" r="${r + 1.5}" fill="none" stroke="#fff" stroke-width="2.5"/>`
    : ''
  if (!total) {
    return `<svg width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${r}"
      fill="#3a3f4b" stroke="#14161a" stroke-width="1"/>${outline}</svg>`
  }
  const parts = split.slices.filter((s) => s.persons > 0)
  let body = ''
  if (parts.length === 1) {
    body = `<circle cx="${c}" cy="${c}" r="${r}" fill="${parts[0].color}"/>`
  } else {
    let a0 = -Math.PI / 2
    for (const s of parts) {
      const a1 = a0 + (2 * Math.PI * s.persons) / total
      const large = a1 - a0 > Math.PI ? 1 : 0
      const x0 = c + r * Math.cos(a0)
      const y0 = c + r * Math.sin(a0)
      const x1 = c + r * Math.cos(a1)
      const y1 = c + r * Math.sin(a1)
      body += `<path d="M${c},${c} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 `
        + `${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${s.color}" stroke="#14161a" stroke-width="0.8"/>`
      a0 = a1
    }
  }
  return `<svg width="${size}" height="${size}">${body}`
    + `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#14161a" stroke-width="1"/>`
    + `${outline}</svg>`
}

const pctText = (share) => (share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`)

/**
 * Lines for a permanent label. Shares only make sense for a split, so a plain
 * marker gets a label in "#" mode and none in "%" mode.
 *
 * People counts built on an assumption (cars x occupancy, transit estimated
 * from vehicles) are printed rounded with a tilde; measured ones exactly.
 */
/** What a permanent label says. `show` picks numbers, shares (%) or both;
 *  shares describe a modal split, so a plain marker only ever has a number. */
export function labelLines(m, show, unit) {
  if (m.split) {
    const total = splitTotal(m.split)
    if (!total) return []
    const lines = [{ text: `Σ ${fmtEst(total)} os.`, bold: true }]
    const top = [...m.split.slices]
      .filter((s) => s.persons / total >= 0.03)
      .sort((a, b) => b.persons - a.persons)
      .slice(0, 4)
    for (const s of top) {
      const num = s.est ? fmtEst(s.persons) : fmt(s.persons)
      const share = pctText(s.persons / total)
      const text = show.num && show.pct ? `${num} · ${share}` : show.pct ? share : num
      lines.push({ text, color: s.color })
    }
    return lines
  }
  if (show.num && m.value) return [{ text: `${fmt(m.value)} ${unit}`, bold: true }]
  return []
}

export function labelHtml(lines) {
  return lines.map((l) => (
    `<div class="nl-line${l.bold ? ' nl-bold' : ''}">`
    + (l.color ? `<i style="background:${l.color}"></i>` : '')
    + `<span>${l.text}</span></div>`
  )).join('')
}

/** Rough box size, so overlap can be tested without measuring the DOM. */
export function labelBox(lines) {
  const chars = Math.max(...lines.map((l) => l.text.length + (l.color ? 2 : 0)))
  return { w: Math.round(chars * 6.4 + 14), h: lines.length * 13 + 6 }
}
