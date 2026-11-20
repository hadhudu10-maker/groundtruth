import { useMemo, useState } from 'react';
import { BellRing, Timer, TriangleAlert, VolumeX, Zap, ZapOff } from 'lucide-react';
import type { SimCityState, SimObservation } from '../sim';
import { powerReadings } from './adapter';
import { createCanary, type Alert } from './monitor';
import { measureWarnings, type WarningReport } from './measure';

const HOUR = 3600;

export interface WarningPanelProps {
  state: SimCityState;
  observations: readonly SimObservation[];
  /** A measurement the parent already has (for example from a cache). If absent, the panel offers to run one. */
  measured?: WarningReport;
}

/** Simulated clock as "day 2, 19:00". */
function clock(t: number): string {
  const day = Math.floor(t / (24 * HOUR));
  const h = Math.floor((t % (24 * HOUR)) / HOUR);
  const m = Math.floor((t % HOUR) / 60);
  return `day ${day}, ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const ago = (now: number, t: number) => {
  const h = (now - t) / HOUR;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : `${h.toFixed(1)} h ago`;
};

// One measurement per page load: it replays 500 seeded runs, which takes several seconds.
let cached: WarningReport | undefined;

export default function WarningPanel({ state, observations, measured }: WarningPanelProps) {
  const now = state.time;
  const alerts = useMemo(() => {
    const canary = createCanary();
    for (const r of powerReadings(observations)) if (r.time <= now) canary.ingest(r);
    canary.check(now);
    return canary.active(now);
  }, [observations, now]);

  const warnings = alerts.filter((a) => a.kind === 'flicker-rise').sort((a, b) => b.level - a.level);
  const silent = new Map<number, Alert[]>();
  for (const a of alerts) if (a.kind === 'silence') silent.set(a.level, [...(silent.get(a.level) ?? []), a]);

  const [report, setReport] = useState<WarningReport | undefined>(measured ?? cached);
  const [busy, setBusy] = useState(false);
  const run = () => {
    setBusy(true);
    // Let the spinner paint before the synchronous replay starts.
    setTimeout(() => {
      cached = measureWarnings({ runs: 500 });
      setReport(cached);
      setBusy(false);
    }, 30);
  };
  const shown = measured ?? report;

  return (
    <section data-testid="warning-panel" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100">
      <header className="flex items-center gap-2">
        <BellRing className="size-4 text-amber-300" aria-hidden />
        <h3 className="text-sm font-semibold">Blackout warning</h3>
        <span className="ml-auto font-mono text-[11px] text-slate-400">{clock(now)}</span>
      </header>

      <div className="mt-2 space-y-2">
        {warnings.length === 0 && silent.size === 0 ? (
          <p data-testid="warning-none" className="flex items-center gap-2 rounded-md bg-emerald-950/40 px-2 py-1.5 text-xs text-emerald-200">
            <Zap className="size-3.5 shrink-0" aria-hidden /> No warnings. Every level is sending its hourly heartbeat.
          </p>
        ) : null}

        {warnings.map((a) => (
          <div
            key={`w${a.level}-${a.firedAt}`}
            data-testid="flicker-warning"
            className="flex items-start gap-2 rounded-md border border-amber-700/60 bg-amber-950/30 px-2 py-1.5 text-xs"
          >
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-300" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold text-amber-100">Level {a.level}: flickers are rising</p>
              <p className="leading-snug text-slate-300">
                {a.count} flickers in an hour, well above this level's usual for this time of day. Raised {ago(now, a.firedAt)}.
                {a.blackoutAt !== undefined ? ` The level went dark ${((a.blackoutAt - a.firedAt) / HOUR).toFixed(1)} h later.` : ' Get ready for a blackout.'}
              </p>
            </div>
          </div>
        ))}

        {[...silent.entries()]
          .sort((a, b) => b[0] - a[0])
          .map(([level, list]) => (
            <div
              key={`s${level}`}
              data-testid="silence-alarm"
              className="flex items-start gap-2 rounded-md border border-red-800/60 bg-red-950/30 px-2 py-1.5 text-xs"
            >
              <VolumeX className="mt-0.5 size-3.5 shrink-0 text-red-300" aria-hidden />
              <div className="min-w-0">
                <p className="font-semibold text-red-100">Level {level}: gone silent</p>
                <p className="leading-snug text-slate-300">
                  {list.length} of its zones stopped sending a heartbeat, first {ago(now, Math.min(...list.map((a) => a.firedAt)))}.
                </p>
              </div>
            </div>
          ))}
      </div>

      <footer className="mt-3 border-t border-slate-800 pt-2">
        {shown ? (
          <dl className="grid grid-cols-3 gap-2 text-center" data-testid="warning-measured">
            <div>
              <dt className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
                <Timer className="size-3" aria-hidden /> Median lead
              </dt>
              <dd className="font-mono text-lg font-semibold text-emerald-300">{shown.medianLeadHours} h</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-400">Blackouts warned</dt>
              <dd className="font-mono text-lg font-semibold text-slate-100">{Math.round(shown.detectionRate * 100)}%</dd>
            </div>
            <div>
              <dt className="text-[11px] text-slate-400">Pure noise</dt>
              <dd className="font-mono text-lg font-semibold text-slate-100">{(shown.spuriousRate * 100).toFixed(1)}%</dd>
            </div>
            <p className="col-span-3 text-[11px] leading-snug text-slate-500">
              Measured over {shown.runs} seeded runs: {shown.warned} of {shown.blackouts} blackouts warned, {shown.silence.detected} caught by the
              silence alarm (median {shown.silence.medianDelayHours} h after).
            </p>
          </dl>
        ) : (
          <button
            type="button"
            onClick={run}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-60"
          >
            <ZapOff className="size-3.5" aria-hidden />
            {busy ? 'Replaying 500 runs...' : 'Measure the lead time over 500 runs'}
          </button>
        )}
      </footer>
    </section>
  );
}
