// The ledger's numbers for the problem rail, measured from harness runs (never the live sim, never typed in).
import type { ProofValues } from '../world';
import { measureOutbreak } from './outbreak';
import { measureWater } from './water';

export type LedgerProof = Pick<ProofValues, 'outbreakUndercountRatio' | 'badWaterWarnedPct'>;

/** Both numbers. The water one is 20 harness runs (about 9 s), so the page runs this in a worker. */
export function measureLedgerProof(): LedgerProof {
  return { ...measureOutbreak().proof, ...measureWater().proof };
}
