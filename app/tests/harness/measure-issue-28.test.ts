// measure-issue-28.test.ts — THROWAWAY measurement rig for issue #28
// (Seed yield saturates at Ascension). Never merge this file. It prototypes
// the three candidate remedies as post-hoc yield recomputations over
// instrumented harness runs, so all candidates are compared on identical
// seeded worlds. Run with:
//   npx vitest run tests/harness/measure-issue-28.test.ts --disable-console-intercept
import { describe, expect, it } from 'vitest'
import { loadContent } from '../../src/data'
import {
  ascend,
  buildOrUpgrade,
  machineCost,
  machineOfType,
  machineUnlocked,
  newRun,
  setSetpoint,
  tapCollect,
} from '../../src/sim/actions'
import { canDraw, drawCard, resolveCard } from '../../src/sim/cards'
import { applyOffline } from '../../src/sim/offline'
import { catchPhenomenon } from '../../src/sim/phenomena'
import { canAscend } from '../../src/sim/prestige'
import { nextFloat, seedRng } from '../../src/sim/rng'
import { habitability, inBand } from '../../src/sim/systems'
import { tick } from '../../src/sim/tick'
import { SYSTEM_IDS, type Content, type RunState } from '../../src/sim/types'
import { runOne, type PolicyName } from './index'

const content = loadContent()
const RUNS = Number(process.env['HARNESS_RUNS'] ?? 1000)
const FINAL_ERA = content.eras.length - 1

type InstrumentedResult = {
  seed: number
  turns: number
  era: number
  peakHabitability: number
  outcome: 'hard-fail' | 'cascade' | 'ascended' | 'survived'
  seeds: number
  causeSystem?: string
  cascade: boolean
  /** Active turns (cards resolved) taken while at the final era. */
  postFinalTurns: number
  /** Of those, turns ending with all four systems in band. */
  postFinalInBandTurns: number
  /** Turns it took to first reach the final era (= turns − postFinalTurns). */
  turnsToFinalEra: number
}

/** Score for greedy-safe: verbatim from tests/harness/index.ts. */
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

function progressScore(run: RunState): number {
  return habitability(run.systems) - run.instability * 0.3
}

/**
 * Verbatim copy of runOne from tests/harness/index.ts with two additions:
 *  - lingerTurns: with L > 0, a skilled bot that could Ascend keeps playing
 *    until it has taken L active turns AT the final era, then Ascends.
 *  - postFinal counters: turns at the final era, and how many of them ended
 *    with all four systems inside their bands (the remedy-A credit input).
 * With lingerTurns = 0 this must reproduce runOne exactly (asserted below).
 */
