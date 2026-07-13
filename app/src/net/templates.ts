// templates.ts — the LOCAL templated chronicle (SPEC §5.4), keyed by
// cause.kind/system/direction. This is the M1 narration and the permanent
// fallback: it must always work, offline, instantly, deterministically.
//
// Tone (SPEC §0): elegiac and wistful — losing a world should sting a little.
// Second person, ≤120 words, prose only.

import type { CollapseReport, SystemId } from '../sim/types'

const HARD_FAIL_LINES: Record<SystemId, { low: string; high: string }> = {
  thermal: {
    low: 'The last warmth left quietly, the way warmth does. Your world froze mid-thought, its rivers stopped like clocks.',
    high: 'In the end the sky caught fire and would not let it go. Your world burned beneath a breath it could not exhale.',
  },
  atmosphere: {
    low: 'The sky thinned until it forgot how to hold on. Your world breathed out once, and did not breathe in again.',
    high: 'The air grew thick and bitter, a blanket that became a wall. Your world was smothered by its own abundance.',
  },
  hydro: {
    low: 'The last water left as vapor, unhurried. Your world dried into a map of where rivers might have been.',
    high: 'The waters rose without malice, patient as tide. Your world drowned while it was still learning to swim.',
  },
  biosphere: {
    low: 'The last living thing closed like an eye. Your world went back to being stone, which is a kind of patience.',
    high: 'The green ran wild past every fence you set. Your world was loved to death by its own garden.',
  },
}

const CASCADE_SYSTEM_PHRASE: Record<SystemId, string> = {
  thermal: 'the thermal balance',
  atmosphere: 'the atmosphere',
  hydro: 'the waters',
  biosphere: 'the biosphere',
}

const CLOSING_LINES = [
  'Nothing you built was wasted. It just was not finished.',
  'Somewhere, the dust is already dreaming of the next world.',
  'Let it rest now. Worlds, like seeds, are patient.',
]

/** Build the templated chronicle. Pure and deterministic per report. */
export function templatedChronicle(report: CollapseReport): string {
  const { cause } = report
  const lines: string[] = []

  if (cause.kind === 'hard-fail') {
    lines.push(HARD_FAIL_LINES[cause.system][cause.direction])
  } else {
    const strayed = cause.direction === 'low' ? 'fell behind and kept falling' : 'ran ahead and kept running'
    lines.push(
      `It did not happen all at once. ${capitalize(CASCADE_SYSTEM_PHRASE[cause.system])} ${strayed}, and every small neglect joined hands until the cascade came, like a debt called in.`,
    )
  }

  const turnsPhrase =
    report.turnsSurvived === 1 ? 'a single turn' : `${report.turnsSurvived} turns`
  lines.push(
    `This was a ${report.archetype} world. You carried it as far as the ${report.eraReached} era, through ${turnsPhrase}.`,
  )

  const notable = report.notableStats.slice(0, 2)
  if (notable.length > 0) {
    lines.push(`Remember it honestly: ${notable.join('; ')}.`)
  }

  lines.push(CLOSING_LINES[report.turnsSurvived % CLOSING_LINES.length]!)
  return lines.join(' ')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
