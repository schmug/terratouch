// offline.ts — bounded catch-up given elapsed ms (SPEC §1.3, §4.3).
// INVARIANT: offline advancement is safe-clamped — gauges never cross a band
// edge and Instability NEVER accrues offline. This rule is non-negotiable.
//
// Concretely, per SPEC §1.3:
//  - machines produce resources at full rate (straight to the balance);
//  - Energy refills;
//  - gauges drift toward their targets but each is clamped to the interval
//    [min(value, band.lo), max(value, band.hi)] — inside the band it can
//    approach an edge but never cross it, and a gauge that went offline
//    already outside its band can only move back toward safety, never
//    further out;
//  - Instability, Era progress, and turn count are UNTOUCHED.

import { driftTarget, productionRate, relax } from './tick'
import {
  SYSTEM_IDS,
  type AwaySummary,
  type Content,
  type RunState,
  type SystemId,
  type SystemState,
} from './types'

/**
 * Apply elapsed offline time (already measured by the caller — the sim never
 * reads the clock). Returns the caught-up run and the "while you were away"
 * summary data.
 */
export function applyOffline(
  run: RunState,
  content: Content,
  elapsedMs: number,
): { run: RunState; summary: AwaySummary } {
  const { balance } = content
  const maxMs = balance.offline.maxHours * 3600_000
  const capped = elapsedMs > maxMs
  const ms = Math.max(0, Math.min(elapsedMs, maxMs))
  const sec = ms / 1000

  if (sec === 0 || run.collapse) {
    const zeroDeltas = {} as Record<SystemId, number>
    for (const id of SYSTEM_IDS) zeroDeltas[id] = 0
    return {
      run,
      summary: {
        elapsedMs: 0,
        capped: false,
        mineralsGained: 0,
        energyGained: 0,
        systemDeltas: zeroDeltas,
      },
    }
  }

  // Safe drift: same relaxation as active ticking, then clamped so no gauge
  // ever crosses a band edge (and an out-of-band gauge never worsens).
  const systems = {} as Record<SystemId, SystemState>
  const systemDeltas = {} as Record<SystemId, number>
  for (const id of SYSTEM_IDS) {
    const s = run.systems[id]
    const { target, rate } = driftTarget(run, content, id)
    const drifted = relax(s.value, target, rate, sec)
    const lo = Math.min(s.value, s.band[0])
    const hi = Math.max(s.value, s.band[1])
    const value = Math.min(hi, Math.max(lo, drifted))
    systems[id] = { ...s, value }
    systemDeltas[id] = Math.round((value - s.value) * 10) / 10
  }

  // Production goes straight to the balance (no tap pool while away).
  const mineralsGained = productionRate(run, content) * sec * balance.offline.productionMult
  const minerals = run.resources.minerals + mineralsGained

  // Energy refills on real time, up to the cap.
  const energy = Math.min(balance.energy.cap, run.energy + balance.energy.regenPerSec * sec)
  const energyGained = energy - run.energy

  return {
    run: {
      ...run,
      systems,
      resources: { ...run.resources, minerals },
      energy,
      // instability, eraProgressSec, era, turns: deliberately untouched.
    },
    summary: {
      elapsedMs: ms,
      capped,
      mineralsGained: Math.round(mineralsGained * 10) / 10,
      energyGained: Math.round(energyGained * 100) / 100,
      systemDeltas,
    },
  }
}
