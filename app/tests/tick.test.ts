// tick.test.ts — drift-to-setpoint, production, Energy regen, Era
// stabilization (SPEC §4.3, §2.3). Ticking must never be able to kill.
import { describe, expect, it } from 'vitest'
import { buildOrUpgrade, newRun, setSetpoint, tapCollect } from '../src/sim/actions'
import { habitability } from '../src/sim/systems'
import { driftDirection, driftTarget, relax, tick } from '../src/sim/tick'
import { SYSTEM_IDS } from '../src/sim/types'
import { makeRun, makeTestContent } from './fixtures'

describe('relax', () => {
  it('approaches the target without overshooting, even for huge dt', () => {
    expect(relax(10, 50, 0.01, 1)).toBeGreaterThan(10)
    expect(relax(10, 50, 0.01, 1)).toBeLessThan(50)
    expect(relax(10, 50, 0.01, 1e9)).toBeCloseTo(50)
    expect(relax(90, 50, 0.01, 1e9)).toBeCloseTo(50)
    expect(relax(10, 50, 0, 100)).toBe(10) // zero rate: no movement
  })
})

describe('drift', () => {
  it('drifts toward the natural rest with no machines', () => {
    const content = makeTestContent()
    const run = makeRun(content)
    const { target } = driftTarget(run, content, 'thermal')
    expect(target).toBe(25) // naturalRest; no machines yet
    const ticked = tick(run, content, 60)
    expect(ticked.systems.thermal.value).toBeLessThan(run.systems.thermal.value)
    expect(ticked.systems.thermal.value).toBeGreaterThan(25)
    expect(driftDirection(run, content, 'thermal')).toBe(-1)
  })

  it('machines pull the target toward the setpoint, harder with level', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    run = buildOrUpgrade(run, content, 'test-heater')
    run = setSetpoint(run, content, 'thermal', 55)
    const l1 = driftTarget(run, content, 'thermal').target
    expect(l1).toBeGreaterThan(25)
    expect(l1).toBeLessThan(55)
    run = buildOrUpgrade(run, content, 'test-heater') // level 2
    const l2 = driftTarget(run, content, 'thermal').target
    expect(l2).toBeGreaterThan(l1)
  })

  it('can never reach a lethal edge from drift alone', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    run = buildOrUpgrade(run, content, 'test-heater')
    run = setSetpoint(run, content, 'thermal', 98) // max allowed
    for (let i = 0; i < 200; i++) run = tick(run, content, 3600)
    for (const id of SYSTEM_IDS) {
      expect(run.systems[id].value).toBeGreaterThan(0)
      expect(run.systems[id].value).toBeLessThan(100)
    }
  })
})

describe('production and energy', () => {
  it('accrues production into the tap pool up to the cap', () => {
    const content = makeTestContent()
    const run = makeRun(content)
    const t1 = tick(run, content, 10)
    expect(t1.uncollected).toBeCloseTo(10) // baseRate 1/s
    const t2 = tick(run, content, 1e6)
    expect(t2.uncollected).toBeCloseTo(100) // poolCapSec 100 × rate 1
  })

  it('tap collect banks the pool with the bonus', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    run = tick(run, content, 10)
    const { run: collected, collected: amount } = tapCollect(run, content)
    expect(amount).toBeCloseTo(15) // 10 × 1.5 bonus
    expect(collected.resources.minerals).toBeCloseTo(run.resources.minerals + 15)
    expect(collected.uncollected).toBe(0)
  })

  it('energy regenerates to the cap and stops', () => {
    const content = makeTestContent()
    let run = { ...makeRun(content), energy: 0 }
    run = tick(run, content, 100)
    expect(run.energy).toBeCloseTo(2) // 0.02/s × 100s
    run = tick(run, content, 1e6)
    expect(run.energy).toBe(10)
  })
})

