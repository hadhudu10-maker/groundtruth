// Problem 2: prove the split is unfair, then compute the fair one. Everything is read from the
// simulation's own state: `received` (per person, per day), `population`, `powerHoursTotal`.
import type { ProofValues, Resource } from '../world';
import type { SimCityState } from '../sim';
import { maximinSplit } from './maximin';

export const RESOURCES: readonly Resource[] = ['power', 'water', 'food'];

/** Per person per day, in the units on `Resource`. The sim's nominal figures: 24 h, 55 L, 2100 kcal. */
export type Needs = Record<Resource, number>;
export const DEFAULT_NEEDS: Needs = { power: 24, water: 55, food: 2100 };
export const UNITS: Record<Resource, string> = { power: 'h/day', water: 'L/day', food: 'kcal/day' };

/** A resource counts as unfairly split when the best-off level has this many points more of its need than the worst-off. */
export const UNFAIR_GAP_POINTS = 5;

export interface FairShareOptions {
  /** 'run' (default): hours per day averaged over the whole run, which is what the proof number uses. 'day': the last 24 hours. */
  powerBasis?: 'run' | 'day';
  needs?: Partial<Needs>;
  /**
   * `sim.proof()` for the same run. The sim keeps `powerHoursTotal` at full precision but its state
   * snapshot rounds it to 0.1 h, so a share computed from the state alone can differ from the proof by
   * a tenth of a point (more on a run only a few hours old). Pass the proof to report its exact figure.
   */
  proof?: ProofValues;
}

export interface LevelSplit {
  level: number;
  population: number;
  /** Per person, per day. What the level actually got. */
  actual: number;
  /** Per person, per day. What the fair plan gives it from the same total. */
  fair: number;
  /** Shares of need, 0..1 (actual can pass 1 when a level is given more than it needs). */
  actualShare: number;
  fairShare: number;
}

export interface ResourceSplit {
  resource: Resource;
  unit: string;
  /** Per person, per day. */
  need: number;
  levels: LevelSplit[];
  /** Person-units (population times per-person amount) in total. */
  totalActual: number;
  totalFair: number;
  totalNeed: number;
  /** Supply the fair plan did not need to hand out (only when supply beat total need). */
  leftover: number;
  worstActualShare: number;
  bestActualShare: number;
  worstFairShare: number;
  /** Best-off minus worst-off level, in points of need (0..100+), under the actual split. */
  gapPoints: number;
}

export interface FairSplit {
  basis: 'run' | 'day';
  resources: Record<Resource, ResourceSplit>;
  /**
   * The deepest level's power hours as a share of the top level's over the whole run, in percent.
   * The same formula as `sim.proof()`, over the state's `powerHoursTotal`; equal to `sim.proof()` itself when
   * `options.proof` is given, and within rounding (0.1 h of each total) when it is not.
   */
  deepLevelPowerSharePct?: number;
  /** True when any resource has a gap of at least UNFAIR_GAP_POINTS. */
  unfair: boolean;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function fairSplit(state: SimCityState, options: FairShareOptions = {}): FairSplit {
  const basis = options.powerBasis ?? 'run';
  const needs: Needs = { ...DEFAULT_NEEDS, ...options.needs };
  const samples = state.hour + 1; // powerHoursTotal adds one sample per simulated hour, starting with hour 0

  const actualOf = (l: SimCityState['levels'][number], r: Resource): number => {
    if (r === 'power' && basis === 'run') return (l.powerHoursTotal / samples) * 24;
    return l.received[r];
  };

  const resources = {} as Record<Resource, ResourceSplit>;
  for (const resource of RESOURCES) {
    const need = needs[resource];
    const pops = state.levels.map((l) => l.population);
    const actual = state.levels.map((l) => actualOf(l, resource));
    const totalActual = actual.reduce((s, a, i) => s + a * pops[i]!, 0);
    const solved = maximinSplit({ supply: totalActual, needs: pops.map((p) => p * need) });
    const levels: LevelSplit[] = state.levels.map((l, i) => {
      const fair = pops[i]! > 0 ? solved.allocation[i]! / pops[i]! : 0;
      return {
        level: l.id,
        population: pops[i]!,
        actual: actual[i]!,
        fair,
        actualShare: need > 0 ? actual[i]! / need : 0,
        fairShare: need > 0 ? fair / need : 0,
      };
    });
    const shares = levels.map((l) => l.actualShare);
    const worst = Math.min(...shares);
    const best = Math.max(...shares);
    resources[resource] = {
      resource,
      unit: UNITS[resource],
      need,
      levels,
      totalActual,
      totalFair: solved.allocation.reduce((a, b) => a + b, 0),
      totalNeed: pops.reduce((s, p) => s + p * need, 0),
      leftover: solved.leftover,
      worstActualShare: worst,
      bestActualShare: best,
      worstFairShare: Math.min(...levels.map((l) => l.fairShare)),
      gapPoints: (best - worst) * 100,
    };
  }

  const top = state.levels[0]!;
  const deepest = state.levels[state.levels.length - 1]!;
  const fromState = top.powerHoursTotal > 0 ? round1((100 * deepest.powerHoursTotal) / top.powerHoursTotal) : undefined;
  const deepLevelPowerSharePct = options.proof?.deepLevelPowerSharePct ?? fromState;
  const unfair = RESOURCES.some((r) => resources[r].gapPoints >= UNFAIR_GAP_POINTS);
  return { basis, resources, ...(deepLevelPowerSharePct !== undefined ? { deepLevelPowerSharePct } : {}), unfair };
}
