// types.ts — GameState, Content, CollapseReport, Save, RunState, MetaState.
// See SPEC §4.4 (save schema) and §5.3 (CollapseReport).
//
// Convention for the whole sim/ directory: every function is PURE — it never
// mutates its inputs, never reads the wall clock, never touches I/O. Time
// arrives as deltas; randomness arrives as explicit rng state on RunState.

export const SYSTEM_IDS = [
  'thermal',
  'atmosphere',
  'hydro',
  'biosphere',
] as const
export type SystemId = (typeof SYSTEM_IDS)[number]

export type ResourceId = 'minerals'

export type Band = readonly [lo: number, hi: number]

export type SystemState = {
  /** Current position, 0–100. Hitting exactly 0 or 100 is a hard fail. */
  value: number
  /** Current safe band [lo, hi]; a subrange of 0–100 that climbs with Eras. */
  band: Band
  /** Where machines push `value`; player-configurable per system. */
  setpoint: number
}

export type MachineInstance = {
  id: string
  typeId: string
  level: number
}

export type RunHistory = {
  peakHabitability: number
  /** Active turns each system has spent outside its safe band (for the Chronicle). */
  turnsOutOfBand: Record<SystemId, number>
  machinesBuilt: number
  /**
   * Turn count when the run first reached the final era (stamped by tick's
   * era advance; null until then). Ascension's efficiency bonus reads this —
   * keyed to ARRIVAL, so lingering afterwards never erodes it (issue #28).
   */
  turnsToFinalEra: number | null
}

export type CollapseCause = {
  /** 'ascension' is the voluntary run end at Habitable (SPEC §2.8, M2). */
  kind: 'hard-fail' | 'cascade' | 'ascension'
  system: SystemId
  direction: 'low' | 'high'
}

// SPEC §5.3 — drives the loss screen and the LLM narration.
export type CollapseReport = {
  archetype: string
  eraReached: string
  turnsSurvived: number
  cause: CollapseCause
  systemsFinal: Record<SystemId, number>
  peakHabitability: number
  notableStats: string[]
  seedsAwarded: number
}

export type RunState = {
  seed: number
  /** Serialized mulberry32 state — part of the save so replays are exact. */
  rngState: number
  archetypeId: string
  /** 0-based index into content.eras. */
  era: number
  /** Seconds of sustained above-threshold Habitability toward the next Era. */
  eraProgressSec: number
  systems: Record<SystemId, SystemState>
  instability: number
  resources: Record<ResourceId, number>
  /** Tap-collect pool (minerals produced but not yet collected). */
  uncollected: number
  machines: MachineInstance[]
  energy: number
  /** Active turns taken (cards resolved). */
  turns: number
  /** Card drawn but not yet resolved (survives save/load mid-swipe). */
  activeCardId: string | null
  /** Recently drawn card ids, excluded from the next draws for variety. */
  recentCardIds: string[]
  /**
   * Cumulative seconds of ACTIVE play — advanced only by tick(), never by
   * offline.ts. The clock for phenomena, tailwinds, and the tap pulse; its
   * freezing while away is what makes leaving always free.
   */
  activeSec: number
  /**
   * Second mulberry32 stream (phenomena spawns/types). Never used for card
   * draws, so card sequences are identical whether or not anyone engages.
   */
  phenoRngState: number
  /** The currently tappable phenomenon, if one is live. */
  phenomenon: { defId: string; expiresAtActiveSec: number } | null
  /** A live tailwind boost from a caught phenomenon. */
  tailwind: {
    system: SystemId
    untilActiveSec: number
    pushMult: number
  } | null
  /** Next spawn time on the activeSec clock; 0 = unscheduled (lazy). */
  nextPhenomenonAtSec: number
  history: RunHistory
  /** Set exactly once, when the run ends. No actions are legal afterwards. */
  collapse: CollapseReport | null
}

export type MetaState = {
  genesisSeeds: number
  upgrades: Record<string, number>
  codex: string[]
  unlockedArchetypes: string[]
  stats: { runs: number; bestEra: number; longestRun: number }
}

export type Save = {
  schemaVersion: 3
  run: RunState | null
  meta: MetaState
  lastSeenMs: number
}

