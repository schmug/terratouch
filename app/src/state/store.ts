// store.ts — Zustand store wrapping the sim + persistence (SPEC §4.3).
// UI subscribes here; the sim mutates via reducer-style pure calls. The wall
// clock is read ONLY here, at the tick-loop boundary and when actions are
// initiated — never inside sim/ functions.

import { create } from 'zustand'
import { content as baseContent } from '../data'
import {
  ascend,
  buildOrUpgrade,
  newRun,
  setSetpoint,
  tapCollect,
} from '../sim/actions'
import { canDraw, cardById, drawCard, resolveCard } from '../sim/cards'
import { applyOffline } from '../sim/offline'
import { applyMetaUpgrades, buyUpgrade } from '../sim/prestige'
import { tick } from '../sim/tick'
import {
  SimError,
  type AppliedEffects,
  type AwaySummary,
  type Content,
  type MetaState,
  type RunState,
  type Save,
  type SystemId,
} from '../sim/types'
import { loadSave, writeSave } from '../persist/db'

const STARTING_ARCHETYPE = 'barren'
/** Hidden gaps at least this long go through the safe offline path. */
const OFFLINE_GAP_MS = 5_000
/** Away summaries shorter than this aren't worth a modal. */
const AWAY_SUMMARY_MIN_MS = 60_000
const AUTOSAVE_DEBOUNCE_MS = 3_000
const TICK_INTERVAL_MS = 250

function freshMeta(): MetaState {
  return {
    genesisSeeds: 0,
    upgrades: {},
    codex: [],
    unlockedArchetypes: [STARTING_ARCHETYPE],
    stats: { runs: 0, bestEra: 0, longestRun: 0 },
  }
}

function randomSeed(): number {
  // Boundary code: randomness for NEW runs comes from the platform; inside a
  // run everything flows from this seed via sim/rng.
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0]!
}

export type CardOutcome = {
  cardTitle: string
  choiceLabel: string
  applied: AppliedEffects
}

type GameStore = {
  loaded: boolean
  run: RunState | null
  meta: MetaState
  /**
   * The EFFECTIVE content bundle: base content with the owned meta-upgrade
   * levels applied (SPEC §2.8). Everything — sim calls and UI reads — goes
   * through this; it is re-derived whenever upgrades change.
   */
  content: Content
  awaySummary: AwaySummary | null
  /** The most recent resolved card, for UI feedback. */
  lastOutcome: CardOutcome | null

  init(): Promise<void>
  /** Advance by whole logical ticks (1s each) — called only by the loop. */
  tickBy(steps: number): void
  offlineBy(elapsedMs: number): void
  tap(): void
  draw(): void
  resolve(side: 'left' | 'right'): void
  build(typeId: string): void
  setpoint(system: SystemId, value: number): void
  buy(upgradeId: string): void
  /** Voluntary Ascension at the final era (SPEC §2.8): max Seed yield. */
  ascendRun(): void
  /** Start the next world; archetype must be unlocked (falls back to Barren). */
  beginNewRun(archetypeId?: string): void
  dismissAwaySummary(): void
}

/** Bank a finished run's Seed yield + records into persistent meta. */
function foldRunEnd(meta: MetaState, run: RunState): MetaState {
  if (!run.collapse) return meta
  return {
    ...meta,
    genesisSeeds: meta.genesisSeeds + run.collapse.seedsAwarded,
    stats: {
      ...meta.stats,
      bestEra: Math.max(meta.stats.bestEra, run.era + 1),
      longestRun: Math.max(meta.stats.longestRun, run.turns),
    },
  }
}

/** Swallow SimError (illegal action — UI races), rethrow real bugs. */
function guard<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch (err) {
    if (err instanceof SimError) return undefined
    throw err
  }
}

