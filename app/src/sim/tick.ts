// tick.ts — fixed-timestep advance: resource production, drift-to-setpoint,
// Energy regen, Era stabilization progress (SPEC §4.3). Time deltas are
// PASSED IN; never read the wall clock here.
//
// Drift model: each gauge relaxes exponentially toward an influence-weighted
// blend of the archetype's natural rest point and the player's setpoint
// (weighted by total machine push). Exponential approach never overshoots,
// so ticking can NEVER hard-fail a gauge — danger comes only from cards.

import { habitability, shiftBandsToEra } from './systems'
import {
  SYSTEM_IDS,
  type ArchetypeDef,
  type Content,
  type MachineInstance,
  type RunState,
  type SystemId,
  type SystemState,
} from './types'

function archetypeOf(run: RunState, content: Content): ArchetypeDef {
  const a = content.archetypes.find((x) => x.id === run.archetypeId)
  if (!a) throw new Error(`unknown archetype ${run.archetypeId}`)
  return a
}

/** Total machine push rate (per second) applied to one system. */
export function machinePushRate(
  machines: readonly MachineInstance[],
  content: Content,
  system: SystemId,
): number {
  let rate = 0
  for (const m of machines) {
    const def = content.machines.find((d) => d.id === m.typeId)
    if (def && def.system === system)
      rate += def.pushRatePerSecPerLevel * m.level
  }
  return rate
}

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

/**
 * The value a gauge is drifting toward and how fast: blend of natural rest
 * and setpoint, weighted by pull rates. `rate` is the exponential constant.
 */
export function driftTarget(
  run: RunState,
  content: Content,
  system: SystemId,
): { target: number; rate: number } {
  const arch = archetypeOf(run, content)
  const nat = arch.systems[system]
  const push = machinePushRate(run.machines, content, system)
  const rate = nat.naturalRatePerSec + push
  if (rate <= 0) return { target: run.systems[system].value, rate: 0 }
  const target =
    (nat.naturalRest * nat.naturalRatePerSec +
      run.systems[system].setpoint * push) /
    rate
  return { target, rate }
}

/** Closed-form exponential relaxation of `value` toward `target` over dt. */
export function relax(
  value: number,
  target: number,
  rate: number,
  dtSec: number,
): number {
  if (rate <= 0 || dtSec <= 0) return value
  return target + (value - target) * Math.exp(-rate * dtSec)
}

/** Sign of a gauge's current drift, for UI arrows: -1, 0, or 1. */
export function driftDirection(
  run: RunState,
  content: Content,
  system: SystemId,
): -1 | 0 | 1 {
  const { target, rate } = driftTarget(run, content, system)
  if (rate <= 0) return 0
  const gap = target - run.systems[system].value
  if (Math.abs(gap) < 0.5) return 0
  return gap > 0 ? 1 : -1
}

/** Total minerals per second flowing into the tap pool. */
export function productionRate(run: RunState, content: Content): number {
  return (
    content.balance.tap.baseRatePerSec +
    machineProductionRate(run.machines, content)
  )
}

/**
 * Advance the run by dtSec of ACTIVE play. Pure; returns a new state.
 * Collapse can never happen inside a tick (SPEC §1.3: danger is card-driven).
 */
export function tick(run: RunState, content: Content, dtSec: number): RunState {
  if (dtSec <= 0 || run.collapse) return run
  const { balance } = content

  // Gauges drift toward their blended targets.
  const systems = {} as Record<SystemId, SystemState>
  for (const id of SYSTEM_IDS) {
    const s = run.systems[id]
    const { target, rate } = driftTarget(run, content, id)
    systems[id] = { ...s, value: relax(s.value, target, rate, dtSec) }
  }

  // Production accrues into the tap pool, up to a cap (SPEC §2.6).
  const rate = productionRate(run, content)
  const poolCap = rate * balance.tap.poolCapSec
  const uncollected = Math.min(poolCap, run.uncollected + rate * dtSec)

  // Energy regenerates in real time (SPEC §2.5) — but only up to the cap,
  // and never down: an overfill from bonus Energy (reserve) is preserved.
  const energy =
    run.energy >= balance.energy.cap
      ? run.energy
      : Math.min(
          balance.energy.cap,
          run.energy + balance.energy.regenPerSec * dtSec,
        )

  // Era stabilization: hold Habitability at/above the threshold for the
  // window and the world advances (SPEC §2.3). Never accrues offline —
  // offline.ts simply does not call this.
  let era = run.era
  let eraProgressSec = run.eraProgressSec
  const eraDef = content.eras[era]
  if (!eraDef) throw new Error(`unknown era ${era}`)
  const hab = habitability(systems)
  let shiftedSystems = systems
  if (
    eraDef.advanceHabitability !== undefined &&
    eraDef.stabilizationSec !== undefined
  ) {
    if (hab >= eraDef.advanceHabitability) {
      eraProgressSec += dtSec
      if (
        eraProgressSec >= eraDef.stabilizationSec &&
        era + 1 < content.eras.length
      ) {
        era += 1
        eraProgressSec = 0
        shiftedSystems = shiftBandsToEra(systems, content, era)
      }
    } else {
      eraProgressSec = Math.max(
        0,
        eraProgressSec - dtSec * balance.era.progressDecayMult,
      )
    }
  }

  const peak = Math.max(
    run.history.peakHabitability,
    habitability(shiftedSystems),
  )
  return {
    ...run,
    systems: shiftedSystems,
    uncollected,
    energy,
    era,
    eraProgressSec,
    history: { ...run.history, peakHabitability: peak },
  }
}
