import { useRef } from 'react';
import { Droplets, OctagonAlert } from 'lucide-react';
import type { VerifiedNote, WaterBody } from '../world';
import type { Sim, SimCityState } from '../sim';
import { WATER_THRESHOLD, WATER_WINDOW_S, waterAlarms, waterLines, waterNotes, type LineAlarm } from './water';

const HOUR = 3600;

interface Signed {
  sim: Sim;
  /** How many of the sim's observations have been looked at. */
  seen: number;
  seq: Map<number, number>;
  notes: VerifiedNote<WaterBody>[];
}

/**
 * Problem 4 on screen: the live city's tap tests, signed as water notes as they arrive (only the new
 * ones each hour), and the "do not drink" flags they raise. The flag comes from the notes alone.
 */
export function useWaterAlarms(sim: Sim, state: SimCityState): { standing: LineAlarm[]; badReports: number } {
  const ref = useRef<Signed | null>(null);
  if (!ref.current || ref.current.sim !== sim) ref.current = { sim, seen: 0, seq: new Map(), notes: [] };
  const cur = ref.current;
  const all = sim.observations();
  if (all.length > cur.seen) {
    cur.notes.push(...waterNotes(sim, all.slice(cur.seen), cur.seq));
    cur.seen = all.length;
  }
  const now = state.time;
  const standing = waterAlarms(cur.notes, waterLines(state)).filter((a) => a.time <= now && now < a.until);
  const badReports = cur.notes.filter((n) => n.body.result === 'bad' && now - n.time < WATER_WINDOW_S).length;
  return { standing, badReports };
}

export function WaterPanel({ sim, state, warnedPct }: { sim: Sim; state: SimCityState; warnedPct?: number }) {
  const { standing, badReports } = useWaterAlarms(sim, state);
  return (
    <section data-testid="water-panel" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100">
      <header className="flex items-center gap-2">
        <Droplets className="size-4 text-sky-300" aria-hidden />
        <h3 className="text-sm font-semibold">Water warnings</h3>
        {warnedPct !== undefined ? (
          <span className="ml-auto text-right text-[11px] leading-tight text-slate-400">
            Residents on the bad line flagged in time:{' '}
            <span className="font-mono text-base font-semibold text-emerald-300">{warnedPct}%</span>
          </span>
        ) : null}
      </header>
      {standing.length ? (
        <ul className="mt-2 flex flex-col gap-2">
          {standing.map((a) => (
            <li key={a.recycler} data-testid="do-not-drink" className="rounded-md border border-red-700/70 bg-red-950/40 p-2 text-xs text-red-100">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <OctagonAlert className="size-4" aria-hidden />
                Do not drink: levels {a.feeds.join(' and ')}
              </p>
              <p className="mt-1 text-red-200/90">
                Raised {((state.time - a.time) / HOUR).toFixed(0)} h ago by {a.reporters} residents' signed bad tap tests on the line from recycler {a.recycler}.
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-slate-400">No line flagged. {badReports} bad tap tests in the last 12 hours.</p>
      )}
      <p className="mt-2 text-[11px] text-slate-500">
        A line is flagged once {WATER_THRESHOLD} different residents on it report bad water within {WATER_WINDOW_S / HOUR} hours.
      </p>
    </section>
  );
}
