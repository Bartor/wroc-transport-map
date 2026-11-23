// The picture of one point: what the card says. Drawing it is the library's
// business, see renderCard there.
import {
  figureBlock, hourRuns, renderCard, sharesBlock, slug, splitBlock,
} from '@bartor-net/ui-kit'
import { carGap, splitShares, SHARE_ROW, thinText } from './data'

const SITE = 'bartor.github.io/wroc-transport-map'

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

function splitBlocks(split) {
  const shares = splitShares(split)
  return [
    // the donut keeps the map's slice order, whose neighbours were checked
    // against each other; the table beside it goes largest first
    splitBlock({
      unit: 'osób',
      columns: { value: 'OSOBY', share: '% OSÓB', extra: 'POJAZDY', extraShare: '% POJ.' },
      slices: split.slices.map((s) => ({
        key: s.key, label: s.label, color: s.color, est: s.est, value: s.persons, extra: s.vehicles,
      })),
    }),
    // the same modes as people, vehicles and road capacity
    ...(shares ? [sharesBlock({
      rows: shares.map((r) => ({ label: SHARE_ROW[r.key], parts: r.parts })),
      mark: 'car',
      caption: 'Liczba po prawej: samochody osobowe. Przepustowość jezdni w pojazdach umownych '
        + '(WR-D-13, tab. 4.3.1).',
      conclusion: carGap(split),
    })] : []),
  ]
}

/** What the card of a point shows, as the library draws it. */
export const cardSpec = (spec) => ({
  accent: spec.accent || '#e4572e',
  kicker: spec.kicker,
  title: spec.title,
  subtitle: spec.subtitle,
  when: spec.split
    ? `${cap(spec.period)} · podział liczony dla ${hourRuns(spec.split.hours, 'brak godzin wspólnych')}`
    : cap(spec.period),
  blocks: spec.split ? splitBlocks(spec.split)
    : [figureBlock({ figure: spec.big, profile: spec.profile })],
  notes: [...(spec.split ? splitNotes(spec) : []), ...(spec.notes || [])],
  source: `Źródło: ${spec.source}`,
  footer: `KBR Wrocław 2024 — przeglądarka map · wygenerowano ${new Date().toLocaleDateString('pl-PL')}`,
  // a card shared on its own still leads back to the map
  site: SITE,
})

export const cardFilename = (spec) => `${slug(`kbr2024-${spec.id}-${spec.period}`)}.png`

export const drawCard = (spec) => renderCard(cardSpec(spec))
