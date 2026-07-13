# data/ — content as data, not code (SPEC §5.1)

All game content lives here as JSON, validated at load with zod so malformed
content fails loudly in dev. Adding content = editing JSON, no code changes.

Planned files (created as their systems land):

| File | Contents | Milestone |
|---|---|---|
| `balance.json` | All tunables: tick rates, Energy regen (target: ~5 min/burst), Instability accrual/decay, band shifts, Seed-yield formula | M1 |
| `eras.json` | Era ladder, band targets per Era, unlocks | M1 |
| `archetypes.json` | Starting values, hazards, card-pool weights per Archetype | M1 (Barren only) |
| `machines.json` | Machine types, costs, production, setpoint effects | M1 |
| `cards.json` | Event cards: situation text, left/right choices, system deltas | M1 (~20 cards) |
| `recipes.json` | Two-slot synthesis recipes → machines/catalysts/lifeforms/cards | M3 |

Tone reminder (SPEC §0): card copy is cozy and hopeful; loss narration is
elegiac. Write card text accordingly.
