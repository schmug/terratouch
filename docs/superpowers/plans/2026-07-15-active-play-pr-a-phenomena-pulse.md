# Active Play PR A — Phenomena + Tap Pulse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice A of the approved Session Arc design ([spec](../specs/2026-07-15-active-play-session-arc-design.md)): tappable planetary phenomena on an active-time clock, an on-beat tap-pool pulse, the Energy reserve, an `attentive` harness policy, and acceptance-walk coverage.

**Architecture:** All game rules stay in `app/src/sim/` as pure functions. A new `activeSec` clock (advanced only by `tick()`, frozen offline) drives phenomenon spawn/expiry and the pulse phase. A second mulberry32 stream (`phenoRngState`) isolates phenomena randomness from card draws so existing replay/harness guarantees survive byte-identically. Save schema bumps 1 → 2.

**Tech Stack:** React 19 + Vite 8 + TypeScript 7, zustand 5, zod 4, vitest 4, idb. Tests run in pure node (`npm --prefix app test`).

## Global Constraints

- **Sim purity (CLAUDE.md rule 1–2):** no React/DOM/I/O/network/wall-clock in `app/src/sim/`. Time arrives as deltas.
- **Determinism (rule 3):** same seed + same actions ⇒ identical run. All new randomness flows through `phenoRngState` via `sim/rng.ts` helpers.
- **Offline safety (rule 4):** `offline.ts` gains NO references to phenomena/tailwind/activeSec. Offline never advances the new clock, never spawns, never boosts drift.
- **Content is data (rule 5):** phenomena live in `app/src/data/phenomena.json`, zod-validated, cross-checked in `data/index.ts`.
- **Save has `schemaVersion` + migration switch (rule 6):** v1 saves must load losslessly into v2.
- **Bonus-only invariant (spec):** a player (or bot) who ignores every new mechanic gets exactly today's game. Misses cost nothing.
- **Workflow:** TDD every task (failing test → implement → pass → commit). Conventional commit prefixes. `npm run format && npm run lint` (repo root) before every commit. Never push to `main`; PR at the end with both CI checks green.
- Work happens on the current branch `claude/active-gameplay-engagement-08b78f`.
- All `npm` commands for the app run as `npm --prefix app …` from the repo root.

---

### Task 1: Schema v2 foundation (types, rng stream, migration, content plumbing)

Everything that must change atomically for the app to compile: new `RunState`/`Balance`/`Content` fields with inert defaults, the pheno rng stream, `phenomena.json` + schemas, and the v1→v2 save migration. Zero behavior change — phenomena exist as data but nothing spawns yet.

**Files:**

- Modify: `app/src/sim/types.ts`
- Modify: `app/src/sim/rng.ts`
- Modify: `app/src/sim/actions.ts` (newRun init)
- Modify: `app/src/persist/db.ts` (migration)
- Modify: `app/src/state/store.ts` (schemaVersion literal in `currentSave()`)
- Modify: `app/src/data/balance.json`, `app/src/data/schema.ts`, `app/src/data/index.ts`
- Create: `app/src/data/phenomena.json`
- Modify: `app/tests/fixtures.ts`
- Test: `app/tests/persist.test.ts`, `app/tests/phenomena.test.ts` (new), `app/tests/content.test.ts`

**Interfaces:**

- Produces: `RunState.{activeSec, phenoRngState, phenomenon, tailwind, nextPhenomenonAtSec}`, `Save.schemaVersion: 2`, `Balance.{energy.reserve, phenomena, pulse}`, `Content.phenomena: PhenomenonDef[]`, `PhenomenonDef`/`PhenomenonPayout` types, `seedPhenoRng(seed): number` in `sim/rng.ts`.
- Consumes: existing `seedRng`, `migrateSave`, `parseContent` shapes shown below.

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/persist.test.ts` (it already imports `migrateSave` — follow its existing fixture style for a valid v1 save object; build one via `newRun` + wrapping):

```ts
import { seedPhenoRng } from '../src/sim/rng'

