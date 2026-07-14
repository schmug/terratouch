// visuals.ts — pure helpers behind the living planet (issue #10): palette
// fallbacks, star/mote scatter, and the little state→appearance formulas.
//
// UI-ONLY randomness: scatter uses mulberry32 with fixed local seeds and
// NEVER the run's rngState — ambience must not consume the seeded rng
// (determinism rule 3). Everything here is pure and node-testable.

import { nextFloat } from '../sim/rng'
import type { EraLayer, EraLayerKind, EraVisuals } from '../sim/types'

/** Fallback palette for an era shipped without visuals: bare grey rock. */
export const DEFAULT_VISUALS: EraVisuals = {
  surface: ['#5a6f6e', '#3d4a55', '#141c2b'],
  glow: '#e9b872',
}

/** Hard cap on drifting life motes, whatever the content asks for. */
export const MAX_MOTES = 8

export function layerOf(
  visuals: EraVisuals,
  kind: EraLayerKind,
): EraLayer | undefined {
  return visuals.layers?.find((l) => l.kind === kind)
}

/** Per-kind fallback tints, for layers shipped without a color. */
const LAYER_DEFAULT_COLOR: Record<EraLayerKind, string> = {
  frost: '#ddeaf5',
  seas: '#1e3c62',
  microbial: '#b26e5f',
  flora: '#5f8f52',
  clouds: '#eef2f0',
  aurora: '#8fd4b8',
  motes: '#e4f0b0',
}

export function layerColor(layer: EraLayer): string {
  return layer.color ?? LAYER_DEFAULT_COLOR[layer.kind]
}

/** '#rrggbb' + alpha → 'rgba(r, g, b, a)' for SVG gradient stops. */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`
}

/**
 * Cloud cover: the layer's base opacity scaled by the Atmosphere gauge, so
 * a thickening atmosphere is visible minute-to-minute.
 */
export function cloudCover(
  baseOpacity: number,
  atmosphereValue: number,
): number {
  return baseOpacity * (0.3 + 0.7 * (atmosphereValue / 100))
}

/** Habitability glow strength at the limb: faint ember at 0, warm halo at 100. */
export function glowAlpha(habitability: number): number {
  return 0.1 + 0.25 * (habitability / 100)
}

/**
 * How visibly troubled the planet looks. Thresholds mirror the instability
 * bar's warn/danger steps — decoration restates the meter, never replaces it.
 */
export function strain(
  instability: number,
  cascadeThreshold: number,
): 'calm' | 'strained' | 'trembling' {
  const pct = (instability / cascadeThreshold) * 100
  if (pct > 75) return 'trembling'
  if (pct > 50) return 'strained'
  return 'calm'
}

export type Star = {
  x: number
  y: number
  r: number
  durSec: number
  delaySec: number
}

/**
 * Deterministic star scatter across a size×size box, skipping the disc of
 * `holeRadius` around the center (the planet hides them anyway). Same args
 * ⇒ same sky, render after render.
 */
export function starfield(
  count: number,
  size: number,
  holeRadius: number,
): Star[] {
  let state = 0xc0ffee
  const stars: Star[] = []
  const c = size / 2
  let guard = 0
  while (stars.length < count && guard++ < count * 30) {
    let r = nextFloat(state)
    const x = r.value * size
    r = nextFloat(r.state)
    const y = r.value * size
    r = nextFloat(r.state)
    state = r.state
    if (Math.hypot(x - c, y - c) < holeRadius) continue
    stars.push({
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      r: Math.round((0.5 + r.value * 0.8) * 100) / 100,
      durSec: Math.round((3 + r.value * 4) * 10) / 10,
      delaySec: Math.round(((x + y) % 6) * 10) / 10,
    })
  }
  return stars
}

export type Mote = { x: number; y: number; durSec: number; delaySec: number }

/** Deterministic mote scatter inside `maxR` of (cx, cy), capped at MAX_MOTES. */
export function motesFor(
  count: number,
  cx: number,
  cy: number,
  maxR: number,
): Mote[] {
  let state = 0x5eed1e
  const motes: Mote[] = []
  for (let i = 0; i < Math.min(count, MAX_MOTES); i++) {
    let r = nextFloat(state)
    const angle = r.value * Math.PI * 2
    r = nextFloat(r.state)
    const radius = Math.sqrt(r.value) * maxR
    r = nextFloat(r.state)
    state = r.state
    motes.push({
      x: Math.round((cx + Math.cos(angle) * radius) * 10) / 10,
      y: Math.round((cy + Math.sin(angle) * radius) * 10) / 10,
      durSec: Math.round((6 + r.value * 5) * 10) / 10,
      delaySec: Math.round(i * 1.7 * 10) / 10,
    })
  }
  return motes
}
