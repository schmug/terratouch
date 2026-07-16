# Active play "Session Arc" — design

**Date:** 2026-07-15
**Status:** approved design, pre-implementation
**Owner decision trail:** brainstormed interactively; approach and all defaults below were approved by Cory.

## Problem

Active play empties out too fast. A session today is: draw cards until Energy runs dry
(~2 minutes at cap 10), tap-collect the pool, build what you can afford — then there is
nothing to do but watch drift. Three gaps, in priority order:

1. **Density** — nothing to do between card draws.
2. **Duration** — sessions cannot stretch past the ~5-minute burst even when the player
   wants to stay.
3. **Skill/agency** — swipe, tap, and build are fire-and-forget; paying attention never
   visibly matters.

Direct tactile planet interaction was considered and explicitly deprioritized (it falls
out of the phenomena mechanic partially, but is not a goal).

## Goals & non-goals

**Goals**

- A player who feels like staying has a rewarding next thing to do for 15–30 minutes.
- Attention visibly pays: light timing moments and small judgment calls, all gentle —
  generous windows, no fail states, a miss just means no bonus.
- Hybrid energy economy (owner decision): safe activities fill the gaps **and**
  attentive play slowly earns bonus card draws. Tuning target: an attentive 20-minute
  session earns roughly **25–40% more draws** than passively idling in-app for the same
  time. Bounded, never required.

**Non-goals / out of scope**

- Seed meta-upgrades that touch phenomena/pulse (future shop tier, file later).
- Any synthesis/Codex coupling (M3 owns that).
- Push notifications or anything that nags the player to come back.
- Twitch difficulty. Nothing in this design punishes slow thumbs.

## Invariants (unchanged, load-bearing)

- SPEC §1.3: offline only ever accumulates safely; Instability never accrues offline;
  danger is opt-in and card-driven.
- Sim purity: no wall clock, no I/O, no React in `sim/`; time arrives as deltas;
  randomness is explicit serializable state.
- Determinism: same seed + same actions ⇒ identical run.
- Content is data (`*.json` + zod), not code.
- **New unifying rule:** phenomena and contracts exist only in _active time_. Their
  clocks count active ticks, never wall time. Walking away freezes them — a contract is
  frozen, not failed; a phenomenon waits. Leaving never costs anything the player had.

## The three slices

### Slice A — Phenomena + tap pulse (density, timing-skill)

Roughly once per minute of active play, the planet does something tappable for a
~12-second window:

| Type         | Payout                                                         | Notes                     |
| ------------ | -------------------------------------------------------------- | ------------------------- |
| **Meteor**   | Lump-sum minerals ≈ 45 s of current production                 | economy                   |
| **Vent**     | −4 Instability                                                 | only matters while active |
| **Tailwind** | One system's machine push ×2 toward setpoint for the next 30 s | safe: setpoints clamped   |
| **Spark**    | +1 Energy                                                      | rare — the trickle        |

Misses expire silently. Payouts, weights, windows, and era/archetype gates live in a new
`phenomena.json`.

**Tap pulse:** the collect control breathes on a ~4 s cycle; collecting on the beat
upgrades the tap bonus from 1.25× to ~1.6×. Off-beat collection is exactly today's
behavior — never worse. Given the 1 s fixed timestep, the on-beat window is one full
tick out of the period (25% duty cycle): on-beat iff `floor(activeSec) % periodSec === 0`.
The UI ring animates continuously but the sim evaluates at tick resolution.

### Slice B — Micro-contracts + Energy reserve (duration, judgment)

One small optional objective on offer at a time, instantiated from templates against
current run state:

- _"Bring {system} into band within {N} s"_ — offered only when that system is out of band.
- _"Hold all four systems in-band for {N} s"_ — offered only when all are in band.
- _"Catch {K} phenomena"_ — the Slice A interlock.
- _"Collect the pool on-beat {K} times."_

Rewards: minerals, an Instability vent, or +1 Energy. The player may dismiss an offer
(reroll after a short cooldown); expiry is silent and a new offer follows. Deadlines
count **active seconds only**, so leaving mid-contract freezes it.

**Energy reserve:** bonus Energy from Sparks and contract rewards may overfill the cap
by up to +3. Tick regen still clamps to plain cap but never reduces an existing
overfill. All bonus Energy routes through one `gainEnergy()` helper.

### Slice C — Card chains (tension density)

A card **choice** (per-choice, Reigns-style) may carry
`chain?: { cardId: string; chance?: number }`. When it fires, the linked card is
presented as the next draw, **free** (no Energy), exempt from `recentCardIds`
exclusion, chain depth capped at 2. Chance rolls use the **main** rng stream (chains
are part of the card layer). Chained cards can still carry Instability — danger remains
opt-in because the player drew the parent. Ship with 6–10 authored chain pairs.

## Architecture

### State & determinism

New `RunState` fields; save `schemaVersion` bumps 1 → 2 with a migration filling
defaults:

- `activeSec: number` — cumulative active seconds, advanced only inside `tick()`,
  never by `offline.ts`. Time base for phenomenon expiry, tailwind duration, contract
  deadlines, and pulse phase. Freezing-on-leave falls out of the data model.
