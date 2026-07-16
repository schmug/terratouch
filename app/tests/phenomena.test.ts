// phenomena.test.ts — Session Arc slice A: spawn scheduling, catching,
// payouts, and the active-time clock. Design doc:
// docs/superpowers/specs/2026-07-15-active-play-session-arc-design.md
import { describe, expect, it } from 'vitest'
import { newRun } from '../src/sim/actions'
import { applyOffline } from '../src/sim/offline'
import { catchPhenomenon, tailwindBoost } from '../src/sim/phenomena'
import { seedPhenoRng, seedRng } from '../src/sim/rng'
import { tick } from '../src/sim/tick'
import type { Content, PhenomenonDef } from '../src/sim/types'
import { makeTestContent } from './fixtures'

const METEOR: PhenomenonDef = {
  id: 'meteor',
  name: 'Meteor',
  blurb: 'x',
  weight: 1,
  payout: { kind: 'minerals', productionSec: 45 },
}

function phenoContent(defs: PhenomenonDef[] = [METEOR]): Content {
  return makeTestContent({ phenomena: defs })
}

/** Tick 1s at a time until a phenomenon is live (bounded). */
function tickUntilSpawn(run: ReturnType<typeof newRun>, content: Content) {
  for (let i = 0; i < 200 && !run.phenomenon; i++) run = tick(run, content, 1)
  return run
}

describe('newRun active-play fields', () => {
  it('initializes the v2 fields inert', () => {
    const content = makeTestContent()
    const run = newRun(content, 99, 'test-rock')
    expect(run.activeSec).toBe(0)
    expect(run.phenoRngState).toBe(seedPhenoRng(99))
    expect(run.phenoRngState).not.toBe(seedRng(99)) // distinct stream
    expect(run.phenomenon).toBeNull()
    expect(run.tailwind).toBeNull()
    expect(run.nextPhenomenonAtSec).toBe(0)
  })
})

describe('activeSec clock', () => {
  it('accrues active tick time and freezes offline', () => {
    const content = makeTestContent()
    let run = newRun(content, 1, 'test-rock')
    run = tick(run, content, 7)
    run = tick(run, content, 3)
    expect(run.activeSec).toBe(10)
    const after = applyOffline(run, content, 3600_000).run
    expect(after.activeSec).toBe(10)
  })
})

describe('phenomena scheduling', () => {
  it('stays fully dormant with an empty pool (no rng draws)', () => {
    const content = makeTestContent() // phenomena: []
    let run = newRun(content, 5, 'test-rock')
    const stream0 = run.phenoRngState
    for (let i = 0; i < 300; i++) run = tick(run, content, 1)
    expect(run.phenomenon).toBeNull()
    expect(run.nextPhenomenonAtSec).toBe(0)
    expect(run.phenoRngState).toBe(stream0)
  })

  it('lazily schedules within [0.5, 1.5) × meanSpacing, then spawns', () => {
    const content = phenoContent()
    let run = newRun(content, 5, 'test-rock')
    run = tick(run, content, 1) // first tick: 0-sentinel → schedule
    expect(run.nextPhenomenonAtSec).toBeGreaterThanOrEqual(1 + 30)
    expect(run.nextPhenomenonAtSec).toBeLessThan(1 + 90)
    run = tickUntilSpawn(run, content)
    expect(run.phenomenon).not.toBeNull()
    expect(run.phenomenon!.defId).toBe('meteor')
    expect(run.nextPhenomenonAtSec).toBe(0) // rescheduled lazily after resolve
    expect(run.phenomenon!.expiresAtActiveSec).toBe(
      run.activeSec + content.balance.phenomena.windowSec,
    )
  })

  it('expires a missed phenomenon silently and schedules the next', () => {
    const content = phenoContent()
    let run = tickUntilSpawn(newRun(content, 5, 'test-rock'), content)
    const firstExpiry = run.phenomenon!.expiresAtActiveSec
    for (let i = 0; i < 200 && run.phenomenon; i++) run = tick(run, content, 1)
    expect(run.phenomenon).toBeNull()
    expect(run.activeSec).toBeGreaterThanOrEqual(firstExpiry)
    run = tickUntilSpawn(run, content) // a second one arrives
    expect(run.phenomenon).not.toBeNull()
  })

  it('same seed ⇒ identical spawn schedule; main rng untouched', () => {
    const content = phenoContent()
    const play = (seed: number) => {
      let run = newRun(content, seed, 'test-rock')
      const events: Array<[number, string]> = []
      for (let i = 0; i < 400; i++) {
        const had = run.phenomenon?.defId
        run = tick(run, content, 1)
        if (run.phenomenon && run.phenomenon.defId !== had)
          events.push([run.activeSec, run.phenomenon.defId])
      }
      return { events, run }
    }
    const a = play(77)
    const b = play(77)
    expect(a.events).toEqual(b.events)
    expect(a.events.length).toBeGreaterThan(2)
    // Card stream isolation: 400 ticks of spawning consumed ZERO main rng.
    expect(a.run.rngState).toBe(newRun(content, 77, 'test-rock').rngState)
  })

  it('era-gates the pool like cards (1-based)', () => {
    const gated: PhenomenonDef = { ...METEOR, id: 'late', eras: [2, 2] }
    const content = phenoContent([gated])
    let run = newRun(content, 5, 'test-rock')
    for (let i = 0; i < 300; i++) run = tick(run, content, 1)
    expect(run.phenomenon).toBeNull() // era 1: pool empty, dormant
  })
})

