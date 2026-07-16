// energy-reserve.test.ts — bonus Energy may overfill the cap by
// balance.energy.reserve; nothing passive ever claws it back.
import { describe, expect, it } from 'vitest'
import { newRun } from '../src/sim/actions'
import { drawCard, resolveCard } from '../src/sim/cards'
import { applyOffline } from '../src/sim/offline'
import { gainEnergy } from '../src/sim/systems'
import { tick } from '../src/sim/tick'
import { makeTestContent } from './fixtures'

const content = makeTestContent()
const { cap, reserve } = content.balance.energy // fixture: cap 10, reserve 3

describe('gainEnergy', () => {
  it('adds up to cap + reserve, no further', () => {
    expect(gainEnergy(9, 1, content.balance)).toBe(10)
    expect(gainEnergy(10, 1, content.balance)).toBe(11)
    expect(gainEnergy(12, 5, content.balance)).toBe(cap + reserve)
  })
  it('ignores non-positive amounts', () => {
    expect(gainEnergy(5, 0, content.balance)).toBe(5)
    expect(gainEnergy(5, -2, content.balance)).toBe(5)
  })
})

describe('overfill is never clawed back', () => {
  it('tick regen preserves overfilled energy', () => {
    const run = { ...newRun(content, 1, 'test-rock'), energy: cap + 2 }
    expect(tick(run, content, 100).energy).toBe(cap + 2)
  })
  it('tick regen still climbs to (only) the cap from below', () => {
    const run = { ...newRun(content, 1, 'test-rock'), energy: 0 }
    expect(tick(run, content, 10_000).energy).toBe(cap)
  })
  it('offline refill preserves overfilled energy', () => {
    const run = { ...newRun(content, 1, 'test-rock'), energy: cap + 2 }
    const { run: after, summary } = applyOffline(run, content, 3600_000)
    expect(after.energy).toBe(cap + 2)
    expect(summary.energyGained).toBe(0)
  })
})

describe('card energy routes through the reserve', () => {
  it('a +energy card can overfill up to cap + reserve', () => {
    const withCard = makeTestContent()
    withCard.cards = [
      {
        id: 'gift',
        title: 'Gift',
        text: 'x',
        eras: [1, 2],
        weight: 1,
        left: { label: 'take', effects: { energy: 5 } },
        right: { label: 'pass', effects: {} },
      },
    ]
    let run = { ...newRun(withCard, 1, 'test-rock'), energy: cap }
    run = drawCard(run, withCard).run // costs 1 → cap-1
    run = resolveCard(run, withCard, 'left').run
    expect(run.energy).toBe(cap + reserve) // cap-1+5=14 clamps to 13
  })
})
