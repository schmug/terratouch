// meta.ts — presentation constants for the four systems. Colorblind-safe
// encoding (SPEC §3): every system gets a distinct SHAPE and a fixed screen
// POSITION in addition to its color; color alone never carries meaning.

import type { SystemId } from '../sim/types'

export type MarkerShape = 'circle' | 'diamond' | 'square' | 'triangle'

export const SYSTEM_META: Record<
  SystemId,
  { label: string; short: string; color: string; shape: MarkerShape }
> = {
  thermal: {
    label: 'Thermal',
    short: 'Therm',
    color: '#ef8354',
    shape: 'circle',
  },
  atmosphere: {
    label: 'Atmosphere',
    short: 'Atmos',
    color: '#9ad1d4',
    shape: 'diamond',
  },
  hydro: { label: 'Hydro', short: 'Hydro', color: '#5b9bd4', shape: 'square' },
  biosphere: {
    label: 'Biosphere',
    short: 'Bio',
    color: '#8fbc6f',
    shape: 'triangle',
  },
}

/** Unicode fallbacks for the marker shapes, used in text chips. */
export const SHAPE_GLYPH: Record<MarkerShape, string> = {
  circle: '●',
  diamond: '◆',
  square: '■',
  triangle: '▲',
}
