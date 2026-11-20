// Runs the 500-run warning measurement off the main thread so the city keeps moving.
import { measureWarnings } from './measure';

const { details: _details, ...summary } = measureWarnings({ runs: 500 });
self.postMessage(summary);
