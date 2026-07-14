// rng.ts — mulberry32 seeded PRNG (SPEC §5.2), explicit-state style.
// All randomness in the sim flows through the run's seed via this module.
// State is a plain uint32 stored on RunState (`rngState`) so saves and
// replays are byte-identical: same seed + same actions ⇒ identical run.

export type RngResult = { state: number; value: number }

/** Initial rng state for a run seed. */
export function seedRng(seed: number): number {
  return seed >>> 0
}

/** One mulberry32 step. Returns the next state and a float in [0, 1). */
export function nextFloat(state: number): RngResult {
  const a = (state + 0x6d2b79f5) | 0
  const nextState = a
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296
  return { state: nextState, value }
}

/** Uniform integer in [0, n). n must be a positive integer. */
export function nextInt(state: number, n: number): RngResult {
  const r = nextFloat(state)
  return { state: r.state, value: Math.floor(r.value * n) }
}

/**
 * Weighted pick: returns the chosen index. Weights must be non-negative and
 * sum to > 0.
 */
export function pickWeighted(state: number, weights: readonly number[]): RngResult {
  let total = 0
  for (const w of weights) total += w
  const r = nextFloat(state)
  let roll = r.value * total
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i]!
    if (roll < 0) return { state: r.state, value: i }
  }
  // Floating-point edge: fall back to the last positively-weighted entry.
  for (let i = weights.length - 1; i >= 0; i--) {
    if (weights[i]! > 0) return { state: r.state, value: i }
  }
  return { state: r.state, value: weights.length - 1 }
}