describe('v1 → v2 migration (active-play fields)', () => {
  it('upgrades a v1 save in place with inert defaults', () => {
    const content = makeTestContent()
    const run = newRun(content, 42, 'test-rock')
    // Simulate a stored v1 run: strip the v2 fields.
    const {
      activeSec: _a,
      phenoRngState: _p,
      phenomenon: _ph,
      tailwind: _t,
      nextPhenomenonAtSec: _n,
      ...v1run
    } = run
    const v1save = {
      schemaVersion: 1,
      run: v1run,
      meta: {
        genesisSeeds: 3,
        upgrades: {},
        codex: [],
        unlockedArchetypes: ['test-rock'],
        stats: { runs: 1, bestEra: 0, longestRun: 4 },
      },
      lastSeenMs: 1_700_000_000_000,
    }
    const migrated = migrateSave(v1save)
    expect(migrated).not.toBeNull()
    expect(migrated!.schemaVersion).toBe(2)
    expect(migrated!.run!.activeSec).toBe(0)
    expect(migrated!.run!.phenoRngState).toBe(seedPhenoRng(42))
    expect(migrated!.run!.phenomenon).toBeNull()
    expect(migrated!.run!.tailwind).toBeNull()
    expect(migrated!.run!.nextPhenomenonAtSec).toBe(0)
    expect(migrated!.meta.genesisSeeds).toBe(3) // meta untouched
  })

  it('passes a v2 save through unchanged', () => {
    const content = makeTestContent()
    const save = {
      schemaVersion: 2,
      run: newRun(content, 7, 'test-rock'),
      meta: {
        genesisSeeds: 0,
        upgrades: {},
        codex: [],
        unlockedArchetypes: ['test-rock'],
        stats: { runs: 1, bestEra: 0, longestRun: 0 },
      },
      lastSeenMs: 1_700_000_000_000,
    }
    expect(migrateSave(save)).toEqual(save)
  })

  it('a run-less v1 save migrates without inventing a run', () => {
    const v1 = {
      schemaVersion: 1,
      run: null,
      meta: {
        genesisSeeds: 0,
        upgrades: {},
        codex: [],
        unlockedArchetypes: ['barren'],
        stats: { runs: 0, bestEra: 0, longestRun: 0 },
      },
      lastSeenMs: 1,
    }
    const migrated = migrateSave(v1)
    expect(migrated!.schemaVersion).toBe(2)
    expect(migrated!.run).toBeNull()
  })
})
```

Create `app/tests/phenomena.test.ts`:

```ts
// phenomena.test.ts — Session Arc slice A: spawn scheduling, catching,
// payouts, and the active-time clock. Design doc:
// docs/superpowers/specs/2026-07-15-active-play-session-arc-design.md
import { describe, expect, it } from 'vitest'
import { newRun } from '../src/sim/actions'
import { seedPhenoRng, seedRng } from '../src/sim/rng'
import { makeTestContent } from './fixtures'

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
```

Append to `app/tests/content.test.ts` (follow its existing style):

```ts
it('ships a non-empty, valid phenomena pool', () => {
  const content = loadContent()
  expect(content.phenomena.length).toBeGreaterThanOrEqual(4)
  const kinds = new Set(content.phenomena.map((p) => p.payout.kind))
  expect(kinds).toEqual(new Set(['minerals', 'vent', 'tailwind', 'energy']))
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test`
Expected: FAIL — TypeScript/property errors (`activeSec` does not exist, `seedPhenoRng` not exported, `phenomena` not on Content).

- [ ] **Step 3: Implement the types**

In `app/src/sim/types.ts`:

Add after the `MachineDef` block (near the other content types):

```ts
// ---------------------------------------------------------------------------
// Phenomena (Session Arc slice A): transient tappable events that exist only
// in ACTIVE time. Bonus-only by design — a miss expires silently.
// ---------------------------------------------------------------------------

export type PhenomenonPayout =
  /** Lump-sum minerals worth `productionSec` seconds of current production. */
  | { kind: 'minerals'; productionSec: number }
  /** Vents Instability (floored at 0). Only matters during active play. */
  | { kind: 'vent'; amount: number }
  /** One system's machine push ×pushMult toward setpoint for durationSec. */
  | {
      kind: 'tailwind'
      system: SystemId
      durationSec: number
      pushMult: number
    }
  /** Bonus Energy via gainEnergy (may overfill up to cap + reserve). */
  | { kind: 'energy'; amount: number }

export type PhenomenonDef = {
  id: string
  name: string
  blurb: string
  weight: number
  payout: PhenomenonPayout
  /** Inclusive 1-based Era range (like card gates); omitted = all eras. */
  eras?: readonly [min: number, max: number]
  /** Archetype ids this appears for; omitted = all archetypes. */
  archetypes?: string[]
}
```

In `RunState`, after `recentCardIds: string[]`:

```ts
  /**
   * Cumulative seconds of ACTIVE play — advanced only by tick(), never by
   * offline.ts. The clock for phenomena, tailwinds, and the tap pulse; its
   * freezing while away is what makes leaving always free.
   */
  activeSec: number
  /**
   * Second mulberry32 stream (phenomena spawns/types). Never used for card
   * draws, so card sequences are identical whether or not anyone engages.
   */
  phenoRngState: number
  /** The currently tappable phenomenon, if one is live. */
  phenomenon: { defId: string; expiresAtActiveSec: number } | null
  /** A live tailwind boost from a caught phenomenon. */
  tailwind: { system: SystemId; untilActiveSec: number; pushMult: number } | null
  /** Next spawn time on the activeSec clock; 0 = unscheduled (lazy). */
  nextPhenomenonAtSec: number
```

In `Save`: change `schemaVersion: 1` to `schemaVersion: 2`.

In `Balance`: change the `energy` line to include the reserve, and add two blocks after `tap`:

```ts
energy: {
  cap: number
  regenPerSec: number
  drawCost: number
  reserve: number
}
```

```ts
/** Phenomena cadence (slice A): mean active-seconds between spawns + window. */
phenomena: {
  meanSpacingSec: number
  windowSec: number
}
/** Tap-pool pulse: on-beat collects (1 tick per period) use onBeatMult. */
pulse: {
  periodSec: number
  onBeatMult: number
}
```

In `Content`: add `phenomena: PhenomenonDef[]` after `cards: CardDef[]`.

- [ ] **Step 4: rng stream + newRun init**

In `app/src/sim/rng.ts` append:

```ts
/**
 * Initial state for the run's SECOND stream (phenomena). XOR keeps it
 * distinct from the main stream and from the harness bot stream
 * (seed ^ 0x9e3779b9) on the same seed.
 */
export function seedPhenoRng(seed: number): number {
  return seedRng(seed ^ 0x7068656e) // 'phen'
}
```

In `app/src/sim/actions.ts`: import `seedPhenoRng` from `./rng`, and in `newRun`'s returned object after `recentCardIds: []` add:

```ts
    activeSec: 0,
    phenoRngState: seedPhenoRng(seed),
    phenomenon: null,
    tailwind: null,
    nextPhenomenonAtSec: 0,
```

- [ ] **Step 5: Migration + save literal**

In `app/src/persist/db.ts`: import `seedPhenoRng` from `../sim/rng` and `RunState` type. Replace the `migrateSave` switch body:

```ts
switch (candidate.schemaVersion) {
  case 1: {
    // v1 → v2: add the active-play fields (Session Arc slice A) with inert
    // defaults, then fall through to v2 validation via recursion.
    const v1 = raw as Omit<Save, 'schemaVersion' | 'run'> & {
      schemaVersion: 1
      run: (Omit<RunState, ActivePlayField> & Partial<RunState>) | null
    }
    const run: RunState | null =
      v1.run === null || v1.run === undefined
        ? null
        : {
            ...v1.run,
            activeSec: 0,
            phenoRngState: seedPhenoRng(v1.run.seed),
            phenomenon: null,
            tailwind: null,
            nextPhenomenonAtSec: 0,
          }
    return migrateSave({ ...v1, schemaVersion: 2, run })
  }
  case 2: {
    const save = raw as Save
    if (typeof save.lastSeenMs !== 'number' || save.meta === undefined)
      return null
    if (
      save.run !== undefined &&
      save.run !== null &&
      typeof save.run.seed !== 'number'
    ) {
      return null
    }
    return save
  }
  default:
    console.warn(
      'terratouch: unknown save schemaVersion, starting fresh',
      candidate.schemaVersion,
    )
    return null
}
```

Above `migrateSave`, add the helper type:

```ts
type ActivePlayField =
  | 'activeSec'
  | 'phenoRngState'
  | 'phenomenon'
  | 'tailwind'
  | 'nextPhenomenonAtSec'
```

In `app/src/state/store.ts` `currentSave()`: change `schemaVersion: 1` to `schemaVersion: 2`.

- [ ] **Step 6: Content — balance, schema, phenomena.json, index, fixtures**

`app/src/data/balance.json` — add `"reserve": 3` inside `energy`, and after the `tap` block:

```json
  "phenomena": { "meanSpacingSec": 60, "windowSec": 12 },
  "pulse": { "periodSec": 4, "onBeatMult": 1.6 },
```

`app/src/data/schema.ts` — in `balanceSchema.energy` add `reserve: z.number().nonnegative(),`; after the `tap` block add:

```ts
  phenomena: z.strictObject({
    meanSpacingSec: z.number().positive(),
    windowSec: z.number().positive(),
  }),
  pulse: z.strictObject({
    periodSec: z.number().int().positive(),
    onBeatMult: z.number().min(1),
  }),
```

Append near `cardsSchema` (import `PhenomenonDef` from `../sim/types`):

```ts
const phenomenonPayoutSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('minerals'),
    productionSec: z.number().positive(),
  }),
  z.strictObject({ kind: z.literal('vent'), amount: z.number().positive() }),
  z.strictObject({
    kind: z.literal('tailwind'),
    system: systemId,
    durationSec: z.number().positive(),
    pushMult: z.number().min(1),
  }),
  z.strictObject({ kind: z.literal('energy'), amount: z.number().positive() }),
])

export const phenomenonSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  blurb: z.string().min(1),
  weight: z.number().positive(),
  payout: phenomenonPayoutSchema,
  eras: z
    .tuple([z.number().int().min(1), z.number().int().min(1)])
    .refine(([min, max]) => min <= max, { message: 'eras min must be <= max' })
    .optional(),
  archetypes: z.array(z.string().min(1)).optional(),
}) satisfies z.ZodType<PhenomenonDef>

