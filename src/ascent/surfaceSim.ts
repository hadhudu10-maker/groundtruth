// The seeded surface model (problem 13). The sim in src/sim has no surface, so this is it.
//
// Per seed there is a hidden true state of the surface (safe or not). Probes take readings of six
// metrics with noise. Residents act as witnesses: most are honest, some lie. A fraction of the
// readings are forged to push the false story. Every number this module reports comes from runs
// of this model.
import { SURFACE_METRICS } from '../world';
import type { SurfaceMetric } from '../world';
import { Rng, median } from './rng';
import { DEFAULT_SURFACE_RULES, readingLooksSafe, rulesFingerprint } from './rules';
import type { SurfaceRules } from './rules';

export const MAX_READINGS = 40;
export const PRIOR_DOUBTER = 0.05;
export const PRIOR_BELIEVER = 0.95;
/** The two observers have agreed when both are on the same side of 0.5 and this close. */
export const AGREE_WITHIN = 0.1;

/** Probe noise (one standard deviation) per metric, in the metric's own unit. */
const SIGMA: Record<SurfaceMetric, number> = { o2: 0.4, co2: 120, pm25: 6, radiation: 0.12, temperature: 3, toxin: 0.12 };

export const WITNESS_MODEL = {
  levels: 6,
  residentsPerLevel: 4,
  /** Residents who are standing next to the probe when it takes a reading. */
  presentPerReading: 6,
  liarRate: 0.15,
  forgedRate: 0.18,
  honestSignsGenuine: 0.85,
  honestSignsForged: 0.03,
  liarSignsGenuine: 0.85,
  liarSignsForged: 0.9,
} as const;

export type MetricValues = Record<SurfaceMetric, number>;

export interface SimResident {
  index: number;
  level: number;
  liar: boolean;
}

export interface SimReading {
  index: number;
  forged: boolean;
  values: MetricValues;
  /** Resident indexes in the order they signed. Distinct. */
  signers: number[];
  levelCount: number;
  counted: boolean;
  looksSafe: boolean;
}

