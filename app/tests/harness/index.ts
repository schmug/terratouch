// tests/harness — headless auto-play balance harness (SPEC §6).
// Runs thousands of seeded runs with simple bot policies and reports
// turns-survived / collapse-cause / Era distributions. Everything here is
// deterministic: bot decisions draw from their own mulberry32 chain, and the
// sim is pure, so a (seed, policy) pair always produces the same run.

import {
  buildOrUpgrade,
  machineCost,
  machineOfType,
  newRun,
  setSetpoint,
  tapCollect,
} from '../../src/sim/actions'
import { canDraw, drawCard, resolveCard } from '../../src/sim/cards'
import { applyOffline } from '../../src/sim/offline'
import { nextFloat, seedRng } from '../../src/sim/rng'
import { habitability } from '../../src/sim/systems'
import { tick } from '../../src/sim/tick'
import { SYSTEM_IDS, type Content, type RunState } from '../../src/sim/types'

export type PolicyName = 'random' | 'greedy-safe' | 'greedy-progress'

export type RunResult = {
  seed: number
  turns: number
  era: number // 0-based era index reached
  peakHabitability: number
  outcome: 'hard-fail' | 'cascade' | 'survived'
  causeSystem?: string
}

export type HarnessOptions = {
  runs: number
  policy: PolicyName
  seedBase?: number
  /** Bot stops after this many turns and counts as 'survived'. */
  maxTurns?: number
  /** Seconds of active play simulated between draws. */
  secondsPerTurn?: number
  /**
   * Chance a greedy policy picks the side its scoring rejects — models
   * imperfect human play; a 0-mistake bot is a full-lookahead oracle and
   * says nothing about how the game feels to people.
   */
  mistakeRate?: number
}

/** Score for greedy-safe: lower is better (stay centered, stay calm). */
function safetyScore(run: RunState): number {
  let score = run.instability * 2
  for (const id of SYSTEM_IDS) {
    const s = run.systems[id]
    const [lo, hi] = s.band
    const mid = (lo + hi) / 2
    const half = (hi - lo) / 2
    if (s.value < lo) score += (lo - s.value) * 5
    else if (s.value > hi) score += (s.value - hi) * 5
    score += Math.abs(s.value - mid) / half
  }
  return score
}

/** Score for greedy-progress: higher is better (chase habitability). */
function progressScore(run: RunState): number {
  return habitability(run.systems) - run.instability * 0.3
}

export function runOne(
  content: Content,
  seed: number,
  policy: PolicyName,
  opts?: Partial<HarnessOptions>,
): RunResult {
  const maxTurns = opts?.maxTurns ?? 300
  const secondsPerTurn = opts?.secondsPerTurn ?? 20
  const mistakeRate = opts?.mistakeRate ?? 0.15
  let run: RunState = newRun(content, seed, content.archetypes[0]!.id)
  let botState = seedRng(seed ^ 0x9e3779b9)
  const rand = () => {
    const r = nextFloat(botState)
    botState = r.state
    return r.value
  }

  const buyPriority = content.machines.map((m) => m.id)

  while (!run.collapse && run.turns < maxTurns) {
    run = tick(run, content, secondsPerTurn)
    run = tapCollect(run, content).run

    // Machine management.
    if (policy === 'random') {
      if (rand() < 0.3) {
        const typeId = buyPriority[Math.floor(rand() * buyPriority.length)]!
        try {
          run = buildOrUpgrade(run, content, typeId)
        } catch {
          /* unaffordable or maxed — skip */
        }
      }
    } else {
      const reserve = policy === 'greedy-safe' ? 20 : 0
      for (const typeId of buyPriority) {
        const def = content.machines.find((m) => m.id === typeId)!
        const level = machineOfType(run, typeId)?.level ?? 0
        if (level >= def.maxLevel) continue
        const cost = machineCost(def, level + 1)
        if (run.resources.minerals - cost >= reserve) {
          run = buildOrUpgrade(run, content, typeId)
        }
      }
      // Steer every machine-backed system toward its band center.
      for (const m of run.machines) {
        const def = content.machines.find((d) => d.id === m.typeId)!
        const [lo, hi] = run.systems[def.system].band
        run = setSetpoint(run, content, def.system, (lo + hi) / 2)
      }
    }

    // Out of energy? Step away and let the world refill safely (also
    // exercises the offline path under harness load).
    if (!run.collapse && run.energy < content.balance.energy.drawCost) {
      const refillSec =
        content.balance.energy.cap / content.balance.energy.regenPerSec
      run = applyOffline(run, content, refillSec * 1000).run
    }

    if (!canDraw(run, content)) continue

    const { run: drawn } = drawCard(run, content)
    const left = resolveCard(drawn, content, 'left')
    const right = resolveCard(drawn, content, 'right')

    if (policy === 'random') {
      run = rand() < 0.5 ? left.run : right.run
    } else {
      const preferLeft =
        policy === 'greedy-safe'
          ? safetyScore(left.run) <= safetyScore(right.run)
          : progressScore(left.run) >= progressScore(right.run)
      const mistake = rand() < mistakeRate
      run = preferLeft !== mistake ? left.run : right.run
    }
  }

  return {
    seed,
    turns: run.turns,
    era: run.era,
    peakHabitability: run.history.peakHabitability,
    outcome: run.collapse ? run.collapse.cause.kind : 'survived',
    causeSystem: run.collapse?.cause.system,
  }
}

