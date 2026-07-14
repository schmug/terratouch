// schema.ts — zod schemas for all content JSON (SPEC §5.1). Malformed
// content must fail loudly in dev, so every object is strict (unknown keys
// are errors) and index.ts adds cross-file referential-integrity checks.

import { z } from 'zod'
import type {
  ArchetypeDef,
  Balance,
  CardDef,
  EraDef,
  MachineDef,
} from '../sim/types'

const systemId = z.enum(['thermal', 'atmosphere', 'hydro', 'biosphere'])

/** A gauge position: 0–100. Bands must also stay off the lethal edges. */
const gaugeValue = z.number().min(0).max(100)

/** Safe-band edge: strictly inside the lethal 0/100 lines. */
const bandEdge = z.number().min(1).max(99)

const band = z
  .tuple([bandEdge, bandEdge])
  .refine(([lo, hi]) => lo < hi, { message: 'band lo must be < hi' })

const bands = z.strictObject({
  thermal: band,
  atmosphere: band,
  hydro: band,
  biosphere: band,
})

export const balanceSchema = z.strictObject({
  energy: z.strictObject({
    cap: z.number().positive(),
    regenPerSec: z.number().positive(),
    drawCost: z.number().positive(),
  }),
  tap: z.strictObject({
    baseRatePerSec: z.number().nonnegative(),
    bonusMult: z.number().min(1),
    poolCapSec: z.number().positive(),
  }),
  instability: z.strictObject({
    accrualPerSystemPerTurn: z.number().positive(),
    decayPerTurn: z.number().positive(),
    cascadeThreshold: z.number().positive(),
  }),
  setpoint: z
    .strictObject({ min: bandEdge, max: bandEdge })
    .refine((s) => s.min < s.max, { message: 'setpoint min must be < max' }),
  era: z.strictObject({ progressDecayMult: z.number().nonnegative() }),
  offline: z.strictObject({
    maxHours: z.number().positive(),
    productionMult: z.number().nonnegative(),
  }),
  cards: z.strictObject({ recentExclusion: z.number().int().nonnegative() }),
}) satisfies z.ZodType<Balance>

/** '#rrggbb' only — keeps the palette trivially safe to inline into SVG. */
const hexColor = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'expected a #rrggbb hex color')

const eraLayerSchema = z.strictObject({
  kind: z.enum([
    'frost',
    'seas',
    'microbial',
    'flora',
    'clouds',
    'aurora',
    'motes',
  ]),
  opacity: z.number().min(0).max(1),
  color: hexColor.optional(),
  count: z.number().int().positive().max(12).optional(),
})

const eraVisualsSchema = z
  .strictObject({
    surface: z.tuple([hexColor, hexColor, hexColor]),
    glow: hexColor,
    layers: z.array(eraLayerSchema).optional(),
  })
  .superRefine((visuals, ctx) => {
    const seen = new Set<string>()
    ;(visuals.layers ?? []).forEach((layer, i) => {
      if (seen.has(layer.kind)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate layer "${layer.kind}"`,
          path: ['layers', i],
        })
      }
      seen.add(layer.kind)
      if (layer.count !== undefined && layer.kind !== 'motes') {
        ctx.addIssue({
          code: 'custom',
          message: `"count" only applies to motes, not "${layer.kind}"`,
          path: ['layers', i, 'count'],
        })
      }
    })
  })

export const eraSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  advanceHabitability: z.number().min(1).max(100).optional(),
  stabilizationSec: z.number().positive().optional(),
  volatilityMult: z.number().positive(),
  bands,
  visuals: eraVisualsSchema.optional(),
}) satisfies z.ZodType<EraDef>

export const erasSchema = z
  .array(eraSchema)
  .min(1)
  .superRefine((eras, ctx) => {
    eras.forEach((era, i) => {
      const isLast = i === eras.length - 1
      const hasAdvance =
        era.advanceHabitability !== undefined &&
        era.stabilizationSec !== undefined
      if (!isLast && !hasAdvance) {
        ctx.addIssue({
          code: 'custom',
          message: `era "${era.id}" is not last but has no advance threshold/window`,
          path: [i],
        })
      }
    })
  })

const archetypeSystemSchema = z.strictObject({
  start: gaugeValue,
  setpoint: bandEdge,
  naturalRest: bandEdge,
  naturalRatePerSec: z.number().positive(),
})

export const archetypeSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  blurb: z.string().min(1),
  startingMinerals: z.number().nonnegative(),
  systems: z.strictObject({
    thermal: archetypeSystemSchema,
    atmosphere: archetypeSystemSchema,
    hydro: archetypeSystemSchema,
    biosphere: archetypeSystemSchema,
  }),
}) satisfies z.ZodType<ArchetypeDef>

export const archetypesSchema = z.array(archetypeSchema).min(1)

export const machineSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  blurb: z.string().min(1),
  system: systemId,
  baseCost: z.number().positive(),
  costMult: z.number().min(1),
  pushRatePerSecPerLevel: z.number().positive(),
  productionPerSecPerLevel: z.number().nonnegative(),
  maxLevel: z.number().int().positive(),
}) satisfies z.ZodType<MachineDef>

export const machinesSchema = z.array(machineSchema)

const cardEffectsSchema = z.strictObject({
  systems: z
    .strictObject({
      thermal: z.number().optional(),
      atmosphere: z.number().optional(),
      hydro: z.number().optional(),
      biosphere: z.number().optional(),
    })
    .optional(),
  instability: z.number().optional(),
  minerals: z.number().optional(),
  energy: z.number().optional(),
})

const cardChoiceSchema = z.strictObject({
  label: z.string().min(1),
  effects: cardEffectsSchema,
})

export const cardSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  eras: z
    .tuple([z.number().int().min(1), z.number().int().min(1)])
    .refine(([min, max]) => min <= max, { message: 'eras min must be <= max' }),
  archetypes: z.array(z.string().min(1)).optional(),
  weight: z.number().positive(),
  left: cardChoiceSchema,
  right: cardChoiceSchema,
}) satisfies z.ZodType<CardDef>

export const cardsSchema = z.array(cardSchema)
