// Parts of a whole as one bar, with its legend: press a part to filter by it.
import { useState } from 'react'
import { fmt } from '@bartor-net/ui-kit'

const pct = (s) => (s > 0 && s < 0.005 ? '<1%' : `${Math.round(100 * s)}%`)
const ink = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#14161a' : '#ffffff'
}

// something that has an order is light to dark; kinds of things are hues
export const ORDERED = ['#dbeafc', '#b3d4f6', '#83b7ec', '#5598de', '#3579c4', '#235c9c', '#173f6e']
export const KINDS = ['#3987e5', '#0ca30c', '#c98500', '#b5179e', '#6cc5d9', '#9085e9', '#e4572e', '#f2c14e', '#1baf7a', '#d55181', '#8a93a3', '#5b6270']

/** Colours for a dimension's options: its own, else by whether they have an order. */
export const colorsOf = (d, ordered) => d.options.map((o, i) => o.color
  || (ordered ? ORDERED[Math.round((i * (ORDERED.length - 1)) / Math.max(1, d.options.length - 1))] : KINDS[i % KINDS.length]))

// An answer on a scale, from for to against, and no opinion.
export const SCALE = ['#1b7f5c', '#6cbf9b', '#8a93a3', '#e3a857', '#c0582a', '#4b5361']

const REST = '#5b6270'
/** Counts by name as parts of a bar: the biggest by name, the rest as one. */
export function partsOf(counts, top = 8, rest = 'inne') {
  const all = Object.entries(counts || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const sum = all.reduce((a, [, v]) => a + v, 0)
  if (!sum) return []
  const named = all.filter(([l]) => l !== rest)
  const big = named.length > top ? named.slice(0, top - 1) : named
  const left = sum - big.reduce((a, [, v]) => a + v, 0)
  return [...big.map(([label, v], i) => ({ key: label, label, value: v, share: v / sum, color: KINDS[i % 10] })),
    ...(left > 0 ? [{ key: rest, label: rest, value: left, share: left / sum, color: REST }] : [])]
}

export function Bar({ parts, on, height = 22, onPick, hot, setHot }) {
  const [own, setOwn] = useState(null)
  const h = hot === undefined ? own : hot
  const light = setHot || setOwn
  const some = on?.size > 0
  return (
    <div style={{ display: 'flex', gap: 2, height, margin: '4px 0' }}>
      {parts.filter((p) => p.share > 0).map((p) => {
        const dim = h != null ? h !== p.key : some && !on.has(p.key)
        return (
          <button key={p.key} type="button" title={`${p.label}: ${pct(p.share)}${p.title ? ` · ${p.title}` : ''}`}
            aria-pressed={some ? on.has(p.key) : undefined}
            onClick={onPick ? () => onPick(p.key) : undefined}
            onMouseEnter={() => light(p.key)} onMouseLeave={() => light(null)}
            style={{
              flex: `${p.share} 1 0`, minWidth: 2, border: 0, padding: 0, borderRadius: 2, background: p.color,
              opacity: dim ? 0.35 : 1, color: ink(p.color), font: '600 11px system-ui', overflow: 'hidden',
              cursor: onPick ? 'pointer' : 'default', outlineOffset: 1,
            }}>
            {p.share >= 0.07 ? pct(p.share) : ''}
          </button>
        )
      })}
    </div>
  )
}

export default function Stack({ parts, on, onPick }) {
  const [hot, setHot] = useState(null)
  const some = on?.size > 0
  return (
    <>
      <Bar parts={parts} on={on} onPick={onPick} hot={hot} setHot={setHot} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12 }}>
        {parts.filter((p) => p.share > 0).map((p) => (
          <button key={p.key} type="button" onClick={onPick ? () => onPick(p.key) : undefined} title={p.title}
            onMouseEnter={() => setHot(p.key)} onMouseLeave={() => setHot(null)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, border: 0, background: 'none', padding: '1px 0',
              color: 'inherit', font: 'inherit', cursor: onPick ? 'pointer' : 'default',
              fontWeight: some && on.has(p.key) ? 700 : 400,
              opacity: (hot != null && hot !== p.key) || (hot == null && some && !on.has(p.key)) ? 0.5 : 1,
            }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: p.color, flex: 'none' }} />
            {p.label} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{pct(p.share)}</b>
            {p.value != null && <span style={{ opacity: 0.65, fontVariantNumeric: 'tabular-nums' }}>{fmt(p.value)}</span>}
            {p.note && <span style={{ opacity: 0.65 }}>{p.note}</span>}
          </button>
        ))}
      </div>
    </>
  )
}
