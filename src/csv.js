// What the map shows, as a table for a spreadsheet: one row per drawn point.
// Semicolons and decimal commas, with a BOM, so Excel set to Polish opens
// it as columns without an import dialog.
import { LAYERS, MODES, splitTotal, splitVehicles, splitShares } from './data'

const num = (v, digits = 0) => (v == null || Number.isNaN(v) ? ''
  : (digits ? v.toFixed(digits) : String(Math.round(v))).replace('.', ','))
const cell = (v) => {
  const s = v == null ? '' : String(v)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const sections = (m) => (m.ref.aggregate ? m.ref.members.map((r) => r.id).join(' ') : m.id)

/** Rows of the drawn markers; node pies get a column per mode. */
export function markersTable({ markers, layers, period, people }) {
  const list = layers.flatMap((k) => (markers[k] || []).map((m) => [k, m]))
  const pies = list.some(([, m]) => m.split)
  const head = ['id', 'nazwa', 'warstwa', 'szer', 'dł', 'okres']
  if (pies) {
    head.push('godziny podziału', 'osoby razem')
    for (const md of MODES) head.push(`${md.label} — osoby`, `${md.label} — pojazdy`)
    for (const md of MODES) head.push(`${md.label} — % osób`, `${md.label} — % pojazdów`)
    for (const md of MODES) head.push(`${md.label} — % przepustowości (poj. umowne)`)
    head.push('napełnienie autobus', 'napełnienie tramwaj', 'źródło napełnienia', 'przekroje', 'pominięte')
  } else {
    head.push('wartość', 'jednostka', 'przekroje', 'pominięte')
  }
  const rows = list.map(([k, m]) => {
    const name = (m.title || '').replace(/^\S+ · /, '')
    const base = [m.id, name, LAYERS[k].label, num(m.lat, 6), num(m.lon, 6), period]
    const left = m.ref.aggregate
      ? m.ref.all.filter((r) => !m.ref.members.includes(r)).map((r) => r.id)
      : []
    if (!pies) {
      const unit = k === 'road' && people ? 'osób w samochodach osobowych' : LAYERS[k].unit
      return [...base, num(m.value), unit, sections(m), left.join(' ')]
    }
    const s = m.split
    if (!s) return [...base, ...Array(head.length - base.length).fill('')]
    const total = splitTotal(s)
    const veh = splitVehicles(s)
    const by = Object.fromEntries(s.slices.map((x) => [x.key, x]))
    const out = [...base, s.hours.join(' '), num(total)]
    for (const md of MODES) out.push(num(by[md.key]?.persons), num(by[md.key]?.vehicles))
    for (const md of MODES) {
      const x = by[md.key]
      out.push(x && total ? num((100 * x.persons) / total, 1) : '',
        x?.vehicles != null && veh ? num((100 * x.vehicles) / veh, 1) : '')
    }
    const pcu = splitShares(s)?.[2]
    for (const md of MODES) {
      const x = pcu?.parts.find((p) => p.key === md.key)
      out.push(x ? num(100 * x.share, 1) : '')
    }
    const src = s.basis === 'transit' ? 'pomiar pasażerów'
      : s.local?.bus || s.local?.tram ? `punkt KZ ${m.pair?.id || ''}`.trim() : 'średnia miejska'
    if (s.load) out.push(num(s.load.bus, 1), num(s.load.tram, 1))
    else out.push('', '')
    out.push(src, sections(m), [...left, ...(m.pair ? m.pair.all
      .filter((r) => !m.pair.refs.includes(r)).map((r) => r.id) : [])].join(' '))
    return out
  })
  return [head, ...rows]
}

export function downloadCsv(table, filename) {
  const text = `﻿${table.map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
