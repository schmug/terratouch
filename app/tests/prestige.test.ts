// prestige.test.ts — Genesis Seed yield + voluntary Ascension (SPEC §2.8,
// Milestone 2). Yield converts run progress into the persistent meta-currency:
// partial on collapse, max on Ascension at the final (Habitable) era.
import { describe, expect, it } from 'vitest'
import { ascend, newRun, tapCollect } from '../src/sim/actions'
import { drawCard, resolveCard } from '../src/sim/cards'
import { canAscend, seedYield } from '../src/sim/prestige'
import { SimError, type RunState } from '../src/sim/types'
import { makeRun, makeTestContent } from './fixtures'

const content = makeTestContent()
// Fixture params: eraWeight=2, habDivisor=25, collapseMult=0.5, ascensionBonus=5.

/** A run pushed to a given era / peak habitability, without playing it out. */
function runAt(era: number, peakHabitability: number): RunState {
  const run = makeRun(content)
  return {
    ...run,
    era,
    history: { ...run.history, peakHabitability },
  }
}

describe('seedYield (SPEC §2.8)', () => {
  it('collapse pays the partial yield: floor((era·w + floor(hab/d))·mult)', () => {
    // base = 1*2 + floor(60/25) = 4; collapse = floor(4 * 0.5) = 2
    expect(seedYield(runAt(1, 60), content, 'collapse')).toBe(2)
  })

  it('ascension pays the max yield: base + flat bonus', () => {
    // base = 1*2 + floor(60/25) = 4; ascension = 4 + 5 = 9
    expect(seedYield(runAt(1, 60), content, 'ascension')).toBe(9)
  })

  it('a dead-on-arrival run yields zero seeds on collapse', () => {
    expect(seedYield(runAt(0, 0), content, 'collapse')).toBe(0)
  })

  it('yield is an integer and never negative', () => {
    for (const era of [0, 1]) {
      for (const hab of [0, 33, 99, 100]) {
        for (const mode of ['collapse', 'ascension'] as const) {
          const seeds = seedYield(runAt(era, hab), content, mode)
          expect(Number.isInteger(seeds)).toBe(true)
          expect(seeds).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('yield rises with era reached and with peak habitability', () => {
    expect(seedYield(runAt(1, 50), content, 'collapse')).toBeGreaterThan(
      seedYield(runAt(0, 50), content, 'collapse'),
    )
    expect(seedYield(runAt(1, 100), content, 'ascension')).toBeGreaterThan(
      seedYield(runAt(1, 20), content, 'ascension'),
    )
  })

  it('ascension always beats collapsing on the same run', () => {
    for (const hab of [0, 40, 100]) {
      const run = runAt(1, hab)
      expect(seedYield(run, content, 'ascension')).toBeGreaterThan(
        seedYield(run, content, 'collapse'),
      )
    }
  })
})

describe('canAscend / ascend (voluntary Ascension at the final era)', () => {
  it('cannot ascend before the final era', () => {
    expect(canAscend(runAt(0, 80), content)).toBe(false)
    expect(() => ascend(runAt(0, 80), content)).toThrow(SimError)
  })

  it('can ascend at the final era', () => {
    expect(canAscend(runAt(1, 80), content)).toBe(true)
  })

  it('cannot ascend with a card mid-swipe or after the run ended', () => {
    const atFinal = runAt(1, 80)
    const midCard = drawCard(atFinal, content).run
    expect(canAscend(midCard, content)).toBe(false)
    expect(() => ascend(midCard, content)).toThrow(SimError)

    const ended = ascend(atFinal, content)
    expect(canAscend(ended, content)).toBe(false)
    expect(() => ascend(ended, content)).toThrow(SimError)
  })

  it('ascending ends the run with an ascension report and max seeds', () => {
    const run = runAt(1, 80)
    const ended = ascend(run, content)
    expect(ended.collapse).not.toBeNull()
    expect(ended.collapse!.cause.kind).toBe('ascension')
    // base = 1*2 + floor(80/25) = 5; ascension = 5 + 5 = 10
    expect(ended.collapse!.seedsAwarded).toBe(10)
    expect(ended.collapse!.eraReached).toBe('Two')
    // The run itself is untouched apart from ending.
    expect(ended.turns).toBe(run.turns)
    expect(ended.systems).toEqual(run.systems)
    expect(ended.rngState).toBe(run.rngState)
  })

  it('no actions are legal after ascending', () => {
    const ended = ascend(runAt(1, 80), content)
    expect(() => drawCard(ended, content)).toThrow(SimError)
    expect(() => tapCollect(ended, content)).toThrow(SimError)
  })
})

describe('seedsAwarded wiring (CollapseReport, SPEC §5.3)', () => {
  it('a collapse stamps the partial yield into the report', () => {
    // Force a hard fail: resolve the haymaker (thermal −100) directly.
    const armed = { ...runAt(1, 60), activeCardId: 'haymaker' }
    const ended = resolveCard(armed, content, 'left').run
    expect(ended.collapse).not.toBeNull()
    expect(ended.collapse!.cause.kind).toBe('hard-fail')
    expect(ended.collapse!.seedsAwarded).toBe(
      seedYield(ended, content, 'collapse'),
    )
    expect(ended.collapse!.seedsAwarded).toBeGreaterThan(0)
  })

  it('fresh runs start with no banked yield: report seeds are deterministic', () => {
    const a = ascend({ ...newRun(content, 7, 'test-rock'), era: 1 }, content)
    const b = ascend({ ...newRun(content, 7, 'test-rock'), era: 1 }, content)
    expect(a.collapse!.seedsAwarded).toBe(b.collapse!.seedsAwarded)
  })
})