function runInstrumented(
  seed: number,
  policy: PolicyName,
  lingerTurns = 0,
): InstrumentedResult {
  const maxTurns = 300
  const secondsPerTurn = policy === 'attentive' ? 20 : 19
  const mistakeRate = 0.15
  let run: RunState = newRun(content, seed, content.archetypes[0]!.id)
  let botState = seedRng(seed ^ 0x9e3779b9)
  const rand = () => {
    const r = nextFloat(botState)
    botState = r.state
    return r.value
  }

  const buyPriority = content.machines.map((m) => m.id)
  let postFinalTurns = 0
  let postFinalInBandTurns = 0

  while (!run.collapse && run.turns < maxTurns) {
    run = tick(run, content, secondsPerTurn)
    if (policy === 'attentive') run = catchPhenomenon(run, content).run
    run = tapCollect(run, content).run

    if (
      policy !== 'random' &&
      canAscend(run, content) &&
      postFinalTurns >= lingerTurns
    ) {
      run = ascend(run, content)
      break
    }

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
      const reserve =
        policy === 'greedy-safe' || policy === 'attentive' ? 20 : 0
      for (const typeId of buyPriority) {
        const def = content.machines.find((m) => m.id === typeId)!
        if (!machineUnlocked(run, def)) continue
        const level = machineOfType(run, typeId)?.level ?? 0
        if (level >= def.maxLevel) continue
        const cost = machineCost(def, level + 1)
        if (run.resources.minerals - cost >= reserve) {
          run = buildOrUpgrade(run, content, typeId)
        }
      }
      for (const m of run.machines) {
        const def = content.machines.find((d) => d.id === m.typeId)!
        const [lo, hi] = run.systems[def.system].band
        run = setSetpoint(run, content, def.system, (lo + hi) / 2)
      }
    }

    if (!run.collapse && run.energy < content.balance.energy.drawCost) {
      const refillSec =
        content.balance.energy.cap / content.balance.energy.regenPerSec
      run = applyOffline(run, content, refillSec * 1000).run
    }

    if (!canDraw(run, content)) continue

    const eraAtDraw = run.era
    const { run: drawn } = drawCard(run, content)
    const left = resolveCard(drawn, content, 'left')
    const right = resolveCard(drawn, content, 'right')

    if (policy === 'random') {
      run = rand() < 0.5 ? left.run : right.run
    } else {
      const preferLeft =
        policy === 'greedy-safe' || policy === 'attentive'
          ? safetyScore(left.run) <= safetyScore(right.run)
          : progressScore(left.run) >= progressScore(right.run)
      const mistake = rand() < mistakeRate
      run = preferLeft !== mistake ? left.run : right.run
    }

    if (eraAtDraw === FINAL_ERA) {
      postFinalTurns++
      if (SYSTEM_IDS.every((id) => inBand(run.systems[id]))) {
        postFinalInBandTurns++
      }
    }
  }

  const outcome: InstrumentedResult['outcome'] = !run.collapse
    ? 'survived'
    : run.collapse.cause.kind === 'ascension'
      ? 'ascended'
      : run.collapse.cause.kind
  return {
    seed,
    turns: run.turns,
    era: run.era,
    peakHabitability: run.history.peakHabitability,
    outcome,
    seeds: run.collapse?.seedsAwarded ?? 0,
    causeSystem:
      outcome === 'hard-fail' || outcome === 'cascade'
        ? run.collapse?.cause.system
        : undefined,
    cascade: outcome === 'cascade',
    postFinalTurns,
    postFinalInBandTurns,
    turnsToFinalEra: run.turns - postFinalTurns,
  }
}

// ---------------------------------------------------------------------------
// Candidate yield formulas, recomputed post-hoc from InstrumentedResult.
// ---------------------------------------------------------------------------

const P = content.balance.prestige

/** Reimplementation of today's formula (sanity-checked against banked). */
function yieldCurrent(r: InstrumentedResult): number {
  if (r.outcome === 'survived') return 0
  const base =
    r.era * P.eraWeight + Math.floor(r.peakHabitability / P.habDivisor)
  if (r.outcome === 'ascended') return base + P.ascensionBonus
  return Math.max(0, Math.floor(base * P.collapseMult))
}

/** Remedy B: continuous habitability term with divisor d, rounded at award. */
function yieldB(r: InstrumentedResult, habDivisor: number): number {
  if (r.outcome === 'survived') return 0
  const base = r.era * P.eraWeight + r.peakHabitability / habDivisor
  if (r.outcome === 'ascended') return Math.round(base) + P.ascensionBonus
  return Math.max(0, Math.floor(base * P.collapseMult))
}

/** Remedy C: efficiency bonus on Ascension, scaled by turns-to-Ascension. */
function yieldC(
  r: InstrumentedResult,
  refTurns: number,
  divisor: number,
  cap: number,
): number {
  const cur = yieldCurrent(r)
  if (r.outcome !== 'ascended') return cur
  const bonus = Math.min(
    cap,
    Math.max(0, Math.floor((refTurns - r.turns) / divisor)),
  )
  return cur + bonus
}

/**
 * Remedy C′: same efficiency bonus but keyed to turns-to-REACH the final era
 * (locked at arrival), so lingering afterwards never erodes it — compatible
 * with cozy staying-and-tending in a way plain C is not.
 */