/** Force a live phenomenon of the given def without ticking to it. */
function withLive(
  content: Content,
  def: PhenomenonDef,
  seed = 1,
): ReturnType<typeof newRun> {
  const run = newRun(content, seed, 'test-rock')
  return {
    ...run,
    activeSec: 100,
    phenomenon: { defId: def.id, expiresAtActiveSec: 112 },
  }
}

describe('catchPhenomenon', () => {
  it('minerals payout = productionSec × current production rate', () => {
    const content = phenoContent([METEOR]) // fixture baseRate 1/s, no machines
    const run = withLive(content, METEOR)
    const { run: after, caught } = catchPhenomenon(run, content)
    expect(caught?.id).toBe('meteor')
    expect(after.resources.minerals).toBe(run.resources.minerals + 45)
    expect(after.phenomenon).toBeNull()
  })

  it('vent payout floors Instability at 0', () => {
    const VENT: PhenomenonDef = {
      id: 'vent',
      name: 'Vent',
      blurb: 'x',
      weight: 1,
      payout: { kind: 'vent', amount: 4 },
    }
    const content = phenoContent([VENT])
    const hot = { ...withLive(content, VENT), instability: 10 }
    expect(catchPhenomenon(hot, content).run.instability).toBe(6)
    const calm = { ...withLive(content, VENT), instability: 2 }
    expect(catchPhenomenon(calm, content).run.instability).toBe(0)
  })

  it('energy payout respects cap + reserve', () => {
    const SPARK: PhenomenonDef = {
      id: 'spark',
      name: 'Spark',
      blurb: 'x',
      weight: 1,
      payout: { kind: 'energy', amount: 1 },
    }
    const content = phenoContent([SPARK])
    const full = { ...withLive(content, SPARK), energy: 13 } // cap 10 + reserve 3
    expect(catchPhenomenon(full, content).run.energy).toBe(13)
    const nearly = { ...withLive(content, SPARK), energy: 12.5 }
    expect(catchPhenomenon(nearly, content).run.energy).toBe(13)
  })

  it('tailwind payout arms the tailwind state', () => {
    const WIND: PhenomenonDef = {
      id: 'wind',
      name: 'Wind',
      blurb: 'x',
      weight: 1,
      payout: {
        kind: 'tailwind',
        system: 'thermal',
        durationSec: 30,
        pushMult: 2,
      },
    }
    const content = phenoContent([WIND])
    const { run: after } = catchPhenomenon(withLive(content, WIND), content)
    expect(after.tailwind).toEqual({
      system: 'thermal',
      untilActiveSec: 130,
      pushMult: 2,
    })
  })

  it('is a tolerant no-op when nothing is live or it just expired', () => {
    const content = phenoContent([METEOR])
    const idle = newRun(content, 1, 'test-rock')
    expect(catchPhenomenon(idle, content)).toEqual({ run: idle, caught: null })
    const expired = {
      ...withLive(content, METEOR),
      activeSec: 112, // exactly at expiry ⇒ gone
    }
    expect(catchPhenomenon(expired, content).caught).toBeNull()
    expect(catchPhenomenon(expired, content).run).toEqual(expired)
  })

  it('after a catch, the next tick schedules the next spawn', () => {
    const content = phenoContent([METEOR])
    let run = catchPhenomenon(withLive(content, METEOR), content).run
    expect(run.nextPhenomenonAtSec).toBe(0)
    run = tick(run, content, 1)
    expect(run.nextPhenomenonAtSec).toBeGreaterThan(run.activeSec)
  })
})

describe('tailwind boost', () => {
  const content = makeTestContent()
  const wind = { system: 'thermal' as const, untilActiveSec: 200, pushMult: 2 }

  function windyRun() {
    let run = newRun(content, 1, 'test-rock')
    // A thermal machine so there is push to multiply (real fixture ids —
    // matches what buildOrUpgrade(run, content, 'test-heater') constructs).
    run = {
      ...run,
      machines: [{ id: 'm-test-heater', typeId: 'test-heater', level: 1 }],
      activeSec: 100,
      tailwind: wind,
    }
    return run
  }

  it('reports the multiplier only for the boosted system while live', () => {
    const run = windyRun()
    expect(tailwindBoost(run, 'thermal')).toBe(2)
    expect(tailwindBoost(run, 'hydro')).toBe(1)
    expect(tailwindBoost({ ...run, activeSec: 200 }, 'thermal')).toBe(1) // over
    expect(tailwindBoost({ ...run, tailwind: null }, 'thermal')).toBe(1)
  })

  it('boosted active drift moves the system further toward setpoint', () => {
    const boosted = tick(windyRun(), content, 30)
    const calm = tick({ ...windyRun(), tailwind: null }, content, 30)
    const setpoint = boosted.systems.thermal.setpoint
    expect(Math.abs(boosted.systems.thermal.value - setpoint)).toBeLessThan(
      Math.abs(calm.systems.thermal.value - setpoint),
    )
  })

  it('offline drift is IDENTICAL with or without a live tailwind', () => {
    const withWind = applyOffline(windyRun(), content, 3600_000).run
    const without = applyOffline(
      { ...windyRun(), tailwind: null },
      content,
      3600_000,
    ).run
    expect(withWind.systems).toEqual(without.systems)
  })

  it('stepPhenomena clears an expired tailwind', () => {
    let run = windyRun()
    run = tick(run, content, 150) // activeSec 100 → 250, past 200
    expect(run.tailwind).toBeNull()
  })
})
