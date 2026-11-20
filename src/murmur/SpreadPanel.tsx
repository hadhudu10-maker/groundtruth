// Problems 7 and 8 on one card: how far a note spreads with the network down, and how many split
// families hear each other's "safe" note. Every number comes from measureSpread (200 seeded runs).
// No animation (cut). The dashboard wires it in:
//   const spread = useSpreadProof();
//   <SpreadPanel summary={spread.summary} />   and   {...spread.proof} into the ProblemRail.
import { useEffect, useMemo, useState } from 'react';
import type { ProofValues } from '../world';
import { spreadProof } from './spread';
import type { SpreadSummary } from './spread';

export function useSpreadProof(): { proof: Pick<ProofValues, 'networkDownReachPct' | 'familiesReconnectedPct'>; summary?: SpreadSummary } {
  const [summary, setSummary] = useState<SpreadSummary>();
  useEffect(() => {
    const worker = new Worker(new URL('./spread.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<SpreadSummary>) => {
      setSummary(e.data);
      worker.terminate();
    };
    return () => worker.terminate();
  }, []);
  const proof = useMemo(() => (summary ? spreadProof(summary) : {}), [summary]);
  return { proof, summary };
}

export function SpreadPanel({ summary }: { summary?: SpreadSummary }) {
  if (!summary) {
    return (
      <section className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-400">
        <h2 className="text-sm font-semibold text-slate-200">Pass it on, city scale</h2>
        <p className="mt-1">Measuring 200 seeded runs...</p>
      </section>
    );
  }
  const p = spreadProof(summary);
  const hours = summary.reachByHour;
  const w = 300;
  const h = 90;
  const bw = w / hours.length;
  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-200" data-testid="spread-panel">
      <h2 className="text-sm font-semibold">Pass it on, city scale (network down)</h2>
      <div className="mt-2 grid grid-cols-2 gap-2 text-center">
        <div className="rounded-md bg-slate-800/60 p-2">
          <p className="font-mono text-2xl font-semibold text-sky-300" data-testid="spread-reach">{p.networkDownReachPct}%</p>
          <p className="text-xs text-slate-400">of residents hold a warning 24 hours after it is written</p>
        </div>
        <div className="rounded-md bg-slate-800/60 p-2">
          <p className="font-mono text-2xl font-semibold text-emerald-300" data-testid="spread-families">{p.familiesReconnectedPct}%</p>
          <p className="text-xs text-slate-400">
            of split families heard "safe" from a relative on another level within 48 hours ({summary.familiesHeard} of {summary.splitFamilies})
          </p>
          <p className="mt-1 text-[11px] text-slate-500" data-testid="spread-families-strict">
            Every member got every relative's note: {summary.familiesReconnected} of {summary.splitFamilies}
          </p>
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h + 14}`} className="mt-2 w-full" role="img" aria-label="Share of residents holding the warning, hour by hour">
        {hours.map((v, i) => (
          <rect key={i} x={i * bw + 1} y={h - v * h} width={bw - 2} height={Math.max(0.5, v * h)} className="fill-sky-500" />
        ))}
        <text x={0} y={h + 12} className="fill-slate-500 text-[9px]">hour 0</text>
        <text x={w} y={h + 12} textAnchor="end" className="fill-slate-500 text-[9px]">hour {hours.length - 1}</text>
      </svg>
      <p className="mt-1 text-[11px] text-slate-500">
        Median of {summary.runs} seeded runs over the simulated Hollow. Hand-offs by sound (9 to 14 s a note) and QR bundles of up to 40, at the success rates measured on real phones.
      </p>
    </section>
  );
}
