// content.test.ts — shipped content validates (SPEC §5.1) and malformed
// content fails loudly, including cross-file referential integrity.
import { describe, expect, it } from 'vitest'
import {
  loadContent,
  parseContent,
  parseTransmissions,
  validateContent,
} from '../src/data'
import archetypesJson from '../src/data/archetypes.json'
import balanceJson from '../src/data/balance.json'
import cardsJson from '../src/data/cards.json'
import erasJson from '../src/data/eras.json'
import machinesJson from '../src/data/machines.json'
import phenomenaJson from '../src/data/phenomena.json'
import transmissionsJson from '../src/data/transmissions.json'
import upgradesJson from '../src/data/upgrades.json'

const raw = () => ({
  balance: structuredClone(balanceJson) as unknown,
  eras: structuredClone(erasJson) as unknown,
  archetypes: structuredClone(archetypesJson) as unknown,
  machines: structuredClone(machinesJson) as unknown,
  cards: structuredClone(cardsJson) as unknown,
  phenomena: structuredClone(phenomenaJson) as unknown,
  upgrades: structuredClone(upgradesJson) as unknown,
})

const rawTransmissions = () =>
  structuredClone(transmissionsJson) as Record<string, unknown>[]

describe('shipped content', () => {
  it('parses and validates', () => {
    const content = loadContent()
    expect(content.eras).toHaveLength(7)
    expect(content.archetypes.map((a) => a.id)).toEqual([
      'barren',
      'frozen',
      'volcanic',
    ])
    expect(content.machines).toHaveLength(4)
    expect(content.cards.length).toBeGreaterThanOrEqual(26)
    expect(content.upgrades.length).toBeGreaterThanOrEqual(7)
  })

  it('every system has a steering machine (issue #3: Spore Garden)', () => {
    const systems = loadContent()
      .machines.map((m) => m.system)
      .sort()
    expect(systems).toEqual(['atmosphere', 'biosphere', 'hydro', 'thermal'])
  })

  it('the Spore Garden wakes around Liquid/Microbial (issue #3 decision)', () => {
    const garden = loadContent().machines.find((m) => m.id === 'spore-garden')!
    expect(garden.unlockEra).toBeGreaterThanOrEqual(3)
    expect(garden.unlockEra).toBeLessThanOrEqual(4)
  })

  it('meta-upgrades cover every SPEC §2.8 effect family', () => {
    const kinds = new Set(loadContent().upgrades.map((u) => u.effect.kind))
    expect(kinds).toEqual(
      new Set([
        'machine-push-mult',
        'instability-accrual-mult',
        'starting-minerals',
        'energy-cap',
        'offline-cap-hours',
        'unlock-archetype',
      ]),
    )
  })

  it('every era has a card pool and rising bands stay off the lethal edges', () => {
    const content = loadContent()
    for (const era of content.eras) {
      for (const [lo, hi] of Object.values(era.bands)) {
        expect(lo).toBeGreaterThanOrEqual(1)
        expect(hi).toBeLessThanOrEqual(99)
        expect(lo).toBeLessThan(hi)
      }
    }
  })

  it('Mission Control ships ≥40 lines covering every trigger in every era (issue #16)', () => {
    const eraCount = loadContent().eras.length
    const lines = parseTransmissions(transmissionsJson, eraCount)
    expect(lines.length).toBeGreaterThanOrEqual(40)
    // parseTransmissions already enforces coverage; spot-check the corners
    // that only exist because eras gate the pool.
    const audible = (trigger: string, era: number) =>
      lines.some(
        (l) => l.trigger === trigger && era >= l.eras[0] && era <= l.eras[1],
      )
    expect(audible('idle', 1)).toBe(true)
    expect(audible('idle', eraCount)).toBe(true)
    expect(audible('era-up', 2)).toBe(true)
    expect(audible('era-up', eraCount)).toBe(true)
  })

  it('ships a non-empty, valid phenomena pool', () => {
    const content = loadContent()
    expect(content.phenomena.length).toBeGreaterThanOrEqual(4)
    const kinds = new Set(content.phenomena.map((p) => p.payout.kind))
    expect(kinds).toEqual(new Set(['minerals', 'vent', 'tailwind', 'energy']))
  })

  it('every era paints the planet, and life arrives on ladder (issue #10)', () => {
    const content = loadContent()
    const firstEraWith = (kind: string) =>
      content.eras.findIndex((e) =>
        e.visuals?.layers?.some((l) => l.kind === kind),
      )
    for (const era of content.eras) {
      expect(era.visuals, `era "${era.id}" has no visuals`).toBeDefined()
    }
    // The ladder is named for what you can see: frost caps from Frost, seas
    // from Liquid, the rust bloom from Microbial (with the first aurora),
    // green and motes from Flora on.
    expect(firstEraWith('frost')).toBe(1)
    expect(firstEraWith('seas')).toBe(2)
    expect(firstEraWith('microbial')).toBe(3)
    expect(firstEraWith('aurora')).toBe(3)
    expect(firstEraWith('flora')).toBe(4)
    expect(firstEraWith('motes')).toBe(4)
  })
})

