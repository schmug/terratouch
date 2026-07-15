// meta-upgrades.test.ts — the Seed shop (SPEC §2.8, M2): buying permanent
// meta-upgrades and applying them as a derived effective Content bundle.
// Also covers the machine unlockEra gate (issue #3's Spore Garden mechanism).
import { describe, expect, it } from 'vitest'
import {
  ascend,
  buildOrUpgrade,
  machineUnlocked,
  newRun,
} from '../src/sim/actions'
import { applyOffline } from '../src/sim/offline'
import { applyMetaUpgrades, buyUpgrade, upgradeCost } from '../src/sim/prestige'
import { instabilityStep } from '../src/sim/systems'
import { SimError, type MetaState } from '../src/sim/types'
import { makeRun, makeTestContent } from './fixtures'

const content = makeTestContent()

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

describe('upgradeCost / buyUpgrade', () => {
  // Fixture def: flywheel baseCost=2, costMult=2, maxLevel=2.
  const def = content.upgrades.find((u) => u.id === 'flywheel')!

  it('cost grows geometrically per level', () => {
    expect(upgradeCost(def, 1)).toBe(2)
    expect(upgradeCost(def, 2)).toBe(4)
  })

  it('buying deducts Seeds and raises the level', () => {
    const meta = buyUpgrade(makeMeta({ genesisSeeds: 10 }), content, 'flywheel')
    expect(meta.genesisSeeds).toBe(8)
    expect(meta.upgrades['flywheel']).toBe(1)
    const again = buyUpgrade(meta, content, 'flywheel')
    expect(again.genesisSeeds).toBe(4)
    expect(again.upgrades['flywheel']).toBe(2)
  })

  it('rejects unknown ids, empty pockets, and maxed upgrades', () => {
    expect(() =>
      buyUpgrade(makeMeta({ genesisSeeds: 99 }), content, 'nope'),
    ).toThrow(SimError)
    expect(() =>
      buyUpgrade(makeMeta({ genesisSeeds: 1 }), content, 'flywheel'),
    ).toThrow(SimError)
    const maxed = makeMeta({ genesisSeeds: 99, upgrades: { flywheel: 2 } })
    expect(() => buyUpgrade(maxed, content, 'flywheel')).toThrow(SimError)
  })
})

describe('applyMetaUpgrades → effective Content', () => {
  it('no upgrades: returns the very same bundle (cheap identity)', () => {
    expect(applyMetaUpgrades(content, {})).toBe(content)
    expect(applyMetaUpgrades(content, { unknown: 3 })).toBe(content)
  })

  it('machine-push-mult compounds machine push rates per level', () => {
    // flywheel: +50%/level; base test-heater push = 0.05.
    const eff = applyMetaUpgrades(content, { flywheel: 2 })
    expect(eff.machines[0]!.pushRatePerSecPerLevel).toBeCloseTo(
      0.05 * 1.5 * 1.5,
    )
    // The base bundle is never mutated.
    expect(content.machines[0]!.pushRatePerSecPerLevel).toBe(0.05)
  })

  it('instability-accrual-mult makes active-turn accrual gentler', () => {
    // calm: −50%/level on accrual (10 → 5); decay untouched.
    const eff = applyMetaUpgrades(content, { calm: 1 })
    expect(eff.balance.instability.accrualPerSystemPerTurn).toBeCloseTo(5)
    expect(eff.balance.instability.decayPerTurn).toBe(5)
    const run = makeRun(content)
    const outOfBand = {
      ...run.systems,
      thermal: { ...run.systems.thermal, value: 5 },
    }
    expect(instabilityStep(0, outOfBand, eff.balance)).toBeCloseTo(5)
  })

  it('starting-minerals and energy-cap land when newRun builds state', () => {
    // cache: +10 minerals/level; battery: +5 cap/level.
    const eff = applyMetaUpgrades(content, { cache: 2, battery: 1 })
    const run = newRun(eff, 42, 'test-rock')
    expect(run.resources.minerals).toBe(100 + 20)
    expect(run.energy).toBe(10 + 5) // starts at the (raised) cap
  })

  it('offline-cap-hours raises the cap without breaking offline safety', () => {
    // orbit: +4h/level over the base 8h.
    const eff = applyMetaUpgrades(content, { orbit: 2 })
    expect(eff.balance.offline.maxHours).toBe(16)
    const run = makeRun(eff)
    const dayMs = 24 * 3600_000
    const { run: caught, summary } = applyOffline(run, eff, dayMs)
    expect(summary.capped).toBe(true)
    expect(summary.elapsedMs).toBe(16 * 3600_000)
    // The invariant survives a bigger cap: no Instability, no band crossing.
    expect(caught.instability).toBe(run.instability)
    for (const id of ['thermal', 'atmosphere', 'hydro', 'biosphere'] as const) {
      const s = caught.systems[id]
      expect(s.value).toBeGreaterThanOrEqual(
        Math.min(run.systems[id].value, s.band[0]),
      )
      expect(s.value).toBeLessThanOrEqual(
        Math.max(run.systems[id].value, s.band[1]),
      )
    }
  })

  it('levels are clamped to maxLevel when applying', () => {
    const eff = applyMetaUpgrades(content, { flywheel: 99 })
    expect(eff.machines[0]!.pushRatePerSecPerLevel).toBeCloseTo(
      0.05 * 1.5 * 1.5,
    )
  })
})

describe('machine unlockEra gate (issue #3 mechanism)', () => {
  // Fixture: test-digester unlocks at era 2.
  it('a gated machine cannot be built before its era', () => {
    const run = makeRun(content)
    const def = content.machines.find((m) => m.id === 'test-digester')!
    expect(machineUnlocked(run, def)).toBe(false)
    expect(() => buildOrUpgrade(run, content, 'test-digester')).toThrow(
      SimError,
    )
  })

  it('unlocks once the run reaches the gate era', () => {
    const run = { ...makeRun(content), era: 1 }
    const def = content.machines.find((m) => m.id === 'test-digester')!
    expect(machineUnlocked(run, def)).toBe(true)
    const built = buildOrUpgrade(run, content, 'test-digester')
    expect(built.machines.some((m) => m.typeId === 'test-digester')).toBe(true)
  })

  it('ungated machines are always unlocked', () => {
    const run = makeRun(content)
    const def = content.machines.find((m) => m.id === 'test-heater')!
    expect(machineUnlocked(run, def)).toBe(true)
  })
})

describe('meta compounding end to end', () => {
  it('a returning player is measurably stronger (SPEC M2 acceptance)', () => {
    // Bank an Ascension, spend it, and start over: the next world begins
    // with more minerals and a higher energy ceiling than a fresh one.
    let meta = makeMeta()
    const ended = ascend({ ...makeRun(content), era: 1 }, content)
    meta = {
      ...meta,
      genesisSeeds: meta.genesisSeeds + ended.collapse!.seedsAwarded,
    }
    meta = buyUpgrade(meta, content, 'cache')
    meta = buyUpgrade(meta, content, 'battery')
    const eff = applyMetaUpgrades(content, meta.upgrades)
    const fresh = newRun(content, 1, 'test-rock')
    const returning = newRun(eff, 1, 'test-rock')
    expect(returning.resources.minerals).toBeGreaterThan(
      fresh.resources.minerals,
    )
    expect(returning.energy).toBeGreaterThan(fresh.energy)
  })
})
