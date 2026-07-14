// cards.ts — draw/apply event cards from the weighted, Era/Archetype-gated
// pool using the run's seeded RNG (SPEC §2.5). Drawing costs Energy.
// Resolving a card is "one active turn": the only place Instability moves
// and the only place a hard fail or cascade can happen (SPEC §1.3, §2.4).

import { pickWeighted } from './rng'
import {
  buildCollapseReport,
  cascadeCause,
  detectHardFail,
  habitability,
  instabilityStep,
  isCascade,
} from './systems'
import {
  SimError,
  SYSTEM_IDS,
  type AppliedEffects,
  type CardDef,
  type Content,
  type RunState,
  type SystemId,
  type SystemState,
} from './types'

/** Cards legal for this run right now (Era range + Archetype gate). */
export function cardPool(run: RunState, content: Content): CardDef[] {
  const eraNumber = run.era + 1 // card gates are 1-based, matching the ladder
  return content.cards.filter(
    (c) =>
      eraNumber >= c.eras[0] &&
      eraNumber <= c.eras[1] &&
      (!c.archetypes || c.archetypes.includes(run.archetypeId)),
  )
}

export function cardById(content: Content, id: string): CardDef {
  const c = content.cards.find((x) => x.id === id)
  if (!c) throw new SimError('unknown-card', `unknown card ${id}`)
  return c
}

export function canDraw(run: RunState, content: Content): boolean {
  return (
    !run.collapse &&
    run.activeCardId === null &&
    run.energy >= content.balance.energy.drawCost &&
    cardPool(run, content).length > 0
  )
}

/**
 * Draw the next event card: spend Energy, pick from the weighted pool with
 * the run's seeded RNG (recently drawn ids are excluded when the pool is big
 * enough to allow it), and set it as the active card.
 */
export function drawCard(
  run: RunState,
  content: Content,
): { run: RunState; card: CardDef } {
  if (run.collapse) throw new SimError('run-over')
  if (run.activeCardId !== null) throw new SimError('card-active')
  const cost = content.balance.energy.drawCost
  if (run.energy < cost) throw new SimError('no-energy')

  const pool = cardPool(run, content)
  if (pool.length === 0) throw new SimError('empty-pool')

  const fresh = pool.filter((c) => !run.recentCardIds.includes(c.id))
  const candidates = fresh.length > 0 ? fresh : pool
  const picked = pickWeighted(
    run.rngState,
    candidates.map((c) => c.weight),
  )
  const card = candidates[picked.value]!

  const keep = content.balance.cards.recentExclusion
  const recentCardIds = [card.id, ...run.recentCardIds].slice(0, keep)
  return {
    run: {
      ...run,
      rngState: picked.state,
      energy: run.energy - cost,
      activeCardId: card.id,
      recentCardIds,
    },
    card,
  }
}

/**
 * Resolve the active card with a swipe. Applies the choice's effects (system
 * deltas scaled by the Era's volatility), then takes the turn's Instability
 * step and checks both collapse kinds. Returns the applied deltas for the UI.
 */
export function resolveCard(
  run: RunState,
  content: Content,
  side: 'left' | 'right',
): { run: RunState; applied: AppliedEffects } {
  if (run.collapse) throw new SimError('run-over')
  if (run.activeCardId === null) throw new SimError('no-active-card')
  const card = cardById(content, run.activeCardId)
  const choice = side === 'left' ? card.left : card.right
  const eraDef = content.eras[run.era]
  if (!eraDef) throw new Error(`unknown era ${run.era}`)
  const volatility = eraDef.volatilityMult

  // Apply system deltas, clamped to the physical 0–100 range.
  const applied: AppliedEffects = {
    systems: {},
    instability: 0,
    minerals: 0,
    energy: 0,
  }
  const systems = {} as Record<SystemId, SystemState>
  for (const id of SYSTEM_IDS) {
    const s = run.systems[id]
    const raw = choice.effects.systems?.[id]
    if (raw !== undefined && raw !== 0) {
      const delta = raw * volatility
      const value = Math.min(100, Math.max(0, s.value + delta))
      applied.systems[id] = Math.round((value - s.value) * 10) / 10
      systems[id] = { ...s, value }
    } else {
      systems[id] = s
    }
  }

  // Resource / Energy / direct Instability effects.
  const mineralsDelta = choice.effects.minerals ?? 0
  const minerals = Math.max(0, run.resources.minerals + mineralsDelta)
  applied.minerals = minerals - run.resources.minerals

  const energyDelta = choice.effects.energy ?? 0
  const energy = Math.min(
    content.balance.energy.cap,
    Math.max(0, run.energy + energyDelta),
  )
  applied.energy = Math.round((energy - run.energy) * 100) / 100

  let instability = Math.max(
    0,
    run.instability + (choice.effects.instability ?? 0),
  )

  // The turn's Instability step (accrual/decay) happens after the deltas land.
  instability = instabilityStep(
    instability,
    systems,
    content.balance,
    volatility,
  )
  applied.instability = Math.round((instability - run.instability) * 10) / 10

  // History: out-of-band turns per system, peak Habitability.
  const turnsOutOfBand = { ...run.history.turnsOutOfBand }
  for (const id of SYSTEM_IDS) {
    const s = systems[id]
    if (s.value < s.band[0] || s.value > s.band[1]) {
      turnsOutOfBand[id] = turnsOutOfBand[id] + 1
    }
  }
  const hab = habitability(systems)

  let next: RunState = {
    ...run,
    systems,
    instability,
    energy,
    resources: { ...run.resources, minerals },
    turns: run.turns + 1,
    activeCardId: null,
    history: {
      ...run.history,
      turnsOutOfBand,
      peakHabitability: Math.max(run.history.peakHabitability, hab),
    },
  }

  // Collapse checks: hard fail first (an edge hit trumps the cascade).
  const hardFail = detectHardFail(systems)
  if (hardFail) {
    next = { ...next, collapse: buildCollapseReport(next, content, hardFail) }
  } else if (isCascade(instability, content.balance)) {
    next = {
      ...next,
      collapse: buildCollapseReport(next, content, cascadeCause(next)),
    }
  }

  return { run: next, applied }
}
