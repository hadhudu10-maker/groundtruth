// Runs the 200-run spread measurement off the main thread.
import { measureSpread } from './spread';

self.postMessage(measureSpread({ runs: 200 }));
