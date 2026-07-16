// prestige.ts — Genesis Seed yield on collapse/Ascension + meta-upgrade
// application (SPEC §2.8, §4.2, M2). Converts run progress into the
// persistent meta-currency (partial yield on collapse, max on voluntary
// Ascension at the final era), sells permanent upgrades for Seeds, and
// derives the effective Content bundle those upgrades produce. Pure
// functions over plain state, like all of sim/.
//
// Yield formula (params in balance.json → balance.prestige):
//   base      = era · eraWeight + ⌊peakHabitability / habDivisor⌋
//   collapse  = ⌊base · collapseMult⌋            (the world died — partial)
//   ascension = base + ascensionBonus + efficiency   (you chose to leave — max)
//   efficiency = clamp(⌊(refTurns − turnsToFinalEra) / perTurns⌋, 0, cap)
//
// The efficiency bonus (issue #28) restores top-end skill expression: at the
// final era base+ascensionBonus saturates, so a swift climb pays extra. It
// keys to when the run ARRIVED at the final era (stamped by tick), not the
// Ascension turn, so lingering afterwards never erodes it. Bonus-only:
// collapse yields and slower-than-refTurns runs are exactly the classic
// formula.
//
// SPEC §2.8 also names discoveries as an input; the Codex is Milestone 3, so
// that term joins the formula when synthesis lands. Biosphere contributes via
// peak Habitability (mean band depth across all four systems).

import {
  SimError,
  type Content,
  type MetaState,
  type MetaUpgradeDef,
  type RunState,
} from './types'

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
  if (mode === 'ascension') {
    const e = p.efficiency
    // Null arrival (pre-v3 saves already at the final era) falls back to the
    // current turn count, which can only under-pay — never below classic.
    const arrival = run.history.turnsToFinalEra ?? run.turns
    const bonus = Math.min(
      e.cap,
      Math.max(0, Math.floor((e.refTurns - arrival) / e.perTurns)),
    )
    return base + p.ascensionBonus + bonus
  }
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

// ---------------------------------------------------------------------------
// The Seed shop: meta-upgrades are content (upgrades.json); owned levels live
// in MetaState.upgrades (v1 save shape — no migration needed).
// ---------------------------------------------------------------------------

export function upgradeDef(content: Content, id: string): MetaUpgradeDef {
  const def = content.upgrades.find((u) => u.id === id)
  if (!def) throw new SimError('unknown-upgrade', `unknown upgrade ${id}`)
  return def
}

/** Seed cost to bring an upgrade to `level` (level 1 = first purchase). */
export function upgradeCost(def: MetaUpgradeDef, level: number): number {
  return Math.round(def.baseCost * Math.pow(def.costMult, level - 1))
}

/** Buy the next level of a meta-upgrade with Genesis Seeds. */
export function buyUpgrade(
  meta: MetaState,
  content: Content,
  upgradeId: string,
): MetaState {
  const def = upgradeDef(content, upgradeId)
  const targetLevel = (meta.upgrades[upgradeId] ?? 0) + 1
  if (targetLevel > def.maxLevel) throw new SimError('max-level')
  const cost = upgradeCost(def, targetLevel)
  if (meta.genesisSeeds < cost) throw new SimError('no-seeds')

  // Archetype unlocks land on the canonical v1 list the rest of the app
  // reads (meta.unlockedArchetypes); the upgrade level just records the buy.
  const unlocked =
    def.effect.kind === 'unlock-archetype' &&
    !meta.unlockedArchetypes.includes(def.effect.archetypeId)
      ? [...meta.unlockedArchetypes, def.effect.archetypeId]
      : meta.unlockedArchetypes

  return {
    ...meta,
    genesisSeeds: meta.genesisSeeds - cost,
    upgrades: { ...meta.upgrades, [upgradeId]: targetLevel },
    unlockedArchetypes: unlocked,
  }
}

/**
 * Derive the effective Content bundle owned upgrade levels produce — this is
 * how "a returning player is measurably stronger" reaches the sim: callers
 * (the store, tests, the harness) apply once and pass the result everywhere,
 * so newRun starts richer, ticking pushes harder, active turns accrue gentler
 * Instability, and offline credits a longer window. The offline-safety
 * invariant is untouched: a bigger window still never crosses a band or adds
 * Instability (that lives in offline.ts, which only reads the cap).
 *
 * Unknown ids in `upgrades` are ignored (content may have moved on since the
 * save); levels are clamped to each def's maxLevel. With nothing owned the
 * base bundle is returned as-is.
 */
export function applyMetaUpgrades(
  content: Content,
  upgrades: Record<string, number>,
): Content {
  let pushMult = 1
  let accrualMult = 1
  let startingMinerals = 0
  let energyCap = 0
  let offlineHours = 0
  for (const def of content.upgrades) {
    const owned = Math.min(upgrades[def.id] ?? 0, def.maxLevel)
    if (owned <= 0) continue
    const e = def.effect
    switch (e.kind) {
      case 'machine-push-mult':
        pushMult *= Math.pow(1 + e.perLevel, owned)
        break
      case 'instability-accrual-mult':
        accrualMult *= Math.pow(1 - e.perLevel, owned)
        break
      case 'starting-minerals':
        startingMinerals += e.perLevel * owned
        break
      case 'energy-cap':
        energyCap += e.perLevel * owned
        break
      case 'offline-cap-hours':
        offlineHours += e.perLevel * owned
        break
      case 'unlock-archetype':
        // Unlocks live on MetaState, not on the derived bundle.
        break
    }
  }

  const untouched =
    pushMult === 1 &&
    accrualMult === 1 &&
    startingMinerals === 0 &&
    energyCap === 0 &&
    offlineHours === 0
  if (untouched) return content

  return {
    ...content,
    balance: {
      ...content.balance,
      energy: {
        ...content.balance.energy,
        cap: content.balance.energy.cap + energyCap,
      },
      instability: {
        ...content.balance.instability,
        accrualPerSystemPerTurn:
          content.balance.instability.accrualPerSystemPerTurn * accrualMult,
      },
      offline: {
        ...content.balance.offline,
        maxHours: content.balance.offline.maxHours + offlineHours,
      },
    },
    machines: content.machines.map((m) => ({
      ...m,
      pushRatePerSecPerLevel: m.pushRatePerSecPerLevel * pushMult,
    })),
    archetypes: content.archetypes.map((a) => ({
      ...a,
      startingMinerals: a.startingMinerals + startingMinerals,
    })),
  }
}
