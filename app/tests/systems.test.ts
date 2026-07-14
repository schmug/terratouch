// systems.test.ts — gauge math, bands, Habitability, Instability, collapse
// detection, and Era band shifts (SPEC §2.2–§2.4).
import { describe, expect, it } from 'vitest'
import {
  bandDepth,
  buildCollapseReport,
  cascadeCause,
  detectHardFail,
  habitability,
  inBand,
  instabilityStep,
  isCascade,
  shiftBandsToEra,
  systemsOutOfBand,
} from '../src/sim/systems'
import type { SystemState } from '../src/sim/types'
import { makeRun, makeTestContent } from './fixtures'

const sys = (
  value: number,
  band: [number, number] = [20, 60],
): SystemState => ({
  value,
  band,
  setpoint: 40,
})

describe('bands and depth', () => {
  it('inBand treats edges as safe', () => {
    expect(inBand(sys(20))).toBe(true)
    expect(inBand(sys(60))).toBe(true)
    expect(inBand(sys(19.99))).toBe(false)
    expect(inBand(sys(60.01))).toBe(false)
  })

  it('bandDepth is 1 at center, 0 at edges and outside', () => {
    expect(bandDepth(sys(40))).toBe(1)
    expect(bandDepth(sys(20))).toBe(0)
    expect(bandDepth(sys(60))).toBe(0)
    expect(bandDepth(sys(10))).toBe(0)
    expect(bandDepth(sys(30))).toBeCloseTo(0.5)
  })

  it('habitability is the mean depth as 0–100', () => {
    const all = {
      thermal: sys(40),
      atmosphere: sys(40),
      hydro: sys(40),
      biosphere: sys(30, [10, 50]),
    }
    expect(habitability(all)).toBe(100)
    const half = { ...all, thermal: sys(30), atmosphere: sys(30) }
    expect(habitability(half)).toBe(75)
    const dead = {
      thermal: sys(5),
      atmosphere: sys(5),
      hydro: sys(5),
      biosphere: sys(5, [10, 50]),
    }
    expect(habitability(dead)).toBe(0)
  })
})

describe('collapse detection', () => {
  it('hard fail triggers only at the lethal edges', () => {
    const ok = {
      thermal: sys(1),
      atmosphere: sys(99),
      hydro: sys(40),
      biosphere: sys(40),
    }
    expect(detectHardFail(ok)).toBeNull()
    expect(detectHardFail({ ...ok, thermal: sys(0) })).toEqual({
      kind: 'hard-fail',
      system: 'thermal',
      direction: 'low',
    })
    expect(detectHardFail({ ...ok, hydro: sys(100) })).toEqual({
      kind: 'hard-fail',
      system: 'hydro',
      direction: 'high',
    })
  })

  it('instability accrues per out-of-band system and decays when all clear', () => {
    const content = makeTestContent()
    const inside = {
      thermal: sys(40),
      atmosphere: sys(40),
      hydro: sys(40),
      biosphere: sys(30, [10, 50]),
    }
    const oneOut = { ...inside, thermal: sys(5) }
    const twoOut = { ...oneOut, hydro: sys(95) }
    expect(instabilityStep(50, inside, content.balance)).toBe(45)
    expect(instabilityStep(50, oneOut, content.balance)).toBe(60)
    expect(instabilityStep(50, twoOut, content.balance)).toBe(70)
    expect(instabilityStep(2, inside, content.balance)).toBe(0) // floors at 0
    expect(systemsOutOfBand(twoOut)).toEqual(['thermal', 'hydro'])
    // Era volatility scales accrual (not decay): later worlds punish drift.
    expect(instabilityStep(50, oneOut, content.balance, 2)).toBe(70)
    expect(instabilityStep(50, inside, content.balance, 2)).toBe(45)
  })

  it('cascade triggers at the threshold', () => {
    const content = makeTestContent()
    expect(isCascade(99.9, content.balance)).toBe(false)
    expect(isCascade(100, content.balance)).toBe(true)
  })

  it('cascadeCause blames the system with the most out-of-band turns', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    run = {
      ...run,
      systems: { ...run.systems, hydro: { ...run.systems.hydro, value: 70 } },
      history: {
        ...run.history,
        turnsOutOfBand: { thermal: 2, atmosphere: 0, hydro: 9, biosphere: 1 },
      },
    }
    expect(cascadeCause(run)).toEqual({
      kind: 'cascade',
      system: 'hydro',
      direction: 'high',
    })
  })
})

describe('era band shift', () => {
  it('moves bands to the new era, preserving values and setpoints', () => {
    const content = makeTestContent()
    const run = makeRun(content)
    const shifted = shiftBandsToEra(run.systems, content, 1)
    expect(shifted.thermal.band).toEqual([30, 70])
    expect(shifted.biosphere.band).toEqual([20, 60])
    expect(shifted.thermal.value).toBe(run.systems.thermal.value)
    expect(shifted.thermal.setpoint).toBe(run.systems.thermal.setpoint)
  })
})

describe('collapse report', () => {
  it('captures cause, stats, and notable out-of-band streaks', () => {
    const content = makeTestContent()
    let run = makeRun(content)
    run = {
      ...run,
      turns: 23,
      history: {
        peakHabitability: 61,
        turnsOutOfBand: { thermal: 9, atmosphere: 0, hydro: 1, biosphere: 0 },
        machinesBuilt: 2,
      },
    }
    const report = buildCollapseReport(run, content, {
      kind: 'hard-fail',
      system: 'thermal',
      direction: 'high',
    })
    expect(report.archetype).toBe('Test Rock')
    expect(report.eraReached).toBe('One')
    expect(report.turnsSurvived).toBe(23)
    expect(report.cause).toEqual({
      kind: 'hard-fail',
      system: 'thermal',
      direction: 'high',
    })
    expect(report.peakHabitability).toBe(61)
    expect(report.seedsAwarded).toBe(0)
    expect(report.notableStats.join(' ')).toContain(
      'thermal balance spent 9 turns',
    )
    expect(report.notableStats.join(' ')).toContain('habitability peaked at 61')
  })
})
