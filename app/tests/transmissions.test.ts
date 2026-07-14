// transmissions.test.ts — the Mission Control strip (issue #16) is pure
// ambience: selection filters by context (trigger + era gate + band state),
// is deterministic (same pool + state + tick ⇒ same line), and leaves the
// sim byte-identical — it never consumes the run's seeded rng.
import { describe, expect, it } from 'vitest'
import { tapCollect } from '../src/sim/actions'
import { canDraw, drawCard, resolveCard } from '../src/sim/cards'
import { tick } from '../src/sim/tick'
import type { RunState } from '../src/sim/types'
import { loadContent, transmissions, type TransmissionDef } from '../src/data'
import {
  pickTransmission,
  transmissionPool,
  transmissionStateOf,
  type MomentTrigger,
  type TransmissionState,
} from '../src/ui/transmissions'
import { makeRun, makeTestContent } from './fixtures'

/** A tiny hand-rolled pool where every filtering rule is visible. */
const POOL: TransmissionDef[] = [
  { id: 'idle-early', trigger: 'idle', eras: [1, 2], text: 'early idle' },
  { id: 'idle-late', trigger: 'idle', eras: [3, 7], text: 'late idle' },
  { id: 'clear-a', trigger: 'all-clear', eras: [1, 7], text: 'all clear a' },
  { id: 'clear-b', trigger: 'all-clear', eras: [1, 7], text: 'all clear b' },
  { id: 'drift-a', trigger: 'drifting', eras: [1, 7], text: 'drifting a' },
  { id: 'up-frost', trigger: 'era-up', eras: [2, 2], text: 'frost!' },
  { id: 'built-a', trigger: 'machine-built', eras: [1, 7], text: 'built a' },
  { id: 'back-a', trigger: 'returned', eras: [1, 7], text: 'welcome back' },
]

const state = (over: Partial<TransmissionState> = {}): TransmissionState => ({
  era: 1,
  outOfBand: 0,
  moment: null,
  ...over,
})

describe('transmissionPool — context filtering', () => {
  it('ambient all-clear pool = era-gated all-clear + idle lines', () => {
    const ids = transmissionPool(POOL, state()).map((l) => l.id)
    expect(ids).toEqual(['clear-a', 'clear-b', 'idle-early'])
  })

  it('any system out of band swaps all-clear for drifting', () => {
    const ids = transmissionPool(POOL, state({ outOfBand: 2 })).map((l) => l.id)
    expect(ids).toEqual(['drift-a', 'idle-early'])
  })

  it('era gates are inclusive and 1-based, like card gates', () => {
    expect(
      transmissionPool(POOL, state({ era: 2 })).map((l) => l.id),
    ).toContain('idle-early')
    expect(
      transmissionPool(POOL, state({ era: 3 })).map((l) => l.id),
    ).toContain('idle-late')
    expect(
      transmissionPool(POOL, state({ era: 3 })).map((l) => l.id),
    ).not.toContain('idle-early')
  })

  it('a moment interjects with only its own era-gated lines', () => {
    const ids = transmissionPool(POOL, state({ era: 2, moment: 'era-up' })).map(
      (l) => l.id,
    )
    expect(ids).toEqual(['up-frost'])
  })

  it('a moment with no lines for this era falls back to ambience', () => {
    // 'era-up' has no era-3 lines in this pool — the strip must not go blank.
    const ids = transmissionPool(POOL, state({ era: 3, moment: 'era-up' })).map(
      (l) => l.id,
    )
    expect(ids).toEqual(['clear-a', 'clear-b', 'idle-late'])
  })
})

describe('pickTransmission — deterministic rotation', () => {
  it('same pool + same state + same tick ⇒ same line', () => {
    for (const tickN of [0, 1, 7, 999]) {
      const a = pickTransmission(POOL, state(), tickN)
      const b = pickTransmission(POOL, state(), tickN)
      expect(a).toEqual(b)
    }
  })

  it('rotates: consecutive ticks never repeat while the pool holds', () => {
    for (let t = 0; t < 12; t++) {
      const cur = pickTransmission(POOL, state(), t)
      const next = pickTransmission(POOL, state(), t + 1)
      expect(cur!.id).not.toBe(next!.id)
    }
  })

  it('cycles through the whole eligible pool', () => {
    const seen = new Set<string>()
    for (let t = 0; t < 3; t++) seen.add(pickTransmission(POOL, state(), t)!.id)
    expect(seen).toEqual(new Set(['clear-a', 'clear-b', 'idle-early']))
  })

  it('returns null only for an empty pool', () => {
    expect(pickTransmission([], state(), 0)).toBeNull()
    expect(pickTransmission(POOL, state(), 0)).not.toBeNull()
  })
})

describe('transmissionStateOf — reads visible run state only', () => {
  it('maps 0-based run.era to the 1-based content gate', () => {
    const run = makeRun(makeTestContent())
    expect(transmissionStateOf(run, null).era).toBe(1)
    expect(transmissionStateOf({ ...run, era: 3 }, null).era).toBe(4)
  })

  it('counts out-of-band systems and carries the moment through', () => {
    const run = makeRun(makeTestContent())
    expect(transmissionStateOf(run, null).outOfBand).toBe(0)
    const strained: RunState = {
      ...run,
      systems: {
        ...run.systems,
        thermal: { ...run.systems.thermal, value: 5 },
      },
    }
    expect(transmissionStateOf(strained, 'returned')).toEqual({
      era: 1,
      outOfBand: 1,
      moment: 'returned',
    })
  })
})

describe('the sim is byte-identical with the feature present', () => {
  const MOMENTS: (MomentTrigger | null)[] = [
    null,
    'era-up',
    'machine-built',
    'returned',
  ]

  /** Consult the strip the way the UI does, many times, at many ticks. */
  function murmur(run: RunState, uiTick: number): void {
    for (const moment of MOMENTS) {
      pickTransmission(transmissions, transmissionStateOf(run, moment), uiTick)
    }
  }

  it('interleaved selection leaves ticks, draws, and rng untouched', () => {
    const content = loadContent()
    const play = (withStrip: boolean): string[] => {
      let run = makeRun(content, 20260714)
      const snapshots: string[] = [JSON.stringify(run)]
      for (let i = 0; i < 8; i++) {
        if (withStrip) murmur(run, i)
        run = tick(run, content, 13)
        if (withStrip) murmur(run, i)
        run = tapCollect(run, content).run
        if (canDraw(run, content)) {
          run = drawCard(run, content).run
          if (withStrip) murmur(run, i)
          run = resolveCard(run, content, i % 2 === 0 ? 'left' : 'right').run
        }
        snapshots.push(JSON.stringify(run))
        if (run.collapse) break
      }
      return snapshots
    }
    expect(play(true)).toEqual(play(false))
  })

  it('selection never mutates the run it reads', () => {
    const content = loadContent()
    const run = makeRun(content, 7)
    const before = JSON.stringify(run)
    for (let t = 0; t < 50; t++) murmur(run, t)
    expect(JSON.stringify(run)).toBe(before)
    expect(run.rngState).toBe(makeRun(content, 7).rngState)
  })
})
