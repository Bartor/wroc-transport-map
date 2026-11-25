// The same roads counted in 2018 and 2024.
const RINGS = [['R1', 'Ring 1 — centrum'], ['R2', 'Ring 2'], ['R3', 'Ring 3'], ['PR', 'Poza ringami'],
  ['KW', 'Granica miasta'], ['AOW', 'Obwodnica (AOW)']]

/** Roads counted in both rounds, where they are, and by how much they moved. */
export function changes(C, data) {
  const at = new Map(data.points.map((p) => [p.id, p]))
  return C.roads.map((r) => {
    const ps = r.ids.map((id) => at.get(id)).filter((p) => p?.lat)
    if (!ps.length) return null
    const mean = (k) => ps.reduce((a, p) => a + p[k], 0) / ps.length
    return { ...r, key: r.ids.join('+'), id: r.ids[0], lat: mean('lat'), lon: mean('lon'), name: ps[0].name,
      segment: ps[0].segment, ring: r.ids[0].split('_')[0], d: r.v24 / r.v18 - 1 }
  }).filter(Boolean)
}

export function ringChanges(rows) {
  return RINGS.map(([key, label]) => {
    const own = rows.filter((r) => r.ring === key)
    const a = own.reduce((s, r) => s + r.v18, 0)
    const b = own.reduce((s, r) => s + r.v24, 0)
    return { key, label, n: own.length, v18: a, v24: b, d: a ? b / a - 1 : null, fell: own.filter((r) => r.d < 0).length }
  }).filter((r) => r.n)
}
