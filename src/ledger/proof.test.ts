import { expect, test } from 'vitest';
import { measureLedgerProof } from './proof';

test('the rail gets both ledger numbers from harness runs', () => {
  const p = measureLedgerProof();
  expect(p.outbreakUndercountRatio).toBeGreaterThan(1);
  expect(p.badWaterWarnedPct).toBeGreaterThan(0);
  expect(p.badWaterWarnedPct).toBeLessThanOrEqual(100);
}, 120_000);
