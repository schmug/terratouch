# CLAUDE.md

Guidance for coding agents working in this repo. Read [SPEC.md](SPEC.md) in full before writing code — it is the source of truth. This file is the short version plus the rules that must never be broken.

## What this is

**TerraTouch** — a mobile-first, touch-first terraforming clicker/roguelike PWA. You raise a dead world toward habitability one swipe at a time; when it collapses, an LLM writes the obituary of your planet. See SPEC.md for the full design and rationale.

## Current state

The repo currently contains **only the spec and this file** — nothing is scaffolded yet. The first implementation task is SPEC.md §9 / §4.2: scaffold the monorepo, then build the sim engine before any UI.

## Locked stack (SPEC §0)

- **Frontend:** React + Vite + TypeScript, installable PWA via `vite-plugin-pwa` (Workbox).
- **State:** Zustand store wrapping a pure sim, fixed-timestep tick loop.
- **Persistence:** IndexedDB (Dexie or idb). Never `localStorage` for the authoritative save.
- **Backend:** a single stateless Cloudflare Worker (`POST /api/narrate` → Workers AI) for loss narration only. The game is fully playable with zero backend.
- **Hosting/CI:** GitHub → Cloudflare Pages (app), `wrangler` (Worker).

## Non-negotiable rules

These come straight from the spec. Violating them breaks determinism, testability, or the core design — do not.

1. **All game rules live in `app/src/sim/` as pure functions over plain state.** No React, no DOM, no I/O, no network inside sim code.
2. **Never read wall-clock time inside sim functions.** Time is read only at the tick-loop boundary and passed in as a delta. This is what makes offline catch-up and tests possible.
3. **Determinism is the feature.** All randomness (card draws, archetype rolls) flows through the run's seed via `sim/rng.ts` (mulberry32). Same seed + same actions ⇒ identical run.
4. **Offline only ever accumulates safely (SPEC §1.3).** Offline production/drift is clamped inside the current safe band, never crosses a lethal line, and **never adds Instability**. Danger is opt-in and only happens during active play (drawing event cards costs Energy).
5. **Content is data, not code (SPEC §5.1).** `archetypes.json`, `machines.json`, `cards.json`, `recipes.json`, `eras.json`, `balance.json`. Adding content = editing JSON. Validate with zod so malformed content fails loudly in dev.
6. **Save has `schemaVersion` from day one** with a migration switch (SPEC §4.4).
7. **The LLM narration always has a local templated fallback** (SPEC §5.4). A failed/absent network call must never block the loss screen. Keep the provider behind one `generate()` function so it's swappable.

## Repo layout (target — SPEC §4.2)

```
app/                  # React + Vite + TS PWA → Cloudflare Pages
  src/
    sim/              # ⭐ pure, deterministic engine (systems, tick, offline, cards, synthesis, prestige, rng, types)
    data/             # content JSON (archetypes, machines, cards, recipes, eras, balance)
    state/            # Zustand store wrapping sim + persistence
    persist/          # IndexedDB load/save + schema migrations
    ui/               # screens & components (Planet, Cards, Build, Synthesis, Loss, tabs)
    net/              # narrate() client with timeout + fallback
  tests/              # vitest unit tests + auto-play balance harness
worker/               # Cloudflare Worker (wrangler)
.github/workflows/    # CI: typecheck, test, build
```

## Build order (SPEC §9 — do not skip ahead)

1. Scaffold the monorepo (`app/` Vite+React+TS+PWA, `worker/` wrangler).
2. Build `app/src/sim/` **first**, pure + unit-tested (four systems, tick, collapse, offline catch-up) — before any UI.
3. Wire the Zustand store + IndexedDB persistence (`schemaVersion: 1`).
4. Build the four screens minimally; make the Planet + Cards loop playable.
5. Ship **Milestone 1** (SPEC §7) to Cloudflare Pages; test on a real phone; tune with the balance harness.
6. Only then proceed to M2+.

**Milestone 1 is the "is it fun?" gate.** It ships without synthesis or prestige, with templated (not live-LLM) narration behind a flag.

## Verification (SPEC §6)

- **vitest** unit tests for systems math, band shifts, Instability accrual/decay, both collapse kinds, offline safety, prestige yield, save migration.
- **Auto-play balance harness:** headless script running thousands of seeded runs with bot policies; reports turns-survived / collapse-cause / Era distributions. It's a required CI check and the primary "is it fun-shaped?" instrument.
- Because the sim is pure and deterministic, both come nearly for free — keep it that way.

## Commands

_None yet — the app is not scaffolded. Once `app/` exists, expect roughly:_

```
npm --prefix app install
npm --prefix app run dev        # local dev server
npm --prefix app run build      # → app/dist (Cloudflare Pages output)
npm --prefix app run test       # vitest
```

_Update this section with the real scripts once `package.json` exists._
