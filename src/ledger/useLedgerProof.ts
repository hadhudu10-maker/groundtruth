import { useEffect, useState } from 'react';
import type { LedgerProof } from './proof';

/** The ledger's rail numbers, measured once in a worker. Empty (rail shows "not measured yet") until done. */
export function useLedgerProof(): LedgerProof {
  const [proof, setProof] = useState<LedgerProof>({});
  useEffect(() => {
    const worker = new Worker(new URL('./proof.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<LedgerProof>) => {
      setProof(e.data);
      worker.terminate();
    };
    return () => worker.terminate();
  }, []);
  return proof;
}
