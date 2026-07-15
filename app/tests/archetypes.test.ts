// archetypes.test.ts — M2 Seed-gated archetypes (SPEC §2.8, §2.9): buying an
// unlock-archetype upgrade opens the archetype; Frozen/Volcanic ship as
// content with their own gated cards and distinct drift personalities.
import { describe, expect, it } from 'vitest'
import { newRun } from '../src/sim/actions'
import { cardPool } from '../src/sim/cards'
import { applyMetaUpgrades, buyUpgrade } from '../src/sim/prestige'
import { driftTarget } from '../src/sim/tick'
import { loadContent } from '../src/data'
import type { MetaState, MetaUpgradeDef } from '../src/sim/types'
import { makeRun, makeTestContent } from './fixtures'

const unlockDef: MetaUpgradeDef = {
  id: 'open-ice',
  name: 'Open Ice',
  blurb: 'Unlocks the ice world for tests.',
  baseCost: 4,
  costMult: 2,
  maxLevel: 1,
  effect: { kind: 'unlock-archetype', archetypeId: 'test-ice' },
}

const content = makeTestContent()
const withUnlock = makeTestContent({
  upgrades: [...content.upgrades, unlockDef],
})

function makeMeta(overrides: Partial<MetaState> = {}): MetaState {
  return {
    genesisSeeds: 0,
    upgrades: {},
    codex: [],
    unlockedArchetypes: ['test-rock'],
    stats: { runs: 0, bestEra: 0, longestRun: 0 },
    ...overrides,
  }
}

describe('unlock-archetype upgrades', () => {
  it('buying appends the archetype to unlockedArchetypes', () => {
    const meta = buyUpgrade(
      makeMeta({ genesisSeeds: 5 }),
      withUnlock,
      'open-ice',
    )
    expect(meta.genesisSeeds).toBe(1)
    expect(meta.upgrades['open-ice']).toBe(1)
    expect(meta.unlockedArchetypes).toContain('test-ice')
    expect(meta.unlockedArchetypes).toContain('test-rock')
  })

  it('never duplicates an already-unlocked archetype', () => {
    const meta = buyUpgrade(
      makeMeta({
        genesisSeeds: 5,
        unlockedArchetypes: ['test-rock', 'test-ice'],
      }),
      withUnlock,
      'open-ice',
    )
    expect(
      meta.unlockedArchetypes.filter((a) => a === 'test-ice'),
    ).toHaveLength(1)
  })

  it('has no effect on the derived Content bundle', () => {
    expect(applyMetaUpgrades(withUnlock, { 'open-ice': 1 })).toBe(withUnlock)
  })
})

describe('shipped Frozen / Volcanic (SPEC §2.9 launch twists)', () => {
  const shipped = loadContent()
  const frozen = shipped.archetypes.find((a) => a.id === 'frozen')
  const volcanic = shipped.archetypes.find((a) => a.id === 'volcanic')

  it('both ship in archetypes.json alongside Barren', () => {
    expect(frozen).toBeDefined()
    expect(volcanic).toBeDefined()
    expect(shipped.archetypes.find((a) => a.id === 'barren')).toBeDefined()
  })

  it('Frozen: thermal starts at the cold edge of the band and is pulled colder', () => {
    const era1 = shipped.eras[0]!
    expect(frozen!.systems.thermal.start).toBeLessThanOrEqual(
      era1.bands.thermal[0] + 3,
    )
    // The twist is the drift: with no machines the world pulls toward deep cold.
    const run = newRun(shipped, 7, 'frozen')
    const { target } = driftTarget(run, shipped, 'thermal')
    expect(target).toBeLessThan(frozen!.systems.thermal.start)
  })

  it('Volcanic: thermal starts at the hot edge and is pulled hotter', () => {
    const era1 = shipped.eras[0]!
    expect(volcanic!.systems.thermal.start).toBeGreaterThanOrEqual(
      era1.bands.thermal[1] - 3,
    )
    const run = newRun(shipped, 7, 'volcanic')
    const { target } = driftTarget(run, shipped, 'thermal')
    expect(target).toBeGreaterThan(volcanic!.systems.thermal.start)
  })

  it('both are Seed-gated behind unlock-archetype upgrades', () => {
    const unlockIds = shipped.upgrades
      .filter((u) => u.effect.kind === 'unlock-archetype')
      .map((u) => (u.effect as { archetypeId: string }).archetypeId)
    expect(unlockIds).toContain('frozen')
    expect(unlockIds).toContain('volcanic')
  })

  it('each has archetype-gated cards, and every era still has a pool', () => {
    for (const id of ['frozen', 'volcanic']) {
      const gated = shipped.cards.filter((c) => c.archetypes?.includes(id))
      expect(gated.length, `${id} gated cards`).toBeGreaterThanOrEqual(2)
      let run = newRun(shipped, 3, id)
      for (let era = 0; era < shipped.eras.length; era++) {
        run = { ...run, era }
        expect(
          cardPool(run, shipped).length,
          `${id} pool at era ${era + 1}`,
        ).toBeGreaterThan(0)
      }
    }
  })
})

describe('fixture sanity', () => {
  it('makeTestContent overrides still validate the shape', () => {
    expect(makeRun(withUnlock)).toBeDefined()
  })
})
