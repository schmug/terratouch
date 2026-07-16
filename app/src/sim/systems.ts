// systems.ts — the four gauges (Thermal/Atmosphere/Hydro/Biosphere), safe
// bands, Habitability, Instability accrual/decay, and collapse detection
// (SPEC §2.2, §2.4). Pure functions over plain state.

import { seedYield } from './prestige'
import {
  SYSTEM_IDS,
  type Balance,
  type CollapseCause,
  type CollapseReport,
  type Content,
  type MachineInstance,
  type RunState,
  type SystemId,
  type SystemState,
} from './types'

/** Total passive minerals per second from machines (before the planet's base rate). */
export function machineProductionRate(
  machines: readonly MachineInstance[],
  content: Content,
): number {
  let rate = 0
  for (const m of machines) {
    const def = content.machines.find((d) => d.id === m.typeId)
    if (def) rate += def.productionPerSecPerLevel * m.level
  }
  return rate
}

/** Total minerals per second flowing into the tap pool. */
export function productionRate(run: RunState, content: Content): number {
  return (
    content.balance.tap.baseRatePerSec +
    machineProductionRate(run.machines, content)
  )
}

/** True when value sits inside the safe band (inclusive edges are safe). */
export function inBand(s: SystemState): boolean {
  return s.value >= s.band[0] && s.value <= s.band[1]
}

/**
 * How deep into its band a system sits: 1 at band center, 0 at either band
 * edge or anywhere outside (SPEC §2.3 "how deep into each system's band").
 */
export function bandDepth(s: SystemState): number {
  const [lo, hi] = s.band
  const mid = (lo + hi) / 2
  const half = (hi - lo) / 2
  if (half <= 0) return 0
  return Math.max(0, 1 - Math.abs(s.value - mid) / half)
}

/** Overall Habitability, 0–100: mean band-depth across the four systems. */
export function habitability(systems: Record<SystemId, SystemState>): number {
  let sum = 0
  for (const id of SYSTEM_IDS) sum += bandDepth(systems[id])
  return Math.round((sum / SYSTEM_IDS.length) * 100)
}

/** Ids of systems currently outside their safe band. */
export function systemsOutOfBand(
  systems: Record<SystemId, SystemState>,
): SystemId[] {
  return SYSTEM_IDS.filter((id) => !inBand(systems[id]))
}

/**
 * Hard fail: any gauge at 0 or 100 (SPEC §2.4). Only card deltas can get a
 * gauge there — drift is asymptotic and offline is band-clamped.
 */
export function detectHardFail(
  systems: Record<SystemId, SystemState>,
): CollapseCause | null {
  for (const id of SYSTEM_IDS) {
    const v = systems[id].value
    if (v <= 0) return { kind: 'hard-fail', system: id, direction: 'low' }
    if (v >= 100) return { kind: 'hard-fail', system: id, direction: 'high' }
  }
  return null
}

/**
 * One Instability step, taken once per ACTIVE turn (card resolved) — never
 * on ticks and never offline (SPEC §1.3, §2.4). Each out-of-band system adds
 * accrual, scaled by the Era's volatility (later worlds punish drift harder,
 * SPEC §2.3); an all-clear turn bleeds Instability back down at a flat rate.
 */
export function instabilityStep(
  instability: number,
  systems: Record<SystemId, SystemState>,
  balance: Balance,
  volatilityMult = 1,
): number {
  const out = systemsOutOfBand(systems).length
  if (out === 0) {
    return Math.max(0, instability - balance.instability.decayPerTurn)
  }
  return (
    instability +
    out * balance.instability.accrualPerSystemPerTurn * volatilityMult
  )
}

/** Cascade fail: Instability past the threshold (SPEC §2.4). */
export function isCascade(instability: number, balance: Balance): boolean {
  return instability >= balance.instability.cascadeThreshold
}

/**
 * Which system a cascade collapse pins the blame on: the one that spent the
 * most active turns outside its band (ties break in SYSTEM_IDS order), and
 * which lethal edge it was straying toward.
 */
export function cascadeCause(run: RunState): CollapseCause {
  let worst: SystemId = SYSTEM_IDS[0]
  let worstTurns = -1
  for (const id of SYSTEM_IDS) {
    const t = run.history.turnsOutOfBand[id]
    if (t > worstTurns) {
      worst = id
      worstTurns = t
    }
  }
  const s = run.systems[worst]
  const mid = (s.band[0] + s.band[1]) / 2
  return {
    kind: 'cascade',
    system: worst,
    direction: s.value < mid ? 'low' : 'high',
  }
}

const SYSTEM_LABEL: Record<SystemId, string> = {
  thermal: 'thermal balance',
  atmosphere: 'atmosphere',
  hydro: 'waters',
  biosphere: 'biosphere',
}

/** Build the CollapseReport (SPEC §5.3) that drives the loss screen + LLM. */
export function buildCollapseReport(
  run: RunState,
  content: Content,
  cause: CollapseCause,
): CollapseReport {
  const archetype = content.archetypes.find((a) => a.id === run.archetypeId)
  const era = content.eras[run.era]
  const systemsFinal = {} as Record<SystemId, number>
  for (const id of SYSTEM_IDS) {
    systemsFinal[id] = Math.round(run.systems[id].value * 10) / 10
  }

  const notable: string[] = []
  for (const id of SYSTEM_IDS) {
    const t = run.history.turnsOutOfBand[id]
    if (t >= 3)
      notable.push(
        `the ${SYSTEM_LABEL[id]} spent ${t} turns outside the safe band`,
      )
  }
  notable.sort() // deterministic order regardless of accumulation order
  if (run.history.peakHabitability > 0) {
    notable.push(`habitability peaked at ${run.history.peakHabitability}`)
  }
  if (run.history.machinesBuilt > 0) {
    const n = run.history.machinesBuilt
    notable.push(`${n} machine${n === 1 ? '' : 's'} hummed to the end`)
  }

  return {
    archetype: archetype?.name ?? run.archetypeId,
    eraReached: era?.name ?? `Era ${run.era + 1}`,
    turnsSurvived: run.turns,
    cause,
    systemsFinal,
    peakHabitability: run.history.peakHabitability,
    notableStats: notable.slice(0, 4),
    seedsAwarded: seedYield(
      run,
      content,
      cause.kind === 'ascension' ? 'ascension' : 'collapse',
    ),
  }
}

/**
 * Add bonus Energy (phenomena, contract rewards, +energy cards). Bonus gains
 * may OVERFILL the cap by balance.energy.reserve; regen never does, and
 * nothing passive ever reduces an existing overfill.
 */
export function gainEnergy(
  current: number,
  amount: number,
  balance: Balance,
): number {
  if (amount <= 0) return current
  return Math.min(balance.energy.cap + balance.energy.reserve, current + amount)
}

/**
 * Apply an Era transition: bands shift to the new Era's targets (SPEC §2.3).
 * Values and setpoints are untouched — holding the climbing band IS the game.
 */
export function shiftBandsToEra(
  systems: Record<SystemId, SystemState>,
  content: Content,
  era: number,
): Record<SystemId, SystemState> {
  const def = content.eras[era]
  if (!def) throw new Error(`no era ${era}`)
  const next = {} as Record<SystemId, SystemState>
  for (const id of SYSTEM_IDS) {
    next[id] = { ...systems[id], band: def.bands[id] }
  }
  return next
}
