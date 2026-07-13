# TerraTouch

A mobile-first, touch-first terraforming clicker/roguelike PWA. You raise a
dead world toward habitability one swipe at a time — and when it collapses,
an AI chronicler writes the obituary of your planet.

- **[SPEC.md](SPEC.md)** — the full design spec (source of truth)
- **[CLAUDE.md](CLAUDE.md)** — orientation + hard rules for coding agents

## Layout

| Dir | What | Deploys to |
|---|---|---|
| [`app/`](app/) | React + Vite + TS PWA (sim engine, UI, persistence) | Cloudflare Pages |
| [`worker/`](worker/) | Loss-narration endpoint (`POST /api/narrate` → Workers AI) | Cloudflare Workers |

## Develop

```sh
npm --prefix app install
npm --prefix app run dev        # dev server
npm --prefix app test           # vitest
npm --prefix app run build      # typecheck + build → app/dist

npm --prefix worker install
npm --prefix worker run dev     # wrangler dev
```

The app is a complete, playable game with zero backend; the Worker only
writes the loss story and always has a local templated fallback.
