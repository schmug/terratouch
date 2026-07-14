# TerraTouch — Feasibility Analysis & Implementation Spec

> A mobile-first, touch-first terraforming clicker/roguelike. You raise a dead world toward
> habitability one swipe at a time — and when it collapses, an AI chronicler writes the
> obituary of your planet.

**Status:** Design spec v1.1 (all open questions resolved) · **Audience:** Claude Code (implementer) + Cory (designer/owner)
**Last updated:** 2026-07-13

---

## 0. Decisions locked for v1

| Decision            | Choice                                                                   | Rationale                                                                                      |
| ------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Platform            | **PWA on Cloudflare Pages**                                              | One codebase, installable on mobile, free hosting, no app-store review/fees                    |
| Data model          | **Local-first, no accounts**                                             | All saves in IndexedDB; the only network call is the loss narration                            |
| Loss-narration LLM  | **Cloudflare Workers AI**                                                | Unified stack; 10k free neurons/day dwarfs our needs; key never touches client                 |
| Frontend stack      | **React + Vite + TypeScript**                                            | Conventional, great PWA tooling, most reliable for agentic implementation                      |
| Source control / CI | **GitHub** → Cloudflare Pages Git integration; `wrangler` for the Worker |                                                                                                |
| Name                | **TerraTouch** (final for v1)                                            | Literal, descriptive; already the working title                                                |
| Tone                | **Bittersweet blend**                                                    | Cozy, hopeful play; elegiac, wistful Chronicle obituaries — the contrast is the emotional hook |
| Energy cadence      | **~5 min per active burst** (~10–15 card draws)                          | Reigns-session length; several returns/day. Tune via `balance.json`                            |
| Monetization        | **None, ever** (free / portfolio)                                        | Prestige economy tuned purely for fun                                                          |

Everything below assumes these choices.

---

## 1. Feasibility analysis

### 1.1 Verdict

**Feasible and cheap.** This is a solo-buildable game whose entire production stack sits inside
free tiers, and whose most exotic feature (an LLM writing your loss story) is the _cheapest_ part
of the whole thing. The design is also _coherent_ — but only after resolving one genuine tension,
described in §1.3. That reconciliation is the single most important design idea in this document.

### 1.2 The genre mash-up, and why it works

The pitch combines five patterns. They are not obviously compatible, so here is how each maps onto
a single coherent loop rather than five bolted-on subsystems.

- **Reigns (swipe-to-decide, meters that kill you).** Reigns gives you 4 meters and you die if any
  one empties _or_ overfills. This is the _tension_ engine. In TerraTouch, each planetary system is
  a gauge with a lethal low end and a lethal high end, and binary swipe-cards nudge them.
- **The Planet Crafter (raise indices toward a Terraform Index; cross thresholds to unlock stages).**
  This is the _progression_ engine — the monotonic sense of a world coming alive. In TerraTouch the
  same gauges you're keeping alive are also the gauges you're _ratcheting upward_ through Eras.
- **Clicker / idle + prestige.** The _accumulation_ engine: tap to collect, machines produce
  passively, and a prestige reset trades a run's progress for permanent multipliers.
- **Roguelike.** The _variety + permadeath_ engine: each planet is a randomized archetype; runs end;
  meta-progression persists.
- **Little Alchemy (combine two things to discover a third).** The _depth + collection_ engine: a
  Synthesis screen where resources combine into new machines, lifeforms, catalysts, and cards, all
  tracked in a Codex.

The unifying insight that makes it one game instead of five: **the meters you must not let die
(Reigns) are the same meters you are trying to raise (Planet Crafter).** One set of four gauges
serves both the kill-condition and the progression axis. That collapses the two biggest systems into
one elegant, mobile-legible model (see §2).

### 1.3 The one real tension — and its resolution

**Conflict:** Reigns is high-tension and punishes inattention with death. Idle/offline games reward
_being away_. If planetary gauges can drift into a lethal zone while the player is offline, the
player loses with zero agency — which is enraging and kills retention.

**Resolution (design rule, non-negotiable):**

> **Offline time only ever accumulates safely. Danger is opt-in and only happens while you are
> actively playing.**

Concretely:

- While offline, machines produce **resources** and nudge each gauge **toward its configured
  setpoint**, but every gauge is **clamped to stay inside its current safe band** — it can approach
  the edge but never cross a lethal line.
