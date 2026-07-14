// cards.test.ts — seeded weighted draws, Energy cost, gating, choice
// application, and both collapse paths (SPEC §2.4, §2.5).
import { describe, expect, it } from 'vitest'
import { canDraw, cardPool, drawCard, resolveCard } from '../src/sim/cards'
import type { RunState } from '../src/sim/types'
import { makeRun, makeTestContent } from './fixtures'

const content = makeTestContent()

function drawSpecific(run: RunState, cardId: string): RunState {
  // Deterministically force a specific active card for choice tests.
  return { ...run, activeCardId: cardId, energy: run.energy - 1 }
}

describe('card pool gating', () => {
  it('filters by era and archetype', () => {
    const run = makeRun(content)
    const ids = cardPool(run, content).map((c) => c.id)
    expect(ids).toContain('nudge')
    expect(ids).not.toContain('late-only') // era 2 only
    expect(ids).not.toContain('other-world') // different archetype
    const eraTwo = cardPool({ ...run, era: 1 }, content).map((c) => c.id)
    expect(eraTwo).toContain('late-only')
  })
})

describe('drawing', () => {
  it('costs energy and sets the active card', () => {
    const run = makeRun(content)
    const { run: drawn, card } = drawCard(run, content)
    expect(drawn.energy).toBe(run.energy - 1)
    expect(drawn.activeCardId).toBe(card.id)
    expect(drawn.rngState).not.toBe(run.rngState)
    expect(drawn.recentCardIds[0]).toBe(card.id)
  })

  it('refuses to draw without energy, mid-card, or after collapse', () => {
    const run = makeRun(content)
    expect(() => drawCard({ ...run, energy: 0.5 }, content)).toThrow(
      'no-energy',
    )
    expect(canDraw({ ...run, energy: 0.5 }, content)).toBe(false)
    const { run: drawn } = drawCard(run, content)
    expect(() => drawCard(drawn, content)).toThrow('card-active')
    const { run: dead } = resolveCard(
      drawSpecific(run, 'haymaker'),
      content,
      'left',
    )
    expect(dead.collapse).not.toBeNull()
    expect(() => drawCard(dead, content)).toThrow('run-over')
  })

  it('same seed draws the same sequence of cards', () => {
    const script = (seed: number) => {
      let run = makeRun(content, seed)
      const ids: string[] = []
      for (let i = 0; i < 8; i++) {
        const { run: drawn, card } = drawCard(run, content)
        ids.push(card.id)
        run = resolveCard(drawn, content, i % 2 === 0 ? 'left' : 'right').run
        if (run.collapse) break
      }
      return ids
    }
    expect(script(2024)).toEqual(script(2024))
  })

  it('does not repeat recently drawn cards when the pool allows', () => {
    // Pool for era 1 / test-rock is 3 cards; recentExclusion is 2, so two
    // consecutive draws can never repeat.
    let run = makeRun(content, 5)
    let last = ''
    for (let i = 0; i < 12; i++) {
      const { run: drawn, card } = drawCard({ ...run, energy: 10 }, content)
      expect(card.id).not.toBe(last)
      last = card.id
      run = { ...drawn, activeCardId: null }
    }
  })
})

describe('resolving', () => {
  it('applies system deltas, resource and energy effects', () => {
    const run = makeRun(content)
    const { run: after, applied } = resolveCard(
      drawSpecific(run, 'nudge'),
      content,
      'right',
    )
    expect(after.systems.thermal.value).toBe(45) // 40 + 5 × volatility 1
    expect(applied.systems.thermal).toBe(5)
    expect(after.turns).toBe(1)
    expect(after.activeCardId).toBeNull()

    const { run: paid, applied: a2 } = resolveCard(
      drawSpecific(run, 'windfall'),
      content,
      'left',
    )
    expect(paid.resources.minerals).toBe(120)
    expect(a2.minerals).toBe(20)
  })

  it('scales system deltas by the era volatility multiplier', () => {
    let run = { ...makeRun(content), era: 1 } // era two: volatility 2
    run = {
      ...run,
      systems: {
        ...run.systems,
        thermal: { ...run.systems.thermal, value: 50 },
      },
    }
    const { run: after } = resolveCard(
      drawSpecific(run, 'nudge'),
      content,
      'right',
    )
    expect(after.systems.thermal.value).toBe(60) // 50 + 5 × 2
  })

  it('instability accrues on out-of-band turns and decays on clean ones', () => {
    // 'nudge' left cools thermal 40 → 35, still inside [20, 60]: clean turn.
    const run = { ...makeRun(content), instability: 20 }
    const { run: clean } = resolveCard(
      drawSpecific(run, 'nudge'),
      content,
      'left',
    )
    expect(clean.instability).toBe(15) // decayPerTurn 5

    // Force thermal far below band, then take a turn: accrual 10 for 1 system.
    const outState = {
      ...run,
      systems: {
        ...run.systems,
        thermal: { ...run.systems.thermal, value: 10 },
      },
    }
    const { run: out } = resolveCard(
      drawSpecific(outState, 'windfall'),
      content,
      'left',
    )
    expect(out.instability).toBe(30)
    expect(out.history.turnsOutOfBand.thermal).toBe(1)
  })

  it('direct instability effects clamp at zero', () => {
    const run = { ...makeRun(content), instability: 4 }
    // windfall right: instability -10, then clean-turn decay 5 → stays 0.
    const { run: after } = resolveCard(
      drawSpecific(run, 'windfall'),
      content,
      'right',
    )
    expect(after.instability).toBe(0)
  })

  it('hard fail: a lethal edge collapses the run with the right cause', () => {
    const run = makeRun(content)
    const { run: frozen } = resolveCard(
      drawSpecific(run, 'haymaker'),
      content,
      'left',
    )
    expect(frozen.systems.thermal.value).toBe(0)
    expect(frozen.collapse?.cause).toEqual({
      kind: 'hard-fail',
      system: 'thermal',
      direction: 'low',
    })
    const { run: boiled } = resolveCard(
      drawSpecific(run, 'haymaker'),
      content,
      'right',
    )
    expect(boiled.collapse?.cause).toEqual({
      kind: 'hard-fail',
      system: 'thermal',
      direction: 'high',
    })
    expect(boiled.collapse?.turnsSurvived).toBe(1)
  })

  it('cascade: crossing the instability threshold collapses the run', () => {
    let run = { ...makeRun(content), instability: 95 }
    // Put atmosphere out of band so the turn accrues 10 → 105 ≥ 100.
    run = {
      ...run,
      systems: {
        ...run.systems,
        atmosphere: { ...run.systems.atmosphere, value: 5 },
      },
      history: {
        ...run.history,
        turnsOutOfBand: { thermal: 0, atmosphere: 6, hydro: 0, biosphere: 0 },
      },
    }
    const { run: dead } = resolveCard(
      drawSpecific(run, 'windfall'),
      content,
      'left',
    )
    expect(dead.collapse?.cause.kind).toBe('cascade')
    expect(dead.collapse?.cause.system).toBe('atmosphere')
    expect(dead.collapse?.cause.direction).toBe('low')
  })

  it('refuses to resolve with no active card or after collapse', () => {
    const run = makeRun(content)
    expect(() => resolveCard(run, content, 'left')).toThrow('no-active-card')
    const { run: dead } = resolveCard(
      drawSpecific(run, 'haymaker'),
      content,
      'left',
    )
    expect(() => resolveCard(dead, content, 'left')).toThrow('run-over')
  })
})
