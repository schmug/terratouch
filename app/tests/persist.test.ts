// persist.test.ts — save-migration switch (SPEC §4.4, §6). The IndexedDB
// wrapper itself is exercised in the browser; the migration logic is pure.
import { describe, expect, it } from 'vitest'
import { migrateSave } from '../src/persist/db'
import { newRun } from '../src/sim/actions'
import { loadContent } from '../src/data'
import type { Save } from '../src/sim/types'

const validSave = (): Save => ({
  schemaVersion: 1,
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
  it('passes a current (v1) save through intact', () => {
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
