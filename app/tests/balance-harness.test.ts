// balance-harness.test.ts — the auto-play balance harness as a required CI
// check (SPEC §6, M1 acceptance): a 1,000-run pass per policy must produce a
// non-degenerate turns-survived distribution. `npm run harness` runs this
// file alone and prints the full report; HARNESS_RUNS overrides the count.
import { describe, expect, it } from 'vitest'
import { loadContent } from '../src/data'
import { formatReport, runMany, runOne, type HarnessReport } from './harness'

const RUNS = Number(process.env['HARNESS_RUNS'] ?? 1000)
const content = loadContent()

describe(`balance harness (${RUNS} runs per policy)`, () => {
  const reports: HarnessReport[] = []

  it('random policy: non-degenerate distribution', () => {
    const report = runMany(content, { runs: RUNS, policy: 'random' })
    reports.push(report)
    console.log(formatReport(report, content))
    expect(report.turns.distinct).toBeGreaterThanOrEqual(8)
    expect(report.turns.stddev).toBeGreaterThan(2)
    // Random play must actually be able to lose — permadeath is real.
    expect(
      report.outcomes['hard-fail'] + report.outcomes.cascade,
    ).toBeGreaterThan(RUNS * 0.5)
  })

  it('greedy-safe policy: dies far less often than random', () => {
    const report = runMany(content, { runs: RUNS, policy: 'greedy-safe' })
    reports.push(report)
    console.log(formatReport(report, content))
    const random = reports.find((r) => r.policy === 'random')!
    // Since Ascension ends winning runs early, longevity is measured by how
    // rarely a run DIES, not by turn medians (a cashed-out run is short on
    // purpose). Safe play must die at under a quarter of random's rate.
    const deaths = (r: HarnessReport) =>
      r.outcomes['hard-fail'] + r.outcomes.cascade
    expect(deaths(report)).toBeLessThan(deaths(random) * 0.25)
    expect(report.turns.distinct).toBeGreaterThanOrEqual(8)
  })

  it('greedy-progress policy: reaches later eras than random', () => {
    const report = runMany(content, { runs: RUNS, policy: 'greedy-progress' })
    reports.push(report)
    console.log(formatReport(report, content))
    const reachedEra2 = Object.entries(report.eraHistogram)
      .filter(([era]) => Number(era) >= 1)
      .reduce((a, [, n]) => a + n, 0)
    // Era 1→2 transition is core M1 scope: skilled play must get there.
    expect(reachedEra2).toBeGreaterThan(RUNS * 0.2)
    expect(report.turns.distinct).toBeGreaterThanOrEqual(8)
  })

  it('attentive policy: attention pays in Seeds per turn AND per run', () => {
    const report = runMany(content, { runs: RUNS, policy: 'attentive' })
    reports.push(report)
    console.log(formatReport(report, content))
    const safe = reports.find((r) => r.policy === 'greedy-safe')!
    // Attention pays twice: a faster prestige cycle (Seeds per TURN — the
    // slice-A bar) and, since the Ascension efficiency bonus (issue #28),
    // more Seeds per RUN — faster era climbs arrive at the final era
    // sooner, which is exactly what the bonus pays. Before the bonus the
    // per-run comparison dead-tied at the saturated ~19-Seed ceiling
    // (attentive 18.57 vs safe 18.58); both comparisons are UNROUNDED.
    expect(report.meanSeeds / report.turns.mean).toBeGreaterThan(
      safe.meanSeeds / safe.turns.mean,
    )
    expect(report.meanSeeds).toBeGreaterThan(safe.meanSeeds)
    expect(report.turns.distinct).toBeGreaterThanOrEqual(8)
  })

  it('seeds/run rises with policy skill (SPEC M2 acceptance)', () => {
    const random = reports.find((r) => r.policy === 'random')!
    const safe = reports.find((r) => r.policy === 'greedy-safe')!
    const progress = reports.find((r) => r.policy === 'greedy-progress')!
    // Rising with skill: each skilled policy banks a MULTIPLE of what random
    // flailing earns. (The two greedy styles are different play styles, not
    // a skill ladder relative to each other — safe cashes out reliably,
    // progress rushes and sometimes busts — so no ordering between them.)
    expect(safe.meanSeeds).toBeGreaterThan(random.meanSeeds * 3)
    expect(progress.meanSeeds).toBeGreaterThan(random.meanSeeds * 3)
    // The max-yield path is real: both skilled styles actually Ascend.
    expect(safe.outcomes.ascended).toBeGreaterThan(0)
    expect(progress.outcomes.ascended).toBeGreaterThan(0)
  })

  it('no single system owns the cascade blame (issue #3 success bar)', () => {
    // Pre-Spore-Garden, biosphere owned ~95% of greedy-progress cascades.
    // Pool cascades across all policies and require an actual spread.
    const blame: Record<string, number> = {}
    let total = 0
    for (const r of reports) {
      for (const [sys, n] of Object.entries(r.cascadeSystems)) {
        blame[sys] = (blame[sys] ?? 0) + n
        total += n
      }
    }
    expect(total).toBeGreaterThan(0)
    for (const [sys, n] of Object.entries(blame)) {
      expect(
        n / total,
        `${sys} owns ${Math.round((n / total) * 100)}% of cascade blame`,
      ).toBeLessThan(0.6)
    }
  })

  it('both collapse kinds occur across policies', () => {
    const hard = reports.reduce((a, r) => a + r.outcomes['hard-fail'], 0)
    const cascade = reports.reduce((a, r) => a + r.outcomes.cascade, 0)
    expect(hard).toBeGreaterThan(0)
    expect(cascade).toBeGreaterThan(0)
  })

  it('runs are reproducible: same seed + policy ⇒ identical result', () => {
    const a = runOne(content, 12345, 'greedy-safe')
    const b = runOne(content, 12345, 'greedy-safe')
    expect(a).toEqual(b)
    const c = runOne(content, 12345, 'attentive')
    const d = runOne(content, 12345, 'attentive')
    expect(c).toEqual(d)
  })
})
