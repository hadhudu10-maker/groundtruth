// The Hollow simulation. Every number the demo shows comes from here.
//
// UI use:
//   const sim = createSim({ seed: 42, hazards: false });
//   const state = useSyncExternalStore(sim.subscribe, sim.getState);
//   sim.step(1);                                              // one simulated hour
//   const id = sim.trigger({ kind: 'level-power-loss' });     // deepest level loses power
//   sim.trigger({ kind: 'network-down' });                    // the Directorate kills the network
//   sim.resolve(id);
//   sim.proof();                                              // ProofValues measured so far
export {
  createSim,
  HOUR,
  POWER_ON_RATIO,
  POWER_OUT_RATIO,
  CONTAMINATION_HEALTH,
  SUSPECT_HEALTH,
  type Sim,
} from './engine';
export {
  runHarness,
  demoScript,
  firstOutTimes,
  hoursOf,
  residentSecretKey,
  residentIdentity,
  type ScriptStep,
  type HarnessRun,
} from './harness';
export { buildPipeMap, recyclerNode, junctionNode, tapNode, sourceLevelOf, recyclerLayout, SHARED_FROM } from './pipes';
export { makeStreams, Stream, STREAM_NAMES, type StreamName, type Streams } from './rng';
export type * from './types';
