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
}

export type CollapseCause = {
  kind: 'hard-fail' | 'cascade'
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
  schemaVersion: 1
  run: RunState | null
  meta: MetaState
  lastSeenMs: number
}

// ---------------------------------------------------------------------------
// Content (data/*.json, validated with zod in app/src/data/). The sim never
// imports content directly — a Content bundle is always passed in.
// ---------------------------------------------------------------------------

export type Balance = {
  energy: { cap: number; regenPerSec: number; drawCost: number }
  tap: { baseRatePerSec: number; bonusMult: number; poolCapSec: number }
  instability: {
    accrualPerSystemPerTurn: number
    decayPerTurn: number
    cascadeThreshold: number
  }
  setpoint: { min: number; max: number }
  era: { progressDecayMult: number }
  offline: { maxHours: number; productionMult: number }
  cards: { recentExclusion: number }
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
