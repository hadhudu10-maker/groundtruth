// The simulation harness: run a scripted scenario from a seed and get back every number.
// "Every number shown in the demo must come from the simulation harness" means from here.
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { createIdentity, type Identity, type ProofValues } from '../world';
import { createSim, HOUR, type Sim } from './engine';
import type { FailureSpec, SimCityState, SimEvent, SimObservation, SimOptions } from './types';

/** At `atHour` (hours since the run started), trigger `failure`, or resolve the failure started by step `resolves`. */
export type ScriptStep =
  | { atHour: number; trigger: FailureSpec }
  | { atHour: number; resolves: number /* index of an earlier trigger step in the script */ };

export interface HarnessRun {
  sim: Sim;
  /** State after each hour, index 0 is the starting hour. */
  timeline: SimCityState[];
  observations: readonly SimObservation[];
  events: readonly SimEvent[];
  proof: ProofValues;
}

/** Run `hours` hours from `options`, applying `script` along the way. */
export function runHarness(options: SimOptions & { hours: number; script?: ScriptStep[] }): HarnessRun {
  const sim = createSim(options);
  const script = [...(options.script ?? [])].map((s, i) => ({ ...s, index: i })).sort((a, b) => a.atHour - b.atHour || a.index - b.index);
  const ids = new Map<number, number>();
  const timeline: SimCityState[] = [];
  const apply = (h: number) => {
    for (const s of script) {
      if (s.atHour !== h) continue;
      if ('trigger' in s) ids.set(s.index, sim.trigger(s.trigger));
      else {
        const id = ids.get(s.resolves);
        if (id === undefined) throw new Error(`script step ${s.index} resolves step ${s.resolves}, which has not run`);
        sim.resolve(id);
      }
    }
  };
  apply(0);
  timeline.push(sim.getState());
  for (let h = 1; h <= options.hours; h++) {
    sim.step(1);
    apply(h);
    timeline.push(sim.getState());
  }
  return { sim, timeline, observations: sim.observations(), events: sim.events(), proof: sim.proof() };
}

/**
 * The demo story's opening (note 10, story step 1): a quiet day, then the generators sag, the
 * deepest level's feeder fails, and the Directorate's network goes dark. Hazards are off so the
 * story plays the same every time; the seed still drives every draw.
 */
export function demoScript(levels = 12): ScriptStep[] {
  return [
    { atHour: 18, trigger: { kind: 'generation-drop', fraction: 0.08 } },
    { atHour: 24, trigger: { kind: 'level-power-loss', level: levels, rampHours: 6 } },
    { atHour: 30, trigger: { kind: 'network-down' } },
    { atHour: 36, trigger: { kind: 'recycler-failure', level: levels } },
  ];
}

/** First sim time (seconds) each level went dark, from a run's events. Missing means it never did. */
export function firstOutTimes(events: readonly SimEvent[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of events) if (e.what === 'level-out' && e.level !== undefined && !out.has(e.level)) out.set(e.level, e.time);
  return out;
}

/** Hours, for display. */
export const hoursOf = (seconds: number) => seconds / HOUR;

// ---------------------------------------------------------------- residents

/**
 * The seeded secret key of resident `index` in the run with `seed`. Deterministic and independent
 * of call order, so any module can sign city-scale notes as a simulated resident.
 */
export function residentSecretKey(seed: number, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0) throw new Error('resident index must be a whole number >= 0');
  const g = xoroshiro128plus(mix(seed | 0, index));
  const key = new Uint8Array(32);
  const view = new DataView(key.buffer);
  for (let i = 0; i < 8; i++) view.setInt32(i * 4, g.next());
  return key;
}

const identities = new Map<string, Identity>();
/** A simulated resident as a signing identity (`createIdentity` with a seeded key). Cached. */
export function residentIdentity(sim: Pick<Sim, 'seed' | 'levelOfResident'>, index: number): Identity {
  const k = `${sim.seed}:${index}`;
  let id = identities.get(k);
  if (!id) {
    const level = sim.levelOfResident(index);
    id = createIdentity({ name: `Resident ${index}, level ${level}`, level, secretKey: residentSecretKey(sim.seed, index) });
    identities.set(k, id);
  }
  return id;
}

/** A 32-bit mix of two integers (murmur3 finalizer style), used only to seed per-resident generators. */
function mix(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}
