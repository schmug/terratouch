// phenomena.test.ts — Session Arc slice A: spawn scheduling, catching,
// payouts, and the active-time clock. Design doc:
// docs/superpowers/specs/2026-07-15-active-play-session-arc-design.md
import { describe, expect, it } from 'vitest'
import { newRun } from '../src/sim/actions'
import { seedPhenoRng, seedRng } from '../src/sim/rng'
import { makeTestContent } from './fixtures'

describe('newRun active-play fields', () => {
  it('initializes the v2 fields inert', () => {
    const content = makeTestContent()
    const run = newRun(content, 99, 'test-rock')
    expect(run.activeSec).toBe(0)
    expect(run.phenoRngState).toBe(seedPhenoRng(99))
    expect(run.phenoRngState).not.toBe(seedRng(99)) // distinct stream
    expect(run.phenomenon).toBeNull()
    expect(run.tailwind).toBeNull()
    expect(run.nextPhenomenonAtSec).toBe(0)
  })
})
