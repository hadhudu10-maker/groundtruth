// Problem 2's rail number, from one fixed harness run, so it is the same on every screen and in the video.
//
// The scenario is the brief's "when power runs short": the Directorate's generators lose 10% of their
// output for a week, nothing else goes wrong. Seed 42, as on the live site.
// Measured 2026-11-19 (deepest level's power hours as a share of the top level's, over the week):
//   seed 42: 63.3%. Seeds 1..30: median 65.5%, range 60.3% to 70.7%.
//   For comparison, a calm week gives about 98%, so the gap comes from the shortage, not from the model.
import type { ProofValues } from '../world';
import { runHarness, type ScriptStep, type SimCityState, type SimOptions } from '../sim';

export const FAIRSHARE_SCENARIO: SimOptions & { hours: number; script: ScriptStep[] } = {
  seed: 42,
  hours: 7 * 24,
  hazards: false,
  script: [{ atHour: 0, trigger: { kind: 'generation-drop', fraction: 0.1 } }],
};

export const FAIRSHARE_SCENARIO_LABEL = 'A week with 10% less power from the generators (seed 42)';

export interface FairShareMeasurement {
  /** The city at the end of the week, for the fair split panel's bars. */
  state: SimCityState;
  proof: Pick<ProofValues, 'deepLevelPowerSharePct'>;
}

/** Run the scenario. Takes a few milliseconds, so the page can call it directly. */
export function measureFairShare(scenario = FAIRSHARE_SCENARIO): FairShareMeasurement {
  const run = runHarness(scenario);
  const share = run.proof.deepLevelPowerSharePct;
  return {
    state: run.sim.getState(),
    proof: share === undefined ? {} : { deepLevelPowerSharePct: share },
  };
}
