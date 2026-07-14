// transmissions.ts — pure selection for the Mission Control strip (issue
// #16). UI-ONLY, like visuals.ts: a line is a pure function of the visible
// run state + a UI tick counter, so it never consumes the run's seeded rng
// and never mutates sim state (determinism rule 3). Same pool + same state +
// same tick ⇒ same line.

import { systemsOutOfBand } from '../sim/systems'
import type { RunState } from '../sim/types'
import type { TransmissionDef, TransmissionTrigger } from '../data'

/** The "something just happened" triggers; null means plain ambience. */
export type MomentTrigger = Extract<
  TransmissionTrigger,
  'era-up' | 'machine-built' | 'returned'
>

/** The slice of run state a transmission may react to — values, not objects. */
export type TransmissionState = {
  /** 1-based Era position (run.era + 1), matching content `eras` gates. */
  era: number
  /** How many systems sit outside their safe band right now. */
  outOfBand: number
  moment: MomentTrigger | null
}

/** Read the visible state off a run. Read-only — the run is never touched. */
export function transmissionStateOf(
  run: RunState,
  moment: MomentTrigger | null,
): TransmissionState {
  return {
    era: run.era + 1,
    outOfBand: systemsOutOfBand(run.systems).length,
    moment,
  }
}

function gated(
  pool: readonly TransmissionDef[],
  trigger: TransmissionTrigger,
  era: number,
): TransmissionDef[] {
  return pool.filter(
    (l) => l.trigger === trigger && era >= l.eras[0] && era <= l.eras[1],
  )
}

/**
 * The lines eligible right now. A moment interjects with its own pool
 * (falling back to ambience if content left it empty for this era); ambience
 * is the band-state pool ('drifting' if anything is out, else 'all-clear')
 * plus the era's 'idle' lines, so the strip always has something to say.
 */
export function transmissionPool(
  pool: readonly TransmissionDef[],
  state: TransmissionState,
): TransmissionDef[] {
  if (state.moment) {
    const moment = gated(pool, state.moment, state.era)
    if (moment.length > 0) return moment
  }
  const bandTrigger = state.outOfBand > 0 ? 'drifting' : 'all-clear'
  return [
    ...gated(pool, bandTrigger, state.era),
    ...gated(pool, 'idle', state.era),
  ]
}

/**
 * Pick the line to show at a given UI tick: a plain cycle through the
 * eligible pool, phase-shifted per state so different eras/band states start
 * at different lines. Deterministic, and never repeats on consecutive ticks
 * while the state holds (the pool cycles in authored order).
 */
export function pickTransmission(
  pool: readonly TransmissionDef[],
  state: TransmissionState,
  tick: number,
): TransmissionDef | null {
  const eligible = transmissionPool(pool, state)
  if (eligible.length === 0) return null
  const salt = state.era * 3 + (state.moment ? 7 : state.outOfBand > 0 ? 1 : 0)
  const n = eligible.length
  return eligible[(((tick + salt) % n) + n) % n]!
}
