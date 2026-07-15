# data/ — content as data, not code (SPEC §5.1)

All game content lives here as JSON, validated at load with zod (`schema.ts`,
strict objects) plus cross-file referential-integrity checks (`index.ts`) so
malformed content fails loudly in dev. Adding content = editing JSON, no code
changes. The sim never imports this directory — `index.ts` exports a validated
`Content` bundle that callers pass in.

Current files (M1):

| File                 | Contents                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `balance.json`       | All tunables: Energy cap/regen (~5 min/burst target), tap rates, Instability accrual/decay/threshold, setpoint clamps, offline cap |
| `eras.json`          | The 7-era ladder: per-era safe bands, advance threshold + stabilization window, volatility multiplier                              |
| `archetypes.json`    | Barren only (M1): starting values/setpoints, natural rest points + pull rates, starting minerals                                   |
| `machines.json`      | 3 machines (thermal/atmosphere/hydro): costs, push rates, passive production                                                       |
| `cards.json`         | 22 event cards, era-gated, weighted; copy is cozy/hopeful per the tone decision                                                    |
| `transmissions.json` | 44 Mission Control one-liners (issue #16), trigger- and era-tagged; see the tagging scheme below                                   |
| `recipes.json`       | (M3 — not yet created) two-slot synthesis recipes                                                                                  |

Semantics worth knowing when tuning:

- **Card `eras: [min, max]`** are 1-based positions on the era ladder.
- **Card system deltas are multiplied by the era's `volatilityMult`**, and so
  is Instability _accrual_ (decay is flat) — later eras swing and punish harder.
- **Bands must stay within [1, 99]**: 0/100 are lethal and only cards may
  reach them (drift is asymptotic; offline is band-clamped).
- Archetype starting values must sit inside the Era-1 bands (validated).

Balance-harness snapshot (2026-07-15, 1000 runs/policy, 15% mistake rate,
after the issue #4 economy retune): random dies 63% (median 116 turns);
greedy-safe survives 84% to the 300-turn cap, 14% reach Habitable;
greedy-progress hits Fauna in ~48 turns then cascades. **Known hotspot:
biosphere is the dominant late-era killer** (no machine steers it; its band
floor climbs) — revisit when M2 adds content.

Mineral economy (issue #4): offline pays at 50% (`offline.productionMult`),
and machine costs are steep (`costMult` 2.2) so maxing all three machines
(~5,470 minerals total) is a multi-session project rather than one away-cycle
(~3,240 minerals from a 2 h gap early on). The Core Furnace's `baseCost`
equals Barren's `startingMinerals` so the first build stays an instant
onboarding beat. New mineral sinks are deliberately deferred to M2
meta-upgrades (#5) and M3 synthesis (#6).

Tone reminder (SPEC §0): card copy is cozy and hopeful; loss narration is
elegiac. Write card text accordingly.

## Mission Control transmissions (`transmissions.json`, issue #16)

Ambient one-liners the Planet screen rotates through — the strip is pure
presentation: `ui/transmissions.ts` selects with a UI-only tick counter and
never touches the run's seeded rng. This section is the authoring target spec
for the #12 LLM pipeline; the pipeline writes JSON offline, zod validates it,
zero inference happens at play time.

Each line is `{ id, trigger, eras, text }`:

- **`id`** — unique kebab-case, conventionally prefixed by trigger
  (`idle-…`, `era-up-…`).
- **`trigger`** — when the line is eligible:
  - `idle` — anytime ambience (state-neutral: must read true whether or not
    a gauge is drifting).
  - `all-clear` — every system inside its safe band.
  - `drifting` — at least one system outside its band. Gently concerned,
    never doomy: danger communication is the dial's job.
  - `era-up` — just advanced to a new era (gate = the era arrived in, so
    these lines start at era 2; `[2,2]` greets Frost, `[7,7]` Habitable).
  - `machine-built` — just placed a new machine (upgrades don't count).
  - `returned` — came back from an away gap (shown alongside the summary).
- **`eras`** — inclusive 1-based ladder range, like card `eras`.
- **`text`** — one strip-sized line, ≤100 chars (schema-enforced).

Validation beyond the schema (`parseTransmissions` in `index.ts`): unique
ids, era gates within the ladder, and **coverage** — every trigger must have
at least one eligible line in every era it can fire in (era 1–7, or 2–7 for
`era-up`), so the strip never falls silent. Grow the pool freely; you cannot
shrink it below coverage without the build failing.

Tone: Mission Control lives entirely on the cozy side of the split — warm,
a little wry, on the player's team. It may be gently concerned (`drifting`)
but never grim; grief belongs to the Chronicle (`net/templates.ts`).
