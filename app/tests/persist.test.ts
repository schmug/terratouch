// persist.test.ts — save-migration switch (SPEC §4.4, §6). The IndexedDB
// wrapper itself is exercised in the browser; the migration logic is pure.
import { describe, expect, it } from 'vitest'
import { migrateSave } from '../src/persist/db'
import { newRun } from '../src/sim/actions'
import { seedPhenoRng } from '../src/sim/rng'
import { loadContent } from '../src/data'
import type { Save } from '../src/sim/types'
import { makeTestContent } from './fixtures'

const validSave = (): Save => ({
  schemaVersion: 3,
  run: newRun(loadContent(), 99, 'barren'),
  meta: {
    genesisSeeds: 0,
    upgrades: {},
    codex: [],
    unlockedArchetypes: ['barren'],
    stats: { runs: 3, bestEra: 2, longestRun: 40 },
  },
  lastSeenMs: 1_752_400_000_000,
})

describe('save migration switch', () => {
  it('passes a current (v3) save through intact', () => {
    const save = validSave()
    expect(migrateSave(save)).toEqual(save)
  })

  it('accepts a between-runs save (run: null)', () => {
    const save = { ...validSave(), run: null }
    expect(migrateSave(save)).toEqual(save)
  })

  it('returns null for garbage rather than crashing', () => {
    expect(migrateSave(undefined)).toBeNull()
    expect(migrateSave(null)).toBeNull()
    expect(migrateSave('corrupt')).toBeNull()
    expect(migrateSave(42)).toBeNull()
    expect(migrateSave({})).toBeNull()
    expect(migrateSave({ schemaVersion: 1 })).toBeNull() // missing fields
    expect(
      migrateSave({ schemaVersion: 1, meta: {}, lastSeenMs: 'later' }),
    ).toBeNull()
  })

  it('returns null for unknown future schema versions', () => {
    expect(migrateSave({ ...validSave(), schemaVersion: 999 })).toBeNull()
  })
})

describe('v1 → v3 migration chain (active-play fields, then arrival stamp)', () => {
  it('upgrades a v1 save in place with inert defaults', () => {
    const content = makeTestContent()
    const run = newRun(content, 42, 'test-rock')
    // Simulate a stored v1 run: strip the v2 fields and the v3 history stamp.
    const v1history: Record<string, unknown> = { ...run.history }
    delete v1history['turnsToFinalEra']
    const v1run: Record<string, unknown> = { ...run, history: v1history }
    delete v1run['activeSec']
    delete v1run['phenoRngState']
    delete v1run['phenomenon']
    delete v1run['tailwind']
    delete v1run['nextPhenomenonAtSec']
    const v1save = {
      schemaVersion: 1,
      run: v1run,
      meta: {
        genesisSeeds: 3,
        upgrades: {},
        codex: [],
        unlockedArchetypes: ['test-rock'],
        stats: { runs: 1, bestEra: 0, longestRun: 4 },
      },
      lastSeenMs: 1_700_000_000_000,
    }
    const migrated = migrateSave(v1save)
    expect(migrated).not.toBeNull()
    expect(migrated!.schemaVersion).toBe(3)
    expect(migrated!.run!.activeSec).toBe(0)
    expect(migrated!.run!.phenoRngState).toBe(seedPhenoRng(42))
    expect(migrated!.run!.phenomenon).toBeNull()
    expect(migrated!.run!.tailwind).toBeNull()
    expect(migrated!.run!.nextPhenomenonAtSec).toBe(0)
    expect(migrated!.run!.history.turnsToFinalEra).toBeNull()
    expect(migrated!.meta.genesisSeeds).toBe(3) // meta untouched
  })

  it('a run-less v1 save migrates without inventing a run', () => {
    const v1 = {
      schemaVersion: 1,
      run: null,
      meta: {
        genesisSeeds: 0,
        upgrades: {},
        codex: [],
        unlockedArchetypes: ['barren'],
        stats: { runs: 0, bestEra: 0, longestRun: 0 },
      },
      lastSeenMs: 1,
    }
    const migrated = migrateSave(v1)
    expect(migrated!.schemaVersion).toBe(3)
    expect(migrated!.run).toBeNull()
  })
})

describe('v2 → v3 migration (Ascension efficiency arrival stamp)', () => {
  /** A stored v2 run: today's shape minus history.turnsToFinalEra. */
  function v2run(): Record<string, unknown> {
    const run = newRun(makeTestContent(), 42, 'test-rock')
    const history: Record<string, unknown> = { ...run.history }
    delete history['turnsToFinalEra']
    return { ...run, history }
  }

  it('upgrades a v2 save in place with a null arrival stamp', () => {
    const v2save = {
      schemaVersion: 2,
      run: v2run(),
      meta: {
        genesisSeeds: 12,
        upgrades: { 'spore-priming': 1 },
        codex: [],
        unlockedArchetypes: ['test-rock'],
        stats: { runs: 4, bestEra: 3, longestRun: 60 },
      },
      lastSeenMs: 1_752_500_000_000,
    }
    const migrated = migrateSave(v2save)
    expect(migrated).not.toBeNull()
    expect(migrated!.schemaVersion).toBe(3)
    // Null arrival: seedYield falls back to the run's turn count, which can
    // only under-pay the bonus — never worse than the pre-bonus yield.
    expect(migrated!.run!.history.turnsToFinalEra).toBeNull()
    expect(migrated!.run!.history.peakHabitability).toBe(0)
    expect(migrated!.meta.genesisSeeds).toBe(12) // meta untouched
    expect(migrated!.lastSeenMs).toBe(1_752_500_000_000)
  })

  it('a run-less v2 save migrates without inventing a run', () => {
    const v2save = {
      schemaVersion: 2,
      run: null,
      meta: {
        genesisSeeds: 0,
        upgrades: {},
        codex: [],
        unlockedArchetypes: ['test-rock'],
        stats: { runs: 0, bestEra: 0, longestRun: 0 },
      },
      lastSeenMs: 1,
    }
    const migrated = migrateSave(v2save)
    expect(migrated!.schemaVersion).toBe(3)
    expect(migrated!.run).toBeNull()
  })
})
