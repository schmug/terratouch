// db.ts — IndexedDB load/save (idb) + schema migrations (SPEC §4.4).
// Single versioned Save object under one key; schemaVersion: 1 from day one
// with a migration switch. Never localStorage for the authoritative save.

import { openDB, type IDBPDatabase } from 'idb'
import { seedPhenoRng } from '../sim/rng'
import type { RunState, Save } from '../sim/types'

const DB_NAME = 'terratouch'
const DB_VERSION = 1
const STORE = 'saves'
const KEY = 'main'

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE)
    },
  })
  return dbPromise
}

type ActivePlayField =
  | 'activeSec'
  | 'phenoRngState'
  | 'phenomenon'
  | 'tailwind'
  | 'nextPhenomenonAtSec'

/**
 * Migration switch (SPEC §4.4). Pure — exported for tests. Returns null for
 * anything unrecognized (treated as no save, so the game starts fresh rather
 * than crashing on corrupt data).
 *
 * When the save shape changes: bump the schemaVersion literal in types.ts,
 * add a `case <old>:` here that upgrades the object, and fall through.
 */
export function migrateSave(raw: unknown): Save | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  const candidate = raw as { schemaVersion?: unknown }
  switch (candidate.schemaVersion) {
    case 1: {
      // v1 → v2: add the active-play fields (Session Arc slice A) with inert
      // defaults, then continue up the chain via recursion.
      const v1 = raw as Omit<Save, 'schemaVersion' | 'run'> & {
        schemaVersion: 1
        run: (Omit<RunState, ActivePlayField> & Partial<RunState>) | null
      }
      const run: RunState | null =
        v1.run === null || v1.run === undefined
          ? null
          : {
              ...v1.run,
              activeSec: 0,
              phenoRngState: seedPhenoRng(v1.run.seed),
              phenomenon: null,
              tailwind: null,
              nextPhenomenonAtSec: 0,
            }
      return migrateSave({ ...v1, schemaVersion: 2, run })
    }
    case 2: {
      // v2 → v3: stamp history.turnsToFinalEra (Ascension efficiency bonus,
      // issue #28). Null = arrival unknown; seedYield then falls back to the
      // run's turn count, which can only under-pay the bonus — never below
      // the pre-bonus yield. (No Content here, so a run already AT the final
      // era can't be told apart from one mid-climb; null is safe for both,
      // and mid-climb runs get stamped properly by tick on arrival.)
      const v2 = raw as Omit<Save, 'schemaVersion' | 'run'> & {
        schemaVersion: 2
        run:
          | (Omit<RunState, 'history'> & {
              history: Omit<RunState['history'], 'turnsToFinalEra'>
            })
          | null
      }
      const run: RunState | null =
        v2.run === null || v2.run === undefined
          ? null
          : {
              ...v2.run,
              history: { ...v2.run.history, turnsToFinalEra: null },
            }
      return migrateSave({ ...v2, schemaVersion: 3, run })
    }
    case 3: {
      const save = raw as Save
      if (typeof save.lastSeenMs !== 'number' || save.meta === undefined)
        return null
      if (
        save.run !== undefined &&
        save.run !== null &&
        typeof save.run.seed !== 'number'
      ) {
        return null
      }
      return save
    }
    default:
      console.warn(
        'terratouch: unknown save schemaVersion, starting fresh',
        candidate.schemaVersion,
      )
      return null
  }
}

export async function loadSave(): Promise<Save | null> {
  try {
    const raw: unknown = await (await db()).get(STORE, KEY)
    return migrateSave(raw)
  } catch (err) {
    console.warn('terratouch: failed to load save', err)
    return null
  }
}

export async function writeSave(save: Save): Promise<void> {
  await (await db()).put(STORE, save, KEY)
}
