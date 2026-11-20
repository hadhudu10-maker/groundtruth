// The rules for "safe", published BEFORE any reading arrives (problem 13).
// Residents publish SHA-256(rules) in a `commit` note with topic 'surface-rules'. A verdict only
// counts readings recorded after that commit, so nobody can pick thresholds after seeing the data.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { SURFACE_METRICS, signNote } from '../world';
import type { Identity, SurfaceMetric, VerifiedNote } from '../world';

export interface Bound {
  min?: number;
  max?: number;
}

export interface SurfaceRules {
  version: 1;
  /** A reading is "safe" only if every metric sits inside its bound. Units are on `SurfaceMetric`. */
  thresholds: Record<SurfaceMetric, Bound>;
  /** Distinct witness key IDs a reading needs before it counts. */
  minWitnesses: number;
  /** Distinct levels those witnesses must come from (independence). */
  minLevels: number;
}

export const DEFAULT_SURFACE_RULES: SurfaceRules = {
  version: 1,
  thresholds: {
    o2: { min: 19.5 },
    co2: { max: 1000 },
    pm25: { max: 35 },
    radiation: { max: 0.5 },
    temperature: { min: -10, max: 40 },
    toxin: { max: 0.5 },
  },
  minWitnesses: 3,
  minLevels: 2,
};

/** One fixed text form of the rules, so every device hashes the same bytes. */
export function canonicalRules(rules: SurfaceRules): string {
  const parts = SURFACE_METRICS.map((m) => {
    const b = rules.thresholds[m];
    return `${m}:${b.min ?? ''}:${b.max ?? ''}`;
  });
  return `groundtruth/surface-rules/v${rules.version}|${parts.join('|')}|witnesses=${rules.minWitnesses}|levels=${rules.minLevels}`;
}

export function fingerprintBytes(rules: SurfaceRules): Uint8Array {
  return sha256(utf8ToBytes(canonicalRules(rules)));
}

/** Lowercase hex SHA-256 of the canonical rules: the fingerprint residents compare. */
export function rulesFingerprint(rules: SurfaceRules): string {
  return bytesToHex(fingerprintBytes(rules));
}

export function fingerprintFromHex(h: string): Uint8Array {
  return hexToBytes(h);
}

/** The commit note that publishes the rules. */
export function rulesCommitNote(identity: Identity, rules: SurfaceRules, seq: number, time: number): VerifiedNote {
  return signNote({ seq, time, body: { kind: 'commit', topic: 'surface-rules', value: fingerprintBytes(rules) } }, identity);
}

/**
 * True when every metric is inside its published bound. Null when a metric is missing,
 * because an incomplete reading cannot be called safe.
 */
export function readingLooksSafe(rules: SurfaceRules, values: Partial<Record<SurfaceMetric, number>>): boolean | null {
  let ok = true;
  for (const m of SURFACE_METRICS) {
    const v = values[m];
    if (v === undefined) return null;
    const b = rules.thresholds[m];
    if (b.min !== undefined && v < b.min) ok = false;
    if (b.max !== undefined && v > b.max) ok = false;
  }
  return ok;
}
