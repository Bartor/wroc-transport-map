import { fmt, fmtEst } from '@bartor-net/ui-kit'
import { splitTotal } from './data'

const pctText = (share) => (share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`)

/**
 * What a permanent map label says. `show` picks numbers, shares (%) or both;
 * shares describe a modal split, so a plain marker only ever has a number.
 *
 * People counts built on an assumption (cars x occupancy, transit estimated
 * from vehicles) are printed rounded with a tilde; measured ones exactly.
 */
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
