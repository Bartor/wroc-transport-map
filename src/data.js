// Loading and reshaping of the ETL output. Everything is small enough to keep
// in memory (~1.2 MB total), so the map filters client-side.

const FILES = ['meta', 'points', 'road', 'pt', 'bike', 'ped', 'rail', 'survey']

export async function loadAll() {
  const parts = await Promise.all(
    FILES.map((f) => fetch(`data/${f}.json`).then((r) => {
      if (!r.ok) throw new Error(`data/${f}.json missing — run: npm run etl`)
      return r.json()
    })),
  )
  const d = Object.fromEntries(FILES.map((f, i) => [f, parts[i]]))
  d.roadById = d.road.sections
  return d
}

// Units are plain nouns: every map value is a sum over the selected period,
// never a rate, so the period is spelled out next to it instead.
export const LAYERS = {
  road: { label: 'Ruch drogowy', color: '#e4572e', unit: 'poj.' },
  pt: { label: 'Potoki w autobusach i tramwajach', color: '#2e86ab', unit: 'pasażerów' },
  bike: { label: 'Ruch rowerowy', color: '#3fa34d', unit: 'rowerzystów' },
  ped: { label: 'Ruch pieszy', color: '#b5179e', unit: 'pieszych' },
  rail: { label: 'Potoki w pociągach (kordon)', color: '#7048e8', unit: 'pasażerów' },
  survey: { label: 'Próba badania ankietowego', color: '#8d99ae', unit: 'adresów' },
}

const ALL_HOURS = Array.from({ length: 24 }, (_, i) => i)

export const PRESETS = {
  day: { label: 'Cała doba', hours: ALL_HOURS },
  am: { label: 'Szczyt poranny 7–9', hours: [7, 8] },
  pm: { label: 'Szczyt popołudniowy 15–17', hours: [15, 16] },
  midday: { label: 'Międzyszczyt 10–14', hours: [10, 11, 12, 13] },
  night: { label: 'Noc 22–5', hours: [22, 23, 0, 1, 2, 3, 4, 5] },
}

// Road metric = which vehicle categories to count.
export const ROAD_METRICS = {
  all: { label: 'Wszystkie pojazdy', cats: null },
  motor: { label: 'Pojazdy silnikowe', cats: ['c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'l'] },
  car: { label: 'Samochody osobowe', cats: ['d'] },
  freight: { label: 'Ciężarowe i dostawcze', cats: ['e', 'f', 'g', 'h'] },
  transit: { label: 'Autobusy i tramwaje', cats: ['i', 'j', 'k'] },
  bike: { label: 'Rowery i UTO (na jezdni)', cats: ['a1', 'a2', 'b1', 'b2'] },
}

/** Vehicles at a road cross-section, summed over the chosen hours/cats/dirs. */
export function roadVolume(section, { cats, hours, dir }, catOrder) {
  if (!section) return 0
  const idx = cats ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0) : null
  let total = 0
  for (const [d, dd] of Object.entries(section.dirs)) {
    if (dir && dir !== d) continue
    for (const h of hours) {
      const row = dd.h[h]
      if (!row) continue
      if (idx) for (const i of idx) total += row[i]
      else for (const v of row) total += v
    }
  }
  return total
}

/** 24-value hourly profile for a road cross-section. */
export function roadProfile(section, { cats, dir }, catOrder) {
  const idx = cats ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0) : null
  const out = new Array(24).fill(0)
  if (!section) return out
  for (const [d, dd] of Object.entries(section.dirs)) {
    if (dir && dir !== d) continue
    for (let h = 0; h < 24; h++) {
      const row = dd.h[h]
      if (!row) continue
      if (idx) for (const i of idx) out[h] += row[i]
      else for (const v of row) out[h] += v
    }
  }
  return out
}

export const sumHours = (profile, hours) => hours.reduce((a, h) => a + (profile[h] || 0), 0)

/** 24-value hourly profile for any layer, so points and cross-sections can be
 *  summed the same way. */
export function profileFor(data, kind, p, metric) {
  if (kind === 'road') {
    return roadProfile(data.roadById[p.id], { cats: ROAD_METRICS[metric].cats },
      data.meta.vehCatOrder)
  }
  if (kind === 'pt' || kind === 'rail') {
    const out = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { out[h] += v }))
    return out
  }
  return p.byHour || new Array(24).fill(0)
}

/** Cross-sections of one point summed together — the whole junction, not one
 *  approach of it. */
export function addProfiles(profiles) {
  const out = new Array(24).fill(0)
  for (const pr of profiles) for (let h = 0; h < 24; h++) out[h] += pr[h] || 0
  return out
}

// A measurement point (punkt) is split into lettered cross-sections (przekroje):
// KW_08 -> KW_08A, KW_08B, KW_08C. Each letter is one approach at that place -
// a separate street or slip road for road counts, one side of the street for
// cycle counts, one street of an interchange for transit counts.
export const parentOf = (kind, p) =>
  kind === 'road' || kind === 'pt' ? p.point : p.id.replace(/[A-Z]$/, '')

export const sectionLetter = (id) => (/[A-Z]$/.test(id) ? id.slice(-1) : null)

/** What distinguishes this cross-section from its siblings. */
export function sectionOf(kind, p) {
  if (kind === 'pt') return p.loc
  if (kind === 'bike' || kind === 'ped') return (p.where || [])[0] || p.segment
  return p.segment
}

/**
 * Transit cross-sections all sit on the same stop, so identical coordinates
 * would hide each other. Fan coincident markers onto a small ring around the
 * shared position; the popup still names the real location.
 */
export function spread(markers, metres = 20) {
  const by = new Map()
  for (const m of markers) {
    const k = `${m.lat.toFixed(5)},${m.lon.toFixed(5)}`
    if (!by.has(k)) by.set(k, [])
    by.get(k).push(m)
  }
  for (const group of by.values()) {
    if (group.length < 2) continue
    const dLat = metres / 111320
    const dLon = dLat / Math.cos((group[0].lat * Math.PI) / 180)
    group.forEach((m, i) => {
      const a = (2 * Math.PI * i) / group.length
      m.lat += dLat * Math.sin(a)
      m.lon += dLon * Math.cos(a)
      m.shifted = group.length
    })
  }
  return markers
}

/** Marker radius: sqrt so area, not radius, tracks the volume. */
export function radius(value, max, min = 3, cap = 22) {
  if (!value || !max) return min
  return min + (cap - min) * Math.sqrt(value / max)
}

export const fmt = (n) =>
  n == null ? '—' : Math.round(n).toLocaleString('pl-PL')

export const pct = (n) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`)

export const HOUR_LABEL = (h) => `${String(h).padStart(2, '0')}:00`

/** What the numbers on the map are summed over, for labelling. */
export function periodLabel(preset, hour) {
  if (hour != null) return `${HOUR_LABEL(hour)}–${HOUR_LABEL((hour + 1) % 24)}`
  return PRESETS[preset].label.toLowerCase()
}
