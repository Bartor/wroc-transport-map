import { describe, expect, it } from 'vitest'
import { buildMarkers } from './data'
import { labelLines } from './pie'
import { markersTable } from './csv'
import { fixture, OPTS } from './fixture.test-data'

const mk = buildMarkers(fixture(), OPTS)
const n1 = mk.road.find((m) => m.id === 'N1')

describe('map labels', () => {
  it('give numbers, shares or both for a pie', () => {
    const num = labelLines(n1, { num: true, pct: false }, 'os.')
    const pct = labelLines(n1, { num: false, pct: true }, 'os.')
    const both = labelLines(n1, { num: true, pct: true }, 'os.')
    expect(num[0].text).toMatch(/^Σ/)
    expect(pct[1].text).toMatch(/^\d+%$/)
    expect(both[1].text).toMatch(/ · \d+%$/)
  })

  it('give a plain marker a number only', () => {
    const plain = { ...n1, split: null, value: 1234 }
    expect(labelLines(plain, { num: false, pct: true }, 'poj.')).toEqual([])
    expect(labelLines(plain, { num: true, pct: false }, 'poj.')[0].text).toContain('poj.')
  })
})

describe('CSV table', () => {
  const t = markersTable({ markers: mk, layers: ['road', 'pt'], period: 'szczyt', people: true })
  const head = t[0]
  const row = t.find((r) => r[0] === 'N1')

  it('has a column per mode for people, vehicles and capacity', () => {
    expect(head).toContain('Tramwaje — osoby')
    expect(head).toContain('Samochody osobowe — % pojazdów')
    expect(head).toContain('Samochody osobowe — % przepustowości (poj. umowne)')
    expect(row).toHaveLength(head.length)
  })

  it('writes decimal commas and names the load source', () => {
    expect(row[head.indexOf('osoby razem')]).toBe('1584')
    expect(row[head.indexOf('napełnienie autobus')]).toBe('40,0')
    expect(row[head.indexOf('źródło napełnienia')]).toBe('punkt KZ P1')
    expect(row[head.indexOf('przekroje')]).toBe('N1A N1B')
  })
})