export const useGame = create<GameStore>((set, get) => ({
  loaded: false,
  run: null,
  meta: freshMeta(),
  content: baseContent,
  awaySummary: null,
  lastOutcome: null,

  async init() {
    if (get().loaded) return
    const save = await loadSave()
    let run = save?.run ?? null
    let meta = save?.meta ?? freshMeta()
    const content = applyMetaUpgrades(baseContent, meta.upgrades)
    let awaySummary: AwaySummary | null = null

    if (run === null) {
      run = newRun(content, randomSeed(), STARTING_ARCHETYPE)
      meta = { ...meta, stats: { ...meta.stats, runs: meta.stats.runs + 1 } }
    } else if (save && !run.collapse) {
      const elapsed = Date.now() - save.lastSeenMs
      if (elapsed >= OFFLINE_GAP_MS) {
        const caught = applyOffline(run, content, elapsed)
        run = caught.run
        if (caught.summary.elapsedMs >= AWAY_SUMMARY_MIN_MS)
          awaySummary = caught.summary
      }
    }

    set({ loaded: true, run, meta, content, awaySummary })
    startLoop()
    // Persist immediately: offline gains were just credited against the old
    // lastSeenMs, and a debounced save would leave a window where reloading
    // re-credits the same elapsed time.
    saveNow()
  },

  tickBy(steps) {
    const { content } = get()
    let { run } = get()
    if (!run || run.collapse) return
    for (let i = 0; i < steps && !run.collapse; i++) {
      run = tick(run, content, LOGICAL_TICK_SEC)
    }
    set({ run })
    scheduleSave()
  },

  offlineBy(elapsedMs) {
    const { run, content } = get()
    if (!run || run.collapse) return
    const { run: caught, summary } = applyOffline(run, content, elapsedMs)
    set({
      run: caught,
      awaySummary:
        summary.elapsedMs >= AWAY_SUMMARY_MIN_MS ? summary : get().awaySummary,
    })
    saveNow() // same re-credit window as init — persist promptly
  },

  tap() {
    const { run, content } = get()
    if (!run) return
    const result = guard(() => tapCollect(run, content))
    if (result) {
      set({ run: result.run })
      scheduleSave()
    }
  },

  draw() {
    const { run, content } = get()
    if (!run || !canDraw(run, content)) return
    const result = guard(() => drawCard(run, content))
    if (result) {
      set({ run: result.run })
      scheduleSave()
    }
  },

  resolve(side) {
    const { run, meta, content } = get()
    if (!run || !run.activeCardId) return
    const card = cardById(content, run.activeCardId)
    const result = guard(() => resolveCard(run, content, side))
    if (!result) return
    const choice = side === 'left' ? card.left : card.right
    set({
      run: result.run,
      // A collapsing turn banks the Seed yield + records (SPEC §2.8, §4.4).
      meta: foldRunEnd(meta, result.run),
      lastOutcome: {
        cardTitle: card.title,
        choiceLabel: choice.label,
        applied: result.applied,
      },
    })
    saveNow() // a collapse (or any turn) is worth persisting promptly
  },

  build(typeId) {
    const { run, content } = get()
    if (!run) return
    const next = guard(() => buildOrUpgrade(run, content, typeId))
    if (next) {
      set({ run: next })
      scheduleSave()
    }
  },

  setpoint(system, value) {
    const { run, content } = get()
    if (!run) return
    const next = guard(() => setSetpoint(run, content, system, value))
    if (next) {
      set({ run: next })
      scheduleSave()
    }
  },

  buy(upgradeId) {
    const { meta } = get()
    const nextMeta = guard(() => buyUpgrade(meta, baseContent, upgradeId))
    if (!nextMeta) return
    // Re-derive the effective bundle; a live run benefits immediately (the
    // only mid-run changes are strictly kind ones).
    set({
      meta: nextMeta,
      content: applyMetaUpgrades(baseContent, nextMeta.upgrades),
    })
    saveNow() // spent Seeds are worth persisting promptly
  },

  ascendRun() {
    const { run, meta, content } = get()
    if (!run) return
    const ended = guard(() => ascend(run, content))
    if (!ended) return
    set({ run: ended, meta: foldRunEnd(meta, ended), lastOutcome: null })
    saveNow() // an ended world is worth persisting promptly
  },

  beginNewRun(archetypeId) {
    const { meta, content } = get()
    const pick =
      archetypeId && meta.unlockedArchetypes.includes(archetypeId)
        ? archetypeId
        : STARTING_ARCHETYPE
    set({
      run: newRun(content, randomSeed(), pick),
      meta: { ...meta, stats: { ...meta.stats, runs: meta.stats.runs + 1 } },
      awaySummary: null,
      lastOutcome: null,
    })
    saveNow()
  },

  dismissAwaySummary() {
    set({ awaySummary: null })
  },
}))

// ---------------------------------------------------------------------------
// Tick loop + persistence plumbing (module-level; wall clock lives here only).
// ---------------------------------------------------------------------------

const LOGICAL_TICK_SEC = 1

let intervalId: ReturnType<typeof setInterval> | null = null
let lastTickMs = 0
let accumulatorMs = 0
let hiddenAtMs: number | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let listenersInstalled = false

function currentSave(): Save {
  const { run, meta } = useGame.getState()
  return { schemaVersion: 2, run, meta, lastSeenMs: Date.now() }
}

function saveNow(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  void writeSave(currentSave()).catch((err) =>
    console.warn('terratouch: save failed', err),
  )
}

function scheduleSave(): void {
  saveTimer ??= setTimeout(() => {
    saveTimer = null
    saveNow()
  }, AUTOSAVE_DEBOUNCE_MS)
}

// Fixed-timestep accumulator (SPEC §4.3): real elapsed time collects here
// and is spent in whole 1-second logical ticks; the remainder carries over.
function loopStep(): void {
  const now = Date.now()
  accumulatorMs += Math.max(0, now - lastTickMs)
  lastTickMs = now
  const steps = Math.floor(accumulatorMs / (LOGICAL_TICK_SEC * 1000))
  if (steps <= 0) return
  accumulatorMs -= steps * LOGICAL_TICK_SEC * 1000
  // A stall this long should have gone through the offline path instead.
  useGame.getState().tickBy(Math.min(steps, 60))
}

function startLoop(): void {
  if (intervalId === null) {
    lastTickMs = Date.now()
    accumulatorMs = 0
    intervalId = setInterval(loopStep, TICK_INTERVAL_MS)
  }
  if (!listenersInstalled) {
    listenersInstalled = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtMs = Date.now()
        stopLoop()
        saveNow()
      } else {
        const gap = hiddenAtMs === null ? 0 : Date.now() - hiddenAtMs
        hiddenAtMs = null
        if (gap >= OFFLINE_GAP_MS) useGame.getState().offlineBy(gap)
        if (intervalId === null) {
          lastTickMs = Date.now()
          accumulatorMs = 0
          intervalId = setInterval(loopStep, TICK_INTERVAL_MS)
        }
      }
    })
    window.addEventListener('pagehide', () => saveNow())
  }
}

function stopLoop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}