export const phenomenaSchema = z.array(phenomenonSchema)
```

Create `app/src/data/phenomena.json` (tone: cozy-hopeful, per the design decisions). Weights: spark ≈ 14% so the Energy trickle lands near the spec's 25–40% target once slice B adds contract rewards:

```json
[
  {
    "id": "meteor-fall",
    "name": "Meteor fall",
    "blurb": "A soft streak of sky-iron — catch it while it glitters.",
    "weight": 30,
    "payout": { "kind": "minerals", "productionSec": 45 }
  },
  {
    "id": "geyser-vent",
    "name": "Geyser vent",
    "blurb": "The crust exhales. Let the pressure go with it.",
    "weight": 25,
    "payout": { "kind": "vent", "amount": 4 }
  },
  {
    "id": "aurora-surge",
    "name": "Aurora surge",
    "blurb": "Charged winds comb the high air into ribbons.",
    "weight": 10,
    "payout": {
      "kind": "tailwind",
      "system": "atmosphere",
      "durationSec": 30,
      "pushMult": 2
    }
  },
  {
    "id": "thermal-bloom",
    "name": "Thermal bloom",
    "blurb": "A warm current rises, eager to be steered.",
    "weight": 10,
    "payout": {
      "kind": "tailwind",
      "system": "thermal",
      "durationSec": 30,
      "pushMult": 2
    }
  },
  {
    "id": "spring-swell",
    "name": "Spring swell",
    "blurb": "Groundwater remembers the way up.",
    "weight": 10,
    "payout": {
      "kind": "tailwind",
      "system": "hydro",
      "durationSec": 30,
      "pushMult": 2
    }
  },
  {
    "id": "verdant-flush",
    "name": "Verdant flush",
    "blurb": "Something small decides today is the day.",
    "weight": 10,
    "payout": {
      "kind": "tailwind",
      "system": "biosphere",
      "durationSec": 30,
      "pushMult": 2
    }
  },
  {
    "id": "spark-of-attention",
    "name": "Spark of attention",
    "blurb": "The world notices you noticing. Take a breath back.",
    "weight": 15,
    "payout": { "kind": "energy", "amount": 1 }
  }
]
```

`app/src/data/index.ts` — import `phenomenaJson from './phenomena.json'` and `phenomenaSchema`; add `phenomena: unknown` to `parseContent`'s parameter and `phenomena: phenomenaSchema.parse(raw.phenomena),` to the bundle; pass `phenomena: phenomenaJson` in `loadContent()`. In `validateContent` add:

```ts
for (const d of dupes(content.phenomena.map((p) => p.id)))
  problems.push(`duplicate phenomenon id "${d}"`)
for (const p of content.phenomena) {
  if (p.eras !== undefined && p.eras[1] > eraCount) {
    problems.push(
      `phenomenon "${p.id}" gates up to era ${p.eras[1]} but only ${eraCount} exist`,
    )
  }
  for (const ref of p.archetypes ?? []) {
    if (!archetypeIds.has(ref)) {
      problems.push(
        `phenomenon "${p.id}" references unknown archetype "${ref}"`,
      )
    }
  }
}
```

`app/tests/fixtures.ts` — in `makeTestContent`'s balance add `reserve: 3` to `energy`, and after `tap`:

```ts
      phenomena: { meanSpacingSec: 60, windowSec: 12 },
      pulse: { periodSec: 4, onBeatMult: 1.6 },
```

and add `phenomena: [],` to the Content object (empty pool = the engine stays dormant in every existing fixture test).

- [ ] **Step 7: Run all tests + typecheck**

Run: `npm --prefix app run typecheck && npm --prefix app test`
Expected: PASS (including all pre-existing tests — this task changes no behavior).

- [ ] **Step 8: Commit**

```bash
npm run format && npm run lint
git add -A
git commit -m "feat: schema v2 foundation for active-play phenomena (types, rng stream, migration, content)"
```

---

### Task 2: Energy reserve (`gainEnergy`) + overfill guards

Bonus Energy may overfill the cap by `balance.energy.reserve`; regen and offline refill never reduce an existing overfill; positive card energy routes through the same helper.

**Files:**

- Modify: `app/src/sim/systems.ts` (add `gainEnergy`)
- Modify: `app/src/sim/tick.ts` (regen guard)
- Modify: `app/src/sim/offline.ts` (refill guard only — still zero new-field references)
- Modify: `app/src/sim/cards.ts` (route positive deltas)
- Test: `app/tests/energy-reserve.test.ts` (new)

**Interfaces:**

- Produces: `gainEnergy(current: number, amount: number, balance: Balance): number` exported from `sim/systems.ts`.
- Consumes: `Balance.energy.reserve` from Task 1.

- [ ] **Step 1: Write the failing tests**

Create `app/tests/energy-reserve.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test -- energy-reserve`
Expected: FAIL — `gainEnergy` not exported; overfill tests fail (current clamps cut to cap).

- [ ] **Step 3: Implement**

`app/src/sim/systems.ts` — append (it already imports `Balance` via types; add to the import if not):

```ts
/**
 * Add bonus Energy (phenomena, contract rewards, +energy cards). Bonus gains
 * may OVERFILL the cap by balance.energy.reserve; regen never does, and
 * nothing passive ever reduces an existing overfill.
 */
export function gainEnergy(
  current: number,
  amount: number,
  balance: Balance,
): number {
  if (amount <= 0) return current
  return Math.min(balance.energy.cap + balance.energy.reserve, current + amount)
}
```

`app/src/sim/tick.ts` — replace the energy regen expression:

```ts
// Energy regenerates in real time (SPEC §2.5) — but only up to the cap,
// and never down: an overfill from bonus Energy (reserve) is preserved.
const energy =
  run.energy >= balance.energy.cap
    ? run.energy
    : Math.min(
        balance.energy.cap,
        run.energy + balance.energy.regenPerSec * dtSec,
      )
```

`app/src/sim/offline.ts` — replace the energy refill expression the same way (comment: `// Refill to the cap only; an overfill (bonus reserve) is preserved.`). This touches no new fields — it guards clamp behavior only.

`app/src/sim/cards.ts` — import `gainEnergy` from `./systems`; replace the energy block in `resolveCard`:

```ts
const energyDelta = choice.effects.energy ?? 0
// Positive card energy is bonus energy (may overfill into the reserve);
// costs/negative deltas floor at 0 as before.
const energy =
  energyDelta >= 0
    ? gainEnergy(run.energy, energyDelta, content.balance)
    : Math.max(0, run.energy + energyDelta)
```

- [ ] **Step 4: Run all tests**

Run: `npm --prefix app test`
Expected: PASS (existing suites unaffected: nothing else ever starts above cap).

- [ ] **Step 5: Commit**

```bash
npm run format && npm run lint
git add -A
git commit -m "feat: energy reserve — bonus energy may overfill the cap, never clawed back"
```

---

### Task 3: Phenomena engine — activeSec clock, scheduling, spawn, expiry

The pure state machine: `tick()` advances `activeSec` and steps phenomena (expire → lazily schedule → spawn). Also a tiny move of `machineProductionRate`/`productionRate` into `systems.ts` (re-exported from `tick.ts`) so Task 4 avoids an import cycle.

