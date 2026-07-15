// index.ts — load + validate all content JSON into a typed Content bundle
// (SPEC §5.1). Validation runs at module load so malformed content fails
// loudly in dev, with schema checks (schema.ts) plus the cross-file
// referential-integrity checks below. The sim itself never imports this —
// callers pass the Content bundle in.

import type { Content } from '../sim/types'
import archetypesJson from './archetypes.json'
import balanceJson from './balance.json'
import cardsJson from './cards.json'
import erasJson from './eras.json'
import machinesJson from './machines.json'
import transmissionsJson from './transmissions.json'
import upgradesJson from './upgrades.json'
import {
  archetypesSchema,
  balanceSchema,
  cardsSchema,
  erasSchema,
  machinesSchema,
  transmissionsSchema,
  transmissionTriggerSchema,
  upgradesSchema,
  type TransmissionDef,
} from './schema'

export type { TransmissionDef, TransmissionTrigger } from './schema'

const dupes = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i)

/** Cross-file invariants that per-file schemas can't see. Throws on failure. */
export function validateContent(content: Content): void {
  const problems: string[] = []
  const eraCount = content.eras.length
  const archetypeIds = new Set(content.archetypes.map((a) => a.id))
  for (const d of dupes(content.eras.map((e) => e.id)))
    problems.push(`duplicate era id "${d}"`)
  for (const d of dupes(content.cards.map((c) => c.id)))
    problems.push(`duplicate card id "${d}"`)
  for (const d of dupes(content.machines.map((m) => m.id)))
    problems.push(`duplicate machine id "${d}"`)
  for (const d of dupes(content.archetypes.map((a) => a.id)))
    problems.push(`duplicate archetype id "${d}"`)
  for (const d of dupes(content.upgrades.map((u) => u.id)))
    problems.push(`duplicate upgrade id "${d}"`)

  for (const machine of content.machines) {
    if (machine.unlockEra !== undefined && machine.unlockEra > eraCount) {
      problems.push(
        `machine "${machine.id}" unlocks at era ${machine.unlockEra} but only ${eraCount} exist`,
      )
    }
  }

  for (const card of content.cards) {
    if (card.eras[1] > eraCount) {
      problems.push(
        `card "${card.id}" gates up to era ${card.eras[1]} but only ${eraCount} exist`,
      )
    }
    for (const ref of card.archetypes ?? []) {
      if (!archetypeIds.has(ref)) {
        problems.push(`card "${card.id}" references unknown archetype "${ref}"`)
      }
    }
  }

  // Every archetype must start playable: values inside the Era-1 bands
  // (otherwise a run could begin already accruing Instability), and rest
  // points/setpoints must be reachable without touching a lethal edge.
  const era0 = content.eras[0]
  if (era0) {
    for (const arch of content.archetypes) {
      for (const [systemId, def] of Object.entries(arch.systems)) {
        const band = era0.bands[systemId as keyof typeof era0.bands]
        if (def.start < band[0] || def.start > band[1]) {
          problems.push(
            `archetype "${arch.id}" starts ${systemId} at ${def.start}, outside Era-1 band [${band[0]}, ${band[1]}]`,
          )
        }
      }
    }
  }

  // Each Era's first appearance of a card pool must be non-empty for every
  // archetype, or drawing could dead-end mid-run.
  for (let era = 1; era <= eraCount; era++) {
    for (const arch of content.archetypes) {
      const pool = content.cards.filter(
        (c) =>
          era >= c.eras[0] &&
          era <= c.eras[1] &&
          (!c.archetypes || c.archetypes.includes(arch.id)),
      )
      if (pool.length === 0) {
        problems.push(`empty card pool: era ${era}, archetype "${arch.id}"`)
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`content validation failed:\n - ${problems.join('\n - ')}`)
  }
}

/** Parse and validate raw JSON content. Exported for tests. */
export function parseContent(raw: {
  balance: unknown
  eras: unknown
  archetypes: unknown
  machines: unknown
  cards: unknown
  upgrades: unknown
}): Content {
  const content: Content = {
    balance: balanceSchema.parse(raw.balance),
    eras: erasSchema.parse(raw.eras),
    archetypes: archetypesSchema.parse(raw.archetypes),
    machines: machinesSchema.parse(raw.machines),
    cards: cardsSchema.parse(raw.cards),
    upgrades: upgradesSchema.parse(raw.upgrades),
  }
  validateContent(content)
  return content
}

export function loadContent(): Content {
  return parseContent({
    balance: balanceJson,
    eras: erasJson,
    archetypes: archetypesJson,
    machines: machinesJson,
    cards: cardsJson,
    upgrades: upgradesJson,
  })
}

/**
 * Parse and validate the Mission Control transmission pool (issue #16).
 * Deliberately NOT part of the Content bundle: the sim never reads these, so
 * they stay out of sim/types entirely — only ui/ consumes them. Beyond the
 * schema, every trigger must stay audible in every era it can fire in (the
 * strip must never fall silent), and 'era-up' can only fire from Era 2 on.
 */
export function parseTransmissions(
  raw: unknown,
  eraCount: number,
): TransmissionDef[] {
  const lines = transmissionsSchema.parse(raw)
  const problems: string[] = []

  for (const d of dupes(lines.map((l) => l.id)))
    problems.push(`duplicate transmission id "${d}"`)

  for (const line of lines) {
    if (line.eras[1] > eraCount) {
      problems.push(
        `transmission "${line.id}" gates up to era ${line.eras[1]} but only ${eraCount} exist`,
      )
    }
  }

  for (const trigger of transmissionTriggerSchema.options) {
    const firstEra = trigger === 'era-up' ? 2 : 1
    for (let era = firstEra; era <= eraCount; era++) {
      const audible = lines.some(
        (l) => l.trigger === trigger && era >= l.eras[0] && era <= l.eras[1],
      )
      if (!audible) {
        problems.push(`no "${trigger}" transmission for era ${era}`)
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `transmissions validation failed:\n - ${problems.join('\n - ')}`,
    )
  }
  return lines
}

/** The validated content bundle the app uses. Fails loudly at import time. */
export const content: Content = loadContent()

/** The validated Mission Control line pool. Fails loudly at import time. */
export const transmissions: TransmissionDef[] = parseTransmissions(
  transmissionsJson,
  content.eras.length,
)
