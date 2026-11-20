// Seeded randomness for src/ascent. Everything random in the surface model and the lottery
// scenario comes from pure-rand, so the same seed always gives the same run.
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';
import { uniformInt } from 'pure-rand/distribution/uniformInt';
import type { JumpableRandomGenerator } from 'pure-rand/types/JumpableRandomGenerator';

export class Rng {
  private readonly g: JumpableRandomGenerator;
  constructor(seed: number) {
    this.g = xoroshiro128plus(subSeed(seed, 0x51ed));
    // Small seeds give correlated first outputs; burn a few.
    for (let i = 0; i < 8; i++) this.float();
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
    const u = 1 - this.float();
    const v = this.float();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** A copy of `items` in random order (Fisher-Yates). */
  shuffled<T>(items: readonly T[]): T[] {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
  bytes(n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.int(0, 255);
    return out;
  }
}

/** Mix a base seed with a small integer so streams for different jobs do not overlap. */
export function subSeed(base: number, salt: number): number {
  let x = (Math.imul(base | 0, 0x9e3779b1) ^ Math.imul((salt | 0) + 0x7f4a7c15, 0x85ebca6b)) | 0;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return (x ^ (x >>> 15)) | 0;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
