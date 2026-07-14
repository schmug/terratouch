# data/ — content as data, not code (SPEC §5.1)

All game content lives here as JSON, validated at load with zod (`schema.ts`,
strict objects) plus cross-file referential-integrity checks (`index.ts`) so
malformed content fails loudly in dev. Adding content = editing JSON, no code
changes. The sim never imports this directory — `index.ts` exports a validated
`Content` bundle that callers pass in.

Current files (M1):

| File              | Contents                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `balance.json`    | All tunables: Energy cap/regen (~5 min/burst target), tap rates, Instability accrual/decay/threshold, setpoint clamps, offline cap |
| `eras.json`       | The 7-era ladder: per-era safe bands, advance threshold + stabilization window, volatility multiplier                              |
| `archetypes.json` | Barren only (M1): starting values/setpoints, natural rest points + pull rates, starting minerals                                   |
| `machines.json`   | 3 machines (thermal/atmosphere/hydro): costs, push rates, passive production                                                       |
| `cards.json`      | 22 event cards, era-gated, weighted; copy is cozy/hopeful per the tone decision                                                    |
| `recipes.json`    | (M3 — not yet created) two-slot synthesis recipes                                                                                  |

Semantics worth knowing when tuning:

- **Card `eras: [min, max]`** are 1-based positions on the era ladder.
- **Card system deltas are multiplied by the era's `volatilityMult`**, and so
  is Instability _accrual_ (decay is flat) — later eras swing and punish harder.
- **Bands must stay within [1, 99]**: 0/100 are lethal and only cards may
  reach them (drift is asymptotic; offline is band-clamped).
- Archetype starting values must sit inside the Era-1 bands (validated).

Balance-harness snapshot (2026-07-13, 1000 runs/policy, 15% mistake rate):
random dies 61% (median 131 turns); greedy-safe survives 85% to the 300-turn
cap, 13.5% reach Habitable; greedy-progress hits Fauna in ~45 turns then
cascades. **Known hotspot: biosphere is the dominant late-era killer** (no
machine steers it; its band floor climbs) — revisit when M2 adds content.

Tone reminder (SPEC §0): card copy is cozy and hopeful; loss narration is
elegiac. Write card text accordingly.