describe('malformed content fails loudly', () => {
  it('rejects unknown keys', () => {
    const bad = raw()
    ;(bad.balance as Record<string, unknown>)['surprise'] = true
    expect(() => parseContent(bad)).toThrow()
  })

  it('rejects an inverted band', () => {
    const bad = raw()
    ;(
      bad.eras as { bands: { thermal: [number, number] } }[]
    )[0]!.bands.thermal = [60, 20]
    expect(() => parseContent(bad)).toThrow(/lo must be </)
  })

  it('rejects a band touching a lethal edge', () => {
    const bad = raw()
    ;(
      bad.eras as { bands: { biosphere: [number, number] } }[]
    )[0]!.bands.biosphere = [0, 30]
    expect(() => parseContent(bad)).toThrow()
  })

  it('rejects a card gated past the era ladder', () => {
    const bad = raw()
    ;(bad.cards as { eras: [number, number] }[])[0]!.eras = [1, 99]
    expect(() => parseContent(bad)).toThrow(/only 7 exist/)
  })

  it('rejects a card referencing an unknown archetype', () => {
    const bad = raw()
    ;(bad.cards as { archetypes?: string[] }[])[0]!.archetypes = ['gas-giant']
    expect(() => parseContent(bad)).toThrow(/unknown archetype/)
  })

  it('rejects an archetype starting outside the era-1 band', () => {
    const bad = raw()
    ;(
      bad.archetypes as { systems: { thermal: { start: number } } }[]
    )[0]!.systems.thermal.start = 99
    expect(() => parseContent(bad)).toThrow(/outside Era-1 band/)
  })

  it('rejects duplicate ids', () => {
    const content = loadContent()
    const dupe = {
      ...content,
      cards: [...content.cards, content.cards[0]!],
    }
    expect(() => validateContent(dupe)).toThrow(/duplicate card id/)
  })

  it('rejects a duplicate upgrade id', () => {
    const content = loadContent()
    const dupe = {
      ...content,
      upgrades: [...content.upgrades, content.upgrades[0]!],
    }
    expect(() => validateContent(dupe)).toThrow(/duplicate upgrade id/)
  })

  it('rejects a machine unlocking past the era ladder', () => {
    const bad = raw()
    ;(bad.machines as { unlockEra?: number }[])[0]!.unlockEra = 99
    expect(() => parseContent(bad)).toThrow(/only 7 exist/)
  })

  it('rejects an instability upgrade that could stop accrual entirely', () => {
    const bad = raw()
    const steady = (
      bad.upgrades as { id: string; effect: { perLevel: number } }[]
    ).find((u) => u.id === 'steady-hands')!
    steady.effect.perLevel = 1
    expect(() => parseContent(bad)).toThrow()
  })

  it('rejects a non-final era with no advance threshold', () => {
    const bad = raw()
    delete (bad.eras as Record<string, unknown>[])[0]!['advanceHabitability']
    expect(() => parseContent(bad)).toThrow(/no advance threshold/)
  })

  it('rejects a visuals color that is not #rrggbb', () => {
    const bad = raw()
    ;(bad.eras as { visuals: { glow: string } }[])[0]!.visuals.glow = 'tomato'
    expect(() => parseContent(bad)).toThrow(/#rrggbb/)
  })

  it('rejects an unknown visual layer kind', () => {
    const bad = raw()
    ;(
      bad.eras as { visuals: { layers: { kind: string }[] } }[]
    )[0]!.visuals.layers[0]!.kind = 'lava'
    expect(() => parseContent(bad)).toThrow()
  })

  it('rejects a mote count on a non-mote layer', () => {
    const bad = raw()
    ;(
      bad.eras as { visuals: { layers: { count?: number }[] } }[]
    )[1]!.visuals.layers[0]!.count = 3
    expect(() => parseContent(bad)).toThrow(/only applies to motes/)
  })

  it('rejects duplicate visual layers', () => {
    const bad = raw()
    const layers = (
      bad.eras as { visuals: { layers: { kind: string }[] } }[]
    )[1]!.visuals.layers
    layers.push({ ...layers[0]! })
    expect(() => parseContent(bad)).toThrow(/duplicate layer/)
  })

  it('rejects a duplicate transmission id', () => {
    const bad = rawTransmissions()
    bad.push({ ...bad[0]! })
    expect(() => parseTransmissions(bad, 7)).toThrow(
      /duplicate transmission id/,
    )
  })

  it('rejects a transmission gated past the era ladder', () => {
    const bad = rawTransmissions()
    bad[0]!['eras'] = [1, 99]
    expect(() => parseTransmissions(bad, 7)).toThrow(/only 7 exist/)
  })

  it('rejects an unknown transmission trigger', () => {
    const bad = rawTransmissions()
    bad[0]!['trigger'] = 'doomsday'
    expect(() => parseTransmissions(bad, 7)).toThrow()
  })

  it('rejects a transmission too long for the strip', () => {
    const bad = rawTransmissions()
    bad[0]!['text'] = 'x'.repeat(101)
    expect(() => parseTransmissions(bad, 7)).toThrow()
  })

  it('rejects a trigger left silent in an era it can fire in', () => {
    const bad = rawTransmissions().filter((l) => l['trigger'] !== 'returned')
    expect(() => parseTransmissions(bad, 7)).toThrow(
      /no "returned" transmission for era 1/,
    )
  })

  it('rejects unknown transmission keys', () => {
    const bad = rawTransmissions()
    bad[0]!['mood'] = 'doom'
    expect(() => parseTransmissions(bad, 7)).toThrow()
  })
})
