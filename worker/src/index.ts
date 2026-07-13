// POST /api/narrate — the AI chronicler endpoint (SPEC §5.4).
//
// Milestone 4 stub: routing, CORS, and method handling are wired; the actual
// Workers AI call returns 501 until M4 flips it on. The client MUST treat any
// non-200 as a signal to use its local templated fallback, so this stub is
// safe to deploy at any time.
//
// M4 responsibilities (SPEC §5.4): validate the CollapseReport, call
// env.AI.run() behind a single generate() function (provider-swappable),
// trim to the 120-word cap, strip markdown/control chars, enforce a timeout,
// lock CORS to the Pages origin, and apply a cheap per-IP rate heuristic.

export interface Env {
  AI: Ai
  ALLOWED_ORIGIN: string
}

const corsHeaders = (env: Env) => ({
  'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
})

const json = (env: Env, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  })

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) })
    }

    if (url.pathname === '/api/narrate') {
      if (request.method !== 'POST') {
        return json(env, 405, { error: 'method not allowed' })
      }
      // M4: parse { report: CollapseReport }, validate, generate chronicle.
      return json(env, 501, {
        error: 'narration not implemented yet — use the templated fallback',
      })
    }

    return json(env, 404, { error: 'not found' })
  },
} satisfies ExportedHandler<Env>
