// offline.test.ts — THE non-negotiable invariants (SPEC §1.3): offline
// catch-up never crosses a band edge, NEVER adds Instability, never
// advances Eras or turns, and is bounded by the offline cap. Exercised
// property-style across many seeded states and gap lengths.
import { describe, expect, it } from 'vitest'
import { buildOrUpgrade, setSetpoint } from '../src/sim/actions'
import { applyOffline } from '../src/sim/offline'
import { nextFloat, seedRng } from '../src/sim/rng'
import { SYSTEM_IDS, type RunState } from '../src/sim/types'
import { makeRun, makeTestContent } from './fixtures'

const content = makeTestContent()

/** Deterministically scramble a run into an arbitrary (even ugly) state. */
function scrambledRun(seed: number): RunState {
  let run = makeRun(content, seed)
  let s = seedRng(seed ^ 0x5f3759df)
  const rand = () => {
    const r = nextFloat(s)
    s = r.state
    return r.value
  }
  const systems = { ...run.systems }
  for (const id of SYSTEM_IDS) {
    // Anywhere in (0, 100): inside the band, near edges, or far outside.
    const value = 0.5 + rand() * 99
    const setpoint = 2 + rand() * 96
    systems[id] = { ...systems[id], value, setpoint }
  }
  run = {
    ...run,
    systems,
    instability: rand() * 120,
    energy: rand() * 10,
    eraProgressSec: rand() * 30,
    era: rand() < 0.5 ? 0 : 1,
  }
  if (run.era === 1) {
    for (const id of SYSTEM_IDS) {
      systems[id] = { ...systems[id], band: content.eras[1]!.bands[id] }
    }
    run = { ...run, systems: { ...systems } }
  }
  if (rand() < 0.5)
    run = buildOrUpgrade(
      { ...run, resources: { minerals: 50 } },
      content,
      'test-heater',
    )
  if (run.machines.length > 0)
    run = setSetpoint(run, content, 'thermal', 2 + rand() * 96)
  return run
}

const GAPS_MS = [
  1_000,
  60_000,
  600_000,
  3_600_000,
  8 * 3_600_000,
  48 * 3_600_000,
]

describe('offline safety invariants (property-style)', () => {
  it('never crosses a band edge; out-of-band gauges never get worse', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const run = scrambledRun(seed)
      for (const gap of GAPS_MS) {
        const { run: after } = applyOffline(run, content, gap)
        for (const id of SYSTEM_IDS) {
          const before = run.systems[id]
          const [lo, hi] = before.band
          const v = after.systems[id].value
          expect(v).toBeGreaterThan(0)
          expect(v).toBeLessThan(100)
          if (before.value >= lo && before.value <= hi) {
            // Started safe: must stay inside the band.
            expect(v).toBeGreaterThanOrEqual(lo)
            expect(v).toBeLessThanOrEqual(hi)
          } else if (before.value < lo) {
            // Started below: may only move up, never past the far edge.
            expect(v).toBeGreaterThanOrEqual(before.value)
            expect(v).toBeLessThanOrEqual(hi)
          } else {
            // Started above: may only move down, never past the far edge.
            expect(v).toBeLessThanOrEqual(before.value)
            expect(v).toBeGreaterThanOrEqual(lo)
          }
        }
      }
    }
  })

  it('NEVER changes instability, era, era progress, or turns', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const run = scrambledRun(seed)
      for (const gap of GAPS_MS) {
        const { run: after } = applyOffline(run, content, gap)
        expect(after.instability).toBe(run.instability)
        expect(after.era).toBe(run.era)
        expect(after.eraProgressSec).toBe(run.eraProgressSec)
        expect(after.turns).toBe(run.turns)
        expect(after.rngState).toBe(run.rngState)
        expect(after.activeCardId).toBe(run.activeCardId)
      }
    }
  })

  it('refills energy toward the cap and never drains it', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = scrambledRun(seed)
      const { run: after, summary } = applyOffline(run, content, 3_600_000)
      expect(after.energy).toBeGreaterThanOrEqual(run.energy)
      expect(after.energy).toBeLessThanOrEqual(content.balance.energy.cap)
      expect(summary.energyGained).toBeCloseTo(after.energy - run.energy, 1)
    }
  })

  it('produces minerals proportional to (clamped) elapsed time', () => {
    const run = makeRun(content, 9)
    const { run: after, summary } = applyOffline(run, content, 600_000)
    // baseRate 1/s × 600s × mult 1
    expect(summary.mineralsGained).toBeCloseTo(600, 0)
    expect(after.resources.minerals).toBeCloseTo(
      run.resources.minerals + 600,
      0,
    )
  })

  it('clamps elapsed time to the offline cap and reports it', () => {
    const run = makeRun(content, 9)
    const capMs = content.balance.offline.maxHours * 3_600_000
    const { summary } = applyOffline(run, content, capMs * 6)
    expect(summary.capped).toBe(true)
    expect(summary.elapsedMs).toBe(capMs)
    const { summary: small } = applyOffline(run, content, 1000)
    expect(small.capped).toBe(false)
    expect(small.elapsedMs).toBe(1000)
  })

  it('is a no-op for zero elapsed time or a collapsed run', () => {
    const run = makeRun(content, 3)
    const { run: same } = applyOffline(run, content, 0)
    expect(same).toBe(run)
    const dead = {
      ...run,
      collapse: {
        archetype: 'x',
        eraReached: 'x',
        turnsSurvived: 1,
        cause: {
          kind: 'cascade' as const,
          system: 'hydro' as const,
          direction: 'high' as const,
        },
        systemsFinal: { thermal: 50, atmosphere: 50, hydro: 50, biosphere: 50 },
        peakHabitability: 10,
        notableStats: [],
        seedsAwarded: 0,
      },
    }
    const { run: deadAfter } = applyOffline(dead, content, 3_600_000)
    expect(deadAfter).toBe(dead)
  })

  it('is deterministic', () => {
    const run = scrambledRun(17)
    const a = applyOffline(run, content, 7_200_000)
    const b = applyOffline(run, content, 7_200_000)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('never mutates its input', () => {
    const run = scrambledRun(23)
    const before = JSON.stringify(run)
    applyOffline(run, content, 3_600_000)
    expect(JSON.stringify(run)).toBe(before)
  })
})