**Files:**

- Create: `app/src/sim/phenomena.ts`
- Modify: `app/src/sim/tick.ts`, `app/src/sim/systems.ts`
- Test: `app/tests/phenomena.test.ts`, `app/tests/offline.test.ts`

**Interfaces:**

- Produces: `eligiblePhenomena(run, content): PhenomenonDef[]`, `stepPhenomena(run, content): RunState` (both in `sim/phenomena.ts`); `machineProductionRate`/`productionRate` now defined in `sim/systems.ts`, re-exported from `sim/tick.ts` so existing importers are untouched.
- Consumes: Task 1 fields; `nextFloat`/`pickWeighted` from `sim/rng.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/phenomena.test.ts`:

```ts
import { stepPhenomena } from '../src/sim/phenomena'
import { applyOffline } from '../src/sim/offline'
import { tick } from '../src/sim/tick'
import type { Content, PhenomenonDef } from '../src/sim/types'

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
```

Append to `app/tests/offline.test.ts`:

```ts
it('offline freezes the phenomena state machine entirely', () => {
  const content = makeTestContent()
  const run = {
    ...newRun(content, 3, 'test-rock'),
    activeSec: 50,
    phenomenon: { defId: 'x', expiresAtActiveSec: 55 },
    tailwind: { system: 'thermal' as const, untilActiveSec: 70, pushMult: 2 },
    nextPhenomenonAtSec: 0,
  }
  const after = applyOffline(run, content, 8 * 3600_000).run
  expect(after.activeSec).toBe(50)
  expect(after.phenomenon).toEqual(run.phenomenon)
  expect(after.tailwind).toEqual(run.tailwind)
  expect(after.phenoRngState).toBe(run.phenoRngState)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test -- phenomena offline`
Expected: FAIL — `stepPhenomena` module missing; `activeSec` stays 0 through tick.

- [ ] **Step 3: Move production helpers to systems.ts**

Cut `machineProductionRate` and `productionRate` from `app/src/sim/tick.ts` and paste them into `app/src/sim/systems.ts` unchanged (add `MachineInstance`, `Content`, `RunState` to its type imports as needed — `productionRate` reads `content.balance.tap.baseRatePerSec`). In `tick.ts`, import them from `./systems` and re-export for existing callers:

```ts
import {
  habitability,
  machineProductionRate,
  productionRate,
  shiftBandsToEra,
} from './systems'
export { machineProductionRate, productionRate } from './systems'
```

(`machinePushRate` STAYS in tick.ts — `driftTarget` uses it and nothing new needs it elsewhere.)

- [ ] **Step 4: Implement the engine**

Create `app/src/sim/phenomena.ts`:

```ts
// phenomena.ts — Session Arc slice A (design doc:
// docs/superpowers/specs/2026-07-15-active-play-session-arc-design.md).
// Transient tappable events on the activeSec clock. Pure, like all of sim/.
// Randomness draws ONLY from phenoRngState (the run's second stream) so card
// sequences are byte-identical whether or not anyone engages. Bonus-only:
// a miss expires silently; offline never advances any of this.

import { nextFloat, pickWeighted } from './rng'
import type { Content, PhenomenonDef, RunState } from './types'

/** Phenomena legal for this run right now (Era range + Archetype gate). */
export function eligiblePhenomena(
  run: RunState,
  content: Content,
): PhenomenonDef[] {
  const eraNumber = run.era + 1 // gates are 1-based, like cards
  return content.phenomena.filter(
    (p) =>
      (!p.eras || (eraNumber >= p.eras[0] && eraNumber <= p.eras[1])) &&
      (!p.archetypes || p.archetypes.includes(run.archetypeId)),
  )
}

/**
 * Advance the phenomena state machine after activeSec has moved. Called only
 * from tick() — never offline. Order: expire → lazily schedule → spawn.
 * The 0-sentinel on nextPhenomenonAtSec covers newRun, migrated saves, and
 * post-catch/expiry uniformly: the next tick schedules the next spawn.
 */
export function stepPhenomena(run: RunState, content: Content): RunState {
  let next = run
  const { meanSpacingSec, windowSec } = content.balance.phenomena

  if (next.phenomenon && next.activeSec >= next.phenomenon.expiresAtActiveSec) {
    next = { ...next, phenomenon: null } // missed — silently, no penalty
  }
  if (next.tailwind && next.activeSec >= next.tailwind.untilActiveSec) {
    next = { ...next, tailwind: null }
  }
  if (next.phenomenon) return next

  const pool = eligiblePhenomena(next, content)
  if (pool.length === 0) return next // dormant: draw nothing, schedule nothing

  if (next.nextPhenomenonAtSec === 0) {
    const r = nextFloat(next.phenoRngState)
    // Uniform in [0.5, 1.5) × mean: mean spacing, never instant, never late.
    const spacing = meanSpacingSec * (0.5 + r.value)
    return {
      ...next,
      phenoRngState: r.state,
      nextPhenomenonAtSec: next.activeSec + spacing,
    }
  }

  if (next.activeSec < next.nextPhenomenonAtSec) return next

  const picked = pickWeighted(
    next.phenoRngState,
    pool.map((p) => p.weight),
  )
  const def = pool[picked.value]!
  return {
    ...next,
    phenoRngState: picked.state,
    phenomenon: {
      defId: def.id,
      expiresAtActiveSec: next.activeSec + windowSec,
    },
    nextPhenomenonAtSec: 0,
  }
}
```

In `app/src/sim/tick.ts`: import `stepPhenomena` from `./phenomena`. In `tick()`, add `activeSec` to the returned object and wrap the return:

```ts
return stepPhenomena(
  {
    ...run,
    systems: shiftedSystems,
    uncollected,
    energy,
    era,
    eraProgressSec,
    activeSec: run.activeSec + dtSec,
    history: { ...run.history, peakHabitability: peak },
  },
  content,
)
```

- [ ] **Step 5: Run all tests**

Run: `npm --prefix app test`
Expected: PASS. Note: `determinism.test.ts` and harness replay stay green because the pheno stream is separate and fixtures ship an empty pool.

- [ ] **Step 6: Commit**

```bash
npm run format && npm run lint
git add -A
git commit -m "feat: phenomena engine — activeSec clock, lazy scheduling, spawn/expiry on a second rng stream"
```

---

### Task 4: `catchPhenomenon` + payouts (minerals, vent, energy)

The player action. Tolerant no-op on races (tapping a just-expired phenomenon), `SimError` only for a finished run. Tailwind payout state is set here too, but its drift effect lands in Task 5.

**Files:**

- Modify: `app/src/sim/phenomena.ts`
- Test: `app/tests/phenomena.test.ts`

**Interfaces:**

- Produces: `catchPhenomenon(run: RunState, content: Content): { run: RunState; caught: PhenomenonDef | null }` in `sim/phenomena.ts`.
- Consumes: `gainEnergy` + `productionRate` from `sim/systems.ts` (Tasks 2–3).

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/phenomena.test.ts`:

```ts
import { catchPhenomenon } from '../src/sim/phenomena'

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test -- phenomena`
Expected: FAIL — `catchPhenomenon` not exported.

- [ ] **Step 3: Implement**

Append to `app/src/sim/phenomena.ts` (extend imports: `SimError` from `./types`, `gainEnergy, productionRate` from `./systems`):

```ts
/**
 * Tap the live phenomenon. Tolerant no-op when none is live or it just
 * expired — the player can honestly race the tick loop, and losing that
 * race must never throw (mirrors tapCollect's zero path).
 */
