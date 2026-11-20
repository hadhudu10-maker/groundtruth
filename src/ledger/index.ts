// src/ledger: the notebook nobody can erase, and the math done on it.
//
// Wiring (for src/App.tsx, at merge time):
//   const report = useOutbreakReport(sim, state);         // signed sick notes in a notebook, rebuilt daily
//   <OutbreakPanel report={report} />                     // official vs estimated vs actual, supply ranking
//   <NotebookPanel notebook={report.notebook} />          // head, entries, inclusion check, rewrite history
//   proof: { ...sim.proof(), ...measureOutbreak().proof, ...measureWater().proof }
//     outbreakUndercountRatio: one harness run (OUTBREAK_SCENARIO), well under a second
//     badWaterWarnedPct: 20 harness runs of 20 days (WATER_SCENARIO), about 9 s, so compute it once
//     at build or story time, not on every render
export {
  notebook,
  headDigest,
  notebookFrom,
  rewriteHistory,
  shortHash,
  EMPTY_ROOT,
} from './notebook';
export { MerkleTree, hashLeaf, hashNode, verifyInclusionPath, verifyConsistencyPath } from './merkle';
export { attemptRewrite, forgedReplacement, DIRECTORATE, type RewriteAttempt } from './rewrite';
export {
  chapman,
  clinicVolunteer,
  sickNotes,
  estimateOutbreak,
  outbreakReport,
  measureOutbreak,
  rankSupplies,
  OUTBREAK_SCENARIO,
  type LevelEstimate,
  type OutbreakRow,
  type OutbreakReport,
  type SupplyShare,
} from './outbreak';
export { useOutbreakReport } from './useOutbreak';
export { NotebookPanel } from './NotebookPanel';
export { summarize } from './summary';
export { OutbreakPanel } from './OutbreakPanel';
export {
  waterNotes,
  waterLines,
  waterAlarms,
  scoreWarnings,
  waterRun,
  measureWater,
  WATER_SCENARIO,
  WATER_THRESHOLD,
  WATER_WINDOW_S,
  type WaterLine,
  type LineAlarm,
  type Exposure,
  type WaterRunReport,
  type WaterMeasurement,
} from './water';
export { measureLedgerProof, type LedgerProof } from './proof';
export { useLedgerProof } from './useLedgerProof';
