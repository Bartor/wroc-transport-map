import { describe, expect, it } from 'vitest'
import { ASSUME, CASES, KINDS, MOST } from './evaporation'

const all = CASES.map((c) => c.v)
const of = (kind) => CASES.filter((c) => c.kind === kind).map((c) => c.v)
const mean = (l) => l.reduce((a, b) => a + b, 0) / l.length
const median = (l) => {
  const s = [...l].sort((a, b) => a - b)
  return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2
}

describe('the cases of disappearing traffic', () => {
  it('add up to what the paper says of them', () => {
    expect(all.filter((x) => x > 0)).toHaveLength(51)
    expect(all.filter((x) => x < 0)).toHaveLength(11)
    expect(median(all)).toBeCloseTo(10.6, 5)
    expect(mean(all)).toBeCloseTo(21.9, 1)
    expect(median(of('c'))).toBeCloseTo(13.7, 1)
    expect(mean(of('c'))).toBeCloseTo(28.3, 1)
  })

  it('are sorted, of known kinds, and the shares offered fit the slider', () => {
    expect(all).toEqual([...all].sort((a, b) => b - a))
    CASES.forEach((c) => expect(KINDS[c.kind]).toBeTruthy())
    ASSUME.forEach((a) => expect(a.key).toBeLessThanOrEqual(MOST))
  })
})
