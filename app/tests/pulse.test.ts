// pulse.test.ts — the tap pool's on-beat rhythm (Session Arc slice A).
// On-beat = the one tick per pulse period where floor(activeSec) lands on 0
// mod period. Off-beat collects are byte-for-byte today's behavior.
import { describe, expect, it } from 'vitest'
import { newRun, onBeat, tapCollect } from '../src/sim/actions'
import { makeTestContent } from './fixtures'

const content = makeTestContent() // period 4, onBeatMult 1.6, bonusMult 1.5

function withPool(activeSec: number, uncollected = 10) {
  return { ...newRun(content, 1, 'test-rock'), activeSec, uncollected }
}

describe('onBeat', () => {
  it('is true exactly one tick per period', () => {
    expect(onBeat(withPool(0), content)).toBe(true)
    expect(onBeat(withPool(0.9), content)).toBe(true) // same tick
    expect(onBeat(withPool(1), content)).toBe(false)
    expect(onBeat(withPool(2), content)).toBe(false)
    expect(onBeat(withPool(3), content)).toBe(false)
    expect(onBeat(withPool(4), content)).toBe(true)
    expect(onBeat(withPool(8), content)).toBe(true)
  })
})

describe('tapCollect pulse', () => {
  it('pays onBeatMult on the beat', () => {
    const { run, collected, onBeat: hit } = tapCollect(withPool(4), content)
    expect(hit).toBe(true)
    expect(collected).toBe(16) // 10 × 1.6
    expect(run.resources.minerals).toBe(
      newRun(content, 1, 'test-rock').resources.minerals + 16,
    )
    expect(run.uncollected).toBe(0)
  })

  it('pays exactly the old bonusMult off the beat', () => {
    const { collected, onBeat: hit } = tapCollect(withPool(5), content)
    expect(hit).toBe(false)
    expect(collected).toBe(15) // 10 × 1.5 — unchanged from pre-pulse behavior
  })

  it('empty pool stays a zero no-op either way', () => {
    const { run, collected } = tapCollect(withPool(4, 0), content)
    expect(collected).toBe(0)
    expect(run).toEqual(withPool(4, 0))
  })
})
