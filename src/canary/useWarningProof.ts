import { useEffect, useMemo, useState } from 'react';
import type { ProofValues } from '../world';
import type { WarningSummary } from './measure';

/**
 * The warning module's rail number and full measurement, computed once in a worker from 500 seeded
 * harness runs. `proof` is empty (the rail shows "not measured yet") and `report` undefined until it is done.
 */
export function useWarningProof(): { proof: Pick<ProofValues, 'blackoutWarningLeadHours'>; report?: WarningSummary } {
  const [report, setReport] = useState<WarningSummary>();
  useEffect(() => {
    const worker = new Worker(new URL('./proof.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WarningSummary>) => {
      setReport(e.data);
      worker.terminate();
    };
    return () => worker.terminate();
  }, []);
  const proof = useMemo(() => (report && report.warned > 0 ? { blackoutWarningLeadHours: report.medianLeadHours } : {}), [report]);
  return { proof, report };
}