function yieldCArrival(
  r: InstrumentedResult,
  refTurns: number,
  divisor: number,
  cap: number,
): number {
  const cur = yieldCurrent(r)
  if (r.outcome !== 'ascended') return cur
  const bonus = Math.min(
    cap,
    Math.max(0, Math.floor((refTurns - r.turnsToFinalEra) / divisor)),
  )
  return cur + bonus
}

/** Remedy A: linger credit — +1 Seed per N in-band final-era turns, capped. */
function yieldA(
  r: InstrumentedResult,
  perTurns: number,
  cap: number,
  mode: 'asc-only' | 'in-base',
): number {
  const cur = yieldCurrent(r)
  const bonus = Math.min(cap, Math.floor(r.postFinalInBandTurns / perTurns))
  if (r.outcome === 'ascended') return cur + bonus
  if (r.outcome === 'survived') return cur
  // collapse: 'in-base' halves the credit like the rest of base; 'asc-only'
  // forfeits it entirely (all-or-nothing linger risk).
  return mode === 'in-base' ? cur + Math.floor(bonus * P.collapseMult) : cur
}

// ---------------------------------------------------------------------------
// Reporting helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

function hist(xs: number[]): string {
  const h: Record<number, number> = {}
  for (const x of xs) h[x] = (h[x] ?? 0) + 1
  return Object.entries(h)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, n]) => `${k}:${((n / xs.length) * 100).toFixed(1)}%`)
    .join(' ')
}

function policyStats(
  results: InstrumentedResult[],
  yieldFn: (r: InstrumentedResult) => number,
) {
  const seeds = results.map(yieldFn)
  const turns = results.map((r) => r.turns)
  const asc = results.filter((r) => r.outcome === 'ascended')
  const deaths = results.filter(
    (r) => r.outcome === 'hard-fail' || r.outcome === 'cascade',
  )
  return {
    meanSeeds: mean(seeds),
    meanTurns: mean(turns),
    seedsPerTurn: mean(seeds) / mean(turns),
    deathRate: deaths.length / results.length,
    ascRate: asc.length / results.length,
    ascYieldHist: hist(asc.map(yieldFn)),
    ascMeanPeakHab: asc.length ? mean(asc.map((r) => r.peakHabitability)) : 0,
  }
}

function fmt(label: string, s: ReturnType<typeof policyStats>): string {
  return (
    `  ${label.padEnd(16)} seeds/run=${s.meanSeeds.toFixed(4)} ` +
    `seeds/turn=${s.seedsPerTurn.toFixed(4)} turns=${s.meanTurns.toFixed(1)} ` +
    `deaths=${(s.deathRate * 100).toFixed(1)}% asc=${(s.ascRate * 100).toFixed(1)}%\n` +
    `  ${''.padEnd(16)} asc-yield-hist: ${s.ascYieldHist || '(none)'}`
  )
}

// ---------------------------------------------------------------------------