export function catchPhenomenon(
  run: RunState,
  content: Content,
): { run: RunState; caught: PhenomenonDef | null } {
  if (run.collapse) throw new SimError('run-over')
  const live = run.phenomenon
  if (!live || run.activeSec >= live.expiresAtActiveSec)
    return { run, caught: null }
  const def = content.phenomena.find((d) => d.id === live.defId)
  if (!def) return { run, caught: null } // content changed under a live save

  let next: RunState = { ...run, phenomenon: null }
  const payout = def.payout
  switch (payout.kind) {
    case 'minerals': {
      const gained = productionRate(next, content) * payout.productionSec
      next = {
        ...next,
        resources: {
          ...next.resources,
          minerals: next.resources.minerals + gained,
        },
      }
      break
    }
    case 'vent':
      next = {
        ...next,
        instability: Math.max(0, next.instability - payout.amount),
      }
      break
    case 'tailwind':
      next = {
        ...next,
        tailwind: {
          system: payout.system,
          untilActiveSec: next.activeSec + payout.durationSec,
          pushMult: payout.pushMult,
        },
      }
      break
    case 'energy':
      next = {
        ...next,
        energy: gainEnergy(next.energy, payout.amount, content.balance),
      }
      break
  }
  return { run: next, caught: def }
}
```

- [ ] **Step 4: Run all tests**

Run: `npm --prefix app test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format && npm run lint
git add -A
git commit -m "feat: catchPhenomenon action with minerals/vent/tailwind/energy payouts"
```

---

### Task 5: Tailwind drift boost (active-only)

A live tailwind multiplies that system's machine push toward its (already safe-clamped) setpoint — but only through `tick()`. `offline.ts` calls `driftTarget` without the new parameter, so away-time drift is untouched by construction.

**Files:**

- Modify: `app/src/sim/phenomena.ts` (add `tailwindBoost`)
- Modify: `app/src/sim/tick.ts` (`driftTarget` optional param; `tick` + `driftDirection` pass the boost)
- Test: `app/tests/phenomena.test.ts`

**Interfaces:**

- Produces: `tailwindBoost(run: RunState, system: SystemId): number` in `sim/phenomena.ts`; `driftTarget(run, content, system, pushMult = 1)` gains an optional 4th param (default preserves every existing call site, including offline.ts).

- [ ] **Step 1: Write the failing tests**

Append to `app/tests/phenomena.test.ts`:

```ts
import { tailwindBoost } from '../src/sim/phenomena'

