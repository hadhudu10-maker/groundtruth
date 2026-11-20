// Seeded randomness for the Hollow. Every random draw in src/sim goes through here, and every
// draw comes from pure-rand, so the same seed and the same script always give the same run.
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import type { JumpableRandomGenerator } from 'pure-rand/types/JumpableRandomGenerator';

/** One independent stream of random numbers. Mutable: each call moves it forward. */
export class Stream {
  private readonly g: JumpableRandomGenerator;
  constructor(g: JumpableRandomGenerator) {
    this.g = g;
  }
  /** Uniform in [0, 1). */
  float(): number {
    return uniformFloat64(this.g);
  }
  /** Uniform integer in [from, to], both included. */
  int(from: number, to: number): number {
    return uniformInt(this.g, from, to);
  }
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.float();
  }
  chance(p: number): boolean {
    return this.float() < p;
  }
  /** Standard normal, Box-Muller. */
  normal(): number {
    const u = 1 - this.float(); // (0, 1]
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** Poisson count with the given mean. Exact for small means, normal approximation above 40. */
  poisson(mean: number): number {
    if (!(mean > 0)) return 0;
    if (mean > 40) return Math.max(0, Math.round(mean + Math.sqrt(mean) * this.normal()));
    const limit = Math.exp(-mean);
    let k = 0;
    let p = this.float();
    while (p > limit) {
      k++;
      p *= this.float();
    }
    return k;
  }
  /** Binomial(n, p), drawn as a Poisson capped at n. Good enough for small p. */
  binomial(n: number, p: number): number {
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return n;
    if (n * p > 40 && n * (1 - p) > 40) {
      const mean = n * p;
      const sd = Math.sqrt(mean * (1 - p));
      return Math.min(n, Math.max(0, Math.round(mean + sd * this.normal())));
    }
    if (n <= 64) {
      let k = 0;
      for (let i = 0; i < n; i++) if (this.float() < p) k++;
      return k;
    }
    return Math.min(n, this.poisson(n * p));
  }
}

/** The named streams the engine uses. Separate streams keep subsystems from disturbing each other. */
export const STREAM_NAMES = ['setup', 'power', 'water', 'sick', 'hazard', 'notes', 'keys'] as const;
export type StreamName = (typeof STREAM_NAMES)[number];
export type Streams = Record<StreamName, Stream>;

/**
 * Build one stream per subsystem from a single seed. Each stream starts a whole jump apart
 * (2^64 steps), so adding draws to one subsystem never shifts the numbers another one sees.
 */
export function makeStreams(seed: number): Streams {
  const base = xoroshiro128plus(seed | 0);
  const out = {} as Streams;
  for (const name of STREAM_NAMES) {
    out[name] = new Stream(base.clone());
    base.jump();
  }
  return out;
}
