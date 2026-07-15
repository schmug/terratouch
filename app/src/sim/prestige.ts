// prestige.ts — Genesis Seed yield on collapse/Ascension (SPEC §2.8, M2).
// Converts run progress into the persistent meta-currency: partial yield on
// collapse, max yield on voluntary Ascension at the final (Habitable) era.
// Pure functions over plain state, like all of sim/. Meta-upgrade application
// (the other half of this file per SPEC §4.2) lands with the upgrade shop.
//
// Yield formula (params in balance.json → balance.prestige):
//   base      = era · eraWeight + ⌊peakHabitability / habDivisor⌋
//   collapse  = ⌊base · collapseMult⌋            (the world died — partial)
//   ascension = base + ascensionBonus            (you chose to leave — max)
//
// SPEC §2.8 also names discoveries as an input; the Codex is Milestone 3, so
// that term joins the formula when synthesis lands. Biosphere contributes via
// peak Habitability (mean band depth across all four systems).

import type { Content, RunState } from './types'

export type YieldMode = 'collapse' | 'ascension'

/** Genesis Seeds a run is worth right now, if it ended the given way. */
export function seedYield(
  run: RunState,
  content: Content,
  mode: YieldMode,
): number {
  const p = content.balance.prestige
  const base =
    run.era * p.eraWeight +
    Math.floor(run.history.peakHabitability / p.habDivisor)
  if (mode === 'ascension') return base + p.ascensionBonus
  return Math.max(0, Math.floor(base * p.collapseMult))
}

/**
 * Voluntary Ascension is legal only at the final era (Habitable), on a live
 * run with no card mid-swipe (SPEC §2.8).
 */
export function canAscend(run: RunState, content: Content): boolean {
  return (
    !run.collapse &&
    run.activeCardId === null &&
    run.era === content.eras.length - 1
  )
}