export interface SurfaceRun {
  seed: number;
  /** The hidden truth. */
  safe: boolean;
  residents: SimResident[];
  readings: SimReading[];
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;

function inside(rng: Rng, rules: SurfaceRules, m: SurfaceMetric, margin: number): number {
  const b = rules.thresholds[m];
  const s = SIGMA[m];
  const lowSide = b.min !== undefined && (b.max === undefined || rng.chance(0.5));
  return lowSide ? b.min! + margin * s : Math.max(0, b.max! - margin * s);
}

function outside(rng: Rng, rules: SurfaceRules, m: SurfaceMetric, margin: number): number {
  const b = rules.thresholds[m];
  const s = SIGMA[m];
  const lowSide = b.min !== undefined && (b.max === undefined || rng.chance(0.5));
  return lowSide ? b.min! - margin * s : b.max! + margin * s;
}

/** True values of a surface that is safe (every metric inside its bound) or not (1 to 3 metrics outside). */
function truthValues(rng: Rng, rules: SurfaceRules, safe: boolean): MetricValues {
  const bad = new Set<SurfaceMetric>();
  if (!safe) {
    const k = rng.int(1, 3);
    for (const m of rng.shuffled(SURFACE_METRICS).slice(0, k)) bad.add(m);
  }
  const out = {} as MetricValues;
  for (const m of SURFACE_METRICS) {
    out[m] = bad.has(m) ? outside(rng, rules, m, rng.range(0.3, 2.5)) : inside(rng, rules, m, rng.range(1, 3.5));
  }
  return out;
}

function probe(rng: Rng, truth: MetricValues): MetricValues {
  const out = {} as MetricValues;
  for (const m of SURFACE_METRICS) {
    const v = truth[m] + SIGMA[m] * rng.normal();
    out[m] = round3(m === 'temperature' ? v : Math.max(0, v));
  }
  return out;
}

export interface RunOptions {
  rules?: SurfaceRules;
  readings?: number;
  /** Force the hidden truth (used to calibrate the observers). */
  forceSafe?: boolean;
}

export function generateRun(seed: number, opts: RunOptions = {}): SurfaceRun {
  const rules = opts.rules ?? DEFAULT_SURFACE_RULES;
  const n = opts.readings ?? MAX_READINGS;
  const rng = new Rng(seed);
  const drawn = rng.chance(0.5);
  const safe = opts.forceSafe ?? drawn;
  const truth = truthValues(rng, rules, safe);
  const fiction = truthValues(rng, rules, !safe);
  const W = WITNESS_MODEL;
  const residents: SimResident[] = [];
  for (let level = 1; level <= W.levels; level++) {
    for (let i = 0; i < W.residentsPerLevel; i++) residents.push({ index: residents.length, level, liar: rng.chance(W.liarRate) });
  }
  const readings: SimReading[] = [];
  for (let index = 0; index < n; index++) {
    const forged = rng.chance(W.forgedRate);
    const values = probe(rng, forged ? fiction : truth);
    const signers: number[] = [];
    for (const r of rng.shuffled(residents).slice(0, W.presentPerReading)) {
      const p = r.liar
        ? forged
          ? W.liarSignsForged
          : W.liarSignsGenuine
        : forged
          ? W.honestSignsForged
          : W.honestSignsGenuine;
      if (rng.chance(p)) signers.push(r.index);
    }
    const levelCount = new Set(signers.map((i) => residents[i]!.level)).size;
    readings.push({
      index,
      forged,
      values,
      signers,
      levelCount,
      counted: signers.length >= rules.minWitnesses && levelCount >= rules.minLevels,
      looksSafe: readingLooksSafe(rules, values) === true,
    });
  }
  return { seed, safe, residents, readings };
}

// ---------------------------------------------------------------- the two observers

export interface Likelihoods {
  /** P(a counted reading looks safe | the surface is safe). */
  pSafeLooksSafe: number;
  /** P(a counted reading looks safe | the surface is not safe). */
  pUnsafeLooksSafe: number;
}

const CALIBRATION_SEED = 9_000_000;
const CALIBRATION_RUNS = 1500;
const CALIBRATION_READINGS = 20;
const likCache = new Map<string, Likelihoods>();

/**
 * What the observers believe a counted reading tells them, measured from the model itself on a
 * seed range the 500-run test never uses (forgeries and lying witnesses included).
 */
export function observerLikelihoods(rules: SurfaceRules = DEFAULT_SURFACE_RULES): Likelihoods {
  const key = rulesFingerprint(rules);
  const hit = likCache.get(key);
  if (hit) return hit;
  const tally = (safe: boolean) => {
    let counted = 0;
    let looksSafe = 0;
    for (let i = 0; i < CALIBRATION_RUNS; i++) {
      const run = generateRun(CALIBRATION_SEED + (safe ? 0 : CALIBRATION_RUNS) + i, {
        rules,
        readings: CALIBRATION_READINGS,
        forceSafe: safe,
      });
      for (const r of run.readings) {
        if (!r.counted) continue;
        counted++;
        if (r.looksSafe) looksSafe++;
      }
    }
    return (looksSafe + 1) / (counted + 2);
  };
  const lik = { pSafeLooksSafe: tally(true), pUnsafeLooksSafe: tally(false) };
  likCache.set(key, lik);
  return lik;
}

export interface EvidenceItem {
  looksSafe: boolean;
  /** Reached the witness threshold. Only counted readings move the observers. */
  counted: boolean;
  /** Witness signatures recorded on this reading. */
  signatures: number;
}

export type Verdict = 'safe' | 'unsafe' | 'undecided';

export interface Observation {
  /** P(safe) after each counted reading. Index 0 is the prior. */
  doubter: number[];
  believer: number[];
  /** How many counted readings it took, or null if they never agreed. */
  agreedAt: number | null;
  /** Index into the evidence list of the reading that brought agreement. */
  agreedIndex: number | null;
  /** Witness signatures on every reading up to and including that one. */
  signaturesAtAgreement: number | null;
  verdict: Verdict;
}

const logit = (p: number) => Math.log(p / (1 - p));
const prob = (l: number) => 1 / (1 + Math.exp(-l));

function agree(d: number, b: number): boolean {
  return d > 0.5 === b > 0.5 && Math.abs(b - d) <= AGREE_WITHIN;
}

/** Both observers update on the same evidence, in order, until they agree. */
export function evaluateEvidence(evidence: readonly EvidenceItem[], lik: Likelihoods = observerLikelihoods()): Observation {
  const up = Math.log(lik.pSafeLooksSafe / lik.pUnsafeLooksSafe);
  const down = Math.log((1 - lik.pSafeLooksSafe) / (1 - lik.pUnsafeLooksSafe));
  let d = logit(PRIOR_DOUBTER);
  let b = logit(PRIOR_BELIEVER);
  const doubter = [PRIOR_DOUBTER];
  const believer = [PRIOR_BELIEVER];
  let signatures = 0;
  let counted = 0;
  for (let i = 0; i < evidence.length; i++) {
    const e = evidence[i]!;
    signatures += e.signatures;
    if (!e.counted) continue;
    counted++;
    const step = e.looksSafe ? up : down;
    d += step;
    b += step;
    doubter.push(prob(d));
    believer.push(prob(b));
    if (agree(prob(d), prob(b))) {
      return {
        doubter,
        believer,
        agreedAt: counted,
        agreedIndex: i,
        signaturesAtAgreement: signatures,
        verdict: prob(d) > 0.5 ? 'safe' : 'unsafe',
      };
    }
  }
  return { doubter, believer, agreedAt: null, agreedIndex: null, signaturesAtAgreement: null, verdict: 'undecided' };
}

export function evidenceOfRun(run: SurfaceRun): EvidenceItem[] {
  return run.readings.map((r) => ({ looksSafe: r.looksSafe, counted: r.counted, signatures: r.signers.length }));
}

export function verdictOfRun(run: SurfaceRun, lik?: Likelihoods): Observation {
  return evaluateEvidence(evidenceOfRun(run), lik);
}

// ---------------------------------------------------------------- measurement

export interface SurfaceMeasurement {
  runs: number;
  /** Median witness signatures recorded until doubter and believer agree, over runs where they did. */
  witnessesToAgreement: number;
  /** Share of runs where they agreed on the true answer. */
  agreedCorrectPct: number;
  /** Share of runs where they agreed on the wrong answer. */
  wrongPct: number;
  /** Share of runs where they had not agreed after MAX_READINGS readings. */
  undecidedPct: number;
}

const measureCache = new Map<number, SurfaceMeasurement>();

/** Seeds 1..runs. Calibration uses a different seed range, so the observers never saw these runs. */
export function measureSurface(runs = 500): SurfaceMeasurement {
  const hit = measureCache.get(runs);
  if (hit) return hit;
  const lik = observerLikelihoods();
  const sigs: number[] = [];
  let correct = 0;
  let wrong = 0;
  let undecided = 0;
  for (let seed = 1; seed <= runs; seed++) {
    const run = generateRun(seed);
    const obs = verdictOfRun(run, lik);
    if (obs.verdict === 'undecided') {
      undecided++;
      continue;
    }
    sigs.push(obs.signaturesAtAgreement!);
    if ((obs.verdict === 'safe') === run.safe) correct++;
    else wrong++;
  }
  const m: SurfaceMeasurement = {
    runs,
    witnessesToAgreement: median(sigs),
    agreedCorrectPct: (100 * correct) / runs,
    wrongPct: (100 * wrong) / runs,
    undecidedPct: (100 * undecided) / runs,
  };
  measureCache.set(runs, m);
  return m;
}

/** The ProofValues subset for problem 13. Never hand-typed. */
export function surfaceProof(runs = 500): { witnessesToAgreement: number } {
  return { witnessesToAgreement: measureSurface(runs).witnessesToAgreement };
}
