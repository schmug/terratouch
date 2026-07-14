# CLAUDE.md

Guidance for coding agents working in this repo. Read [SPEC.md](SPEC.md) in full before writing code — it is the source of truth. This file is the short version plus the rules that must never be broken.

## What this is

**TerraTouch** — a mobile-first, touch-first terraforming clicker/roguelike PWA. You raise a dead world toward habitability one swipe at a time; when it collapses, an LLM writes the obituary of your planet. See SPEC.md for the full design and rationale.

## Current state

**Milestone 1 implemented (2026-07-13): the core loop is playable end-to-end.**

- `app/src/sim/` is a pure, deterministic engine (rng with explicit serializable state on `RunState`; closed-form exponential drift so ticking/offline can never hard-fail; Instability moves only on active turns). 80 vitest tests cover the SPEC §6 list, including offline-safety properties and byte-identical replay on shipped content.
- Balance harness (`app/tests/harness/`) runs 1000 seeded runs × 3 policies inside `npm test` (so it is a required CI check); `npm run harness` prints the full report. Snapshot + known biosphere hotspot: see [app/src/data/README.md](app/src/data/README.md).
- Zustand store + IndexedDB (`idb`) with `schemaVersion: 1` migration switch; fixed-timestep 1 s loop; hidden gaps ≥5 s go through the safe offline path; away summary shows for gaps ≥60 s. Saves persist immediately after offline credit (avoids re-crediting on quick reload).
- UI: Planet dial (arc gauges showing value/band/drift with shape-coded markers), Cards swipe with on-card telegraphing, Build, Loss screen with **templated** chronicle (`VITE_NARRATE_LLM` flag exists, off), away modal, Synthesis placeholder tab. Verified headlessly end-to-end: `npm --prefix app run walk` runs the 27-check acceptance walk ([app/tests/e2e/acceptance-walk.mjs](app/tests/e2e/acceptance-walk.mjs) — needs Chrome + a server; `WALK_BASE` overrides the URL). Run it before shipping UI changes.
- Still stubs by design: `sim/synthesis.ts` (M3), `sim/prestige.ts` (M2 — `seedsAwarded` is always 0), `worker/` 501 (M4).
- **Deployed:** https://terratouch.pages.dev via Cloudflare Pages Git integration (build command needs the explicit `npm ci` — see SPEC §4.6). The 27-check acceptance walk passes against production, including SW-served no-network reload.
- **Not yet done:** hands-on real-phone feel test (install, swipe feel, away moment, obituary tone), then M2+.
- **All outstanding work is tracked as [GitHub issues](https://github.com/schmug/terratouch/issues)** — milestones M2–M6, balance findings with harness baselines, and enhancements. Start there when picking up work; file new findings as issues rather than TODOs.

## Locked stack (SPEC §0)

- **Frontend:** React + Vite + TypeScript, installable PWA via `vite-plugin-pwa` (Workbox).
- **State:** Zustand store wrapping a pure sim, fixed-timestep tick loop.
- **Persistence:** IndexedDB (Dexie or idb). Never `localStorage` for the authoritative save.
- **Backend:** a single stateless Cloudflare Worker (`POST /api/narrate` → Workers AI) for loss narration only. The game is fully playable with zero backend.
- **Hosting/CI:** GitHub → Cloudflare Pages (app), `wrangler` (Worker).

## Design decisions (resolved 2026-07-13)

- **Name:** TerraTouch — final for v1; use it in the manifest and user-facing strings.
- **Tone: bittersweet blend.** Card copy and in-game text are cozy and hopeful; the Chronicle's loss obituaries are elegiac and wistful. The contrast is deliberate — losing a world should sting a little. Write all content (cards.json, templated fallbacks, LLM system prompt) with this split in mind.
- **Energy cadence:** one active burst ≈ **5 minutes** (~10–15 card draws + building). Tune Energy cap/regen in `balance.json` toward this target.
- **Monetization: none, ever.** Free/portfolio project. Tune the prestige economy purely for fun — never add store-shaped friction.

## Branch & merge policy (owner decision 2026-07-13)

Every push to `main` auto-deploys to production (https://terratouch.pages.dev). There is no enforced branch ruleset (private repo, free plan), so this is a convention — follow it exactly:

- **Never push to `main` directly** — not even for docs, tooling, or content-JSON tweaks. Always work on a branch and open a PR.
- **Merge only when both CI checks are green:** `App (typecheck · test · build)` and `Worker (typecheck)`.
- Dependabot opens grouped **monthly** version-update PRs ([.github/dependabot.yml](.github/dependabot.yml)) for npm (`app/`, `worker/`) and GitHub Actions. They go through the same gate: CI green before merge, and sanity-check `dist-tags` per the toolchain notes below.

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

```sh
# repo root (tooling only: Prettier + ESLint — run both before committing)
npm install            # installs the tooling-only root package.json
npm run format         # prettier --write . (app/ + worker/ + md/json)
npm run format:check   # what CI runs
npm run lint           # eslint . (flat config at eslint.config.mjs)

# app/ (React + Vite + TS PWA)
npm --prefix app install
npm --prefix app run dev        # dev server
npm --prefix app run typecheck  # tsc --noEmit
npm --prefix app test           # vitest run (tests/ — pure node env)
npm --prefix app run build      # typecheck + vite build → app/dist
npm --prefix app run icons      # regenerate PWA icons (scripts/make-icons.mjs)

# worker/ (Cloudflare Worker)
npm --prefix worker install
npm --prefix worker run dev        # wrangler dev
npm --prefix worker run typecheck  # tsc --noEmit
npm --prefix worker run deploy     # wrangler deploy (needs CF auth)
```

Toolchain notes (verified against the npm registry 2026-07-13):

- Key versions: Vite 8 (rolldown-based), vitest 4 (peer-deps our vite — one vite in the tree), React 19.2, TypeScript 7 (native compiler), zod 4, zustand 5, wrangler 4.
- `vitest.config.ts` is **standalone**, not merged into `vite.config.ts` — sim tests are pure node and need no plugins. Keep it that way.
- Node: `.nvmrc` says 24 (LTS); CI runs 24. Engines floor across deps is effectively >=22.12.
- CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs app typecheck/test/build + worker typecheck via `npm ci` — keep both `package-lock.json` files committed.
- When adding a dependency, sanity-check `npm view <pkg> dist-tags` — resolver under-picks happen (vitest initially resolved to 3.x when 4.x was latest).
- **Formatting/linting (issue #14):** the root `package.json` is tooling-only (private; Prettier 3 + ESLint 10 flat config + typescript-eslint + react-hooks). It plays no build role — the Cloudflare Pages build command installs explicitly inside `app/` (SPEC §4.6). The root `typescript` is pinned to 6.x solely as typescript-eslint's parser peer (`<6.1.0`); app/worker build with TypeScript 7. CI runs `format:check` + `lint` as a first gate — run `npm run format && npm run lint` before committing. The one-time reformat commit is in `.git-blame-ignore-revs` (GitHub honors it automatically; locally, `git config blame.ignoreRevsFile .git-blame-ignore-revs`).
