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
  schemaVersion: 2,
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
  it('passes a current (v2) save through intact', () => {
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

describe('v1 → v2 migration (active-play fields)', () => {
  it('upgrades a v1 save in place with inert defaults', () => {
    const content = makeTestContent()
    const run = newRun(content, 42, 'test-rock')
    // Simulate a stored v1 run: strip the v2 fields.
    const v1run: Record<string, unknown> = { ...run }
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
    expect(migrated!.schemaVersion).toBe(2)
    expect(migrated!.run!.activeSec).toBe(0)
    expect(migrated!.run!.phenoRngState).toBe(seedPhenoRng(42))
    expect(migrated!.run!.phenomenon).toBeNull()
    expect(migrated!.run!.tailwind).toBeNull()
    expect(migrated!.run!.nextPhenomenonAtSec).toBe(0)
    expect(migrated!.meta.genesisSeeds).toBe(3) // meta untouched
  })

  it('passes a v2 save through unchanged', () => {
    const content = makeTestContent()
    const save = {
      schemaVersion: 2,
      run: newRun(content, 7, 'test-rock'),
      meta: {
        genesisSeeds: 0,
        upgrades: {},
        codex: [],
        unlockedArchetypes: ['test-rock'],
        stats: { runs: 1, bestEra: 0, longestRun: 0 },
      },
      lastSeenMs: 1_700_000_000_000,
    }
    expect(migrateSave(save)).toEqual(save)
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
    expect(migrated!.schemaVersion).toBe(2)
    expect(migrated!.run).toBeNull()
  })
})
