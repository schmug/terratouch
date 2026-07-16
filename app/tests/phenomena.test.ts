// phenomena.test.ts — Session Arc slice A: spawn scheduling, catching,
// payouts, and the active-time clock. Design doc:
// docs/superpowers/specs/2026-07-15-active-play-session-arc-design.md
import { describe, expect, it } from 'vitest'
import { newRun } from '../src/sim/actions'
import { applyOffline } from '../src/sim/offline'
import { seedPhenoRng, seedRng } from '../src/sim/rng'
import { tick } from '../src/sim/tick'
import type { Content, PhenomenonDef } from '../src/sim/types'
import { makeTestContent } from './fixtures'

const METEOR: PhenomenonDef = {
  id: 'meteor',
  name: 'Meteor',
  blurb: 'x',
  weight: 1,
  payout: { kind: 'minerals', productionSec: 45 },
}

function phenoContent(defs: PhenomenonDef[] = [METEOR]): Content {
  return makeTestContent({ phenomena: defs })
}

/** Tick 1s at a time until a phenomenon is live (bounded). */
function tickUntilSpawn(run: ReturnType<typeof newRun>, content: Content) {
  for (let i = 0; i < 200 && !run.phenomenon; i++) run = tick(run, content, 1)
  return run
}

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

describe('activeSec clock', () => {
  it('accrues active tick time and freezes offline', () => {
    const content = makeTestContent()
    let run = newRun(content, 1, 'test-rock')
    run = tick(run, content, 7)
    run = tick(run, content, 3)
    expect(run.activeSec).toBe(10)
    const after = applyOffline(run, content, 3600_000).run
    expect(after.activeSec).toBe(10)
  })
})

describe('phenomena scheduling', () => {
  it('stays fully dormant with an empty pool (no rng draws)', () => {
    const content = makeTestContent() // phenomena: []
    let run = newRun(content, 5, 'test-rock')
    const stream0 = run.phenoRngState
    for (let i = 0; i < 300; i++) run = tick(run, content, 1)
    expect(run.phenomenon).toBeNull()
    expect(run.nextPhenomenonAtSec).toBe(0)
    expect(run.phenoRngState).toBe(stream0)
  })

  it('lazily schedules within [0.5, 1.5) × meanSpacing, then spawns', () => {
    const content = phenoContent()
    let run = newRun(content, 5, 'test-rock')
    run = tick(run, content, 1) // first tick: 0-sentinel → schedule
    expect(run.nextPhenomenonAtSec).toBeGreaterThanOrEqual(1 + 30)
    expect(run.nextPhenomenonAtSec).toBeLessThan(1 + 90)
    run = tickUntilSpawn(run, content)
    expect(run.phenomenon).not.toBeNull()
    expect(run.phenomenon!.defId).toBe('meteor')
    expect(run.nextPhenomenonAtSec).toBe(0) // rescheduled lazily after resolve
    expect(run.phenomenon!.expiresAtActiveSec).toBe(
      run.activeSec + content.balance.phenomena.windowSec,
    )
  })

  it('expires a missed phenomenon silently and schedules the next', () => {
    const content = phenoContent()
    let run = tickUntilSpawn(newRun(content, 5, 'test-rock'), content)
    const firstExpiry = run.phenomenon!.expiresAtActiveSec
    for (let i = 0; i < 200 && run.phenomenon; i++) run = tick(run, content, 1)
    expect(run.phenomenon).toBeNull()
    expect(run.activeSec).toBeGreaterThanOrEqual(firstExpiry)
    run = tickUntilSpawn(run, content) // a second one arrives
    expect(run.phenomenon).not.toBeNull()
  })

  it('same seed ⇒ identical spawn schedule; main rng untouched', () => {
    const content = phenoContent()
    const play = (seed: number) => {
      let run = newRun(content, seed, 'test-rock')
      const events: Array<[number, string]> = []
      for (let i = 0; i < 400; i++) {
        const had = run.phenomenon?.defId
        run = tick(run, content, 1)
        if (run.phenomenon && run.phenomenon.defId !== had)
          events.push([run.activeSec, run.phenomenon.defId])
      }
      return { events, run }
    }
    const a = play(77)
    const b = play(77)
    expect(a.events).toEqual(b.events)
    expect(a.events.length).toBeGreaterThan(2)
    // Card stream isolation: 400 ticks of spawning consumed ZERO main rng.
    expect(a.run.rngState).toBe(newRun(content, 77, 'test-rock').rngState)
  })

  it('era-gates the pool like cards (1-based)', () => {
    const gated: PhenomenonDef = { ...METEOR, id: 'late', eras: [2, 2] }
    const content = phenoContent([gated])
    let run = newRun(content, 5, 'test-rock')
    for (let i = 0; i < 300; i++) run = tick(run, content, 1)
    expect(run.phenomenon).toBeNull() // era 1: pool empty, dormant
  })
})