describe('tailwind boost', () => {
  const content = makeTestContent()
  const wind = { system: 'thermal' as const, untilActiveSec: 200, pushMult: 2 }

  function windyRun() {
    let run = newRun(content, 1, 'test-rock')
    // A thermal machine so there is push to multiply (fixture machine ids:
    // check makeTestContent — use the thermal one).
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
```

NOTE for the implementer: open `app/tests/fixtures.ts` and use the actual fixture machine `id`/`typeId` for the thermal machine in `windyRun()` (the fixture bundle defines its own machines; the names above are illustrative and MUST be corrected to the real ones — the test should build via `buildOrUpgrade` if that is simpler: give the run enough minerals, then `buildOrUpgrade(run, content, '<thermal-machine-id>')`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test -- phenomena`
Expected: FAIL — `tailwindBoost` not exported; boosted/calm drifts equal.

- [ ] **Step 3: Implement**

Append to `app/src/sim/phenomena.ts`:

```ts
/**
 * Machine-push multiplier a live tailwind grants this system (1 = none).
 * Passed into driftTarget by tick()/driftDirection only — offline.ts never
 * passes it, so away-time drift can never be boosted (frozen, not banked).
 */
export function tailwindBoost(run: RunState, system: SystemId): number {
  const t = run.tailwind
  return t && t.system === system && run.activeSec < t.untilActiveSec
    ? t.pushMult
    : 1
}
```

(Add `SystemId` to the type imports.)

In `app/src/sim/tick.ts`:

- `driftTarget` gains a 4th parameter and multiplies push:

```ts
export function driftTarget(
  run: RunState,
  content: Content,
  system: SystemId,
  pushMult = 1,
): { target: number; rate: number } {
  const arch = archetypeOf(run, content)
  const nat = arch.systems[system]
  const push = machinePushRate(run.machines, content, system) * pushMult
  ...
```

- In `tick()`'s drift loop: `const { target, rate } = driftTarget(run, content, id, tailwindBoost(run, id))`
- In `driftDirection` (UI arrows should reflect the boost): `const { target, rate } = driftTarget(run, content, system, tailwindBoost(run, system))`
- Import `tailwindBoost` from `./phenomena`.
- `offline.ts` is NOT edited — its `driftTarget(run, content, id)` calls keep the default of 1.

- [ ] **Step 4: Run all tests**

Run: `npm --prefix app test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format && npm run lint
git add -A
git commit -m "feat: tailwind drift boost, active ticks only — offline drift provably unchanged"
```

---

### Task 6: Tap pulse (on-beat collect)

`tapCollect` pays `pulse.onBeatMult` when the activeSec clock sits in the on-beat tick (`floor(activeSec) % periodSec === 0` — one tick per period, 25% duty at period 4), else exactly today's `tap.bonusMult`. Result gains an `onBeat` flag for UI feedback.

**Files:**

- Modify: `app/src/sim/actions.ts`
- Test: `app/tests/pulse.test.ts` (new)

**Interfaces:**

- Produces: `onBeat(run: RunState, content: Content): boolean` and `tapCollect(...): { run: RunState; collected: number; onBeat: boolean }` in `sim/actions.ts`. (Existing callers destructure `.run`/`.collected` — additive, no call sites break.)

- [ ] **Step 1: Write the failing tests**

Create `app/tests/pulse.test.ts`:

```ts
// pulse.test.ts — the tap pool's on-beat rhythm (Session Arc slice A).
// On-beat = the one tick per pulse period where floor(activeSec) lands on 0
// mod period. Off-beat collects are byte-for-byte today's behavior.
import { describe, expect, it } from 'vitest'
import { newRun, onBeat, tapCollect } from '../src/sim/actions'
import { makeTestContent } from './fixtures'

const content = makeTestContent() // period 4, onBeatMult 1.6, bonusMult 1.5

function withPool(activeSec: number, uncollected = 10) {
  return { ...newRun(content, 1, 'test-rock'), activeSec, uncollected }
}

describe('onBeat', () => {
  it('is true exactly one tick per period', () => {
    expect(onBeat(withPool(0), content)).toBe(true)
    expect(onBeat(withPool(0.9), content)).toBe(true) // same tick
    expect(onBeat(withPool(1), content)).toBe(false)
    expect(onBeat(withPool(2), content)).toBe(false)
    expect(onBeat(withPool(3), content)).toBe(false)
    expect(onBeat(withPool(4), content)).toBe(true)
    expect(onBeat(withPool(8), content)).toBe(true)
  })
})

describe('tapCollect pulse', () => {
  it('pays onBeatMult on the beat', () => {
    const { run, collected, onBeat: hit } = tapCollect(withPool(4), content)
    expect(hit).toBe(true)
    expect(collected).toBe(16) // 10 × 1.6
    expect(run.resources.minerals).toBe(
      newRun(content, 1, 'test-rock').resources.minerals + 16,
    )
    expect(run.uncollected).toBe(0)
  })

  it('pays exactly the old bonusMult off the beat', () => {
    const { collected, onBeat: hit } = tapCollect(withPool(5), content)
    expect(hit).toBe(false)
    expect(collected).toBe(15) // 10 × 1.5 — unchanged from pre-pulse behavior
  })

  it('empty pool stays a zero no-op either way', () => {
    const { run, collected } = tapCollect(withPool(4, 0), content)
    expect(collected).toBe(0)
    expect(run).toEqual(withPool(4, 0))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix app test -- pulse`
Expected: FAIL — `onBeat` not exported; collected is 15 on the beat.

- [ ] **Step 3: Implement**

In `app/src/sim/actions.ts`, replace `tapCollect` and add `onBeat` above it:

```ts
/** Is the activeSec clock inside the collect pulse's on-beat tick? */
export function onBeat(run: RunState, content: Content): boolean {
  return Math.floor(run.activeSec) % content.balance.pulse.periodSec === 0
}

/**
 * Collect the tap pool with the active-play bonus (SPEC §2.6). Collecting
 * on the pulse's beat upgrades the multiplier (Session Arc slice A);
 * off-beat is exactly the pre-pulse behavior — never worse.
 */
export function tapCollect(
  run: RunState,
  content: Content,
): { run: RunState; collected: number; onBeat: boolean } {
  if (run.collapse) throw new SimError('run-over')
  const beat = onBeat(run, content)
  const mult = beat
    ? content.balance.pulse.onBeatMult
    : content.balance.tap.bonusMult
  const collected = Math.round(run.uncollected * mult * 10) / 10
  if (collected <= 0) return { run, collected: 0, onBeat: beat }
  return {
    run: {
      ...run,
      uncollected: 0,
      resources: {
        ...run.resources,
        minerals: run.resources.minerals + collected,
      },
    },
    collected,
    onBeat: beat,
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npm --prefix app test`
Expected: PASS. (`determinism.test.ts` replays destructure `.run` — unaffected. The harness ticks 20 s/turn today, which happens to be always-on-beat; Task 7 fixes that deliberately.)

- [ ] **Step 5: Commit**

```bash
npm run format && npm run lint
git add -A
git commit -m "feat: tap-pool pulse — on-beat collects pay a higher multiplier"
```

---

### Task 7: Harness `attentive` policy + bonus-only assertions + snapshot

Baseline policies must model an inattentive player: `secondsPerTurn` moves 20 → 19 (19 mod 4 cycles all residues, so baselines hit the beat at the chance level of 25%, instead of the accidental 100% that 20 gives). The new `attentive` policy plays greedy-safe PLUS catches every phenomenon and taps only on-beat (20 s turns → always on-beat). CI asserts attention pays in Seeds.

**Files:**

- Modify: `app/tests/harness/index.ts`
- Modify: `app/tests/balance-harness.test.ts`
- Modify: `app/src/data/README.md` (harness snapshot)

**Interfaces:**

- Produces: `PolicyName = 'random' | 'greedy-safe' | 'greedy-progress' | 'attentive'`.
- Consumes: `catchPhenomenon` (Task 4); shipped `phenomena.json` (Task 1).

- [ ] **Step 1: Write the failing test**

In `app/tests/balance-harness.test.ts`, add after the greedy-progress block:

```ts
it('attentive policy: attention pays in Seeds (bonus-only invariant)', () => {
  const report = runMany(content, { runs: RUNS, policy: 'attentive' })
  reports.push(report)
  console.log(formatReport(report, content))
  const safe = reports.find((r) => r.policy === 'greedy-safe')!
  // Catching phenomena + on-beat taps must OUT-EARN the same strategy
  // played inattentively — that is the whole point of slice A.
  expect(report.meanSeeds).toBeGreaterThan(safe.meanSeeds)
  expect(report.turns.distinct).toBeGreaterThanOrEqual(8)
})
```

And extend the reproducibility test with the new policy:

```ts
const c = runOne(content, 12345, 'attentive')
const d = runOne(content, 12345, 'attentive')
expect(c).toEqual(d)
```

- [ ] **Step 2: Run to verify it fails**

Run: `HARNESS_RUNS=200 npm --prefix app test -- balance-harness`
Expected: FAIL — `'attentive'` is not a valid PolicyName.

- [ ] **Step 3: Implement the policy**

In `app/tests/harness/index.ts`:

- `export type PolicyName = 'random' | 'greedy-safe' | 'greedy-progress' | 'attentive'`
- Import `catchPhenomenon` from `../../src/sim/phenomena`.
- In `runOne`, replace the `secondsPerTurn` default:

```ts
// 19 (not 20): 19 mod pulse-period 4 cycles every residue, so ordinary
// bots hit the tap beat at chance level (25%) instead of always. The
// attentive bot ticks 20 — a multiple of the period — to ALWAYS be on-beat.
const secondsPerTurn =
  opts?.secondsPerTurn ?? (policy === 'attentive' ? 20 : 19)
```

- After `run = tick(run, content, secondsPerTurn)` and before `tapCollect`, add:

```ts
// The attentive player notices what the planet offers; nobody else does.
if (policy === 'attentive') run = catchPhenomenon(run, content).run
```

- Everywhere the policy branches, `attentive` behaves as greedy-safe: change `policy === 'greedy-safe' ? 20 : 0` to `policy === 'greedy-safe' || policy === 'attentive' ? 20 : 0`, and the choice scoring condition `policy === 'greedy-safe'` to `policy === 'greedy-safe' || policy === 'attentive'`. The `policy !== 'random'` branches already include it.

- [ ] **Step 4: Run the harness test**

Run: `HARNESS_RUNS=200 npm --prefix app test -- balance-harness`
Expected: PASS. If `attentive.meanSeeds` does NOT beat greedy-safe: the tuning knobs are, in order, `spark-of-attention`'s weight in `phenomena.json` (raise toward 20), `meteor-fall`'s `productionSec` (raise toward 60), and `pulse.onBeatMult`. Change one, re-run, and record the final values in the commit message. Then run the full gate: `npm --prefix app test`.

- [ ] **Step 5: Regenerate the harness snapshot**

Run: `npm --prefix app run harness`
Update the snapshot numbers in `app/src/data/README.md` with the new report (baselines shift slightly: 19 s turns + 25% chance-level on-beat taps ≈ +7% mineral income). Confirm the README's blame-spread note still holds (CI asserts <60% per system regardless).

- [ ] **Step 6: Commit**

```bash
npm run format && npm run lint
git add -A
git commit -m "feat: attentive harness policy — CI asserts phenomena+pulse attention out-earns inattentive play"
```

---

### Task 8: Store wiring + UI (chip, pulse ring, FX, reserve pips)

The store exposes `catchPheno()` and returns tap results for feedback; PlanetScreen renders the tappable chip (the REAL hit target — fixed position, works under reduced motion) plus a decorative FX overlay and the pulse ring; App.tsx renders reserve pips distinctly. Also exposes the store handle the acceptance walk (Task 9) drives.

**Files:**

- Modify: `app/src/state/store.ts`
- Modify: `app/src/ui/PlanetScreen.tsx`
- Modify: `app/src/ui/App.tsx` (energy pips)
- Modify: `app/src/index.css`

**Interfaces:**

- Produces: store `catchPheno(): void`; store `tap(): { collected: number; onBeat: boolean } | undefined`; `window.__terratouch` = the zustand store (walk/debug handle); CSS classes `.pheno-chip`, `.pheno-fx`, `.pulse-ring`, `.pip.reserve`.
- Consumes: `catchPhenomenon`, `onBeat` result from Tasks 4/6.

- [ ] **Step 1: Store changes**

In `app/src/state/store.ts`:

- Import `catchPhenomenon` from `../sim/phenomena`.
- In the `GameStore` type: change `tap(): void` to `tap(): { collected: number; onBeat: boolean } | undefined` and add `catchPheno(): void`.
- Implementation — `tap` returns the guard result:

```ts
  tap() {
    const { run, content } = get()
    if (!run) return undefined
    const result = guard(() => tapCollect(run, content))
    if (!result) return undefined
    set({ run: result.run })
    scheduleSave()
    return { collected: result.collected, onBeat: result.onBeat }
  },

  catchPheno() {
    const { run, content } = get()
    if (!run) return
    const result = guard(() => catchPhenomenon(run, content))
    if (result && result.caught) {
      set({ run: result.run })
      scheduleSave()
    }
  },
```

- At the bottom of the file (after `stopLoop`), expose the walk/debug handle:

```ts
// Debug/e2e handle: the acceptance walk fast-forwards active time through
// this (tests/e2e/acceptance-walk.mjs). Harmless in production — the game
// is free, offline-first, and single-player; there is nothing to cheat.
declare global {
  interface Window {
    __terratouch?: typeof useGame
  }
}
if (typeof window !== 'undefined') window.__terratouch = useGame
```

- [ ] **Step 2: PlanetScreen — chip, ring, FX, on-beat float**

In `app/src/ui/PlanetScreen.tsx`:

- Pull the new pieces from the store/run: `const catchPheno = useGame((s) => s.catchPheno)`; read `run.phenomenon`, `run.activeSec`, and look up the live def: `const pheno = run.phenomenon ? content.phenomena.find((p) => p.id === run.phenomenon!.defId) : undefined`.
- `onTap` uses the returned result (replaces the precomputed `pool` amount for the float, and flags the beat):

```ts
const onTap = () => {
  const result = tap()
  if (result && result.collected >= 1) {
    const id = ++floatId.current
    setFloats((f) => [
      ...f,
      { id, amount: result.collected, onBeat: result.onBeat },
    ])
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 950)
  }
}
```

(Extend the `Float` type with `onBeat: boolean`; render `className={`float-num${f.onBeat ? ' on-beat' : ''}`}` and show `+{fmtInt(f.amount)}{f.onBeat ? ' ✧' : ''}`.)

- Inside `.dial-wrap`, add the pulse ring (before the button) and the FX overlay (after it):

```tsx
;<span
  className="pulse-ring"
  aria-hidden
  style={{
    animationDuration: `${balance.pulse.periodSec}s`,
    animationDelay: `-${run.activeSec % balance.pulse.periodSec}s`,
  }}
/>
{
  pheno && (
    <span className={`pheno-fx pheno-fx--${pheno.payout.kind}`} aria-hidden />
  )
}
```

- Between the `gather-hint` and `TransmissionStrip`, the chip — the accessible, fixed-position hit target:

```tsx
{
  pheno && run.phenomenon && (
    <button
      type="button"
      className="pheno-chip"
      onClick={catchPheno}
      aria-label={`${pheno.name} — tap to catch`}
    >
      <span className="pheno-name">{pheno.name}</span>
      <span className="pheno-blurb">{pheno.blurb}</span>
      <span className="pheno-timer" aria-hidden>
        <span
          className="pheno-timer-fill"
          style={{
            width: `${Math.max(
              0,
              ((run.phenomenon.expiresAtActiveSec - run.activeSec) /
                balance.phenomena.windowSec) *
                100,
            )}%`,
          }}
        />
      </span>
    </button>
  )
}
```

- [ ] **Step 3: Reserve pips in App.tsx**

Read `app/src/ui/App.tsx` around the `energy-pips` block (line ~20). Today it renders `cap` pips with a `pip-fill` width per pip. Extend it: when `energy > cap`, render `Math.ceil(energy - cap)` extra pips with class `pip reserve` (same fill logic, offset by cap), and include the reserve in the aria-label: ``aria-label={`Energy ${whole} of ${cap}${whole > cap ? ' (reserve)' : ''}`}``. Keep the total rendered pips ≤ `cap + balance.energy.reserve`.

- [ ] **Step 4: CSS**

Append to `app/src/index.css` (match its existing custom-property/color conventions — read the neighboring blocks first):

```css
/* ------------------------------------------------------- active-play: pulse */
.pulse-ring {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 2px solid var(--accent, #7fd4a8);
  opacity: 0;
  pointer-events: none;
  animation: pulse-beat linear infinite;
}
@keyframes pulse-beat {
  /* Bright during the first quarter of the period — the on-beat tick. */
  0% {
    opacity: 0.55;
    transform: scale(1);
  }
  25% {
    opacity: 0.12;
    transform: scale(1.03);
  }
  100% {
    opacity: 0.12;
    transform: scale(1);
  }
}

/* --------------------------------------------------- active-play: phenomena */
.pheno-chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--accent, #7fd4a8);
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent, #7fd4a8) 12%, transparent);
  text-align: left;
  animation: pheno-arrive 240ms ease-out;
}
.pheno-name {
  font-weight: 600;
}
.pheno-blurb {
  font-size: 0.85em;
  opacity: 0.8;
}
.pheno-timer {
  height: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--accent, #7fd4a8) 25%, transparent);
  overflow: hidden;
}
.pheno-timer-fill {
  display: block;
  height: 100%;
  background: var(--accent, #7fd4a8);
  transition: width 1s linear;
}
@keyframes pheno-arrive {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
}

.pheno-fx {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  pointer-events: none;
}
.pheno-fx--minerals {
  animation: fx-streak 2.4s ease-in-out infinite;
}
.pheno-fx--vent {
  animation: fx-plume 2.4s ease-in-out infinite;
}
.pheno-fx--tailwind {
  animation: fx-shimmer 3s linear infinite;
}
.pheno-fx--energy {
  animation: fx-glint 1.6s ease-in-out infinite;
}
@keyframes fx-streak {
  0%,
  100% {
    box-shadow: inset 12px -12px 24px -18px #ffd9a0;
  }
  50% {
    box-shadow: inset 18px -18px 32px -16px #ffd9a0;
  }
}
@keyframes fx-plume {
  0%,
  100% {
    box-shadow: inset 0 14px 26px -18px #bfe8ff;
  }
  50% {
    box-shadow: inset 0 20px 34px -16px #bfe8ff;
  }
}
@keyframes fx-shimmer {
  0%,
  100% {
    box-shadow: inset 0 -14px 30px -18px #a8ffd0;
  }
  50% {
    box-shadow: inset 0 -20px 38px -14px #a8ffd0;
  }
}
@keyframes fx-glint {
  0%,
  100% {
    box-shadow: 0 0 14px -4px #fff3b0;
  }
  50% {
    box-shadow: 0 0 22px -2px #fff3b0;
  }
}

.float-num.on-beat {
  color: var(--accent, #7fd4a8);
  font-weight: 700;
}

.pip.reserve {
  outline: 1px dashed var(--accent, #7fd4a8);
}

@media (prefers-reduced-motion: reduce) {
  .pulse-ring,
  .pheno-fx {
    animation: none;
  }
  .pulse-ring {
    opacity: 0.2;
  }
}
```

(If `--accent` does not exist in this stylesheet, substitute the variable the existing buttons use — check `.btn-primary`.)

- [ ] **Step 5: Verify in the browser**

Run: `npm --prefix app run dev`, open the app. Confirm: pulse ring breathes on the dial; within ~90 s a phenomenon chip appears; tapping it pays out and clears it; with OS reduced-motion enabled the chip still appears and works. (If working headless, defer visual confirmation to the Task 9 walk — but state that explicitly in the commit/PR notes.)

- [ ] **Step 6: Run all tests + typecheck, commit**

```bash
npm --prefix app run typecheck && npm --prefix app test
npm run format && npm run lint
git add -A
git commit -m "feat: phenomena chip, pulse ring, tailwind FX, and reserve pips in the UI"
```

---

### Task 9: Acceptance-walk checks, full gates, docs, PR

**Files:**

- Modify: `app/tests/e2e/acceptance-walk.mjs`
- Modify: `CLAUDE.md` (current-state bullet + walk check count)
- Test: full gate suite

**Interfaces:**

- Consumes: `window.__terratouch` (Task 8), `.pheno-chip`/`.pulse-ring` selectors.

- [ ] **Step 1: Add walk checks**

In `app/tests/e2e/acceptance-walk.mjs`, after the existing energy-pips check block, following the file's `check(name, ok, detail)` idiom:

```js
// --- Active play slice A: pulse ring + a caught phenomenon (issue: Session Arc PR A)
check('pulse ring renders on the dial', await page.isVisible('.pulse-ring'))

const phenoSpawned = await page.evaluate(async () => {
  const store = window.__terratouch
  if (!store) return false
  // Fast-forward active time in 5s logical steps until a phenomenon is live
  // (max spacing is 1.5 × 60s; 40 × 5s = 200s of active time is plenty).
  for (let i = 0; i < 40 && !store.getState().run?.phenomenon; i++) {
    store.getState().tickBy(5)
    await new Promise((r) => setTimeout(r, 25)) // let React paint
  }
  return Boolean(store.getState().run?.phenomenon)
})
check('a phenomenon spawns within 200s of active time', phenoSpawned)
check('phenomenon chip is visible', await page.isVisible('.pheno-chip'))

const beforeCatch = await page.evaluate(() => {
  const r = window.__terratouch.getState().run
  return {
    minerals: r.resources.minerals,
    energy: r.energy,
    instability: r.instability,
  }
})
await page.click('.pheno-chip')
const afterCatch = await page.evaluate(() => {
  const r = window.__terratouch.getState().run
  return {
    minerals: r.resources.minerals,
    energy: r.energy,
    instability: r.instability,
    cleared: r.phenomenon === null,
    tailwind: r.tailwind !== null,
  }
})
check('catching clears the phenomenon', afterCatch.cleared)
check(
  'catching pays out (minerals, energy, vent, or tailwind)',
  afterCatch.minerals > beforeCatch.minerals ||
    afterCatch.energy > beforeCatch.energy ||
    afterCatch.instability < beforeCatch.instability ||
    afterCatch.tailwind,
)
```

If the walk asserts or prints a total check count anywhere, update it (35 → 40).

- [ ] **Step 2: Run the walk**

Start the dev server, then run the walk against it:

```bash
npm --prefix app run build
npm --prefix app run preview &   # or: npm --prefix app run dev
WALK_BASE=http://localhost:4173 npm --prefix app run walk
```

Expected: all checks pass, including the 5 new ones. (Check `app/package.json` for the preview port; adjust `WALK_BASE`. If Chrome isn't found, set `CHROME_PATH`.)

- [ ] **Step 3: Full gates**

```bash
npm run format:check && npm run lint
npm --prefix app run typecheck
npm --prefix app test          # includes the 1000-run harness
npm --prefix app run build
npm --prefix worker run typecheck
```

Expected: all green. Report exact test counts.

- [ ] **Step 4: Update CLAUDE.md**

In the "Current state" section, add a bullet (adapt the final numbers):

```md
- Active play slice A (Session Arc design, docs/superpowers/specs/2026-07-15-active-play-session-arc-design.md): tappable phenomena on a new `activeSec` clock (`sim/phenomena.ts`, second rng stream so card sequences never shift), tap-pool pulse with on-beat bonus, Energy reserve (bonus energy may overfill the cap by 3), and an `attentive` harness policy CI-asserted to out-earn inattentive play. Phenomena/tailwinds exist only in active time — offline freezes them. Save schema is now v2 (v1 migrates losslessly).
```

Update the two "35-check" mentions to the new count.

- [ ] **Step 5: Commit + PR**

```bash
npm run format && npm run lint
git add -A
git commit -m "test: acceptance-walk coverage for phenomena + pulse; docs: current-state update"
git push -u origin claude/active-gameplay-engagement-08b78f
```

Open a PR to `main` titled `feat: active-play slice A — phenomena, tap pulse, energy reserve (Session Arc PR A)`, body linking the design doc and summarizing: the three mechanics, the bonus-only invariant and how CI enforces it, schema v2 migration, and the harness baseline shift (20 s → 19 s turns, rationale). Do NOT enable auto-merge; wait for both CI checks (`App (typecheck · test · build)`, `Worker (typecheck)`).

---

## Self-Review Notes (already applied)

- **Spec coverage:** every slice-A item in the design doc maps to a task — activeSec/phenoRng/migration (T1), reserve + gainEnergy + card routing (T2), scheduling/spawn/expiry + rng thrift + dormant-pool rule (T3), catch + payouts + tolerant no-op (T4), tailwind boost active-only (T5), pulse (T6), attentive policy + bonus-only CI assertions + snapshot (T7), chip-as-hit-target + reduced-motion + reserve pips (T8), walk checks (T9). Slice B/C items (contracts, chains) are explicitly out of scope for this plan.
- **Deviations from the spec, both deliberate:** (1) `tailwind` state carries `pushMult` (the spec listed `{system, untilActiveSec}`) so `driftTarget` needs no def lookup; (2) phenomena FX renders as an overlay in PlanetScreen's dial-wrap rather than inside PlanetVisuals — same visual result, smaller blast radius. Both are recorded here so the reviewer sees them.
- **Known judgment calls:** harness `secondsPerTurn` 20 → 19 (chance-level on-beat baseline); `offline.ts` gets a clamp-behavior guard for the reserve (it still references zero new fields — the spec's intent).
