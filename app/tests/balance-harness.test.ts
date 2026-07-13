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
    expect(report.outcomes['hard-fail'] + report.outcomes.cascade).toBeGreaterThan(RUNS * 0.5)
  })

  it('greedy-safe policy: survives longer than random', () => {
    const report = runMany(content, { runs: RUNS, policy: 'greedy-safe' })
    reports.push(report)
    console.log(formatReport(report, content))
    const random = reports.find((r) => r.policy === 'random')!
    expect(report.turns.median).toBeGreaterThan(random.turns.median)
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
  })
})
