// templates.test.ts — the templated chronicle must cover every cause key,
// stay under the word cap, and never block on anything (SPEC §5.4).
import { describe, expect, it } from 'vitest'
import { templatedChronicle } from '../src/net/templates'
import { SYSTEM_IDS, type CollapseReport } from '../src/sim/types'

function report(overrides: Partial<CollapseReport> = {}): CollapseReport {
  return {
    archetype: 'Barren',
    eraReached: 'Frost',
    turnsSurvived: 23,
    cause: { kind: 'hard-fail', system: 'thermal', direction: 'low' },
    systemsFinal: { thermal: 0, atmosphere: 30, hydro: 20, biosphere: 5 },
    peakHabitability: 48,
    notableStats: ['the waters spent 4 turns outside the safe band', 'habitability peaked at 48'],
    seedsAwarded: 0,
    ...overrides,
  }
}

describe('templated chronicle', () => {
  it('produces distinct prose for every cause key', () => {
    const texts = new Set<string>()
    for (const kind of ['hard-fail', 'cascade'] as const) {
      for (const system of SYSTEM_IDS) {
        for (const direction of ['low', 'high'] as const) {
          const text = templatedChronicle(report({ cause: { kind, system, direction } }))
          expect(text.length).toBeGreaterThan(40)
          texts.add(text)
        }
      }
    }
    expect(texts.size).toBe(16)
  })

  it('stays at or under 120 words and mentions the era, archetype, and stats', () => {
    const text = templatedChronicle(report())
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(120)
    expect(text).toContain('Barren')
    expect(text).toContain('Frost')
    expect(text).toContain('23 turns')
    expect(text).toContain('the waters spent 4 turns')
  })

  it('is deterministic', () => {
    expect(templatedChronicle(report())).toBe(templatedChronicle(report()))
  })

  it('handles an empty stats list and a single turn', () => {
    const text = templatedChronicle(report({ notableStats: [], turnsSurvived: 1 }))
    expect(text).toContain('a single turn')
    expect(text).not.toContain('Remember it honestly')
  })
})
