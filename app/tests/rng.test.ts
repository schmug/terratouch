// rng.test.ts — mulberry32 determinism and distribution sanity (SPEC §5.2).
import { describe, expect, it } from 'vitest'
import { nextFloat, nextInt, pickWeighted, seedRng } from '../src/sim/rng'

describe('rng', () => {
  it('same seed produces the same sequence', () => {
    const a: number[] = []
    const b: number[] = []
    let sa = seedRng(12345)
    let sb = seedRng(12345)
    for (let i = 0; i < 20; i++) {
      const ra = nextFloat(sa)
      const rb = nextFloat(sb)
      sa = ra.state
      sb = rb.state
      a.push(ra.value)
      b.push(rb.value)
    }
    expect(a).toEqual(b)
  })

  it('different seeds diverge', () => {
    const a = nextFloat(seedRng(1)).value
    const b = nextFloat(seedRng(2)).value
    expect(a).not.toBe(b)
  })

  it('floats are in [0, 1)', () => {
    let s = seedRng(7)
    for (let i = 0; i < 1000; i++) {
      const r = nextFloat(s)
      s = r.state
      expect(r.value).toBeGreaterThanOrEqual(0)
      expect(r.value).toBeLessThan(1)
    }
  })

  it('floats are roughly uniform', () => {
    let s = seedRng(99)
    let sum = 0
    const n = 10000
    for (let i = 0; i < n; i++) {
      const r = nextFloat(s)
      s = r.state
      sum += r.value
    }
    expect(sum / n).toBeGreaterThan(0.47)
    expect(sum / n).toBeLessThan(0.53)
  })

  it('nextInt stays in range', () => {
    let s = seedRng(3)
    for (let i = 0; i < 500; i++) {
      const r = nextInt(s, 7)
      s = r.state
      expect(r.value).toBeGreaterThanOrEqual(0)
      expect(r.value).toBeLessThan(7)
      expect(Number.isInteger(r.value)).toBe(true)
    }
  })

  it('pickWeighted respects weights and never picks zero-weight entries', () => {
    let s = seedRng(11)
    const counts = [0, 0, 0]
    const n = 10000
    for (let i = 0; i < n; i++) {
      const r = pickWeighted(s, [1, 0, 3])
      s = r.state
      counts[r.value]!++
    }
    expect(counts[1]).toBe(0)
    expect(counts[0]! / n).toBeGreaterThan(0.2)
    expect(counts[0]! / n).toBeLessThan(0.3)
    expect(counts[2]! / n).toBeGreaterThan(0.7)
  })

  it('pickWeighted is deterministic for a given state', () => {
    const s = seedRng(500)
    expect(pickWeighted(s, [5, 5, 5])).toEqual(pickWeighted(s, [5, 5, 5]))
  })
})
