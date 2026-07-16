// actions.ts — player actions outside the card flow: starting a run,
// tap-to-collect (SPEC §2.6), building/upgrading machines, and setting
// system setpoints. Pure functions over plain state, like all of sim/.
// (Not in SPEC §4.2's file list — split out so tick.ts stays time-only.)

import { canAscend } from './prestige'
import { seedPhenoRng, seedRng } from './rng'
import { buildCollapseReport } from './systems'
import {
  SimError,
  SYSTEM_IDS,
  type Content,
  type MachineDef,
  type RunState,
  type SystemId,
  type SystemState,
} from './types'

/** Start a fresh run of the given archetype from a seed. */
export function newRun(
  content: Content,
  seed: number,
  archetypeId: string,
): RunState {
  const arch = content.archetypes.find((a) => a.id === archetypeId)
  if (!arch)
    throw new SimError('unknown-archetype', `unknown archetype ${archetypeId}`)
  const era0 = content.eras[0]
  if (!era0) throw new Error('content has no eras')

  const systems = {} as Record<SystemId, SystemState>
  const turnsOutOfBand = {} as Record<SystemId, number>
  for (const id of SYSTEM_IDS) {
    const def = arch.systems[id]
    systems[id] = {
      value: def.start,
      band: era0.bands[id],
      setpoint: def.setpoint,
    }
    turnsOutOfBand[id] = 0
  }

  return {
    seed,
    rngState: seedRng(seed),
    archetypeId,
    era: 0,
    eraProgressSec: 0,
    systems,
    instability: 0,
    resources: { minerals: arch.startingMinerals },
    uncollected: 0,
    machines: [],
    energy: content.balance.energy.cap,
    turns: 0,
    activeCardId: null,
    recentCardIds: [],
    activeSec: 0,
    phenoRngState: seedPhenoRng(seed),
    phenomenon: null,
    tailwind: null,
    nextPhenomenonAtSec: 0,
    history: { peakHabitability: 0, turnsOutOfBand, machinesBuilt: 0 },
    collapse: null,
  }
}

/**
 * Voluntary Ascension (SPEC §2.8): end a run at the final era for the max
 * Genesis Seed yield. The run's board is otherwise untouched — the report is
 * the record of the world as you left it. The cause's system/direction are
 * fixed ('biosphere' rising) purely so the report shape stays uniform.
 */
export function ascend(run: RunState, content: Content): RunState {
  if (!canAscend(run, content)) throw new SimError('cannot-ascend')
  const report = buildCollapseReport(run, content, {
    kind: 'ascension',
    system: 'biosphere',
    direction: 'high',
  })
  return { ...run, collapse: report }
}

/** Collect the tap pool with the active-play bonus (SPEC §2.6). */
export function tapCollect(
  run: RunState,
  content: Content,
): { run: RunState; collected: number } {
  if (run.collapse) throw new SimError('run-over')
  const collected =
    Math.round(run.uncollected * content.balance.tap.bonusMult * 10) / 10
  if (collected <= 0) return { run, collected: 0 }
  return {
    run: {
      ...run,
      uncollected: 0,
      resources: {
        ...run.resources,
        minerals: run.resources.minerals + collected,
      },
    },
    collected,
  }
}

export function machineDef(content: Content, typeId: string): MachineDef {
  const def = content.machines.find((m) => m.id === typeId)
  if (!def) throw new SimError('unknown-machine', `unknown machine ${typeId}`)
  return def
}

/** Cost to bring a machine type to `level` (level 1 = initial build). */
export function machineCost(def: MachineDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.costMult, level - 1))
}

/** The single instance of a machine type, if built (M1: one per type). */
export function machineOfType(run: RunState, typeId: string) {
  return run.machines.find((m) => m.typeId === typeId)
}

/** Era gate (unlockEra is 1-based, like card gates); eras only climb. */
export function machineUnlocked(run: RunState, def: MachineDef): boolean {
  return def.unlockEra === undefined || run.era + 1 >= def.unlockEra
}

/**
 * Build a machine (level 1) or upgrade the existing one by a level, paying
 * minerals. M1 keeps one instance per machine type.
 */
export function buildOrUpgrade(
  run: RunState,
  content: Content,
  typeId: string,
): RunState {
  if (run.collapse) throw new SimError('run-over')
  const def = machineDef(content, typeId)
  if (!machineUnlocked(run, def)) throw new SimError('machine-locked')
  const existing = machineOfType(run, typeId)
  const targetLevel = (existing?.level ?? 0) + 1
  if (targetLevel > def.maxLevel) throw new SimError('max-level')
  const cost = machineCost(def, targetLevel)
  if (run.resources.minerals < cost) throw new SimError('no-minerals')

  const machines = existing
    ? run.machines.map((m) =>
        m.id === existing.id ? { ...m, level: targetLevel } : m,
      )
    : [...run.machines, { id: `m-${typeId}`, typeId, level: 1 }]

  return {
    ...run,
    machines,
    resources: { ...run.resources, minerals: run.resources.minerals - cost },
    history: existing
      ? run.history
      : { ...run.history, machinesBuilt: run.history.machinesBuilt + 1 },
  }
}

/**
 * Set a system's setpoint (where machines push it). Requires a machine on
 * that system; clamped to the configured safe range so drift alone can never
 * reach a lethal edge.
 */
export function setSetpoint(
  run: RunState,
  content: Content,
  system: SystemId,
  value: number,
): RunState {
  if (run.collapse) throw new SimError('run-over')
  const hasMachine = run.machines.some(
    (m) => machineDef(content, m.typeId).system === system,
  )
  if (!hasMachine) throw new SimError('no-machine-for-system')
  const { min, max } = content.balance.setpoint
  const clamped = Math.min(max, Math.max(min, value))
  return {
    ...run,
    systems: {
      ...run.systems,
      [system]: { ...run.systems[system], setpoint: clamped },
    },
  }
}
