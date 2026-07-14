// content.test.ts — shipped content validates (SPEC §5.1) and malformed
// content fails loudly, including cross-file referential integrity.
import { describe, expect, it } from 'vitest'
import { loadContent, parseContent, validateContent } from '../src/data'
import archetypesJson from '../src/data/archetypes.json'
import balanceJson from '../src/data/balance.json'
import cardsJson from '../src/data/cards.json'
import erasJson from '../src/data/eras.json'
import machinesJson from '../src/data/machines.json'

const raw = () => ({
  balance: structuredClone(balanceJson) as unknown,
  eras: structuredClone(erasJson) as unknown,
  archetypes: structuredClone(archetypesJson) as unknown,
  machines: structuredClone(machinesJson) as unknown,
  cards: structuredClone(cardsJson) as unknown,
})

describe('shipped content', () => {
  it('parses and validates', () => {
    const content = loadContent()
    expect(content.eras).toHaveLength(7)
    expect(content.archetypes.map((a) => a.id)).toEqual(['barren']) // M1: Barren only
    expect(content.machines).toHaveLength(3)
    expect(content.cards.length).toBeGreaterThanOrEqual(20)
  })

  it('M1 scope: a machine steers thermal, atmosphere, and hydro', () => {
    const systems = loadContent()
      .machines.map((m) => m.system)
      .sort()
    expect(systems).toEqual(['atmosphere', 'hydro', 'thermal'])
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

  it('rejects a non-final era with no advance threshold', () => {
    const bad = raw()
    delete (bad.eras as Record<string, unknown>[])[0]!['advanceHabitability']
    expect(() => parseContent(bad)).toThrow(/no advance threshold/)
  })
})