// ---------------------------------------------------------------------------
// Content (data/*.json, validated with zod in app/src/data/). The sim never
// imports content directly — a Content bundle is always passed in.
// ---------------------------------------------------------------------------

export type Balance = {
  energy: {
    cap: number
    regenPerSec: number
    drawCost: number
    reserve: number
  }
  tap: { baseRatePerSec: number; bonusMult: number; poolCapSec: number }
  /** Phenomena cadence (slice A): mean active-seconds between spawns + window. */
  phenomena: {
    meanSpacingSec: number
    windowSec: number
  }
  /** Tap-pool pulse: on-beat collects (1 tick per period) use onBeatMult. */
  pulse: {
    periodSec: number
    onBeatMult: number
  }
  instability: {
    accrualPerSystemPerTurn: number
    decayPerTurn: number
    cascadeThreshold: number
  }
  setpoint: { min: number; max: number }
  era: { progressDecayMult: number }
  offline: { maxHours: number; productionMult: number }
  cards: { recentExclusion: number }
  /** Genesis Seed yield (SPEC §2.8): base = era·eraWeight + ⌊peakHab/habDivisor⌋. */
  prestige: {
    eraWeight: number
    habDivisor: number
    /** Partial yield on collapse: ⌊base·collapseMult⌋. */
    collapseMult: number
    /** Flat extra Seeds on voluntary Ascension (max yield): base + bonus. */
    ascensionBonus: number
    /**
     * Ascension efficiency bonus (issue #28): a swift climb pays extra —
     * clamp(⌊(refTurns − turnsToFinalEra) / perTurns⌋, 0, cap) Seeds, keyed
     * to when the run ARRIVED at the final era so lingering stays free.
     * Ascension-only; collapse and slower-than-refTurns runs are untouched.
     */
    efficiency: {
      refTurns: number
      perTurns: number
      cap: number
    }
  }
}

/** Decorative overlay kinds painted on the planet (issue #10). */
export type EraLayerKind =
  'frost' | 'seas' | 'microbial' | 'flora' | 'clouds' | 'aurora' | 'motes'

export type EraLayer = {
  kind: EraLayerKind
  /** Base opacity 0–1. Clouds additionally scale with the Atmosphere gauge. */
  opacity: number
  /** Tint override, '#rrggbb'. Each kind has a default in ui/. */
  color?: string
  /** Motes only: how many specks drift over the surface (ui/ caps this). */
  count?: number
}

/**
 * Presentation palette for an Era (SPEC §3, issue #10). Pure decoration —
 * lives on content so the ladder stays data-not-code, but the sim NEVER
 * reads it; only ui/ does.
 */
export type EraVisuals = {
  /** Radial surface gradient stops: [sunlit, mid, limb], '#rrggbb'. */
  surface: readonly [string, string, string]
  /** Habitability glow tint, '#rrggbb'. */
  glow: string
  layers?: EraLayer[]
}

export type EraDef = {
  id: string
  name: string
  /** Habitability (0–100) to hold to begin advancing. Absent on the final Era. */
  advanceHabitability?: number
  /** Seconds Habitability must be held at/above the threshold to advance. */
  stabilizationSec?: number
  /** Multiplier on event-card system deltas ("baseline volatility", SPEC §2.3). */
  volatilityMult: number
  bands: Record<SystemId, Band>
  visuals?: EraVisuals
}

export type ArchetypeSystemDef = {
  /** Starting gauge value. Must sit inside the Era-1 band. */
  start: number
  /** Default setpoint at run start. */
  setpoint: number
  /** Where the planet drifts with no machines pushing (1–99). */
  naturalRest: number
  /** Pull strength toward naturalRest, per second (exponential rate). */
  naturalRatePerSec: number
}

export type ArchetypeDef = {
  id: string
  name: string
  blurb: string
  startingMinerals: number
  systems: Record<SystemId, ArchetypeSystemDef>
}

export type MachineDef = {
  id: string
  name: string
  blurb: string
  system: SystemId
  baseCost: number
  costMult: number
  /** Setpoint push strength per level, per second (exponential rate). */
  pushRatePerSecPerLevel: number
  /** Passive minerals per second per level. */
  productionPerSecPerLevel: number
  maxLevel: number
  /** 1-based era the machine becomes buildable in; omitted = always. */
  unlockEra?: number
}

