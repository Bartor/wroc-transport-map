import { Fragment, useCallback, useRef, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, ResponsiveContainer, Cell,
} from 'recharts'
import {
  LAYERS, ROAD_METRICS, roadProfile, profileFor, addProfiles, fmt, pct,
  HOUR_LABEL, sumHours, parentOf, sectionLetter, sectionOf, fmtEst,
  activeCats, expand, toPeople, expansionOf, BASIS_LABEL, markerIndex, splitTotal,
  splitVehicles, bikeNote, pedNote, thinText, splitShares, SHARE_ROW, PCU_SOURCE,
  HOUR_LABEL as HL, coverageGap, windowKind, pieceKey, transitByMode, MODES, nodeSplit,
} from './data'
import { copyCard, downloadCard, shareCard, canShareImage } from './shareCard'
import { useSheetDrag } from './sheetDrag'
import { inkOn } from './pie'

const SHARE_FILES = canShareImage()

const GROUP_LABEL = {
  road: 'Przekroje drogowe',
  pt: 'Przystanki — pomiar pasażerów',
  bike: 'Przekroje rowerowe',
  ped: 'Przekroje piesze',
}

const NO_OFF = new Set()

/**
 * A node is made of pieces: lettered road sections (KW_08A, KW_08B...), and
 * the stops of the transit point paired with it. The tree stays put while
 * moving between the node and its pieces, lighting up the one on show.
 *
 * Each piece shows its share of its own group - road and transit count
 * different things, so they are never summed together. Unticking a piece
 * leaves it out of the node's numbers everywhere: the far approaches of an
 * interchange, say, to look at one junction of it. The node's own group keeps
 * at least one piece, or it would have nothing to stand on; the paired stops
 * only lend their load per vehicle, and can all go.
 *
 * Hovering a piece here lights up its dot on the map, and the other way round.
 */
const PHONE = typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches
// a pointer that can hover; on touch a tap pins instead, and a hover would stick
const MOUSE = typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches

function NodeTree({ family, shares, onSelect, off, toggleOff, hot, setHot }) {
  const { node, groups, current } = family
  // On a phone twelve rows fill the sheet before the split is in sight, so
  // groups start folded - unless they hold the open piece or a left-out one.
  const [shut, setShut] = useState(() => new Set(PHONE ? groups
    .filter((g) => current?.kind !== g.kind
      && !g.members.some((m) => off.has(pieceKey(g.kind, m.id))))
    .map((g) => g.kind) : []))
  const fold = (kind) => setShut((s) => {
    const n = new Set(s)
    if (n.has(kind)) n.delete(kind)
    else n.add(kind)
    return n
  })
  const toNode = () => onSelect({ kind: node.kind, id: node.id, ref: node.ref })
  const isOn = (kind, id) => current?.kind === kind && current.id === id
  // leaving pieces out only means something when they add up to a node
  const can = !!node && !!toggleOff
  const keysOf = (g) => g.members.map((m) => pieceKey(g.kind, m.id))
  const nOff = can ? groups.flatMap(keysOf).filter((k) => off.has(k)).length : 0
  const isHot = (kind, id) => hot?.kind === kind && hot.id === id
  // a mouse only: on touch a tap would leave the row lit
  const hover = (kind, id) => (setHot ? {
    onPointerEnter: (e) => e.pointerType === 'mouse' && setHot({ kind, id }),
    onPointerLeave: (e) => e.pointerType === 'mouse' && setHot(null),
  } : {})
  return (
    <nav className="tree" aria-label="Części węzła">
      {node && (
        <button type="button" className={current ? 'tree-root' : 'tree-root on'}
          aria-current={current ? undefined : 'true'} onClick={toNode}>
          <b>Σ</b>
          <span>Cały węzeł {node.id}</span>
          {nOff > 0 && <em>{nOff} pominięte</em>}
        </button>
      )}
      {groups.map((g) => {
        const keys = keysOf(g)
        const left = keys.filter((k) => !off.has(k)).length
        return (
          <div key={g.kind} className={`tree-group ${g.kind}${node ? ' nested' : ''}`}>
            {(groups.length > 1 || node) && (
              <h5>
                <button type="button" className="fold" aria-expanded={!shut.has(g.kind)}
                  onClick={() => fold(g.kind)}>
                  <i className={shut.has(g.kind) ? 'chevron' : 'chevron open'}>▸</i>
                  {GROUP_LABEL[g.kind]}
                  <em>{left < keys.length ? `${left} z ${keys.length}` : keys.length}</em>
                </button>
                {can && left < keys.length && (
                  <button type="button" onClick={() => toggleOff(keys, false)}>
                    wlicz wszystkie
                  </button>
                )}
              </h5>
            )}
            {!shut.has(g.kind) && <ul>
              {g.members.map((m, i) => {
                const out = can && off.has(keys[i])
                const last = !out && left === 1 && g.kind === node.kind
                const on = isOn(g.kind, m.id)
                const share = shares[keys[i]]
                return (
                  <li key={m.id} {...hover(g.kind, m.id)}
                    className={`${on ? 'on' : ''}${out ? ' out' : ''}`
                      + `${isHot(g.kind, m.id) ? ' hot' : ''}`}>
                    {can && (
                      <input type="checkbox" className="check" checked={!out} disabled={last}
                        style={{ '--c': LAYERS[g.kind].color }}
                        aria-label={`Wliczaj ${m.id} do węzła`}
                        title={last ? 'Węzeł musi mieć co najmniej jeden przekrój'
                          : out ? 'Wlicz do węzła' : 'Pomiń w liczbach węzła'}
                        onChange={(e) => toggleOff(keys[i], !e.target.checked)} />
                    )}
                    <button type="button" aria-current={on ? 'true' : undefined}
                      title={`${m.id} · ${sectionOf(g.kind, m) || m.name}`}
                      onClick={() => onSelect({ kind: g.kind, id: m.id, ref: m })}>
                      <b>{sectionLetter(m.id) || '—'}</b>
                      <span>{(g.kind === 'road' ? m.name : sectionOf(g.kind, m)) || m.name}</span>
                      <em>{out ? 'pominięty' : share == null ? '—' : `${share}%`}</em>
                    </button>
                  </li>
                )
              })}
            </ul>}
          </div>
        )
      })}
      {nOff > 0 && (
        <p className="hint">
          Pominięte części nie wliczają się do sum węzła, podziału modalnego,
          wielkości koła na mapie ani rankingu.
        </p>
      )}
    </nav>
  )
}

/**
 * The hour and what was counted in it, spelled out: "3 056 osób w samochodach
 * osobowych", on the dark panel - Recharts' own box was white with a pale
 * grey hour and the data key "v" for a name.
 */
function HourTip({ active, payload, label, names, colors }) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      <b>{HOUR_LABEL(label)}–{HOUR_LABEL((label + 1) % 24)}</b>
      {payload.map((x) => (
        <div key={x.dataKey}>
          {colors && <i style={{ background: colors[x.dataKey] }} />}
          {fmt(x.value)} {names[x.dataKey]}
        </div>
      ))}
    </div>
  )
}
const CURSOR = { fill: 'rgba(255, 255, 255, .06)' }
// Tooltips sit above the chart, pinned to its top edge and lifted by their own
// height in CSS, so they never cover the bars they describe.
const TIP = { position: { y: 0 }, allowEscapeViewBox: { x: false, y: true }, wrapperStyle: { zIndex: 5 } }

// Axis ticks: thousands shortened, so "3800" is not clipped to "800".
const AXIS_TICK = (v) => (v >= 1000 ? `${(v / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} tys.` : v)
const YAX = { tick: { fontSize: 10 }, width: 44, tickFormatter: AXIS_TICK }
const MARGIN = { top: 4, right: 4, bottom: 0, left: -6 }

