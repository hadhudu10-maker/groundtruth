import { useMemo, useState } from 'react';
import { Check, Fingerprint, Mountain, RefreshCw, ShieldCheck, ShieldAlert, Eye, Lock } from 'lucide-react';
import { shortHash } from '../ledger';
import { rulesFingerprint } from './rules';
import { buildSurfaceScenario, parseVerdictNote, verdictNote, SCENARIO_T0 } from './surfaceNotes';
import type { Observation } from './surfaceSim';

const W = 300;
const H = 110;

function Curves({ obs }: { obs: Observation }) {
  const n = Math.max(1, obs.doubter.length - 1);
  const x = (i: number) => 8 + (i / n) * (W - 16);
  const y = (p: number) => 6 + (1 - p) * (H - 12);
  const path = (xs: number[]) => xs.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Doubter and believer belief that the surface is safe" data-testid="surface-curves">
      <line x1="8" x2={W - 8} y1={y(0.5)} y2={y(0.5)} stroke="#475569" strokeDasharray="3 3" />
      <path d={path(obs.doubter)} fill="none" stroke="#f59e0b" strokeWidth="2" />
      <path d={path(obs.believer)} fill="none" stroke="#38bdf8" strokeWidth="2" />
      <text x="10" y="12" fontSize="9" fill="#94a3b8">safe</text>
      <text x="10" y={H - 3} fontSize="9" fill="#94a3b8">not safe</text>
    </svg>
  );
}

/**
 * Problem 13: the rules fingerprint, the readings with their witness counts, the doubter and
 * believer curves, and the verdict. Everything is read back from signed notes in a notebook.
 */
export function SurfacePanel({ seed: initial = 5 }: { seed?: number }) {
  const [seed, setSeed] = useState(initial);
  const sc = useMemo(() => buildSurfaceScenario(seed), [seed]);
  const { verdict: obs, readout, rules } = sc;
  const v = obs.verdict;
  const note = useMemo(
    () => (v === 'undecided' ? null : verdictNote(sc.organizer, v, 1000, SCENARIO_T0 + 86_400, rules)),
    [sc, v, rules],
  );
  const text = note && parseVerdictNote(note) ? (note.body.kind === 'text' ? note.body.text : '') : '';

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-200" data-testid="surface-panel">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Mountain className="size-4 text-slate-400" />
          The surface
        </h2>
        <button
          type="button"
          onClick={() => setSeed((s) => s + 1)}
          className="flex items-center gap-1 rounded border border-slate-600 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          <RefreshCw className="size-3" /> New seed
        </button>
      </header>

      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-300">
        <Lock className="size-3.5 text-slate-400" />
        Rules published first
        <Fingerprint className="ml-1 size-3.5 text-slate-400" />
        <span className="font-mono text-slate-100" data-testid="rules-fingerprint">{shortHash(rulesFingerprint(rules), 12)}</span>
      </p>
      <p className="mt-1 text-xs text-slate-400">
        A reading counts with {rules.minWitnesses} witnesses on {rules.minLevels} levels or more. Readings before the rules: {readout.ignoredBeforeRules} (ignored).
      </p>

      <ul className="mt-2 space-y-1" data-testid="surface-readings">
        {readout.readings.map((r, i) => (
          <li key={r.noteId} className="flex items-center gap-2 text-xs">
            <span className="w-6 font-mono text-slate-500">#{i + 1}</span>
            <Eye className="size-3.5 text-slate-400" />
            <span className="flex-1">
              {r.witnesses} witnesses, {r.levelCount} levels
            </span>
            <span className={r.looksSafe ? 'text-emerald-300' : 'text-red-300'}>{r.looksSafe ? 'looks safe' : 'not safe'}</span>
            {r.counted ? <Check className="size-3.5 text-emerald-400" aria-label="counted" /> : <span className="text-slate-500">not counted</span>}
          </li>
        ))}
      </ul>

      <div className="mt-3">
        <Curves obs={obs} />
        <p className="flex gap-3 text-[11px] text-slate-400">
          <span className="text-amber-400">Doubter starts at 5%</span>
          <span className="text-sky-400">Believer starts at 95%</span>
        </p>
      </div>

      <div
        className={`mt-2 flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
          v === 'safe'
            ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200'
            : v === 'unsafe'
              ? 'border-red-700/70 bg-red-950/40 text-red-200'
              : 'border-slate-600 bg-slate-800 text-slate-300'
        }`}
        data-testid="surface-verdict"
      >
        {v === 'safe' ? <ShieldCheck className="mt-px size-3.5" /> : <ShieldAlert className="mt-px size-3.5" />}
        <span>
          {v === 'undecided'
            ? 'Not enough witnessed readings yet.'
            : `Doubter and believer agree: the surface is ${v}, after ${obs.agreedAt} counted readings and ${obs.signaturesAtAgreement} witness signatures.`}
        </span>
      </div>
      {text ? (
        <p className="mt-1.5 text-[11px] text-slate-400">
          Verdict note to pass on: <span className="font-mono text-slate-200">{text}</span>
        </p>
      ) : null}
    </section>
  );
}
