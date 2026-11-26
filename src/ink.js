// What stands out on the map underneath: white on a dark one, near black on a
// light one. Set by the app as the basemap changes; read while drawing.
let dark = false
export const setInkDark = (d) => { dark = d }
/** A line or outline that must show over anything. */
export const ink = () => (dark ? '#ffffff' : '#11151c')

// The page's own theme, for what is drawn on its panels: an order of colours
// runs dark to light on a dark page, light to dark on a light one.
let page = false
export const setUiDark = (d) => { page = d }
export const uiDark = () => page
/** Fills stand off a light map less: more of them. */
export const fillBoost = () => (dark ? 1 : 1.35)
