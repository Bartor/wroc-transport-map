// Shares as a short list of bars, label above, one colour.
const row = { display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 8, fontSize: 12, lineHeight: 1.35 }
const track = { gridColumn: '1 / -1', height: 6, borderRadius: 3, background: 'rgba(127,140,160,.18)', margin: '2px 0 6px' }

/** `whole`: the bar's full length is 100%, not the longest of them. */
export default function Bars({ rows, color = '#3f8bd0', onPick, whole }) {
  const top = whole ? 1 : Math.max(0.0001, ...rows.map((r) => r.share))
  return (
    <div role="list">
      {rows.map((r) => (
        <div role="listitem" key={r.key} style={{ ...row, cursor: onPick ? 'pointer' : undefined }} title={r.title}
          onClick={onPick ? () => onPick(r) : undefined}>
          <span style={{ fontWeight: r.on ? 700 : 400 }}>{r.label}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {r.share > 0 && r.share < 0.005 ? '<1%' : `${Math.round(100 * r.share)}%`}
            {r.note && <span style={{ opacity: 0.65 }}> {r.note}</span>}
          </span>
          <span style={track}>
            <span style={{
              display: 'block', height: '100%', borderRadius: 3, width: `${(100 * r.share) / top}%`,
              background: r.color || color, opacity: r.dim ? 0.45 : 1,
            }} />
          </span>
        </div>
      ))}
    </div>
  )
}
