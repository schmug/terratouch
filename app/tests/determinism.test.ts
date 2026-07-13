// determinism.test.ts — SPEC §5.2: same seed + same actions ⇒ byte-identical
// state, across the full action surface (ticks, taps, builds, setpoints,
// draws, swipes, offline gaps).
import { describe, expect, it } from 'vitest'
import { buildOrUpgrade, newRun, setSetpoint, tapCollect } from '../src/sim/actions'
import { canDraw, drawCard, resolveCard } from '../src/sim/cards'
import { applyOffline } from '../src/sim/offline'
import { tick } from '../src/sim/tick'
import type { Content, RunState } from '../src/sim/types'
import { loadContent } from '../src/data'
import { makeTestContent } from './fixtures'

/** A fixed action script exercising every sim entry point. */
function playScript(content: Content, seed: number, archetypeId: string): string[] {
  let run: RunState = newRun(content, seed, archetypeId)
  const snapshots: string[] = [JSON.stringify(run)]
  const sides = ['left', 'right', 'right', 'left', 'right', 'left', 'left', 'right'] as const

  for (let i = 0; i < sides.length; i++) {
    run = tick(run, content, 17)
    run = tapCollect(run, content).run
    try {
      run = buildOrUpgrade(run, content, content.machines[0]!.id)
    } catch {
      // not affordable / maxed — part of the script, still deterministic
    }
    if (run.machines.length > 0) {
      run = setSetpoint(run, content, content.machines[0]!.system, 30 + i * 5)
    }
    if (i === 3) run = applyOffline(run, content, 2 * 3_600_000).run
    if (canDraw(run, content)) {
      run = drawCard(run, content).run
      run = resolveCard(run, content, sides[i]!).run
    }
    snapshots.push(JSON.stringify(run))
    if (run.collapse) break
  }
  return snapshots
}

describe('determinism', () => {
  it('same seed + same actions ⇒ byte-identical state at every step (fixture content)', () => {
    const content = makeTestContent()
    const a = playScript(content, 777, 'test-rock')
    const b = playScript(content, 777, 'test-rock')
    expect(a).toEqual(b)
  })

  it('same seed + same actions ⇒ byte-identical state (shipped content)', () => {
    const content = loadContent()
    for (const seed of [1, 424242, 2 ** 31 - 1]) {
      const a = playScript(content, seed, 'barren')
      const b = playScript(content, seed, 'barren')
      expect(a).toEqual(b)
    }
  })

  it('different seeds diverge', () => {
    const content = loadContent()
    const a = playScript(content, 1, 'barren')
    const b = playScript(content, 2, 'barren')
    expect(a.at(-1)).not.toEqual(b.at(-1))
  })
})
