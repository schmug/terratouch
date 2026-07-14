// TransmissionStrip.tsx — the Mission Control ambient strip (issue #16): a
// fixed-height one-liner under the dial that rotates on a slow UI clock and
// interjects on notable moments (era-up, machine built, returned from away).
// Selection is pure (ui/transmissions.ts); this file owns the impure edges
// only: the rotation timer and a store subscription that spots moments by
// comparing consecutive store states. The sim's seeded rng is never touched.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { transmissions } from '../data'
import type { RunState } from '../sim/types'
import { useGame } from '../state/store'
import {
  pickTransmission,
  transmissionStateOf,
  type MomentTrigger,
} from './transmissions'

/** Ambient rotation cadence. Slow enough to keep aria-live announcements polite. */
const ROTATE_MS = 30_000
/** How long a moment line holds the strip before ambience resumes. */
const MOMENT_HOLD_MS = 60_000

// A tiny external store for the currently-active moment. It lives outside
// React (and outside the game store — moments are presentation, not save
// state) so moments survive tab switches, expire on their own timer, and
// renders stay pure: the component only ever reads the snapshot.
let activeMoment: MomentTrigger | null = null
let momentExpiry: ReturnType<typeof setTimeout> | null = null
const momentListeners = new Set<() => void>()

function publishMoment(moment: MomentTrigger | null): void {
  if (momentExpiry) {
    clearTimeout(momentExpiry)
    momentExpiry = null
  }
  if (moment) {
    momentExpiry = setTimeout(() => {
      momentExpiry = null
      publishMoment(null)
    }, MOMENT_HOLD_MS)
  }
  activeMoment = moment
  for (const listener of momentListeners) listener()
}

function subscribeMoments(listener: () => void): () => void {
  momentListeners.add(listener)
  return () => momentListeners.delete(listener)
}

// Spot moments by diffing consecutive store states. Runs on every store
// update whether or not the strip is mounted, so nothing is missed while the
// player is on another tab.
useGame.subscribe((state, prev) => {
  const run = state.run
  if (!run) return
  const prevRun = prev.run
  let trigger: MomentTrigger | null = null
  if (!prevRun || prevRun.seed !== run.seed) {
    // First load or a brand-new world: nothing "just happened" except,
    // on reload, possibly an away return credited during init.
    if (state.awaySummary !== null) trigger = 'returned'
    else if (activeMoment !== null) publishMoment(null)
  } else {
    // Latest-wins ordering: an era-up outranks the machine that caused it.
    if (run.history.machinesBuilt > prevRun.history.machinesBuilt)
      trigger = 'machine-built'
    if (state.awaySummary !== null && prev.awaySummary === null)
      trigger = 'returned'
    if (run.era > prevRun.era) trigger = 'era-up'
  }
  if (trigger) publishMoment(trigger)
})

function readMomentSnapshot(): MomentTrigger | null {
  return activeMoment
}

export function TransmissionStrip({ run }: { run: RunState }) {
  const [tick, setTick] = useState(0)
  const moment = useSyncExternalStore(subscribeMoments, readMomentSnapshot)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), ROTATE_MS)
    return () => clearInterval(id)
  }, [])

  const line = pickTransmission(
    transmissions,
    transmissionStateOf(run, moment),
    tick,
  )
  // Collapse is the Chronicle's stage (opposite tone) — go quiet under it.
  if (!line || run.collapse) return null

  return (
    <p className="transmission" aria-live="polite">
      <span className="transmission-glyph" aria-hidden>
        ◍
      </span>
      <span key={line.id} className="transmission-text">
        {line.text}
      </span>
    </p>
  )
}