describe('era stabilization', () => {
  it('advances the era after holding habitability, shifting bands', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    // Values start at band centers → habitability 100 ≥ threshold 50.
    expect(habitability(run.systems)).toBe(100)
    run = tick(run, content, 29)
    expect(run.era).toBe(0)
    expect(run.eraProgressSec).toBeCloseTo(29)
    run = tick(run, content, 2)
    expect(run.era).toBe(1)
    expect(run.eraProgressSec).toBe(0)
    expect(run.systems.thermal.band).toEqual([30, 70])
  })

  it('decays progress while below the threshold', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    // Push everything out of band so habitability is 0.
    const systems = { ...run.systems }
    for (const id of SYSTEM_IDS) systems[id] = { ...systems[id], value: 5 }
    run = { ...run, systems, eraProgressSec: 20 }
    run = tick(run, content, 5)
    expect(run.eraProgressSec).toBeCloseTo(15)
    expect(run.era).toBe(0)
  })

  it('the final era never advances', () => {
    const content = makeTestContent()
    let run = { ...makeRun(content), era: 1 }
    run = { ...run, systems: { ...run.systems } }
    run = tick(run, content, 1e5)
    expect(run.era).toBe(1)
  })

  it('tracks peak habitability', () => {
    const content = makeTestContent()
    const run = makeRun(content)
    const ticked = tick(run, content, 1)
    expect(ticked.history.peakHabitability).toBeGreaterThan(90)
  })
})

describe('tick guards', () => {
  it('is a no-op on a collapsed run or non-positive dt', () => {
    const content = makeTestContent()
    const run = makeRun(content)
    expect(tick(run, content, 0)).toBe(run)
    expect(tick(run, content, -5)).toBe(run)
    const dead = {
      ...run,
      collapse: {
        archetype: 'x',
        eraReached: 'x',
        turnsSurvived: 0,
        cause: { kind: 'hard-fail' as const, system: 'thermal' as const, direction: 'low' as const },
        systemsFinal: { thermal: 0, atmosphere: 0, hydro: 0, biosphere: 0 },
        peakHabitability: 0,
        notableStats: [],
        seedsAwarded: 0,
      },
    }
    expect(tick(dead, content, 10)).toBe(dead)
  })

  it('never mutates its input', () => {
    const content = makeTestContent()
    const run = makeRun(content)
    const before = JSON.stringify(run)
    tick(run, content, 123)
    expect(JSON.stringify(run)).toBe(before)
  })
})

describe('actions', () => {
  it('build/upgrade charges scaled costs and respects max level', () => {
    const content = makeTestContent()
    let run = makeRun(content) // 100 minerals
    run = buildOrUpgrade(run, content, 'test-heater') // 10
    expect(run.resources.minerals).toBe(90)
    expect(run.machines).toHaveLength(1)
    expect(run.history.machinesBuilt).toBe(1)
    run = buildOrUpgrade(run, content, 'test-heater') // 20
    run = buildOrUpgrade(run, content, 'test-heater') // 40
    expect(run.resources.minerals).toBe(30)
    expect(run.machines[0]!.level).toBe(3)
    expect(() => buildOrUpgrade(run, content, 'test-heater')).toThrow('max-level')
  })

  it('refuses to build without minerals', () => {
    const content = makeTestContent()
    const run = { ...makeRun(content), resources: { minerals: 5 } }
    expect(() => buildOrUpgrade(run, content, 'test-heater')).toThrow('no-minerals')
  })

  it('setpoints require a machine on the system and clamp to the safe range', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    expect(() => setSetpoint(run, content, 'thermal', 50)).toThrow('no-machine-for-system')
    run = buildOrUpgrade(run, content, 'test-heater')
    run = setSetpoint(run, content, 'thermal', 150)
    expect(run.systems.thermal.setpoint).toBe(98)
    run = setSetpoint(run, content, 'thermal', -10)
    expect(run.systems.thermal.setpoint).toBe(2)
  })

  it('newRun starts at the archetype values inside era-1 bands with full energy', () => {
    const content = makeTestContent()
    const run = newRun(content, 7, 'test-rock')
    expect(run.energy).toBe(10)
    expect(run.era).toBe(0)
    expect(run.instability).toBe(0)
    expect(run.turns).toBe(0)
    expect(run.collapse).toBeNull()
    for (const id of SYSTEM_IDS) {
      const s = run.systems[id]
      expect(s.value).toBeGreaterThanOrEqual(s.band[0])
      expect(s.value).toBeLessThanOrEqual(s.band[1])
    }
  })
})
