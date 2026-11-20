import { useState } from 'react';
import type { Sim, SimCityState } from '../sim';
import { outbreakReport, type OutbreakReport } from './outbreak';

/**
 * The outbreak report for a live sim, rebuilt once per simulated day (at 06:00, when the
 * Directorate publishes), so the notebook it carries stays put long enough to try a rewrite on it.
 */
export function useOutbreakReport(sim: Sim, state: SimCityState): OutbreakReport {
  const day = Math.floor(state.hour / 24);
  const [cache, setCache] = useState(() => ({ sim, day, report: outbreakReport(sim) }));
  if (cache.sim !== sim || cache.day !== day) {
    const next = { sim, day, report: outbreakReport(sim) };
    setCache(next);
    return next.report;
  }
  return cache.report;
}
