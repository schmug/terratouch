// phenomena.ts — Session Arc slice A (design doc:
// docs/superpowers/specs/2026-07-15-active-play-session-arc-design.md).
// Transient tappable events on the activeSec clock. Pure, like all of sim/.
// Randomness draws ONLY from phenoRngState (the run's second stream) so card
// sequences are byte-identical whether or not anyone engages. Bonus-only:
// a miss expires silently; offline never advances any of this.

import { nextFloat, pickWeighted } from './rng'
import type { Content, PhenomenonDef, RunState } from './types'

/** Phenomena legal for this run right now (Era range + Archetype gate). */
export function eligiblePhenomena(
  run: RunState,
  content: Content,
): PhenomenonDef[] {
  const eraNumber = run.era + 1 // gates are 1-based, like cards
  return content.phenomena.filter(
    (p) =>
      (!p.eras || (eraNumber >= p.eras[0] && eraNumber <= p.eras[1])) &&
      (!p.archetypes || p.archetypes.includes(run.archetypeId)),
  )
}

/**
 * Advance the phenomena state machine after activeSec has moved. Called only
 * from tick() — never offline. Order: expire → lazily schedule → spawn.
 * The 0-sentinel on nextPhenomenonAtSec covers newRun, migrated saves, and
 * post-catch/expiry uniformly: the next tick schedules the next spawn.
 */
export function stepPhenomena(run: RunState, content: Content): RunState {
  let next = run
  const { meanSpacingSec, windowSec } = content.balance.phenomena

  if (next.phenomenon && next.activeSec >= next.phenomenon.expiresAtActiveSec) {
    next = { ...next, phenomenon: null } // missed — silently, no penalty
  }
  if (next.tailwind && next.activeSec >= next.tailwind.untilActiveSec) {
    next = { ...next, tailwind: null }
  }
  if (next.phenomenon) return next

  const pool = eligiblePhenomena(next, content)
  if (pool.length === 0) return next // dormant: draw nothing, schedule nothing

  if (next.nextPhenomenonAtSec === 0) {
    const r = nextFloat(next.phenoRngState)
    // Uniform in [0.5, 1.5) × mean: mean spacing, never instant, never late.
    const spacing = meanSpacingSec * (0.5 + r.value)
    return {
      ...next,
      phenoRngState: r.state,
      nextPhenomenonAtSec: next.activeSec + spacing,
    }
  }

  if (next.activeSec < next.nextPhenomenonAtSec) return next

  const picked = pickWeighted(
    next.phenoRngState,
    pool.map((p) => p.weight),
  )
  const def = pool[picked.value]!
  return {
    ...next,
    phenoRngState: picked.state,
    phenomenon: {
      defId: def.id,
      expiresAtActiveSec: next.activeSec + windowSec,
    },
    nextPhenomenonAtSec: 0,
  }
}