describe(`issue #28 measurements (${RUNS} runs per cell)`, () => {
  it('instrumented loop reproduces the shipped harness exactly at linger=0', () => {
    for (const policy of [
      'random',
      'greedy-safe',
      'greedy-progress',
      'attentive',
    ] as const) {
      for (let seed = 1; seed <= 100; seed++) {
        const a = runOne(content, seed, policy)
        const b = runInstrumented(seed, policy)
        expect({
          turns: b.turns,
          era: b.era,
          peakHabitability: b.peakHabitability,
          outcome: b.outcome,
          seeds: b.seeds,
        }).toEqual({
          turns: a.turns,
          era: a.era,
          peakHabitability: a.peakHabitability,
          outcome: a.outcome,
          seeds: a.seeds,
        })
      }
    }
  })

  it('post-hoc current-yield formula matches banked seedsAwarded', () => {
    for (const policy of ['greedy-safe', 'attentive', 'random'] as const) {
      for (let seed = 1; seed <= 200; seed++) {
        const r = runInstrumented(seed, policy)
        expect(yieldCurrent(r)).toBe(r.seeds)
      }
    }
  })

  it('measures baseline + remedies A/B/C', () => {
    const policies = [
      'random',
      'greedy-safe',
      'greedy-progress',
      'attentive',
    ] as const

    // --- Baseline runs (linger 0) --------------------------------------
    const base: Record<string, InstrumentedResult[]> = {}
    for (const p of policies) {
      base[p] = Array.from({ length: RUNS }, (_, i) =>
        runInstrumented(1 + i, p),
      )
    }

    console.log(`\n=== BASELINE (current formula, linger 0) ===`)
    for (const p of policies) console.log(fmt(p, policyStats(base[p]!, yieldCurrent)))

    // peakHab spread among ascended runs — the raw material remedy B bins.
    for (const p of ['greedy-safe', 'attentive'] as const) {
      const asc = base[p]!.filter((r) => r.outcome === 'ascended')
      const habs = asc.map((r) => r.peakHabitability).sort((a, b) => a - b)
      console.log(
        `  ${p} ascended peakHab: min=${habs[0]} p25=${habs[Math.floor(habs.length * 0.25)]} ` +
          `median=${habs[Math.floor(habs.length * 0.5)]} p75=${habs[Math.floor(habs.length * 0.75)]} max=${habs[habs.length - 1]} mean=${mean(habs).toFixed(2)}`,
      )
    }

    // --- Remedy B on baseline runs --------------------------------------
    for (const d of [10, 25]) {
      console.log(`\n=== REMEDY B (peakHab/${d}, rounded at award) ===`)
      for (const p of policies) {
        console.log(fmt(p, policyStats(base[p]!, (r) => yieldB(r, d))))
      }
      const att = policyStats(base['attentive']!, (r) => yieldB(r, d))
      const safe = policyStats(base['greedy-safe']!, (r) => yieldB(r, d))
      const rnd = policyStats(base['random']!, (r) => yieldB(r, d))
      const prog = policyStats(base['greedy-progress']!, (r) => yieldB(r, d))
      console.log(
        `  CHECKS attentive>safe/run: ${att.meanSeeds > safe.meanSeeds} (Δ=${(att.meanSeeds - safe.meanSeeds).toFixed(4)}) | ` +
          `attentive>safe/turn: ${att.seedsPerTurn > safe.seedsPerTurn} | ` +
          `safe>3×random: ${safe.meanSeeds > 3 * rnd.meanSeeds} | progress>3×random: ${prog.meanSeeds > 3 * rnd.meanSeeds}`,
      )
    }

    // --- Remedy C on baseline runs --------------------------------------
    for (const [ref, div, cap] of [
      [80, 8, 5],
      [70, 5, 5],
      [90, 10, 5],
    ] as const) {
      console.log(`\n=== REMEDY C (bonus = clamp(⌊(${ref}−turns)/${div}⌋, 0, ${cap}) on Ascension) ===`)
      for (const p of policies) {
        console.log(
          fmt(p, policyStats(base[p]!, (r) => yieldC(r, ref, div, cap))),
        )
      }
      const att = policyStats(base['attentive']!, (r) => yieldC(r, ref, div, cap))
      const safe = policyStats(base['greedy-safe']!, (r) => yieldC(r, ref, div, cap))
      const rnd = policyStats(base['random']!, (r) => yieldC(r, ref, div, cap))
      const prog = policyStats(base['greedy-progress']!, (r) =>
        yieldC(r, ref, div, cap),
      )
      console.log(
        `  CHECKS attentive>safe/run: ${att.meanSeeds > safe.meanSeeds} (Δ=${(att.meanSeeds - safe.meanSeeds).toFixed(4)}) | ` +
          `attentive>safe/turn: ${att.seedsPerTurn > safe.seedsPerTurn} | ` +
          `safe>3×random: ${safe.meanSeeds > 3 * rnd.meanSeeds} | progress>3×random: ${prog.meanSeeds > 3 * rnd.meanSeeds}`,
      )
    }

    // --- Remedy C′ (bonus keyed to arrival at the final era) ------------
    // With linger 0 the bots Ascend on arrival, so C and C′ must coincide.
    for (const p of policies) {
      for (const r of base[p]!) {
        if (yieldC(r, 90, 10, 5) !== yieldCArrival(r, 90, 10, 5)) {
          throw new Error(`C vs C′ mismatch at linger 0, seed ${r.seed}`)
        }
      }
    }
    console.log(`\n=== REMEDY C′ (arrival-keyed) === identical to C at linger 0 (asserted); see linger section for the divergence`)

    // --- Linger runs for remedy A ---------------------------------------
    const lingerPolicies = [
      'greedy-safe',
      'greedy-progress',
      'attentive',
    ] as const
    for (const L of [10, 20, 30]) {
      console.log(`\n=== LINGER RUNS (L=${L} final-era turns before Ascending) ===`)
      const lp: Record<string, InstrumentedResult[]> = {}
      for (const p of lingerPolicies) {
        lp[p] = Array.from({ length: RUNS }, (_, i) =>
          runInstrumented(1 + i, p, L),
        )
      }
      for (const p of lingerPolicies) {
        const rs = lp[p]!
        const s = policyStats(rs, yieldCurrent)
        const reached = rs.filter((r) => r.postFinalTurns > 0)
        const inBandRate =
          mean(reached.map((r) => r.postFinalInBandTurns)) /
          Math.max(1e-9, mean(reached.map((r) => r.postFinalTurns)))
        // Deaths among runs that made it to the final era = linger casualties.
        const lingerDeaths = reached.filter(
          (r) => r.outcome === 'hard-fail' || r.outcome === 'cascade',
        ).length
        console.log(
          `  ${p.padEnd(16)} deaths=${(s.deathRate * 100).toFixed(1)}% asc=${(s.ascRate * 100).toFixed(1)}% ` +
            `turns=${s.meanTurns.toFixed(1)} | reached-final=${reached.length} ` +
            `linger-deaths=${lingerDeaths} (${((lingerDeaths / Math.max(1, reached.length)) * 100).toFixed(1)}% of reached) ` +
            `in-band-rate=${(inBandRate * 100).toFixed(1)}%`,
        )
        const blame: Record<string, number> = {}
        for (const r of rs) {
          if (r.cascade && r.causeSystem)
            blame[r.causeSystem] = (blame[r.causeSystem] ?? 0) + 1
        }
        console.log(
          `  ${''.padEnd(16)} cascade blame: ${JSON.stringify(blame)} | ` +
            `postFinalInBand hist (ascended): ${hist(
              rs.filter((r) => r.outcome === 'ascended').map((r) => r.postFinalInBandTurns),
            )}`,
        )
      }

      for (const [N, cap, mode] of [
        [3, 5, 'in-base'],
        [3, 5, 'asc-only'],
        [2, 10, 'in-base'],
        [4, 6, 'in-base'],
      ] as const) {
        console.log(
          `\n  --- REMEDY A (+1/${N} in-band final-era turns, cap ${cap}, ${mode}) at L=${L} ---`,
        )
        for (const p of lingerPolicies) {
          console.log(
            fmt(p, policyStats(lp[p]!, (r) => yieldA(r, N, cap, mode))),
          )
        }
        const att = policyStats(lp['attentive']!, (r) => yieldA(r, N, cap, mode))
        const safe = policyStats(lp['greedy-safe']!, (r) =>
          yieldA(r, N, cap, mode),
        )
        const prog = policyStats(lp['greedy-progress']!, (r) =>
          yieldA(r, N, cap, mode),
        )
        // Random never lingers: its A yield comes from baseline runs.
        const rnd = policyStats(base['random']!, (r) => yieldA(r, N, cap, mode))
        // EV of lingering vs cashing out now (same policy, same worlds).
        const attNow = policyStats(base['attentive']!, yieldCurrent)
        const safeNow = policyStats(base['greedy-safe']!, yieldCurrent)
        console.log(
          `  CHECKS attentive>safe/run: ${att.meanSeeds > safe.meanSeeds} (Δ=${(att.meanSeeds - safe.meanSeeds).toFixed(4)}) | ` +
            `attentive>safe/turn: ${att.seedsPerTurn > safe.seedsPerTurn} | ` +
            `safe>3×random: ${safe.meanSeeds > 3 * rnd.meanSeeds} | progress>3×random: ${prog.meanSeeds > 3 * rnd.meanSeeds}`,
        )
        console.log(
          `  LINGER EV: attentive ${attNow.meanSeeds.toFixed(3)}→${att.meanSeeds.toFixed(3)} ` +
            `(${att.meanSeeds > attNow.meanSeeds ? 'worth it' : 'TRAP'}) | ` +
            `safe ${safeNow.meanSeeds.toFixed(3)}→${safe.meanSeeds.toFixed(3)} ` +
            `(${safe.meanSeeds > safeNow.meanSeeds ? 'worth it' : 'TRAP'})`,
        )
      }

      // How lingering interacts with the two C flavors (the A/C conflict):
      // plain C's bonus erodes while you linger; C′ locks it at arrival.
      console.log(`\n  --- C vs C′ (90/10/5) on L=${L} linger runs ---`)
      for (const p of lingerPolicies) {
        const plain = policyStats(lp[p]!, (r) => yieldC(r, 90, 10, 5))
        const arrival = policyStats(lp[p]!, (r) => yieldCArrival(r, 90, 10, 5))
        console.log(
          `  ${p.padEnd(16)} plain-C=${plain.meanSeeds.toFixed(3)} C′-arrival=${arrival.meanSeeds.toFixed(3)} ` +
            `(linger cost under plain C: ${(arrival.meanSeeds - plain.meanSeeds).toFixed(3)})`,
        )
      }
      const attArr = policyStats(lp['attentive']!, (r) => yieldCArrival(r, 90, 10, 5))
      const safeArr = policyStats(lp['greedy-safe']!, (r) => yieldCArrival(r, 90, 10, 5))
      console.log(
        `  CHECKS C′ attentive>safe/run on linger runs: ${attArr.meanSeeds > safeArr.meanSeeds} (Δ=${(attArr.meanSeeds - safeArr.meanSeeds).toFixed(4)})`,
      )
    }

    // --- Replication at a second seed base (rule out seed luck) ---------
    console.log(`\n=== REPLICATION (seeds 100001..${100000 + RUNS}) ===`)
    const rep: Record<string, InstrumentedResult[]> = {}
    for (const p of policies) {
      rep[p] = Array.from({ length: RUNS }, (_, i) =>
        runInstrumented(100001 + i, p),
      )
    }
    for (const [label, fn] of [
      ['current', yieldCurrent],
      ['C(80,8,5)', (r: InstrumentedResult) => yieldC(r, 80, 8, 5)],
      ['C(90,10,5)', (r: InstrumentedResult) => yieldC(r, 90, 10, 5)],
    ] as const) {
      const att = policyStats(rep['attentive']!, fn)
      const safe = policyStats(rep['greedy-safe']!, fn)
      const rnd = policyStats(rep['random']!, fn)
      const prog = policyStats(rep['greedy-progress']!, fn)
      console.log(
        `  ${label.padEnd(11)} attentive=${att.meanSeeds.toFixed(4)} safe=${safe.meanSeeds.toFixed(4)} ` +
          `progress=${prog.meanSeeds.toFixed(4)} random=${rnd.meanSeeds.toFixed(4)} | ` +
          `att>safe: ${att.meanSeeds > safe.meanSeeds} (Δ=${(att.meanSeeds - safe.meanSeeds).toFixed(4)}) | ` +
          `ladder: ${safe.meanSeeds > 3 * rnd.meanSeeds && prog.meanSeeds > 3 * rnd.meanSeeds}`,
      )
      if (label !== 'current') {
        console.log(
          `  ${''.padEnd(11)} att-hist: ${att.ascYieldHist}\n` +
            `  ${''.padEnd(11)} safe-hist: ${safe.ascYieldHist}`,
        )
      }
    }

    expect(true).toBe(true)
  })
})