// Neighbouring pieces in a stack take alternating shades of the layer colour,
// with a thin panel-coloured gap between them.
const SHADES = [0, 0.3, -0.25, 0.5, -0.4]
function shade(hex, i) {
  const t = SHADES[i % SHADES.length]
  const c = [1, 3, 5].map((j) => parseInt(hex.slice(j, j + 2), 16))
  const to = t > 0 ? 255 : 0
  const mix = c.map((v) => Math.round(v + (to - v) * Math.abs(t)))
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Every piece in an hour, top of the stack first, the pointed one bright. */
function StackTip({ active, payload, label, pieces, focus, unit }) {
  if (!active || !payload?.length) return null
  const val = Object.fromEntries(payload.map((x) => [x.dataKey, x.value]))
  const total = pieces.reduce((a, s) => a + (s.out ? 0 : val[s.id] || 0), 0)
  return (
    <div className="chart-tip stack-tip">
      <b>{HOUR_LABEL(label)}–{HOUR_LABEL((label + 1) % 24)} · {unit}</b>
      {[...pieces].reverse().map((s) => (
        <div key={s.id} className={focus && focus !== s.id ? 'dim' : undefined}>
          <i style={{ background: s.fill }} />
          <span>{s.letter} {s.name}{s.out ? ' (pominięty)' : ''}</span>
          <em>{fmt(val[s.id] || 0)}</em>
        </div>
      ))}
      <div className="sum"><span>razem</span><em>{fmt(total)}</em></div>
    </div>
  )
}

/**
 * A node's hourly profile stacked by its pieces, so one chart serves the node
 * and each of its pieces: with a piece open, its segments stay lit and the
 * rest fade. Hovering a segment names it, and lights its row in the tree and
 * its dot on the map, as hovering those lights it here; a click opens it.
 */
function StackProfile({ kind, pieces, hours, unit, current, hot, setHot, onSelect }) {
  const [seg, setSeg] = useState(null)
  const focus = seg || (hot?.kind === kind ? hot.id : null)
  const lit = (id) => (!current && !focus) || id === current || id === focus
  const data = Array.from({ length: 24 }, (_, h) => Object.fromEntries(
    [['h', h], ...pieces.map((s) => [s.id, s.values[h] || 0])]))
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={MARGIN}>
        <XAxis dataKey="h" tickFormatter={HOUR_LABEL} interval={3} tick={{ fontSize: 10 }} />
        <YAxis {...YAX} />
        <RTooltip {...TIP} cursor={CURSOR} isAnimationActive={false}
          content={<StackTip pieces={pieces} focus={focus} unit={unit} />} />
        {pieces.map((s) => (
          <Bar key={s.id} dataKey={s.id} stackId="p" isAnimationActive={false} cursor="pointer"
            onMouseEnter={() => { setSeg(s.id); if (MOUSE) setHot?.({ kind, id: s.id }) }}
            onMouseLeave={() => { setSeg(null); if (MOUSE) setHot?.(null) }}
            onClick={() => onSelect?.({ kind, id: s.id, ref: s.ref })}>
            {data.map((_, h) => (
              <Cell key={h} fill={s.fill} stroke="var(--panel)" strokeWidth={1}
                fillOpacity={(hours.includes(h) ? 1 : 0.32) * (lit(s.id) ? 1 : 0.25)
                  * (s.out ? 0.5 : 1)} />
            ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

const Profile = ({ values, hours, color, unit }) => (
  <ResponsiveContainer width="100%" height={130}>
    <BarChart data={values.map((v, h) => ({ h, v }))} margin={MARGIN}>
      <XAxis dataKey="h" tickFormatter={HOUR_LABEL} interval={3} tick={{ fontSize: 10 }} />
      <YAxis {...YAX} />
      <RTooltip {...TIP} cursor={CURSOR} content={<HourTip names={{ v: unit }} />} />
      <Bar dataKey="v">
        {values.map((_, h) => (
          <Cell key={h} fill={color} fillOpacity={hours.includes(h) ? 1 : 0.28} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>
)

const Breakdown = ({ title, obj, total }) => {
  // largest first; the "inne" remainder last, however big
  const rows = Object.entries(obj || {}).filter(([, v]) => v)
    .sort((a, b) => (a[0] === 'inne') - (b[0] === 'inne') || b[1] - a[1])
  if (!rows.length) return null
  const sum = total || rows.reduce((a, [, v]) => a + v, 0)
  return (
    <div className="breakdown">
      <h4>{title}</h4>
      {rows.map(([k, v]) => (
        <div key={k} className="bar">
          <span>{k}</span>
          <i style={{ width: `${(100 * v) / sum}%` }} />
          <b>{fmt(v)}</b>
        </div>
      ))}
    </div>
  )
}

const TRANSIT_MODES = MODES.filter((m) => m.key === 'bus' || m.key === 'tram')
const perVehicle = (x) => (x.veh
  ? (x.pax / x.veh).toLocaleString('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  : '—')

/**
 * What a transit point counted, by mode: the vehicles that stopped at its
 * poles, the people in them, and so how full they were - the figure a node
 * borrows. With several poles, each one's own as well, so a node's load can
 * be traced to the poles behind it; left-out ones stay listed, greyed.
 */
function TransitLoads({ title, refs, all, hours, scale = (v) => v }) {
  const tot = transitByMode(refs, hours)
  const poles = all || refs
  const modes = TRANSIT_MODES.filter((m) => poles
    .some((r) => transitByMode([r], hours)[m.key].veh > 0))
  if (!modes.length) return null
  const sum = { veh: tot.bus.veh + tot.tram.veh, pax: tot.bus.pax + tot.tram.pax }
  return (
    <div className="tloads">
      <h4>{title}</h4>
      <table className="split-table static">
        <thead>
          <tr><th /><th>pojazdy</th><th>pasażerowie</th><th>os./poj.</th><th>% pas.</th></tr>
        </thead>
        <tbody>
          {modes.map((m) => (
            <tr key={m.key}>
              <td><i style={{ background: m.color }} />{m.label}</td>
              <td>{fmt(scale(tot[m.key].veh))}</td>
              <td>{fmt(scale(tot[m.key].pax))}</td>
              <td className="pp">{perVehicle(tot[m.key])}</td>
              <td>{sum.pax ? Math.round((100 * tot[m.key].pax) / sum.pax) : '—'}</td>
            </tr>
          ))}
          {modes.length > 1 && (
            <tr className="sum">
              <td>Razem</td><td>{fmt(scale(sum.veh))}</td><td>{fmt(scale(sum.pax))}</td>
              <td className="pp">{perVehicle(sum)}</td><td>100</td>
            </tr>
          )}
        </tbody>
      </table>
      {poles.length > 1 && (
        <table className="split-table static poles">
          <thead>
            <tr>
              <th>słupki</th>
              {modes.map((m) => (
                <th key={m.key} colSpan={2}><i style={{ background: m.color }} />{m.label.toLowerCase()}</th>
              ))}
            </tr>
            <tr>
              <th />
              {modes.map((m) => <Fragment key={m.key}><th>poj.</th><th>os./poj.</th></Fragment>)}
            </tr>
          </thead>
          <tbody>
            {poles.map((r) => {
              const t = transitByMode([r], hours)
              const out = !refs.includes(r)
              return (
                <tr key={r.id} className={out ? 'out' : undefined}>
                  <td>
                    <b>{sectionLetter(r.id) || r.id}</b> {sectionOf('pt', r) || r.loc}
                    {out && <span className="partial"> — pominięty</span>}
                  </td>
                  {modes.map((m) => (
                    <Fragment key={m.key}>
                      <td>{t[m.key].veh ? fmt(scale(t[m.key].veh)) : '—'}</td>
                      <td className="pp">{t[m.key].veh ? perVehicle(t[m.key]) : ''}</td>
                    </Fragment>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Direction of travel, "W>E" = from west to east; the arrow points where they go.
const ARROW = { N: '↑', S: '↓', E: '→', W: '←', NE: '↗', NW: '↖', SE: '↘', SW: '↙' }
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' }
const dirLabel = (d) => {
  const to = d.includes('>') ? d.split('>')[1] : d
  return `${ARROW[to] || ''} ${d.replace('>', ' → ')}`.trim()
}

/**
 * Each section's directions side by side for the period: one bar per
 * section, split between its two directions. Shows tidal flows - a street
 * busy inbound in the morning and outbound in the afternoon - that a single
 * total hides. One-way sections have a single segment.
 */
function DirSplit({ title, rows }) {
  const shown = rows.filter((r) => r.dirs.some((d) => d.v > 0))
  if (!shown.length) return null
  return (
    <div className="dirsplit">
      <h4>{title}</h4>
      {shown.map((r) => {
        const sum = r.dirs.reduce((a, d) => a + d.v, 0)
        return (
          <div key={r.id} className="dir-row">
            <b>{r.letter}</b>
            <span className="dir-name" title={r.id}>{r.name}</span>
            <div className="dir-bar">
              {r.dirs.map((d, i) => (
                <i key={d.key} className={i ? 'b' : 'a'} style={{ flexGrow: d.v }} />
              ))}
            </div>
            <div className="dir-vals">
              {r.dirs.map((d, i) => (
                <span key={d.key} className={i ? 'b' : 'a'}>
                  {dirLabel(d.key)} <b>{fmt(d.v)}</b> · {sum ? Math.round((100 * d.v) / sum) : 0}%
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const GEO_NOTE = {
  intersections: 'położenie wyliczone ze skrzyżowań opisanych w kolumnie „Odcinek”',
  'one-intersection': 'położenie przybliżone — rozpoznano jedno skrzyżowanie',
  'cross-only': 'położenie przybliżone — tylko ulice poprzeczne',
  'street-centroid': 'położenie przybliżone — środek ulicy',
  'street-anchored': 'położenie przybliżone — fragment ulicy przy odcinku',
  'cross-centroid': 'położenie przybliżone — pomiędzy ulicami poprzecznymi',
  'street-near-cross': 'położenie przybliżone — ulica przy skrzyżowaniu',
  nominatim: 'położenie przybliżone — wyszukiwarka OSM',
  manual: 'położenie wskazane ręcznie (etl/overrides.json)',
  stop: 'położenie przystanku z OpenStreetMap',
  street: 'położenie przybliżone — środek ulicy',
  osm: 'stacja z OpenStreetMap',
  stations: 'środek ciężkości stacji kordonu',
  section: 'współrzędne z wykazu przekrojów',
  point: 'środek punktu pomiarowego',
}

const KICKER = {
  road: 'Punkt pomiaru ruchu drogowego',
  pt: 'Punkt pomiaru potoków pasażerskich',
  bike: 'Punkt pomiaru ruchu rowerowego',
  ped: 'Punkt pomiaru ruchu pieszego',
  rail: 'Kordon kolejowy',
  signal: 'Sygnalizacja świetlna',
}

const KBR = 'Kompleksowe Badania Ruchu Wrocław 2024'
const SOURCE_TEXT = {
  road: `${KBR}, zał. 3.3 — pomiary ruchu drogowego.`,
  pt: `${KBR}, zał. 6.4 — pomiary potoków pasażerskich w autobusach i tramwajach.`,
  bike: `${KBR}, zał. 3.4 — pomiary ruchu rowerowego.`,
  ped: `${KBR}, zał. 3.5 — pomiary ruchu pieszego.`,
  rail: `${KBR}, zał. 7.1 — potoki pasażerskie w pociągach.`,
  signal: 'OpenStreetMap (sygnalizacja), rozkład jazdy GTFS Wrocławia, model '
    + `natężenia ruchu na podstawie ${KBR}.`,
}

/** Copy the point as a picture, with a download for browsers that will not
 *  put images on the clipboard. */
function ShareButtons({ spec }) {
  const [state, setState] = useState(null)
  const settle = (s) => {
    setState(s)
    setTimeout(() => setState(null), 2800)
  }
  const copy = async () => {
    setState('busy')
    try { settle(await copyCard(spec)) } catch { settle('error') }
  }
  const download = async () => {
    try { await downloadCard(spec); settle('saved') } catch { settle('error') }
  }
  const share = async () => {
    try {
      const r = await shareCard(spec)
      if (r === 'shared') settle('shared')
    } catch { settle('error') }
  }
  // the address holds the whole view, this node and its left-out pieces
  const link = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      settle('linked')
    } catch { settle('error') }
  }
  return (
    <div className="share">
      {SHARE_FILES && (
        <button type="button" className="share-btn primary" onClick={share}>
          {state === 'shared' ? 'Udostępniono ✓' : 'Udostępnij'}
        </button>
      )}
      <button type="button" className="share-btn" onClick={copy} disabled={state === 'busy'}>
        {state === 'copied' ? 'Skopiowano ✓' : state === 'busy' ? 'Kopiuję…' : 'Kopiuj obraz'}
      </button>
      <button type="button" className="share-btn" onClick={download} title="Pobierz obraz PNG">
        Pobierz
      </button>
      <button type="button" className="share-btn" onClick={link}
        title="Kopiuj link do tego widoku">
        {state === 'linked' ? 'Link ✓' : 'Link'}
      </button>
      {state === 'downloaded' && <span className="share-msg">schowek niedostępny — pobrano plik</span>}
      {state === 'saved' && <span className="share-msg">pobrano plik</span>}
      {state === 'error' && <span className="share-msg err">nie udało się</span>}
    </div>
  )
}

/** Hours as runs, so 6-10 and 15-19 do not read as 6-19: "07:00–09:00, 15:00–17:00". */
function hourRuns(hours) {
  const runs = []
  for (const h of [...hours].sort((a, b) => a - b)) {
    if (runs.length && runs.at(-1)[1] === h - 1) runs.at(-1)[1] = h
    else runs.push([h, h])
  }
  return runs.map(([a, b]) => `${HL(a)}–${HL((b + 1) % 24)}`).join(', ')
}

// The survey writes a round-the-clock count as "00:00-00:00".
const hoursText = (s) => (/^0?0:00\s*-\s*0?0:00$/.test(s.trim()) ? 'całą dobę' : s)

/**
 * People, vehicles and road capacity as three bars of the same modes, so
 * "a fifth of the people, four fifths of the road" reads at a glance. The
 * car share is written on each bar; the rest are in the table above.
 */
function ShareBars({ split, pick }) {
  const rows = splitShares(split)
  // each segment wide enough for its number carries it; the thin ones are in
  // the table above and in their tooltip
  const [barW, setBarW] = useState(0)
  const watch = useRef(null)
  const measure = useCallback((el) => {
    watch.current?.disconnect()
    if (!el) return
    setBarW(el.clientWidth)
    watch.current = new ResizeObserver(([e]) => setBarW(e.contentRect.width))
    watch.current.observe(el)
  }, [])
  if (!rows) return null
  const shown = pick.active.size ? pick.active : new Set(['car'])
  const dim = (key) => pick.active.size > 0 && !pick.active.has(key)
  const fits = (p, parts) => {
    const w = (barW - 2 * (parts.length - 1)) * p.share
    return w >= `${Math.round(p.share * 100)}%`.length * 6.4 + 6
  }
  return (
    <div className="sharebars" role="table" aria-label="Udziały środków transportu">
      {rows.map((r) => {
        const sel = r.parts.filter((p) => shown.has(p.key))
        const sum = sel.reduce((a, p) => a + p.share, 0)
        return (
          <div key={r.key} className="sharebar" role="row">
            <span role="rowheader">{SHARE_ROW[r.key]}</span>
            <div className="bar" ref={r.key === 'persons' ? measure : undefined}>
              {r.parts.filter((p) => p.share > 0).map((p, _, parts) => (
                <i key={p.key} role="cell" {...pick.on(p.key)}
                  className={dim(p.key) ? 'dim' : undefined}
                  style={{ flexGrow: p.share, background: p.color, color: inkOn(p.color) }}
                  title={`${p.label}: ${Math.round(p.share * 100)}% (${SHARE_ROW[r.key]})`}>
                  {fits(p, parts) ? `${Math.round(p.share * 100)}%` : ''}
                </i>
              ))}
            </div>
            <b>
              {sel.map((p) => <i key={p.key} style={{ background: p.color }} />)}
              {Math.round(sum * 100)}%
            </b>
          </div>
        )
      })}
      <p className="hint">
        Liczba po prawej: samochody osobowe albo suma środków zaznaczonych na
        wykresie lub w tabeli — np. autobusy z tramwajami to cała komunikacja
        zbiorowa. Przepustowość w pojazdach
        umownych — {PCU_SOURCE}: rower 0,3, samochód 1, dostawczy 1,5,
        ciężarowy 2,5–3, autobus 2,5, tramwaj 3. To miara zajęcia przepustowości,
        nie powierzchni; tramwaj liczony jak na jezdni, także gdy ma własne torowisko.
      </p>
    </div>
  )
}

/**
 * The modal split as a ring, drawn by hand rather than with Recharts so the
 * picked slices can slide out and the rest fade with a CSS transition -
 * Recharts swaps its "active" shape in one frame.
 */
function Donut({ rows, active, pick }) {
  const R = 60
  const r = 30
  const c = 75
  const total = rows.reduce((a, s) => a + s.persons, 0)
  let a0 = -Math.PI / 2
  const pt = (rad, a) => `${(c + rad * Math.cos(a)).toFixed(2)},${(c + rad * Math.sin(a)).toFixed(2)}`
  return (
    <svg className="donut" width={2 * c} height={2 * c} viewBox={`0 0 ${2 * c} ${2 * c}`}
      role="img" aria-label="Podział modalny — osoby">
      {rows.filter((s) => s.persons > 0).map((s) => {
        const a1 = a0 + (2 * Math.PI * s.persons) / total
        const mid = (a0 + a1) / 2
        const large = a1 - a0 > Math.PI ? 1 : 0
        // a whole ring cannot be one arc; stop a hair short
        const end = a1 - a0 >= 2 * Math.PI - 1e-6 ? a1 - 1e-4 : a1
        const d = `M${pt(R, a0)} A${R},${R} 0 ${large} 1 ${pt(R, end)} `
          + `L${pt(r, end)} A${r},${r} 0 ${large} 0 ${pt(r, a0)} Z`
        a0 = a1
        const on = active.has(s.key)
        return (
          <path key={s.key} d={d} fill={s.color} {...pick.on(s.key)}
            className={on ? 'on' : active.size ? 'dim' : undefined}
            style={{ '--dx': `${(6 * Math.cos(mid)).toFixed(2)}px`,
              '--dy': `${(6 * Math.sin(mid)).toFixed(2)}px` }}>
            <title>{`${s.label}: ${Math.round((100 * s.persons) / total)}%`}</title>
          </path>
        )
      })}
    </svg>
  )
}

/** Modal split of a node, in people, with the vehicles it came from. */
function ModalSplit({ node, data, occupancy }) {
  const { split } = node
  const total = splitTotal(split)
  // each mode's share of the vehicles beside its share of the people: a car
  // is most of the traffic and a smaller part of who travels
  const vehTotal = splitVehicles(split)
  const rows = split.slices.filter((s) => s.persons > 0 || s.vehicles > 0)
  const span = split.hours.length ? `${split.hours.length} godz. (${hourRuns(split.hours)})` : 'brak'
  // the stop survey's load applied beyond the hours it was measured in
  const beyond = (split.loadHours || []).length
    && split.hours.some((h) => !split.loadHours.includes(h))
  const occ = data.transitOcc
  // Modes can be picked, several at once: a click or tap adds or drops one,
  // and hovering previews what a click would add. The donut, the table and
  // the bars all follow, and the bars sum the picked shares - buses and trams
  // together are the whole of public transport.
  const [hover, setHover] = useState(null)
  const [pinned, setPinned] = useState(() => new Set())
  const active = MOUSE && hover && !pinned.has(hover) ? new Set([...pinned, hover]) : pinned
  const toggle = (key) => setPinned((p) => {
    const n = new Set(p)
    if (n.has(key)) n.delete(key)
    else n.add(key)
    return n
  })
  const pick = {
    active,
    on: (key) => ({
      onMouseEnter: MOUSE ? () => setHover(key) : undefined,
      onMouseLeave: MOUSE ? () => setHover(null) : undefined,
      onClick: () => toggle(key),
    }),
  }
  return (
    <div className="split">
      <h4>
        Podział modalny — osoby
        {node.piece && ` · ${node.piece.kind === 'pt' ? 'przystanek' : 'przekrój'} `
          + `${sectionLetter(node.piece.id) || node.piece.id}`}
      </h4>
      {!total ? (
        <p className="hint">
          Brak danych w wybranym okresie
          {split.basis === 'transit' ? ' — pasażerów liczono tylko 5–9 i 14–18.' : '.'}
        </p>
      ) : (
        <>
          <div className="split-body">
            <Donut rows={rows} active={active} pick={pick} />
            <table className="split-table">
              <thead>
                <tr>
                  <th /><th>osoby</th><th>% osób</th>
                  {vehTotal > 0 && <><th>pojazdy</th><th>% poj.</th></>}
                </tr>
              </thead>
              <tbody>
                {[...rows].sort((a, b) => b.persons - a.persons).map((s) => (
                  <tr key={s.key} {...pick.on(s.key)} tabIndex={0} aria-pressed={pinned.has(s.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(s.key) }
                    }}
                    className={active.has(s.key) ? 'on' : active.size ? 'dim' : undefined}>
                    <td><i style={{ background: s.color }} />{s.label}</td>
                    <td>{s.est ? fmtEst(s.persons) : fmt(s.persons)}</td>
                    <td className="pp">{Math.round((100 * s.persons) / total)}</td>
                    {vehTotal > 0 && (
                      <>
                        <td className="veh">{s.vehicles == null ? '' : fmt(s.vehicles)}</td>
                        <td className="vp">{s.vehicles == null ? ''
                          : Math.round((100 * s.vehicles) / vehTotal)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">Liczone dla {span}.</p>
          <ShareBars split={split} pick={pick} />
        </>
      )}
      <ul className="split-notes">
        {split.basis === 'measured' && (
          <li>
            Autobusy i tramwaje: pojazdy policzone na przekrojach drogowych ×
            średnie napełnienie ze wszystkich zaznaczonych słupków punktu KZ{' '}
            <b>{node.pair.title}</b> ({node.pair.dist} m stąd): autobus {split.load.bus.toFixed(1)}
            {split.local.bus ? '' : ' (średnia miejska)'}, tramwaj{' '}
            {split.load.tram.toFixed(1)}{split.local.tram ? '' : ' (średnia miejska)'}{' '}
            os./poj., zmierzone w godzinach {hourRuns(split.loadHours)}
            {beyond ? ' i przyjęte także dla pozostałych godzin okresu — poza nimi to założenie' : ''}.
            {thinText(split) && ` Średnia miejska tam, gdzie próba była za mała (${thinText(split)}).`}
            {' '}Surowej liczby pasażerów z punktu KZ nie dodajemy, bo jego słupki
            stoją też przy innych ulicach i kierunkach niż przekroje drogowe —
            tabela poniżej pokazuje każdy słupek; te, które nie pasują do
            wybranych przekrojów, można odznaczyć w drzewie.
          </li>
        )}
        {split.basis === 'estimate' && (
          <li>
            Autobusy i tramwaje:{' '}
            {!node.pair ? 'brak punktu pomiaru KZ w promieniu 150 m, więc'
              : !node.pair.refs.length ? `przystanki punktu KZ ${node.pair.title} są pominięte, więc`
              : thinText(split) ? `w punkcie KZ ${node.pair.title} próba była za mała `
                + `(${thinText(split)}), więc`
                : `punkt KZ ${node.pair.title} nie zarejestrował autobusów ani tramwajów, więc`}
            {' '}liczba pojazdów × średnie napełnienie z pomiarów KBR (autobus{' '}
            {occ.bus.toFixed(1)}, tramwaj {occ.tram.toFixed(1)} os./poj.) — szacunek.
          </li>
        )}
        {split.basis !== 'transit' && (
          <>
            <li>
              Samochody osobowe × {occupancy.toFixed(2)} os./poj.
              {Math.abs(occupancy - data.meta.carOccupancy.default) < 1e-9
                ? ' — KBR 2024, badanie ankietowe (zał. 2.2).'
                : ' — wartość ustawiona ręcznie w ustawieniach zaawansowanych.'}
            </li>
            <li>
              Dostawcze, ciężarowe, motocykle i mikrobusy liczone tylko
              z kierowcą — dolne oszacowanie.
            </li>
            {bikeNote(data, node, split) && <li>{bikeNote(data, node, split)}</li>}
            <li>{pedNote(data, node, split)}</li>
          </>
        )}
        {split.basis === 'transit' && (
          <li>
            {node.piece?.kind === 'pt'
              ? 'Tylko ten przystanek: pasażerowie autobusów i tramwajów zmierzeni na jego słupku.'
              : 'Węzeł bez przekroju drogowego w promieniu 150 m — widać tylko podział '
                + 'między autobus i tramwaj.'}
          </li>
        )}
      </ul>
      {node.pair && split.basis !== 'transit' && split.loadHours?.length > 0 && (
        <TransitLoads refs={node.pair.refs} all={node.pair.all} hours={split.loadHours}
          title={`Słupki punktu KZ ${node.pair.id} — ${hourRuns(split.loadHours)}`} />
      )}
    </div>
  )
}

/** Unit for a layer's headline number; the road one depends on toggles, so
 *  Details wraps it in `unit()`. */
function unitOf(kind) {
  return { road: 'pojazdów', pt: 'pasażerów', bike: 'rowerzystów', ped: 'pieszych',
    rail: 'pasażerów' }[kind] || ''
}

export default function Details({
  data, sel, hours, metric, period, share, wholeDay, people, occupancy,
  markers, family, onSelect, onClose, off, toggleOff, hot, setHot,
}) {
  const { kind, ref: p } = sel
  // phones: the panel is a bottom sheet; dragging its header down closes it
  const sheet = useSheetDrag(true, (open) => { if (!open) onClose() })
  // The drawn node carries the modal split and its transit partner, if any.
  const node = markers ? markerIndex(markers)[`${kind}:${sel.id}`] : null
  const color = LAYERS[kind]?.color || '#f4a261'
  const catOrder = data.meta.vehCatOrder

  // The map applies the whole-day expansion and the vehicles-to-people
  // conversion before drawing. This panel has to apply exactly the same pair,
  // or the number here contradicts the marker that was clicked to open it.
  const wk = windowKind(kind, p)
  const shown = (v, k = kind) =>
    toPeople(expand(data.meta, k === kind ? wk : k, v, wholeDay), k, occupancy, people)
  const shape = (arr, k = kind) => arr.map((v) => shown(v, k))
  const exp = expansionOf(data.meta, wk)
  const scaled = wholeDay && exp?.factor > 1
  const unit = (k) => (k === 'road'
    ? (people ? 'osób w samochodach osobowych' : `pojazdów — ${ROAD_METRICS[metric].label.toLowerCase()}`)
    : unitOf(k))

  // A section's directions in the period, in the panel's unit. Road sections
  // record each direction separately; cyclists and pedestrians by direction
  // of travel. Transit directions are destinations, not ways along a street,
  // so they are listed rather than split.
  const dirsOf = (k, ref) => {
    if (k === 'road') {
      const sec = data.roadById[ref.id]
      if (!sec) return []
      const cats = activeCats(metric, people)
      const keep = cats
        ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0)
        : catOrder.map((_, i) => i)
      return Object.entries(sec.dirs).map(([d, dd]) => ({
        key: d,
        v: shown(hours.reduce((a, h) => a + keep.reduce((x, i) => x + (dd.h[h]?.[i] || 0), 0), 0), k),
      }))
    }
    if (k === 'bike' || k === 'ped') {
      // 3.4 and 3.5 record the side people came from ("wlot początkowy"), so
      // "E" is someone heading west; spelled as from > to like the road keys
      return Object.entries(ref.byHourDir || {}).map(([d, arr]) => ({
        key: OPPOSITE[d] ? `${d}>${OPPOSITE[d]}` : d, v: shown(sumHours(arr, hours), k),
      }))
    }
    return []
  }
  // Hours of the period this piece was actually counted in. A count of 0 in
  // an hour nobody measured is "no data", not "no traffic".
  const coveredOf = (k, ref) => {
    if (ref.aggregate) {
      return hours.filter((h) => ref.members.some((m) => coveredOf(k, m).includes(h)))
    }
    if (k === 'road') {
      const sec = data.roadById[ref.id]
      return hours.filter((h) => Object.values(sec?.dirs || {})
        .some((dd) => (dd.h[h] || []).some((x) => x > 0)))
    }
    const w = data.meta.windows?.[windowKind(k, ref)]
    return w ? hours.filter((h) => w.includes(h)) : hours
  }
  const covered = kind === 'signal' ? hours : coveredOf(kind, p)
  /** The period figure, or why there is none. */
  const now = (text) => {
    if (!covered.length) return <dd className="now gap">brak pomiaru w tym okresie</dd>
    return (
      <dd className="now">
        {text}
        {!scaled && covered.length < hours.length && (
          <span className="partial"> — zmierzono {covered.length} z {hours.length} godz.</span>
        )}
      </dd>
    )
  }
  const dirRow = (k, m) => ({
    id: m.id,
    letter: sectionLetter(m.id) || '—',
    name: k === 'road' ? m.name : sectionOf(k, m) || m.name,
    dirs: dirsOf(k, m),
  })
  // transit passengers by destination or line, summed over hours and sections
  const perPeriod = (refs, field) => {
    const out = {}
    for (const r of refs) {
      for (const [key, arr] of Object.entries(r[field] || {})) {
        out[key] = (out[key] || 0) + shown(sumHours(arr, hours), 'pt')
      }
    }
    return out
  }

  // Each piece's share of its own group in the period, for the tabs and the
  // piece view. Same metric and units as everything else in the panel.
  const fam = family && onSelect ? family : null
  const shares = {}
  let part = null
  // Under a modal-split pie the road sections' shares are of all vehicles,
  // not of car occupants, which would say little about the junction.
  const allVehicles = !!fam?.node?.split
  for (const g of fam?.groups || []) {
    const profs = g.members.map((m) => (g.kind === 'road' && allVehicles
      ? profileFor(data, 'road', m, 'all', false)
      : shape(profileFor(data, g.kind, m, metric, people), g.kind)))
    const vals = profs.map((pr) => sumHours(pr, hours))
    // pieces left out of the node are not part of what the shares divide
    const isIn = g.members.map((m) => !fam.node || !off?.has(pieceKey(g.kind, m.id)))
    const sum = vals.reduce((x, y, j) => x + (isIn[j] ? y : 0), 0)
    g.members.forEach((m, j) => {
      shares[pieceKey(g.kind, m.id)] = sum && isIn[j] ? Math.round((100 * vals[j]) / sum) : null
    })
    const i = fam.current?.kind === g.kind
      ? g.members.findIndex((m) => m.id === fam.current.id) : -1
    if (i >= 0) {
      part = {
        g, i, val: vals[i], sum, share: shares[pieceKey(g.kind, g.members[i].id)],
        out: !isIn[i],
        unit: g.kind === 'road' && allVehicles ? 'pojazdów, wszystkie kategorie' : unit(g.kind),
      }
    }
  }

  // The node's pie stays in its place with a piece open, drawn for that piece
  // alone: a road section with the node's stop loads, a stop as its own
  // buses and trams.
  const occ = occupancy ?? data.meta.carOccupancy.default
  let splitNode = node?.split ? node : null
  if (!splitNode && fam?.node?.split && fam.current && (kind === 'road' || kind === 'pt')) {
    const split = kind === 'road'
      ? nodeSplit(data, { roadIds: [p.id], ptRefs: fam.node.pair?.refs ?? null, hours, occupancy: occ })
      : nodeSplit(data, { roadIds: [], ptRefs: [p], hours, occupancy: occ })
    splitNode = { ...fam.node, id: p.id, ref: p, split, piece: { kind, id: p.id } }
  }

  // The hourly profile, stacked by the node's pieces of this kind where it
  // has several - the same chart for the node and for each piece, the open
  // piece lit. Left-out pieces drop out of the stack unless one is open.
  const stackGroup = fam?.groups.find((g) => g.kind === kind && g.members.length > 1)
  const stack = stackGroup && stackGroup.members
    .filter((m) => !fam.node || !off?.has(pieceKey(kind, m.id)) || m.id === fam.current?.id)
    .map((m, i) => ({
      id: m.id, ref: m, letter: sectionLetter(m.id) || m.id,
      name: (kind === 'road' ? m.name : sectionOf(kind, m)) || m.name,
      values: shape(profileFor(data, kind, m, metric, people)),
      fill: shade(color, i),
      out: !!fam.node && !!off?.has(pieceKey(kind, m.id)),
    }))
  const chart = (values) => (stack ? (
    <StackProfile kind={kind} pieces={stack} hours={hours} unit={unit(kind)}
      current={fam.current?.kind === kind ? fam.current.id : null}
      hot={hot} setHot={setHot} onSelect={onSelect} />
  ) : <Profile values={values} hours={hours} color={color} unit={unit(kind)} />)
  // a piece's chart is its whole point, so the heading says which is lit
  const chartFor = (what) => (stack && fam.current
    ? `Profil dobowy — ${what}: punkt ${fam.node?.id || fam.parent}, `
      + `${sectionLetter(fam.current.id) || fam.current.id} wyróżniony`
    : `Profil dobowy — ${what}`)

  let body = null
  // what the shareable picture shows when there is no modal split
  let cardBig = null
  let cardProfile = null
  const cardNotes = []

  if (kind === 'signal') {
    cardBig = { value: fmtEst(p.v * (share ?? 1)), unit: 'pojazdów na wlotach — szacunek z modelu' }
    cardNotes.push(
      `${p.kind === 'crossing' ? 'Samodzielne przejście dla pieszych z sygnalizacją'
        : `Skrzyżowanie, ${p.arms} wloty`}; ulice: ${p.streets.join(', ') || '—'}.`,
      p.runs ? `Komunikacja zbiorowa: ${fmt(p.runs)} kursów w oknie 6–10 i 15–19`
        + `${p.tram ? ', w tym tramwaj' : ''}.` : 'Brak komunikacji zbiorowej.',
      'Natężenie pochodzi z modelu (mediana błędu 24%), nie z pomiaru. O wyłączeniu '
        + 'sygnalizacji decydują też widoczność, przejścia dla pieszych, priorytet '
        + 'tramwaju i historia zdarzeń.',
    )
    body = (
      <>
        <dl>
          <dt>Rodzaj</dt>
          <dd>{p.kind === 'crossing'
            ? 'samodzielne przejście dla pieszych z sygnalizacją'
            : `skrzyżowanie, ${p.arms} wloty`}</dd>
          <dt>Ulice</dt><dd>{p.streets.join(', ') || '—'}</dd>
          <dt>Klasa</dt><dd>{p.c}{p.minor ? ' · same ulice lokalne' : ''}</dd>
          <dt>Sygnalizatorów</dt><dd>{p.n}</dd>
          <dt>Ruch (model, {period})</dt>
          <dd>{fmtEst(p.v * (share ?? 1))} poj.</dd>
          <dt>Komunikacja zbiorowa</dt>
          <dd>{p.runs ? `${fmt(p.runs)} kursów w oknie 6–10 i 15–19` : 'brak'}
            {p.tram ? ' · w tym tramwaj' : ''}</dd>
          {p.near && (
            <>
              <dt>Najbliższy pomiar</dt>
              <dd>ruch {p.near.kind}: {p.near.id}, {fmt(p.near.total)} os.,
                {' '}{p.near.dist} m stąd</dd>
            </>
          )}
        </dl>
        {p.minor && !p.tram && p.kind === 'junction' && (
          <p className="warn">
            Wszystkie wloty to ulice lokalne i nie jeździ tędy tramwaj — warto
            sprawdzić, czy sygnalizacja jest tu potrzebna.
          </p>
        )}
        <p className="hint">
          Natężenie pochodzi z modelu (mediana błędu 24%), nie z pomiaru.
          O możliwości wyłączenia sygnalizacji decydują też widoczność,
          przejścia dla pieszych, priorytet tramwaju i historia zdarzeń.
        </p>
      </>
    )
  } else if (p.aggregate) {
    const profs = p.members.map((m) => shape(profileFor(data, kind, m, metric, people)))
    // transit: the share of passengers seen twice, at two poles of the point
    const ptTot = kind === 'pt' ? transitByMode(p.members, hours) : null
    const ptRepeat = ptTot && ptTot.bus.pax + ptTot.tram.pax > 0
      ? ptTot.repeat / (ptTot.bus.pax + ptTot.tram.pax) : 0
    const total = addProfiles(profs)
    cardBig = { value: fmt(sumHours(total, hours)), unit: unit(kind) }
    cardProfile = total
    // a split card says it in the split's own notes
    if (p.repeatsStreet && !node?.split) {
      cardNotes.push('Przekroje leżą po obu stronach jednego skrzyżowania, więc jadący '
        + 'na wprost są liczeni dwa razy — suma zawyża ruch przez węzeł.')
    }
    const bySection = Object.fromEntries(
      p.members.map((m, i) => [
        `${sectionLetter(m.id) || m.id} — ${sectionOf(kind, m) || m.name}`,
        sumHours(profs[i], hours),
      ]),
    )
    body = (
      <>
        <dl>
          <dt>Przekroje</dt>
          <dd>
            {p.members.map((m) => m.id).join(', ')}
            {p.all.length > p.members.length && (
              <span className="partial">
                {' '}— pominięte: {p.all.filter((m) => !p.members.includes(m))
                  .map((m) => m.id).join(', ')}
              </span>
            )}
          </dd>
          <dt className="now">W okresie {period}</dt>
          {now(node?.split && splitTotal(node.split) > 0
            ? `${fmtEst(splitTotal(node.split))} osób — wszystkie środki`
            : `${fmt(sumHours(total, hours))} ${unit(kind)}`)}
          {node?.split && splitTotal(node.split) > 0 && (
            <>
              <dt className="whole">w tym ruch drogowy</dt>
              <dd className="whole">{fmt(sumHours(total, hours))} {unit(kind)}</dd>
            </>
          )}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">{fmt(total.reduce((a, b) => a + b, 0))} {unit(kind)}</dd>
        </dl>
        {kind === 'pt' ? (
          <p className="hint">
            Punkt KZ jako całość: pasażerowie w pojazdach, które zatrzymały się
            na badanych słupkach, zsumowani po słupkach. Słupki stoją przy
            różnych ulicach i w różnych kierunkach, więc ta suma nie odpowiada
            przekrojom drogowym pobliskiego węzła.
            {ptRepeat >= 0.01 && ` Ok. ${Math.round(ptRepeat * 100)}% to pasażerowie pojazdów `
              + 'widzianych na dwóch słupkach tego punktu — liczeni dwa razy.'}
          </p>
        ) : p.repeatsStreet ? (
          <p className="warn">
            Przekroje leżą na tej samej ulicy po obu stronach skrzyżowania, więc
            pojazd jadący na wprost jest liczony dwa razy. Suma zawyża ruch przez
            węzeł; udziały (%) w podziale modalnym pozostają porównywalne.
          </p>
        ) : (
          <p className="hint">
            Punkt pomiarowy widziany jako całość. Przekroje to różne ulice
            przecinające linię pomiaru, więc ich suma to cały ruch przez tę linię.
          </p>
        )}
        <h4>Profil dobowy — cały punkt{stack ? ' po częściach' : ''}</h4>
        {chart(total)}
        <Breakdown title={`Udział przekrojów — ${period}`} obj={bySection} />
        {kind === 'pt' ? (
          <>
            <TransitLoads refs={p.members} hours={hours} scale={(v) => shown(v, 'pt')}
              title={`Pojazdy i napełnienie — ${period}`} />
            <Breakdown title={`Kierunki (pasażerowie) — ${period}`}
              obj={perPeriod(p.members, 'byHourDir')} />
            <Breakdown title={`Linie (pasażerowie) — ${period}`}
              obj={perPeriod(p.members, 'byHourLine')} />
          </>
        ) : (
          <DirSplit title={`Kierunki przekrojów — ${period} (${unit(kind)})`}
            rows={p.members.map((m) => dirRow(kind, m))} />
        )}
      </>
    )
  } else if (kind === 'road') {
    const sec = data.roadById[p.id]
    const cats = activeCats(metric, people)
    const prof = shape(roadProfile(sec, { cats }, catOrder))
    cardBig = { value: fmt(sumHours(prof, hours)), unit: unit('road') }
    cardProfile = prof
    const keep = cats
      ? cats.map((c) => catOrder.indexOf(c)).filter((i) => i >= 0)
      : catOrder.map((_, i) => i)
    const byCat = {}
    if (sec) {
      for (const dd of Object.values(sec.dirs)) {
        for (let h = 0; h < 24; h++) {
          if (!hours.includes(h)) continue
          for (const i of keep) {
            const label = data.meta.vehCats[catOrder[i]] || catOrder[i]
            byCat[label] = (byCat[label] || 0) + shown(dd.h[h][i])
          }
        }
      }
    }
    const off = {}
    if (sec?.off) {
      for (const rows of Object.values(sec.off)) {
        for (let h = 0; h < 24; h++) {
          if (!hours.includes(h)) continue
          rows[h].forEach((v, i) => {
            const label = data.meta.vehCats[data.meta.offCatOrder[i]] || data.meta.offCatOrder[i]
            off[label] = (off[label] || 0) + v
          })
        }
      }
    }
    body = (
      <>
        <dl>
          <dt>Obszar</dt><dd>{p.area}</dd>
          <dt>Odcinek</dt><dd>{p.segment}</dd>
          <dt>Miejsce pomiaru</dt><dd>{p.where}</dd>
          <dt>Data</dt><dd>{p.date}{p.hours ? ` · ${hoursText(p.hours)}` : ''}</dd>
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(sumHours(prof, hours))} ${unit('road')}`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">
            {fmt(p.total)} pojazdów, wszystkie kategorie
            {p.window ? ' — tylko 6–10 i 15–19, nie cała doba' : ''}
          </dd>
        </dl>
        <h4>
          {chartFor(people ? 'osoby w samochodach osobowych'
            : ROAD_METRICS[metric].label.toLowerCase())}
        </h4>
        {chart(prof)}
        <DirSplit title={`Kierunki — ${period} (${unit('road')})`} rows={[dirRow('road', p)]} />
        <Breakdown title={`Kategorie pojazdów — ${period}`} obj={byCat} />
        <Breakdown title="Poza jezdnią — rowery i UTO" obj={off} />
      </>
    )
  } else if (kind === 'bike' || kind === 'ped') {
    cardBig = { value: fmt(shown(sumHours(p.byHour, hours))), unit: unit(kind) }
    cardProfile = shape(p.byHour)
    if (GEO_NOTE[p.geo]) cardNotes.push(`Położenie: ${GEO_NOTE[p.geo]}.`)
    body = (
      <>
        <dl>
          <dt>Odcinek</dt><dd>{p.segment}</dd>
          {p.where?.length ? <><dt>Miejsce</dt><dd>{p.where.join('; ')}</dd></> : null}
          {p.date ? <><dt>Pomiar</dt><dd>{p.date}{p.hours ? ` · ${p.hours}` : ''}</dd></> : null}
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(shown(sumHours(p.byHour, hours)))} ${unit(kind)}`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">{fmt(p.total)}{p.hours ? ` (${p.hours})` : ''}</dd>
        </dl>
        <h4>{chartFor(unit(kind))}</h4>
        {chart(shape(p.byHour))}
        {p.byHourDir
          ? <DirSplit title={`Kierunki — ${period}`} rows={[dirRow(kind, p)]} />
          : <Breakdown title="Kierunki — cały pomiar" obj={p.byDir} />}
        <Breakdown title="Płeć — cały pomiar" obj={p.bySex} />
        {kind === 'bike' && <Breakdown title="Gdzie jadą — cały pomiar" obj={p.byPlace} />}
        {kind === 'bike' && <Breakdown title="Pojazd — cały pomiar" obj={p.byMode} />}
        {kind === 'bike' && <Breakdown title="Kask — cały pomiar" obj={p.helmet} />}
        {kind === 'ped' && <Breakdown title="Sprawność — cały pomiar" obj={p.byMobility} />}
        {kind === 'ped' && <Breakdown title="Cechy dodatkowe — cały pomiar" obj={p.byMobility2} />}
        {kind === 'ped' && <Breakdown title="Strona ulicy — cały pomiar" obj={p.bySide} />}
      </>
    )
  } else if (kind === 'pt') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    const vehNow = Object.values(p.vehByHour || {}).reduce((a, arr) => a + sumHours(arr, hours), 0)
    cardBig = { value: fmt(sumHours(shape(prof), hours)), unit: unit('pt') }
    cardProfile = shape(prof)
    body = (
      <>
        <dl>
          <dt>Przystanek</dt><dd>{p.stop || '—'}</dd>
          <dt>Lokalizacja</dt><dd>{p.loc}</dd>
          <dt>Osiedle</dt><dd>{p.osiedle || '—'}</dd>
          <dt>Pomiar</dt><dd>{p.dates.join(', ')}</dd>
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(sumHours(shape(prof), hours))} pasażerów w ${fmt(vehNow)} pojazdach`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">
            {fmt(p.pax)} pasażerów w {fmt(p.veh)} pojazdach
            {' '}({hourRuns(Array.from({ length: 24 }, (_, h) => h).filter((h) =>
              Object.values(p.vehByHour || {}).some((arr) => arr[h] > 0)))})
          </dd>
          <dt className="whole">Średnie wykorzystanie miejsc</dt>
          <dd className="whole">{pct(p.avgLoad)} — cały pomiar</dd>
          {p.boarded ? (
            <>
              <dt className="whole">Wsiadło / wysiadło</dt>
              <dd className="whole">
                {fmt(p.boarded)} / {fmt(p.alighted)} — cały pomiar, tylko część kursów
              </dd>
            </>
          ) : null}
        </dl>
        <h4>{chartFor('pasażerowie')}</h4>
        {chart(shape(prof))}
        <TransitLoads refs={[p]} hours={hours} scale={(v) => shown(v, 'pt')}
          title={`Pojazdy i napełnienie — ${period}`} />
        <Breakdown title={`Kierunki (pasażerowie) — ${period}`} obj={perPeriod([p], 'byHourDir')} />
        <Breakdown title={`Linie (pasażerowie) — ${period}`} obj={perPeriod([p], 'byHourLine')} />
        <Breakdown title="Przewoźnicy (liczba pojazdów) — cały pomiar" obj={p.byCarrier} />
      </>
    )
  } else if (kind === 'rail') {
    const prof = new Array(24).fill(0)
    Object.values(p.byHour).forEach((arr) => arr.forEach((v, h) => { prof[h] += v }))
    cardBig = { value: fmt(sumHours(shape(prof), hours)), unit: unit('rail') }
    cardProfile = shape(prof)
    body = (
      <>
        <dl>
          <dt>Stacje kordonu</dt><dd>{p.stations.join(', ')}</dd>
          <dt>Pomiar</dt><dd>{p.dates.join(', ')}</dd>
          <dt className="now">W okresie {period}</dt>
          {now(`${fmt(sumHours(shape(prof), hours))} pasażerów`)}
          <dt className="whole">Cały pomiar</dt>
          <dd className="whole">
            {Object.entries(p.pax).map(([d, v]) => `${d}: ${fmt(v)}`).join(' · ')}
            {' '}w {p.trains} pociągach
          </dd>
        </dl>
        <h4>Profil dobowy — pasażerowie</h4>
        <Profile values={shape(prof)} hours={hours} color={color} unit={unit(kind)} />
        <Breakdown title={`Kierunek — ${period}`} obj={Object.fromEntries(
          Object.entries(p.byHour).map(([d, arr]) => [d, shown(sumHours(arr, hours))]))} />
        <Breakdown title="Miejsca w pociągach — cały pomiar" obj={p.seats} />
        <Breakdown title="Przewoźnicy (kursy) — cały pomiar" obj={p.carriers} />
      </>
    )
  }

  const pill = kind === 'signal' ? (p.kind === 'crossing' ? 'przejście' : 'skrzyżowanie') : p.id
  const title = p.name || p.stop || p.stations?.join(' / ')
    || p.streets?.join(' × ') || 'sygnalizacja'
  if (scaled) {
    cardNotes.push(`Wartości przeliczone na całą dobę (×${exp.factor}, `
      + `${BASIS_LABEL[exp.basis]}) — pomiar obejmował tylko szczyty.`)
  } else if (!node?.split && coverageGap(data.meta, wk, hours)) {
    cardNotes.push('Pomiar tylko w szczytach — część godzin wybranego okresu nie była mierzona.')
  }
  const split = splitNode && splitTotal(splitNode.split) > 0 ? splitNode.split : null
  const spec = {
    id: pill,
    kicker: `${split && !splitNode.piece ? 'Węzeł pomiarowy' : KICKER[kind] || 'Punkt'} · ${pill}`,
    title,
    subtitle: node?.sub || p.segment || p.loc || '',
    period,
    accent: split ? '#e4572e' : color,
    split, pair: splitNode?.pair, repeats: !!p.repeatsStreet,
    bikeNote: split && split.basis !== 'transit' ? bikeNote(data, splitNode, split) : null,
    pedNote: split && split.basis !== 'transit' ? pedNote(data, splitNode, split) : null,
    occupancy, occupancyDefault: data.meta.carOccupancy.default,
    occupancyQuote: data.meta.carOccupancy.value, occ: data.transitOcc,
    big: cardBig,
    profile: cardProfile ? { values: cardProfile, hours, color } : null,
    notes: cardNotes,
    source: split
      ? (split.basis === 'transit' ? SOURCE_TEXT.pt
        : `${KBR}: zał. 3.3 (ruch drogowy), zał. 6.4 (potoki pasażerskie), `
          + 'zał. 2.2 do Raportu II (napełnienie samochodów) — bip.um.wroc.pl.')
      : SOURCE_TEXT[kind] || KBR,
  }

  return (
    <div className={sheet.dy != null ? 'details dragging' : 'details'}
      style={sheet.dy != null ? { transform: `translateY(${sheet.dy}px)` } : undefined}>
      <div className="dhead" style={{ borderColor: color }} {...sheet.handlers}>
        <div>
          <span className="pill" style={{ background: color }}>{pill}</span>
          <h3>{title}</h3>
          <ShareButtons spec={spec} />
        </div>
        <button onClick={onClose}>×</button>
      </div>
      <div className="dbody">
        {fam && (
          <NodeTree family={fam} shares={shares} onSelect={onSelect}
            off={off || NO_OFF} toggleOff={toggleOff} hot={hot} setHot={setHot} />
        )}
        {splitNode && (
          <ModalSplit key={splitNode.id} node={splitNode} data={data} occupancy={occ} />
        )}
        {part && (
          <div className="part">
            <h4>
              Część węzła {fam.node?.id || fam.parent}
              {' — '}{GROUP_LABEL[part.g.kind].toLowerCase()}
            </h4>
            {part.out ? (
              <p>
                {part.g.kind === 'pt' ? 'Przystanek' : 'Przekrój'}{' '}
                {sectionLetter(fam.current.id) || fam.current.id} jest{' '}
                <b>pominięty</b> w liczbach węzła. W okresie {period}:{' '}
                {fmt(part.val)} ({part.unit}), wobec {fmt(part.sum)} w pozostałej części grupy.
              </p>
            ) : (
              <p>
                {part.g.kind === 'pt' ? 'Przystanek' : 'Przekrój'}{' '}
                {sectionLetter(fam.current.id) || fam.current.id} to{' '}
                <b>{part.sum ? `${part.share}%` : '—'}</b> tej grupy w okresie {period}:
                {' '}{fmt(part.val)} z {fmt(part.sum)} ({part.unit}).
              </p>
            )}
          </div>
        )}
        {body}
        {scaled && (
          <p className="warn">
            Wartości przeliczone na całą dobę (×{exp.factor},{' '}
            {BASIS_LABEL[exp.basis]}). Pomiar obejmował tylko szczyty.
          </p>
        )}
        {p.geo && GEO_NOTE[p.geo] && <p className="geo">📍 {GEO_NOTE[p.geo]}</p>}
      </div>
    </div>
  )
}
