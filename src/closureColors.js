// How much a street's traffic changes: more is orange, less is green.
// Smaller changes are the noise of the calculation.
export const NOISE = 300
export const UP = [[NOISE, '#f2c38f'], [1500, '#ef8f3c'], [4000, '#d6541c'], [Infinity, '#b3261e']]
export const DOWN = [[NOISE, '#a9dccf'], [1500, '#5cc0a6'], [4000, '#1fa187'], [Infinity, '#0c7c66']]
const step = (ramp, v) => ramp[Math.max(0, ramp.findIndex(([b]) => v < b) - 1)] || ramp[0]
export const diffColor = (d) => step(d > 0 ? UP : DOWN, Math.abs(d))[1]
