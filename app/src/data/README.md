# data/ — content as data, not code (SPEC §5.1)

All game content lives here as JSON, validated at load with zod (`schema.ts`,
strict objects) plus cross-file referential-integrity checks (`index.ts`) so
malformed content fails loudly in dev. Adding content = editing JSON, no code
changes. The sim never imports this directory — `index.ts` exports a validated
`Content` bundle that callers pass in.

Current files (M1):

| File                 | Contents                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `balance.json`       | All tunables: Energy cap/regen (~5 min/burst target), tap rates, Instability accrual/decay/threshold, setpoint clamps, offline cap, Seed-yield params (`prestige`) |
| `eras.json`          | The 7-era ladder: per-era safe bands, advance threshold + stabilization window, volatility multiplier                                                              |
| `archetypes.json`    | Barren (starter) + Seed-gated Frozen and Volcanic (M2): starting values/setpoints, natural rest points + pull rates, starting minerals                             |
| `machines.json`      | 4 machines (one per system): costs, push rates, passive production; the Spore Garden (biosphere) is era-gated via `unlockEra`                                      |
| `upgrades.json`      | Seed meta-upgrades (SPEC §2.8): machine speed, gentler Instability, starting minerals, energy cap, offline window, archetype unlocks (Charts of Ice/Fire)          |
| `cards.json`         | 28 event cards, era- and archetype-gated, weighted; copy is cozy/hopeful per the tone decision                                                                     |
| `phenomena.json`     | Tappable active-play phenomena (Session Arc slice A): weighted, era/archetype-gatable payouts (minerals / vent / tailwind / energy); bonus-only — misses cost 0    |
| `transmissions.json` | 44 Mission Control one-liners (issue #16), trigger- and era-tagged; see the tagging scheme below                                                                   |
| `recipes.json`       | (M3 — not yet created) two-slot synthesis recipes                                                                                                                  |

Semantics worth knowing when tuning:

- **Card `eras: [min, max]`** are 1-based positions on the era ladder.
- **Card system deltas are multiplied by the era's `volatilityMult`**, and so
  is Instability _accrual_ (decay is flat) — later eras swing and punish harder.
- **Bands must stay within [1, 99]**: 0/100 are lethal and only cards may
  reach them (drift is asymptotic; offline is band-clamped).
- Archetype starting values must sit inside the Era-1 bands (validated).

Balance-harness snapshot (2026-07-15, 1000 runs/policy, 15% mistake rate,
after the Session Arc slice-A phenomena/pulse landed). Baseline policies now
tick **19 s per turn** (was 20): 19 mod pulse-period 4 cycles every residue,
so ordinary bots hit the tap beat at the chance level of 25% instead of the
accidental 100% that 20 gave — baseline numbers shifted slightly with the
extra beat income removed. The new `attentive` policy plays greedy-safe plus
catches every phenomenon, ticking 20 s to always be on-beat. Numbers: random
dies 72.8% (median 50 turns, spread p10=9 / p90=300), seeds/run 1.66;
greedy-safe dies 2.2% and Ascends 97.8% in ~60 turns, seeds/run 18.58;
greedy-progress busts 7% and Ascends 93%, seeds/run 17.76; attentive dies
2.1% and Ascends 97.9% in ~50 turns, seeds/run 18.57. Seeds/run rises with
policy skill (M2 acceptance, asserted in CI): random 1.66 vs skilled
~17.8–18.6 (≥3× is the CI bar). Known saturation: attentive vs greedy-safe
is a seeds/run tie because ~98% of both Ascend at the final era where the
yield saturates, so the slice-A CI bar is **Seeds per TURN** (same-strategy
comparison): attentive 0.371 vs greedy-safe 0.309 — attention pays as a
~20% faster prestige cycle. **The old biosphere
hotspot (issue #3) stays resolved**: cascade blame pooled across policies is
thermal 43.5% / biosphere 27.3% / hydro 17.8% / atmosphere 11.5% — no system
over the 60% bar (also asserted in CI). Biosphere remains the intended
weakest system: the Spore Garden pushes at a sixth of the other machines'
rate, so late floors take high levels + a high setpoint. Note the oracle-bot
caveat: bots see both resolved futures before choosing; human Ascension
rates will be far lower.

Seed yield (`balance.prestige`, SPEC §2.8): `base = era·eraWeight +
⌊peakHab/habDivisor⌋`; collapse pays `⌊base·collapseMult⌋` (partial),
voluntary Ascension at Habitable pays `base + ascensionBonus` (max). The
Codex/discoveries term joins in M3. Tuning intent: first runs bank 0–1 Seeds,
a mid-game death 2–6, a full Ascension ~18–20 — Ascending must always beat
collapsing on the same board (schema enforces `collapseMult < 1`).

Mineral economy (issue #4): offline pays at 50% (`offline.productionMult`),
and machine costs are steep (`costMult` 2.2) so maxing the original three
machines (~5,470 minerals total) is a multi-session project rather than one
away-cycle (~3,240 minerals from a 2 h gap early on). The Core Furnace's
`baseCost` equals Barren's `startingMinerals` so the first build stays an
instant onboarding beat. The Spore Garden (base 200, unlocks at Microbial)
is the M2 mineral sink — maxing it is another ~5,000. Genesis Seeds are a
separate economy: the shop's five upgrades cost ~600 Seeds to complete
(≈30+ Ascensions), the long meta arc.

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