- **Instability** (the accumulating value that actually causes collapse — see §2.4) **does not accrue
  offline.** Ever.
- **Event cards** (the things that swing gauges hard and can push you into danger) **only draw while
  you are in the app**, and each draw is player-initiated (costs Energy — see §2.5).

Result: you come back from offline to a _richer, safer_ planet and a refilled Energy bar, then choose
to spend that Energy pushing your luck with event cards. Idle = safe growth. Active play = tension.
Both loops stay intact and stop fighting each other.

### 1.4 Technical feasibility (all figures current as of July 2026)

| Concern                                       | Finding                                                                                                                                                                                              | Verdict                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Host the PWA                                  | Cloudflare Pages: unlimited static requests, free custom domain, Git-connected CI                                                                                                                    | ✅ Free                         |
| Loss-narration LLM                            | **Cloudflare Workers AI: 10,000 free neurons/day.** A ~200-token generation on a small model (Llama 3.2 1B / Mistral 7B) costs a tiny fraction of that; you could serve thousands of losses/day free | ✅ Effectively free             |
| API for the Worker                            | Cloudflare Workers free plan: 100,000 requests/day                                                                                                                                                   | ✅ Free                         |
| Optional cloud save/leaderboards _(deferred)_ | D1 free tier (5M row reads/day, 100k writes/day, 5GB) and Durable Objects free tier (100k req/day) are ample for hobby scale                                                                         | ✅ Available if we ever want it |
| Offline advancement                           | Standard idle technique: persist `lastSeen` timestamp, compute elapsed delta on resume, run bounded catch-up simulation. Pure client-side                                                            | ✅ Solved pattern               |
| Secret handling                               | Workers AI runs server-side in the Worker via the `AI` binding — no API key is ever shipped to the client                                                                                            | ✅ Secure by construction       |
| iOS PWA caveats                               | iOS supports installable PWAs and (iOS 16.4+) web push when installed to Home Screen, but with quirks. v1 does not depend on push                                                                    | ⚠️ Note, not a blocker          |

**Alternative considered:** Google Gemini free tier (1,500 requests/day, no credit card, higher-quality
prose via Gemini 2.5 Flash). Rejected for v1 only to keep the stack unified on Cloudflare; the Worker
is written so swapping the provider is a one-file change (§5.4).

**Bottom line:** nothing here requires paid infrastructure at launch or realistic early scale.

---

## 2. Core game design

### 2.1 One-run summary

A **run** = one attempt to terraform one planet. You inherit a dead world of some **Archetype**,
build machines, tap to collect, and draw **event cards** that swing your four **planetary systems**.
Keep all four in their advancing safe bands long enough and the world crosses into the next **Era**,
raising the bar and unlocking new toys. Push your luck wrong — or let Instability cascade — and the
world **collapses**: the run ends, the AI chronicler writes its post-mortem, and you **Ascend**
(prestige), converting your progress into permanent power for the next world.

### 2.2 The four planetary systems (the heart of the game)

Every planet is described by **four gauges**, each `0–100`. These are simultaneously your
Reigns-style kill meters _and_ your Planet-Crafter-style progression indices.

| System            | Lethal-low failure | Lethal-high failure              |
| ----------------- | ------------------ | -------------------------------- |
| 🌡️ **Thermal**    | Frozen solid       | Scorched / runaway greenhouse    |
| 🌫️ **Atmosphere** | Airless / too thin | Toxic / crushing pressure        |
| 💧 **Hydro**      | Bone-dry           | Drowned / global flood           |
| 🌱 **Biosphere**  | Barren / sterile   | Blight / uncontrolled overgrowth |

Each system has, at any moment:

- `value` — current position, `0–100`
- `band` — the current **safe band** `[lo, hi]` you must stay within (a subrange of 0–100)
- `setpoint` — where your machines passively push `value` (player-configurable via machines)

**The safe band moves.** Each Era shifts every band's target upward — early on you're keeping a frozen
rock merely "not lethally frozen"; later you're holding a temperate, breathable, watered, living
world. Progression _is_ the band climbing, and the challenge _is_ keeping `value` inside the band
while it climbs.

### 2.3 Eras (the Planet Crafter progression axis)

