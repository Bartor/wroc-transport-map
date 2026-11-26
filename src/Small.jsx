// The mark of a number that rests on few people.
export const FEW_TRIPS = 20
export const FEW_ANSWERS = 30

export const isSmall = (n, few = FEW_TRIPS) => n != null && n > 0 && n < few
/** For plain text: labels on the map and pictures. */
export const smallText = (n, few) => (isSmall(n, few) ? ' (!)' : '')

/** "(!)" beside a number, saying why when pointed at. */
export function Small({ n, few = FEW_TRIPS }) {
  return isSmall(n, few) && (
    <abbr title={`Mała próba: ${n} — wartość orientacyjna (poniżej ${few})`} aria-label={`mała próba: ${n}`}
      style={{ color: 'var(--kit-warn)', fontWeight: 700, textDecoration: 'none', cursor: 'help' }}> (!)</abbr>
  )
}
