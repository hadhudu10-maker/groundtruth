import { useMemo, useState } from 'react';
import { Droplets, Lightbulb, Scale, Utensils, type LucideIcon } from 'lucide-react';
import type { ProofValues, Resource } from '../world';
import type { SimCityState } from '../sim';
import { fairSplit, RESOURCES, type FairShareOptions, type ResourceSplit } from './fairshare';

export interface FairSplitPanelProps {
  state: SimCityState;
  /** 'run' (default) averages power over the whole run, like the proof number. 'day' uses the last 24 hours. */
  powerBasis?: FairShareOptions['powerBasis'];
  /** `sim.proof()`, so the headline share is exactly the number the problem rail shows. */
  proof?: ProofValues;
}

const LABEL: Record<Resource, string> = { power: 'Power', water: 'Water', food: 'Food' };
const ICON: Record<Resource, LucideIcon> = { power: Lightbulb, water: Droplets, food: Utensils };

const fmt = (resource: Resource, x: number) => (resource === 'food' ? Math.round(x).toLocaleString('en-US') : x.toFixed(1));

function Bars({ split }: { split: ResourceSplit }) {
  // Scale every bar to the larger of the need and the biggest amount shown, so actual and fair compare directly.
  const max = Math.max(split.need, ...split.levels.map((l) => Math.max(l.actual, l.fair)));
  return (
    <ul className="mt-2 space-y-1.5" data-testid={`fair-bars-${split.resource}`}>
      {split.levels.map((l) => (
        <li key={l.level} className="grid grid-cols-[2rem_1fr_4.5rem] items-center gap-2 text-[11px]">
          <span className="font-mono text-slate-400">L{l.level}</span>
          <div className="space-y-0.5" role="img" aria-label={`Level ${l.level}: actual ${fmt(split.resource, l.actual)}, fair ${fmt(split.resource, l.fair)} ${split.unit}`}>
            <div className="h-2 rounded-sm bg-slate-800">
              <div className="h-2 rounded-sm bg-red-400" style={{ width: `${Math.min(100, (100 * l.actual) / max)}%` }} />
            </div>
            <div className="h-2 rounded-sm bg-slate-800">
              <div className="h-2 rounded-sm bg-emerald-400" style={{ width: `${Math.min(100, (100 * l.fair) / max)}%` }} />
            </div>
          </div>
          <span className="text-right font-mono leading-tight text-slate-300">
            <span className="text-red-300">{fmt(split.resource, l.actual)}</span>
            <br />
            <span className="text-emerald-300">{fmt(split.resource, l.fair)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function FairSplitPanel({ state, powerBasis, proof }: FairSplitPanelProps) {
  const split = useMemo(() => fairSplit(state, { powerBasis, proof }), [state, powerBasis, proof]);
  const [resource, setResource] = useState<Resource>('power');
  const r = split.resources[resource];
  const deepest = r.levels[r.levels.length - 1]!;
  const top = r.levels[0]!;

  return (
    <section data-testid="fair-split-panel" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-100">
      <header className="flex items-center gap-2">
        <Scale className="size-4 text-emerald-300" aria-hidden />
        <h3 className="text-sm font-semibold">Fair split</h3>
        {split.deepLevelPowerSharePct !== undefined ? (
          <span data-testid="deep-share" className="ml-auto text-right text-[11px] leading-tight text-slate-400">
            Deepest level's power hours,
            <br />
            as a share of the top level's:{' '}
            <span className="font-mono text-base font-semibold text-red-300">{split.deepLevelPowerSharePct}%</span>
          </span>
        ) : null}
      </header>

      <div role="tablist" aria-label="Resource" className="mt-2 grid grid-cols-3 gap-1">
        {RESOURCES.map((x) => {
          const Icon = ICON[x];
          return (
            <button
              key={x}
              type="button"
              role="tab"
              aria-selected={x === resource}
              onClick={() => setResource(x)}
              className={`flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                x === resource ? 'bg-slate-700 text-slate-50' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              <Icon className="size-3.5" aria-hidden />
              {LABEL[x]}
            </button>
          );
        })}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-red-400" /> What they got</span>
        <span className="flex items-center gap-1"><span className="inline-block size-2 rounded-sm bg-emerald-400" /> Fair plan, same total</span>
        <span className="ml-auto font-mono">{r.unit} per person</span>
      </p>

      <Bars split={r} />

      <p data-testid="fair-summary" className="mt-3 border-t border-slate-800 pt-2 text-xs leading-snug text-slate-300">
        Level {deepest.level} got {fmt(resource, deepest.actual)} against {fmt(resource, top.actual)} on level {top.level}. The fair plan gives every level{' '}
        {r.worstFairShare >= 0.999 ? 'all it needs' : `${Math.round(r.worstFairShare * 100)}% of what it needs`}, up from {Math.round(r.worstActualShare * 100)}% for the worst-off level now.
      </p>
    </section>
  );
}