export type HarnessReport = {
  policy: PolicyName
  runs: number
  turns: {
    median: number
    p10: number
    p90: number
    mean: number
    stddev: number
    distinct: number
  }
  outcomes: Record<'hard-fail' | 'cascade' | 'survived', number>
  causeSystems: Record<string, number>
  eraHistogram: Record<number, number>
  meanPeakHabitability: number
}

export function runMany(content: Content, opts: HarnessOptions): HarnessReport {
  const seedBase = opts.seedBase ?? 1
  const results: RunResult[] = []
  for (let i = 0; i < opts.runs; i++) {
    results.push(runOne(content, seedBase + i, opts.policy, opts))
  }

  const turns = results.map((r) => r.turns).sort((a, b) => a - b)
  const q = (p: number) =>
    turns[Math.min(turns.length - 1, Math.floor(p * turns.length))]!
  const mean = turns.reduce((a, b) => a + b, 0) / turns.length
  const stddev = Math.sqrt(
    turns.reduce((a, b) => a + (b - mean) ** 2, 0) / turns.length,
  )

  const outcomes = { 'hard-fail': 0, cascade: 0, survived: 0 }
  const causeSystems: Record<string, number> = {}
  const eraHistogram: Record<number, number> = {}
  let peakSum = 0
  for (const r of results) {
    outcomes[r.outcome]++
    if (r.causeSystem)
      causeSystems[r.causeSystem] = (causeSystems[r.causeSystem] ?? 0) + 1
    eraHistogram[r.era] = (eraHistogram[r.era] ?? 0) + 1
    peakSum += r.peakHabitability
  }

  return {
    policy: opts.policy,
    runs: opts.runs,
    turns: {
      median: q(0.5),
      p10: q(0.1),
      p90: q(0.9),
      mean: Math.round(mean * 10) / 10,
      stddev: Math.round(stddev * 10) / 10,
      distinct: new Set(turns).size,
    },
    outcomes,
    causeSystems,
    eraHistogram,
    meanPeakHabitability: Math.round((peakSum / results.length) * 10) / 10,
  }
}

export function formatReport(report: HarnessReport, content: Content): string {
  const pct = (n: number) => `${((n / report.runs) * 100).toFixed(1)}%`
  const eras = Object.entries(report.eraHistogram)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([era, n]) => `${content.eras[Number(era)]?.name ?? era}: ${pct(n)}`)
    .join('  ')
  const causes = Object.entries(report.causeSystems)
    .sort(([, a], [, b]) => b - a)
    .map(([sys, n]) => `${sys}: ${n}`)
    .join('  ')
  return [
    `policy=${report.policy} runs=${report.runs}`,
    `  turns survived: median=${report.turns.median} p10=${report.turns.p10} p90=${report.turns.p90} mean=${report.turns.mean} stddev=${report.turns.stddev} distinct=${report.turns.distinct}`,
    `  outcomes: hard-fail=${pct(report.outcomes['hard-fail'])} cascade=${pct(report.outcomes.cascade)} survived-cap=${pct(report.outcomes.survived)}`,
    `  collapse systems: ${causes || '(none)'}`,
    `  era reached: ${eras}`,
    `  mean peak habitability: ${report.meanPeakHabitability}`,
  ].join('\n')
}
