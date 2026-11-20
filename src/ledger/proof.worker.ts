// Runs the ledger's harness measurements off the main thread so the city keeps moving.
import { measureLedgerProof } from './proof';

self.postMessage(measureLedgerProof());