- `phenoRngState: number` — a **second mulberry32 stream**, seeded from `seed` at run
  start. Phenomena spawns and contract offers draw from this stream only, so card-draw
  sequences are byte-identical whether or not anyone engages with the new systems
  (protects replay guarantees and harness policy comparisons).
- `phenomenon: { defId: string; expiresAtActiveSec: number } | null`
- `tailwind: { system: SystemId; untilActiveSec: number } | null`
- `contract: { templateId: string; params: Record<string, number | string>; deadlineActiveSec: number; progress: number; target: number } | null`
  — `progress`/`target` are template-defined counters (seconds held, phenomena
  caught, on-beat collects). Hold-type contracts count **consecutive** qualifying
  active seconds; progress resets to 0 when the condition breaks. A contract
  completes the moment `progress ≥ target` before its deadline.
- `nextPhenomenonAtSec: number` — scheduler. `0` is a sentinel meaning
  "unscheduled — schedule lazily on the next tick", so the v1→v2 migration needs
  no Content bundle.

**Rng thrift:** no per-tick rolls. On phenomenon resolve/expire, draw once from the
pheno stream to schedule the next spawn (mean ~60 s active) and once to pick the type.
Same pattern for contract offers. Discrete, testable consumption points.

### Modules

- `sim/phenomena.ts` — scheduling, type selection, `catchPhenomenon()`, tailwind hook
  for `driftTarget()` (push-rate multiplier; still targets the clamped setpoint).
- `sim/contracts.ts` — template instantiation, progress evaluation (called from
  `tick()` and relevant actions), `dismissContract()`, reward payout.
- `sim/cards.ts` — chain support in resolve (transient `chainDepth` counter).
- `sim/tick.ts` stays time-only: advances `activeSec`, expires phenomena / tailwinds /
  contracts, calls the modules' pure step functions. `offline.ts` untouched — zero
  references to any new field.
- `sim/actions.ts` — `tapCollect` gains the on-beat check; multiplier from balance.

### Content

- `phenomena.json` — id, name, blurb, weight, windowSec, payout
  (`minerals | instabilityVent | tailwind | energy`), optional era/archetype gates.
- `contracts.json` — template id, copy with `{param}` slots, offer predicate from a
  **closed enum** (`system-out-of-band`, `all-in-band`, …), target/deadline ranges,
  reward.
- `balance.json` — `phenomena: { meanSpacingSec: 60, windowSec: 12 }`,
  `pulse: { periodSec: 4, onBeatMult: 1.6 }`,
  `contracts: { offerCooldownSec: 10, dismissCooldownSec: 15 }`, and `reserve: 3`
  added to the existing `energy` block (the reserve applies to all bonus Energy —
  Sparks and contract rewards alike).
- `cards.json` — `chain` on choices; zod refinement validates the target exists and its
  era/archetype gates overlap the parent's (fails loudly in dev).

### UI

- Phenomena render twice from the same state: a decorative `PlanetVisuals` layer (CSS
  transform/opacity, reduced-motion-safe, paused when hidden) **and** a fixed-position
  tappable chip on `PlanetScreen` — the chip is the real hit target, so catchability
  never depends on animation or motion settings.
- Contract offer: slim strip near the dial (pattern-match `TransmissionStrip`).
- Pulse: breathing ring on the collect control, phase synced to `activeSec` at render.
- `ui/visuals.ts`'s UI-only rng is not involved — phenomena are gameplay state from the
  store/sim.

## Error handling

Tolerant no-ops where honest play can race the sim: tapping a just-expired phenomenon
returns the run unchanged with `caught: false` (mirrors `tapCollect`'s zero path).
`SimError` remains for genuinely illegal calls (run over, unknown ids). Malformed
content fails loudly at zod load in dev.

## Testing & verification

- **Vitest:** same seed ⇒ identical phenomenon schedule; pheno-stream isolation (card
  sequence unchanged with/without catches); `activeSec` frozen across the offline path;
  pulse boundary math; contract lifecycle (offer → progress → complete/expire/dismiss);
  chain depth cap + free-draw accounting; energy reserve clamps; v1→v2 migration;
  existing offline-safety properties still green.
- **Harness:** new `attentive` policy (catches phenomena, completes contracts). CI
  assertions: attentive Seeds/run > baseline policies; baseline policies' survival and
  collapse-cause distributions unchanged within tolerance vs. the pre-change snapshot
  (the bonus-only invariant, made mechanical); energy never exceeds `cap + reserve`.
- **Acceptance walk:** fixed-seed checks — catch one phenomenon, complete one contract,
  resolve one chain.

## Delivery plan

Three PRs, each independently shippable, in order:

1. **PR A:** `activeSec` + v2 migration + phenomena + pulse + `attentive` harness
   policy/assertions + walk checks.
2. **PR B:** contracts + energy reserve + the "catch K phenomena" interlock template.
3. **PR C:** card chains + authored chain pairs + content validation.

Stopping after any PR still leaves a coherent shipped improvement.