The overall **Habitability** score is a function of how deep into each system's band you're sitting,
summed across all four. Sustain a Habitability threshold for a short "stabilization" window and the
planet advances an Era. Suggested Era ladder (tunable):

1. **Barren** — nothing lives; you're just fighting lethality.
2. **Frost** — ice forms; liquid becomes possible.
3. **Liquid** — oceans; microbial seeding unlocks.
4. **Microbial** — first Biosphere gains; oxygen begins.
5. **Flora** — plants; Atmosphere and Hydro couple.
6. **Fauna** — animals; complex event cards unlock.
7. **Habitable** — the win state → voluntary Ascension for max prestige yield.

Each new Era: raises all four bands, unlocks new **machines**, new **event cards**, and new
**synthesis recipes**, and slightly increases baseline volatility (harder to hold).

### 2.4 Collapse (the roguelike permadeath condition)

Two ways a run ends in failure:

1. **Hard fail** — any system's `value` hits `0` or `100`. Instant collapse. (Only reachable through
   event cards / active play, per §1.3.)
2. **Cascade fail** — **Instability** accumulates past a threshold. Each _active_ turn a system spends
   **outside its safe band** adds Instability; turns fully inside all bands bleed it back down.
   Enough sustained mismanagement → cascade → collapse.

Instability gives the game a forgiving-but-tense feel: one bad card won't kill you, but ignoring a
drifting system will. It also gives the LLM narrator rich, specific material ("your atmosphere spent
nine turns in the red before the greenhouse ran away").

On collapse the game records a **CollapseReport** (§5.3) that drives both the loss screen and the LLM.

### 2.5 Event cards (the Reigns layer)

- Presented as a **swipeable card**: a short situation + a **left choice** and a **right choice**.
- Each choice applies deltas to one or more systems (and sometimes resources/Instability), shown as
  **subtle directional hints** on the card edges (Reigns-style "which meter moves" telegraphing,
  revealed as the card is dragged).
- Drawing a card costs **1 Energy**. Energy regenerates over real time (and refills while offline),
  capping the active-play burst length — this is what makes it _casual_ and ties the idle layer to
  the tension layer.
- Cards are drawn from a **weighted pool** gated by Archetype + current Era + Codex unlocks, using the
  run's **seeded RNG** (deterministic, §5.2).
- Card outcomes can also **grant resources** and **discover Codex entries**, linking to synthesis.

### 2.6 Machines & the clicker/idle layer

- **Tap-to-collect:** the planet screen accumulates resources; tapping collects (with a small
  tap-bonus so active tapping matters but isn't mandatory).
- **Machines:** placeable/upgradeable units that (a) produce resources passively and (b) set a
  **setpoint** and push-rate for one system. Example: a _Heater_ raises Thermal's setpoint;
  a _Hydrolyzer_ raises Atmosphere via oxygen; a _Condenser_ raises Hydro.
- Machines are how the player _steers_ the passive/offline drift safely between card-driven bursts.
- Upgrades cost resources; deeper upgrades unlock via Era + Codex.

### 2.7 Synthesis (the Little Alchemy layer)

- A **two-slot combine** screen: drop two owned resources/elements → discover a result.
- Results include: new **machines**, **catalysts** (one-shot consumables that safely shove a system
  or dump Instability), new **lifeforms** (Biosphere boosts), and new **event cards**.
- Discoveries are recorded in a **Codex**. Discovering things is a core dopamine loop and a
  soft-progression gate.
- Recipes are data-driven (`recipes.json`) so content can grow without code changes.

### 2.8 Prestige / Ascension (the clicker meta-layer)

- Triggered on **collapse** (partial yield) or **voluntary Ascension at Habitable** (max yield).
- Converts run progress (peak Habitability, Biosphere, discoveries) into **Genesis Seeds** — the
  persistent meta-currency.
- Seeds buy permanent **meta-upgrades**: faster machines, gentler Instability accrual, more starting
  resources/Energy, higher offline caps, and **unlocking new Archetypes**.
- **Codex discoveries persist** across runs (roguelike unlock feel), even though the run's board resets.

### 2.9 Roguelike archetypes (run variety)

Each new run rolls (or the player selects, once unlocked) an **Archetype** that sets starting system
values, hazards, weighted card pool, and unique recipes. Launch set:

| Archetype            | Flavor       | Twist                                             |
| -------------------- | ------------ | ------------------------------------------------- |
| **Barren** (starter) | Grey rock    | Balanced, gentle — the tutorial planet            |
| **Frozen**           | Ice world    | Thermal starts near-lethal-low; warming is job #1 |
| **Volcanic**         | Molten       | Thermal near-lethal-high; venting heat            |
| **Toxic**            | Poison skies | Atmosphere near-lethal-high; scrubbing            |
| **Oceanic**          | Water world  | Hydro near-lethal-high; drainage/land-making      |

More archetypes unlock with Seeds. Archetypes are pure data (`archetypes.json`).

### 2.10 The AI chronicler (the signature feature)

When a run collapses, the game builds a compact **CollapseReport** and asks the Worker for a short,
evocative **post-mortem chronicle** of the dead world — 2nd person, ~120 words, referencing the actual
cause of death and a couple of standout stats. It's the emotional punctuation on permadeath and a
shareable moment. Full contract in §5.4. Always has a **local templated fallback** so a failed/absent
network call never blocks the loss screen.

---

## 3. UX / UI (mobile-first, touch-first, minimal)

Design language: one-thumb operation, large touch targets, almost no text chrome, snappy transitions.
Four screens reachable from a bottom tab bar (or a radial), plus modal-style card and loss screens.

- **Planet (home):** a stylized planet with four **arc-gauges** ringing it, each showing `value`,
  its safe `band`, and a drift arrow. Central readout: current **Era** + **Habitability**. Tap the
  planet to collect resources. A prominent **"Advance" (draw card)** button consumes Energy. Energy
  bar visible.
- **Cards:** the Reigns swipe surface. Drag left/right; edges telegraph which systems move. This is
  where active-play tension lives.
- **Build:** machines list — place, upgrade, set setpoints. Minimal, chunky rows.
- **Synthesis:** two-slot combine + scrollable Codex of discoveries.
- **Loss screen (modal):** stat recap (peak Era, turns survived, cause of death, key numbers) + the
  **AI chronicle** + a single big **"Begin New World → Ascend"** button.

Visual/audio scope for v1: clean vector/CSS planet, restrained palette per Archetype, subtle haptics
on swipe/collect, light SFX. No heavy art dependency to reach "playable and fun."

Accessibility: respect `prefers-reduced-motion`, colorblind-safe gauge encoding (shape + position,
not color alone), min 44px touch targets.

---

## 4. Technical architecture

### 4.1 Shape

```
┌─────────────────────────────────────────────┐        ┌───────────────────────────┐
│  PWA client (React + Vite + TS)             │        │  Cloudflare Worker         │
│  - deterministic sim engine (pure TS)        │  POST  │  POST /api/narrate         │
│  - Zustand store + fixed-timestep tick loop  │ ─────► │  → env.AI.run(model, …)    │
│  - IndexedDB save (Dexie/idb)                │  JSON  │  → returns { chronicle }   │
│  - offline catch-up on resume                │ ◄───── │  (Workers AI binding)      │
│  - vite-plugin-pwa (installable, offline)    │        │  CORS locked to Pages origin│
└─────────────────────────────────────────────┘        └───────────────────────────┘
        served by Cloudflare Pages                          deployed via wrangler
```

The client is a **complete, playable game with zero backend.** The Worker is a single stateless
endpoint that only exists to write the loss story (and to keep the model invocation server-side). If
the Worker is down, the game is fully playable with templated narration.

### 4.2 Repository layout (monorepo)

```
terratouch/
├─ app/                    # React + Vite + TS PWA (deployed to Cloudflare Pages)
│  ├─ src/
│  │  ├─ sim/              # ⭐ pure, deterministic simulation engine (no React, no DOM)
│  │  │  ├─ systems.ts     #   the four gauges, bands, Instability, collapse detection
│  │  │  ├─ tick.ts        #   fixed-timestep advance; production; drift-to-setpoint
│  │  │  ├─ offline.ts     #   bounded catch-up given elapsed ms (safe-clamped)
│  │  │  ├─ cards.ts       #   draw/apply event cards (seeded)
│  │  │  ├─ synthesis.ts   #   combine + codex
│  │  │  ├─ prestige.ts    #   seed yield + meta-upgrade application
│  │  │  ├─ rng.ts         #   mulberry32 seeded PRNG
│  │  │  └─ types.ts       #   GameState, Config, CollapseReport, etc.
│  │  ├─ data/             # content as JSON: archetypes, machines, cards, recipes, eras, balance
│  │  ├─ state/            # Zustand store wrapping sim + persistence
│  │  ├─ persist/          # IndexedDB load/save + schema migrations
│  │  ├─ ui/               # screens & components (Planet, Cards, Build, Synthesis, Loss, tabs)
│  │  ├─ net/              # narrate() client with timeout + fallback
│  │  └─ main.tsx
│  ├─ tests/               # vitest unit tests + the auto-play balance harness
│  ├─ vite.config.ts       # + vite-plugin-pwa
│  └─ package.json
├─ worker/                 # Cloudflare Worker (deployed via wrangler)
│  ├─ src/index.ts         # POST /api/narrate → Workers AI; CORS; validation; rate heuristic
│  └─ wrangler.toml        # [ai] binding, routes, vars
├─ .github/workflows/      # CI: typecheck, test, build (Pages can also build on its own)
└─ SPEC.md                 # this document
```

**Design mandate:** all game rules live in `app/src/sim/` as **pure functions over plain state**
(no React, no I/O, no wall-clock reads inside the functions — time deltas are passed in). This is what
makes the game deterministic, unit-testable, offline-catch-up-able, and auto-balanceable (§6).

### 4.3 State, ticking, and time

- **Store:** Zustand holding `GameState`. UI subscribes; the sim mutates via reducer-style pure calls.
- **Tick loop:** a fixed-timestep accumulator (e.g., logical tick = 1s) driving `sim/tick.ts`. Wall
  clock is read _only_ at the loop boundary and converted to a delta passed into pure sim code.
- **Autosave:** debounced write to IndexedDB (e.g., every few seconds + on visibility-change/pagehide).
  Persist `lastSeenMs`.
- **Offline resume:** on load, `elapsed = now - lastSeenMs`; clamp to a Seed-upgradable max (e.g., 8h
  default); run `sim/offline.ts` to apply **safe** production/drift (never crossing bands, never adding
  Instability), then show a "While you were away…" summary.

### 4.4 Persistence & save schema (v1)

Single versioned save object in IndexedDB. **Include `schemaVersion` from day one** with a migration
switch, because content/balance will churn.

```ts
type Save = {
  schemaVersion: 1
  run: RunState | null // current run; null between runs
  meta: MetaState // persists across runs
  lastSeenMs: number
}

type RunState = {
  seed: number
  archetypeId: string
  era: number
  systems: Record<
    SystemId,
    { value: number; band: [number, number]; setpoint: number }
  >
  instability: number
  resources: Record<ResourceId, number>
  machines: Array<{ id: string; typeId: string; level: number }>
  energy: number
  turns: number // active turns taken (cards drawn)
  history: RunHistory // compact rolling stats for the CollapseReport
}

type MetaState = {
  genesisSeeds: number
  upgrades: Record<string, number> // meta-upgrade id → level
  codex: string[] // persistent discoveries
  unlockedArchetypes: string[]
  stats: { runs: number; bestEra: number; longestRun: number }
}
```

### 4.5 PWA specifics

- `vite-plugin-pwa` with Workbox: precache the app shell + data JSON for full offline play.
- Web App Manifest: name, icons, `display: standalone`, portrait, themed splash.
- No browser storage APIs beyond IndexedDB (which is fine and expected). Never rely on `localStorage`
  for the authoritative save.

### 4.6 Deployment

- **App:** connect the GitHub repo to **Cloudflare Pages**; build command
  `npm --prefix app ci && npm --prefix app run build`, output `app/dist`. (The explicit
  `npm ci` matters: the monorepo root has no package.json, so Pages skips its automatic
  dependency install — verified 2026-07-13 when the install-less command failed with
  `tsc: not found`.) Auto-deploy on push to `main`; preview deploys on PRs.
- **Worker:** `wrangler deploy` from `worker/` with the `AI` binding enabled. Route it at
  `/api/*` on the Pages custom domain (or a `*.workers.dev` subdomain referenced by the client via an
  env var) so CORS stays same-origin where possible.
- **Env/config:** client reads `VITE_NARRATE_URL`; Worker holds no secret for Workers AI (the `AI`
  binding is credential-free). If we ever swap to Gemini, the key lives only as a Worker secret.

---

## 5. Contracts & data formats

### 5.1 Content is data, not code

`archetypes.json`, `machines.json`, `cards.json`, `recipes.json`, `eras.json`, and a central
`balance.json` (all tunables: tick rates, Energy regen, Instability accrual/decay, band shifts,
Seed-yield formula). Adding content = editing JSON. Keep a lightweight runtime schema validator
(zod) so malformed content fails loudly in dev.

### 5.2 Determinism

`sim/rng.ts` exposes a seeded `mulberry32` PRNG. Card draws, archetype rolls, and any randomness take
the run's `seed`. Given identical `seed` + identical input actions, a run is perfectly reproducible —
required for the offline catch-up, for tests, and for the balance harness.

### 5.3 CollapseReport (drives the loss screen + the LLM)

```ts
type CollapseReport = {
  archetype: string // "Frozen"
  eraReached: string // "Microbial"
  turnsSurvived: number
  cause: {
    kind: 'hard-fail' | 'cascade'
    system: SystemId // e.g. "atmosphere"
    direction: 'low' | 'high' // which lethal edge
  }
  systemsFinal: Record<SystemId, number> // final values
  peakHabitability: number
  notableStats: string[] // e.g. ["atmosphere spent 9 turns in the red", "3 lifeforms discovered"]
  seedsAwarded: number
}
```

### 5.4 LLM narration contract

**Client → Worker:** `POST /api/narrate` with `{ report: CollapseReport }`.

**Worker → Workers AI:** system prompt constrains hard:

> You are the Chronicle, a terse planetary historian. Given the death of a terraformed world,
> write its obituary in **2nd person**, **≤120 words**, evocative but plain (no markdown, no lists,
> no headings). Name the actual cause of collapse and weave in one or two of the notable stats.
> PG-rated, no profanity. Output prose only.

The user turn is a compact JSON of the `CollapseReport`. Model: start with a small fast model
(`@cf/meta/llama-3.2-1b-instruct` or `@cf/mistral/mistral-7b-instruct`); it's more than enough for a
120-word vignette and stays deep inside the free neuron budget.

**Worker → Client:** `{ chronicle: string }`. Worker responsibilities: validate/trim output to the
word cap, strip control chars/markdown, enforce a request timeout, lock CORS to the app origin, and a
cheap per-IP rate heuristic. **Provider is isolated behind one `generate()` function** so switching to
Gemini later is a single-file change.

**Client fallback:** `net/narrate()` uses an ~4s timeout; on any failure it renders a **local
templated** chronicle keyed by `cause.kind`/`system`/`direction`, so the loss screen is never blocked
by the network. (This also means the game is fully playable offline, LLM or not.)

---

## 6. Balancing & verification

Permadeath games live or die on pacing. Because the sim is pure and deterministic, we get a powerful
verification tool for free:

- **Unit tests (vitest):** systems math, band-shift on Era-up, Instability accrual/decay, collapse
  detection (both kinds), offline catch-up **never** crosses a band or adds Instability, prestige-yield
  formula, save-migration.
- **Auto-play balance harness:** a headless script that runs **thousands of seeded runs** with simple
  bot policies (random, greedy-safe, greedy-progress) and reports distributions: median turns survived,
  collapse-cause breakdown, Era-reached histogram, Seeds/run. Use it to tune `balance.json` toward a
  target curve (e.g., first runs die fast and cheap; skilled play reaches Habitable in a satisfying
  arc). This is the primary "is it fun-shaped?" instrument and a required CI check.
- **Manual playtest checklist** per milestone: does a fresh player understand the swipe? Does offline
  feel rewarding? Does a loss feel _fair_ and the chronicle land?

---

## 7. MVP scope & phased roadmap

Each milestone is independently shippable and testable. **Milestone 1 is the "is it fun?" gate** —
everything else is depth on a proven core.

### Milestone 1 — Playable core (the vertical slice)

**Goal:** a mobile PWA you can install and lose to, with the core tension working.

- One Archetype (**Barren**); the four systems with safe bands; Era 1→2 transition working.
- ~20 event cards; swipe-to-decide with edge telegraphing; Energy gating (regen + offline refill).
- Tap-to-collect + 3 machines with setpoints.
- Collapse detection (hard-fail + cascade) and the loss screen with **templated** narration
  (LLM behind a feature flag, off).
- IndexedDB save + safe offline catch-up + "while you were away" summary.
- Installable PWA deployed to Cloudflare Pages.
- Sim engine pure + unit-tested; balance harness stub in place.

**Acceptance:** On a phone, a new player can install it, play a burst, go offline, return to safe
growth, push their luck, collapse, read a coherent post-mortem, and start a fresh world — with no
network required. Sim unit tests green; a 1,000-run harness pass produces a non-degenerate
turns-survived distribution.

### Milestone 2 — Prestige & meta-progression

- Genesis Seeds yield on collapse/Ascension; meta-upgrade shop; Seed-gated Archetype unlocks.
- Add 2 Archetypes (**Frozen**, **Volcanic**).
- Persistent stats; "Begin New World → Ascend" fully wired.

**Acceptance:** progress compounds across runs; a returning player is measurably stronger; harness
shows Seeds/run rising with policy skill.

### Milestone 3 — Synthesis & Codex

- Two-slot combine, `recipes.json`, catalysts, lifeforms, Codex (persistent).
- Cards/machines that grant combinable resources; discoveries unlock content.

**Acceptance:** discovering a recipe unlocks a usable machine/catalyst/card; Codex persists across runs.

### Milestone 4 — The AI chronicler (real LLM)

- Cloudflare Worker `POST /api/narrate` → Workers AI; CORS + validation + timeout + rate heuristic.
- Client flips the flag from templated to live, keeping the fallback path.

**Acceptance:** a real collapse yields a ≤120-word, cause-accurate chronicle in <~4s; killing the
Worker cleanly falls back to templates with no user-visible error.

### Milestone 5 — Depth & polish

- More cards/archetypes/recipes; audio/haptics; animation polish; onboarding; balance pass driven by
  the harness + real playtests.

### Milestone 6 _(optional, deferred)_ — Cloud save & leaderboards

- Only if wanted. D1/Durable Objects on the free tier; the save layer was built cloud-swappable in M1.

---

## 8. Risks & open questions

- **Difficulty/fairness of permadeath.** Mitigated by Instability (no cheap one-card deaths) and the
  offline-safety rule. Tune with the harness; consider an early "grace" era.
- **Making offline rewarding without trivializing active play.** Offline gives resources + safe drift
  but **no Era progress and no discoveries** (those require active turns) — keeps reasons to open the
  app. Validate in playtest.
- **LLM tone consistency / latency.** Small model + tight prompt + word cap + trim; always have the
  templated fallback. Cache identical CollapseReports if ever needed.
- **iOS PWA limits.** v1 avoids push and any iOS-restricted API. Revisit if we want re-engagement pings.
- **Content scale.** Data-driven JSON + zod validation keeps content growth cheap and safe.
- **Scope creep from the mash-up.** M1 deliberately ships _without_ synthesis or prestige to prove the
  core loop first.

~~Open for Cory~~ **Resolved 2026-07-13:**

1. **Name:** keep **TerraTouch**. **Tone: bittersweet blend** — play feels cozy and hopeful; the
   Chronicle writes elegiac, wistful obituaries. Losing a world should sting a little; that contrast
   is the emotional hook. Card copy leans warm; loss narration leans mournful.
2. **Energy cadence:** target **~5 minutes** per active burst (~10–15 card draws plus building) —
   tune Energy cap/regen in `balance.json` toward this.
3. **Monetization:** **pure free / portfolio.** No monetization ever; tune the prestige economy
   purely for fun.

---

## 9. How Claude Code should start

1. Scaffold the monorepo (`app/` Vite+React+TS+PWA, `worker/` wrangler) per §4.2.
2. Build `app/src/sim/` **first**, as pure functions with unit tests — the four systems, tick,
   collapse, offline catch-up — before any UI. This is the spine; get it deterministic and green.
3. Wire the Zustand store + IndexedDB persistence with `schemaVersion: 1`.
4. Build the four screens minimally; make the Planet + Cards loop playable.
5. Ship Milestone 1 to Cloudflare Pages; run it on an actual phone; iterate on feel with the harness.
6. Only then proceed to M2+.

Keep all rules in `sim/` and all content in `data/*.json`. Do not read wall-clock time inside sim
functions — always pass deltas in. Determinism is the feature that makes everything else testable.
