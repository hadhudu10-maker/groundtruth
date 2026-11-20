import { useMemo, useState } from 'react';
import { Dices, Lock, RefreshCw, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import type { ProofValues } from '../world';
import { notebookFrom, shortHash } from '../ledger';
import { Rng, subSeed } from './rng';
import { buildLotteryScenario, revealNote, runDraw } from './lottery';
import type { DrawResult } from './lottery';

const WHY: Record<string, string> = {
  'reveal-mismatch': 'The revealed seed does not match the commit. Draw rejected.',
  'seed-changed': 'Two different seeds were committed. Draw rejected.',
  'roll-mismatch': 'This copy cannot rebuild the published close. Sync notes first.',
};

/**
 * Problem 14, partial: who goes up first. Shows the commit, the entrants, the reveal and the crew,
 * and lets anyone re-run the draw from a notebook copy in a different order.
 */
export function LotteryPanel({ seed = 1, proof }: { seed?: number; proof?: ProofValues }) {
  const sc = useMemo(() => buildLotteryScenario(seed), [seed]);
  const official = useMemo(() => runDraw(sc.notebook, sc.organizer.keyId, sc.k), [sc]);
  const [runs, setRuns] = useState(0);
  const [recheck, setRecheck] = useState<{ result: DrawResult; same: boolean } | null>(null);
  const [swapped, setSwapped] = useState<DrawResult | null>(null);

  if (!official.ok) return <section className="rounded-lg border border-red-700 bg-slate-900 p-3 text-xs text-red-200">Draw failed: {official.reason}</section>;
  const name = (id: string) => sc.names.get(id) ?? id.slice(0, 6);

  const rerun = () => {
    const copy = notebookFrom(new Rng(subSeed(seed, 100 + runs)).shuffled(sc.notes));
    const result = runDraw(copy, sc.organizer.keyId, sc.k);
    setRuns(runs + 1);
    setSwapped(null);
    setRecheck({ result, same: result.ok && result.crew.join() === official.crew.join() });
  };

  const swapSeed = () => {
    const lie = revealNote(sc.organizer, new Rng(subSeed(seed, 999)).bytes(32), 4, sc.reveal.time + 1);
    setRecheck(null);
    setSwapped(runDraw(notebookFrom([...sc.notes.filter((n) => n !== sc.reveal), lie]), sc.organizer.keyId, sc.k));
  };

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-200" data-testid="lottery-panel">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Dices className="size-4 text-slate-400" />
          Who goes first
        </h2>
        <span className="text-xs text-slate-400">{official.entrants.length} entrants, crew of {sc.k}</span>
      </header>

      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
        <dt className="flex items-center gap-1 text-slate-400"><Lock className="size-3.5" /> 1. Commit</dt>
        <dd className="font-mono text-slate-100" data-testid="lottery-commit">{shortHash(official.seedCommit, 12)}</dd>
        <dt className="flex items-center gap-1 text-slate-400"><Users className="size-3.5" /> 2. Close</dt>
        <dd className="font-mono text-slate-100" data-testid="lottery-close">{shortHash(official.closeDigest, 12)}</dd>
        <dt className="flex items-center gap-1 text-slate-400"><Dices className="size-3.5" /> 3. Reveal</dt>
        <dd className="font-mono text-slate-100">{shortHash(bytesHex(sc.secretSeed), 12)}</dd>
      </dl>
      <p className="mt-1 text-[11px] text-slate-400">
        Late volunteers, ignored: {sc.lateVolunteers.map(name).join(', ')}.
      </p>

      <h3 className="mt-2 text-xs font-semibold text-slate-300">The crew</h3>
      <ol className="mt-1 flex flex-wrap gap-1.5" data-testid="lottery-crew">
        {official.crew.map((id, i) => (
          <li key={id} className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-100">
            {i + 1}. {name(id)}
          </li>
        ))}
      </ol>

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={rerun} className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800">
          <RefreshCw className="size-3" /> Re-run the draw
        </button>
        <button type="button" onClick={swapSeed} className="rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">
          Organizer swaps the seed
        </button>
      </div>

      {recheck ? (
        <p className={`mt-2 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${recheck.same ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200' : 'border-red-700/70 bg-red-950/40 text-red-200'}`} data-testid="lottery-recheck">
          {recheck.same ? <ShieldCheck className="mt-px size-3.5" /> : <ShieldAlert className="mt-px size-3.5" />}
          {recheck.same ? `Run ${runs}: a copy in a different order picked the same crew.` : 'The re-run did not match.'}
        </p>
      ) : null}
      {swapped && !swapped.ok ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-red-700/70 bg-red-950/40 px-2 py-1.5 text-xs text-red-200" data-testid="lottery-swap">
          <ShieldAlert className="mt-px size-3.5" /> {WHY[swapped.reason] ?? swapped.reason}
        </p>
      ) : null}
      {proof?.lotteryRecheckMatchPct !== undefined ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Across 200 simulated residents, {proof.lotteryRecheckMatchPct}% of re-runs picked the same crew.
        </p>
      ) : null}
    </section>
  );
}

function bytesHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
