// narrate.ts — POST CollapseReport → { chronicle } with a ~4s timeout and a
// LOCAL TEMPLATED FALLBACK keyed by cause.kind/system/direction (SPEC §5.4).
// A failed/absent network call must never block the loss screen.
//
// M1 ships with the LLM flag OFF (VITE_NARRATE_LLM !== 'true'): the template
// is the narration. Milestone 4 flips the flag; the fallback path stays.

import type { CollapseReport } from '../sim/types'
import { templatedChronicle } from './templates'

const TIMEOUT_MS = 4_000
const MAX_WORDS = 120

export type Narration = { chronicle: string; source: 'llm' | 'template' }

function llmEnabled(): boolean {
  return (
    import.meta.env['VITE_NARRATE_LLM'] === 'true' &&
    typeof import.meta.env['VITE_NARRATE_URL'] === 'string'
  )
}

/** Trim/limit whatever a model returns to plain, capped prose. */
function sanitize(text: string): string {
  const words = text.replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().split(' ')
  return words.slice(0, MAX_WORDS).join(' ')
}

export async function narrate(report: CollapseReport): Promise<Narration> {
  if (llmEnabled()) {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      const res = await fetch(import.meta.env['VITE_NARRATE_URL'] as string, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ report }),
        signal: controller.signal,
      })
      clearTimeout(timer)
      if (res.ok) {
        const data = (await res.json()) as { chronicle?: unknown }
        if (typeof data.chronicle === 'string' && data.chronicle.trim().length > 0) {
          return { chronicle: sanitize(data.chronicle), source: 'llm' }
        }
      }
    } catch {
      // fall through to the template — the loss screen never blocks on us
    }
  }
  return { chronicle: templatedChronicle(report), source: 'template' }
}
