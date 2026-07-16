// fixtures.ts — a small, fully-controlled Content bundle for sim unit tests.
// Real shipped content is exercised by content.test.ts and the balance
// harness; these fixtures exist so tests can pin exact numbers.

import type { Content, RunState } from '../src/sim/types'
import { newRun } from '../src/sim/actions'

export function makeTestContent(overrides: Partial<Content> = {}): Content {
  const content: Content = {
    balance: {
      energy: { cap: 10, regenPerSec: 0.02, drawCost: 1, reserve: 3 },
      tap: { baseRatePerSec: 1, bonusMult: 1.5, poolCapSec: 100 },
      phenomena: { meanSpacingSec: 60, windowSec: 12 },
      pulse: { periodSec: 4, onBeatMult: 1.6 },
      instability: {
        accrualPerSystemPerTurn: 10,
        decayPerTurn: 5,
        cascadeThreshold: 100,
      },
      setpoint: { min: 2, max: 98 },
      era: { progressDecayMult: 1 },
      offline: { maxHours: 8, productionMult: 1 },
      cards: { recentExclusion: 2 },
      prestige: {
        eraWeight: 2,
        habDivisor: 25,
        collapseMult: 0.5,
        ascensionBonus: 5,
        // cap 0 = efficiency bonus off, so fixture tests keep pinning the
        // classic formula; prestige.test.ts opts in via overrides.
        efficiency: { refTurns: 20, perTurns: 5, cap: 0 },
      },
    },
    eras: [
      {
        id: 'one',
        name: 'One',
        advanceHabitability: 50,
        stabilizationSec: 30,
        volatilityMult: 1,
        bands: {
          thermal: [20, 60],
          atmosphere: [20, 60],
          hydro: [20, 60],
          biosphere: [10, 50],
        },
      },
      {
        id: 'two',
        name: 'Two',
        volatilityMult: 2,
        bands: {
          thermal: [30, 70],
          atmosphere: [30, 70],
          hydro: [30, 70],
          biosphere: [20, 60],
        },
      },
    ],
    archetypes: [
      {
        id: 'test-rock',
        name: 'Test Rock',
        blurb: 'A rock for tests.',
        startingMinerals: 100,
        systems: {
          thermal: {
            start: 40,
            setpoint: 40,
            naturalRest: 25,
            naturalRatePerSec: 0.01,
          },
          atmosphere: {
            start: 40,
            setpoint: 40,
            naturalRest: 25,
            naturalRatePerSec: 0.01,
          },
          hydro: {
            start: 40,
            setpoint: 40,
            naturalRest: 25,
            naturalRatePerSec: 0.01,
          },
          biosphere: {
            start: 30,
            setpoint: 30,
            naturalRest: 15,
            naturalRatePerSec: 0.01,
          },
        },
      },
    ],
    machines: [
      {
        id: 'test-heater',
        name: 'Test Heater',
        blurb: 'Warms things for tests.',
        system: 'thermal',
        baseCost: 10,
        costMult: 2,
        pushRatePerSecPerLevel: 0.05,
        productionPerSecPerLevel: 1,
        maxLevel: 3,
      },
      {
        id: 'test-digester',
        name: 'Test Digester',
        blurb: 'Feeds the biosphere for tests, later.',
        system: 'biosphere',
        baseCost: 10,
        costMult: 2,
        pushRatePerSecPerLevel: 0.05,
        productionPerSecPerLevel: 0.5,
        maxLevel: 3,
        unlockEra: 2,
      },
    ],
    upgrades: [
      {
        id: 'flywheel',
        name: 'Flywheel',
        blurb: 'Faster machines for tests.',
        baseCost: 2,
        costMult: 2,
        maxLevel: 2,
        effect: { kind: 'machine-push-mult', perLevel: 0.5 },
      },
      {
        id: 'calm',
        name: 'Calm',
        blurb: 'Gentler instability for tests.',
        baseCost: 2,
        costMult: 2,
        maxLevel: 1,
        effect: { kind: 'instability-accrual-mult', perLevel: 0.5 },
      },
      {
        id: 'cache',
        name: 'Cache',
        blurb: 'Head-start minerals for tests.',
        baseCost: 2,
        costMult: 2,
        maxLevel: 3,
        effect: { kind: 'starting-minerals', perLevel: 10 },
      },
      {
        id: 'battery',
        name: 'Battery',
        blurb: 'Bigger energy tank for tests.',
        baseCost: 3,
        costMult: 2,
        maxLevel: 2,
        effect: { kind: 'energy-cap', perLevel: 5 },
      },
      {
        id: 'orbit',
        name: 'Orbit',
        blurb: 'Longer offline window for tests.',
        baseCost: 2,
        costMult: 2,
        maxLevel: 4,
        effect: { kind: 'offline-cap-hours', perLevel: 4 },
      },
    ],
    cards: [
      {
        id: 'nudge',
        title: 'Nudge',
        text: 'A gentle nudge.',
        eras: [1, 2],
        weight: 10,
        left: { label: 'Cool', effects: { systems: { thermal: -5 } } },
        right: { label: 'Warm', effects: { systems: { thermal: 5 } } },
      },
      {
        id: 'windfall',
        title: 'Windfall',
        text: 'Free stuff.',
        eras: [1, 2],
        weight: 10,
        left: { label: 'Minerals', effects: { minerals: 20 } },
        right: { label: 'Calm', effects: { instability: -10 } },
      },
      {
        id: 'haymaker',
        title: 'Haymaker',
        text: 'A big swing.',
        eras: [1, 2],
        weight: 10,
        left: { label: 'Deep freeze', effects: { systems: { thermal: -100 } } },
        right: { label: 'Flash boil', effects: { systems: { thermal: 100 } } },
      },
      {
        id: 'late-only',
        title: 'Late Only',
        text: 'Only appears in era two.',
        eras: [2, 2],
        weight: 10,
        left: { label: 'A', effects: {} },
        right: { label: 'B', effects: {} },
      },
      {
        id: 'other-world',
        title: 'Other World',
        text: 'Only for a different archetype.',
        eras: [1, 2],
        archetypes: ['not-test-rock'],
        weight: 10,
        left: { label: 'A', effects: {} },
        right: { label: 'B', effects: {} },
      },
    ],
    // Empty pool = the phenomena engine stays dormant in every existing
    // fixture test; phenomena tests opt in via overrides.
    phenomena: [],
    ...overrides,
  }
  return content
}

export function makeRun(content: Content, seed = 42): RunState {
  return newRun(content, seed, content.archetypes[0]!.id)
}
