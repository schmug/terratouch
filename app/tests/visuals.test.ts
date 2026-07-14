// visuals.test.ts — the planet's decorative helpers (issue #10) are pure
// and deterministic: same inputs ⇒ same scatter, on a UI-only rng that
// never touches the run's seeded state.
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISUALS,
  MAX_MOTES,
  cloudCover,
  glowAlpha,
  hexToRgba,
  layerColor,
  layerOf,
  motesFor,
  starfield,
  strain,
} from '../src/ui/visuals'

describe('color helpers', () => {
  it('hexToRgba converts #rrggbb, any case', () => {
    expect(hexToRgba('#e9b872', 0.5)).toBe('rgba(233, 184, 114, 0.5)')
    expect(hexToRgba('#0A0E1A', 1)).toBe('rgba(10, 14, 26, 1)')
  })

  it('layerColor falls back to a per-kind default', () => {
    expect(layerColor({ kind: 'aurora', opacity: 0.4, color: '#123456' })).toBe(
      '#123456',
    )
    expect(layerColor({ kind: 'aurora', opacity: 0.4 })).toBe('#8fd4b8')
  })

  it('layerOf finds a layer by kind, or undefined', () => {
    const visuals = {
      ...DEFAULT_VISUALS,
      layers: [{ kind: 'seas' as const, opacity: 0.7 }],
    }
    expect(layerOf(visuals, 'seas')?.opacity).toBe(0.7)
    expect(layerOf(visuals, 'flora')).toBeUndefined()
    expect(layerOf(DEFAULT_VISUALS, 'seas')).toBeUndefined()
  })
})

describe('state → appearance formulas', () => {
  it('cloud cover scales with the Atmosphere gauge but never vanishes', () => {
    expect(cloudCover(0.4, 0)).toBeCloseTo(0.12)
    expect(cloudCover(0.4, 100)).toBeCloseTo(0.4)
    expect(cloudCover(0.4, 50)).toBeGreaterThan(cloudCover(0.4, 20))
  })

  it('glow strength stays a subtle halo across the whole hab range', () => {
    expect(glowAlpha(0)).toBeCloseTo(0.1)
    expect(glowAlpha(100)).toBeCloseTo(0.35)
  })

  it('strain thresholds mirror the instability bar (warn > 50%, danger > 75%)', () => {
    expect(strain(0, 100)).toBe('calm')
    expect(strain(50, 100)).toBe('calm')
    expect(strain(51, 100)).toBe('strained')
    expect(strain(75, 100)).toBe('strained')
    expect(strain(76, 100)).toBe('trembling')
  })
})

describe('deterministic scatter (UI-only rng)', () => {
  it('starfield is identical call to call, honors count, and skips the planet disc', () => {
    const a = starfield(22, 320, 96)
    const b = starfield(22, 320, 96)
    expect(a).toEqual(b)
    expect(a).toHaveLength(22)
    for (const s of a) {
      expect(Math.hypot(s.x - 160, s.y - 160)).toBeGreaterThanOrEqual(96)
      expect(s.x).toBeGreaterThanOrEqual(0)
      expect(s.x).toBeLessThanOrEqual(320)
      expect(s.y).toBeGreaterThanOrEqual(0)
      expect(s.y).toBeLessThanOrEqual(320)
    }
  })

  it('motes are identical call to call, capped, and stay on the surface', () => {
    const a = motesFor(6, 160, 160, 58)
    expect(a).toEqual(motesFor(6, 160, 160, 58))
    expect(a).toHaveLength(6)
    expect(motesFor(99, 160, 160, 58)).toHaveLength(MAX_MOTES)
    for (const m of a) {
      expect(Math.hypot(m.x - 160, m.y - 160)).toBeLessThanOrEqual(58.1)
    }
  })
})