// ---------------------------------------------------------------------------
// Phenomena (Session Arc slice A): transient tappable events that exist only
// in ACTIVE time. Bonus-only by design — a miss expires silently.
// ---------------------------------------------------------------------------

export type PhenomenonPayout =
  /** Lump-sum minerals worth `productionSec` seconds of current production. */
  | { kind: 'minerals'; productionSec: number }
  /** Vents Instability (floored at 0). Only matters during active play. */
  | { kind: 'vent'; amount: number }
  /** One system's machine push ×pushMult toward setpoint for durationSec. */
  | {
      kind: 'tailwind'
      system: SystemId
      durationSec: number
      pushMult: number
    }
  /** Bonus Energy via gainEnergy (may overfill up to cap + reserve). */
  | { kind: 'energy'; amount: number }

export type PhenomenonDef = {
  id: string
  name: string
  blurb: string
  weight: number
  payout: PhenomenonPayout
  /** Inclusive 1-based Era range (like card gates); omitted = all eras. */
  eras?: readonly [min: number, max: number]
  /** Archetype ids this appears for; omitted = all archetypes. */
  archetypes?: string[]
}

// ---------------------------------------------------------------------------
// Meta-upgrades (SPEC §2.8, M2): Seeds → permanent effects. Pure data; the
// levels the player owns live in MetaState.upgrades, and prestige.ts derives
// an effective Content bundle from them.
// ---------------------------------------------------------------------------

export type MetaUpgradeEffect =
  /** Machines push harder: every pushRatePerSecPerLevel ×(1+perLevel)^level. */
  | { kind: 'machine-push-mult'; perLevel: number }
  /** Gentler active-turn accrual: accrualPerSystemPerTurn ×(1−perLevel)^level. */
  | { kind: 'instability-accrual-mult'; perLevel: number }
  /** Every archetype starts with +perLevel·level minerals. */
  | { kind: 'starting-minerals'; perLevel: number }
  /** Energy cap +perLevel·level (runs also START at the raised cap). */
  | { kind: 'energy-cap'; perLevel: number }
  /** Offline catch-up window +perLevel·level hours (still band-safe). */
  | { kind: 'offline-cap-hours'; perLevel: number }
  /** Buying adds the archetype to meta.unlockedArchetypes (maxLevel 1). */
  | { kind: 'unlock-archetype'; archetypeId: string }

export type MetaUpgradeDef = {
  id: string
  name: string
  blurb: string
  /** Seed cost of level n: round(baseCost · costMult^(n−1)). */
  baseCost: number
  costMult: number
  maxLevel: number
  effect: MetaUpgradeEffect
}

export type CardEffects = {
  systems?: Partial<Record<SystemId, number>>
  instability?: number
  minerals?: number
  energy?: number
}

export type CardChoice = {
  label: string
  effects: CardEffects
}

export type CardDef = {
  id: string
  title: string
  text: string
  /** Inclusive Era range (1-based, matching the Era ladder) this card appears in. */
  eras: readonly [min: number, max: number]
  /** Archetype ids this card appears for; omitted = all archetypes. */
  archetypes?: string[]
  weight: number
  left: CardChoice
  right: CardChoice
}

export type Content = {
  balance: Balance
  eras: EraDef[]
  archetypes: ArchetypeDef[]
  machines: MachineDef[]
  cards: CardDef[]
  phenomena: PhenomenonDef[]
  upgrades: MetaUpgradeDef[]
}

// ---------------------------------------------------------------------------
// Action results
// ---------------------------------------------------------------------------

/** Deltas actually applied by a card choice (post volatility scaling), for UI. */
export type AppliedEffects = {
  systems: Partial<Record<SystemId, number>>
  instability: number
  minerals: number
  energy: number
}

export type AwaySummary = {
  /** Elapsed time credited, after clamping to the offline cap. */
  elapsedMs: number
  /** True if the raw elapsed time exceeded the cap. */
  capped: boolean
  mineralsGained: number
  energyGained: number
  systemDeltas: Record<SystemId, number>
}

/** Thrown on illegal actions (not enough energy/minerals, run over, …). */
export class SimError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'SimError'
  }
}
