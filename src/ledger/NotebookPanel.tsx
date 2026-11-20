import { useState, type ReactNode } from 'react';
import {
  BookLock,
  Droplet,
  Eye,
  FileText,
  Fingerprint,
  HeartPulse,
  History,
  Lock,
  Mountain,
  ShieldAlert,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import type { KeyIdHex, Notebook, NotebookEntry, NotebookHead, NoteKind } from '../world';
import { summarize } from './summary';
import { notebook as nbm, shortHash } from './notebook';
import { attemptRewrite, type RewriteAttempt } from './rewrite';

const KIND_ICON: Record<NoteKind, typeof FileText> = {
  text: FileText,
  power: Zap,
  family: Users,
  water: Droplet,
  sick: HeartPulse,
  surface: Mountain,
  witness: Eye,
  commit: Lock,
};


function EntryLine({ e, name, picked, onPick }: { e: NotebookEntry; name: string; picked: boolean; onPick: () => void }) {
  const Icon = KIND_ICON[e.note.body.kind];
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs ${
          picked ? 'bg-slate-700/70 text-slate-100' : 'text-slate-300 hover:bg-slate-800'
        }`}
      >
        <span className="w-8 shrink-0 font-mono text-[11px] text-slate-500">#{e.index}</span>
        <Icon className="size-3.5 shrink-0 text-slate-400" aria-label={e.note.body.kind} />
        <span className="min-w-0 flex-1 truncate">{summarize(e.note.body)}</span>
        <span className="shrink-0 font-mono text-[11px] text-slate-500">{name}</span>
      </button>
    </li>
  );
}

function Check({ ok, children }: { ok: boolean; children: ReactNode }) {
  const Icon = ok ? ShieldCheck : ShieldAlert;
  return (
    <p
      className={`flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
        ok ? 'border-emerald-700/60 bg-emerald-950/30 text-emerald-200' : 'border-red-700/70 bg-red-950/40 text-red-200'
      }`}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** Which old entry the forger goes after: one the user picked inside the published head, else the first clinic tally. */
function rewriteTarget(nb: Notebook, published: NotebookHead, picked: number | null): number {
  if (picked !== null && picked < published.size) return picked;
  const tally = nb.entries(0, published.size).find((e) => e.note.body.kind === 'sick' && e.note.body.caseTags.length > 1);
  return tally?.index ?? 0;
}

/**
 * One resident's notebook: how many notes, the current head, the latest entries, an inclusion check
 * for a picked entry, and the "rewrite history" button. The published head is taken when the panel
 * first sees this notebook (or when "Publish head" is pressed); pass a new notebook to start over.
 */
export function NotebookPanel({
  notebook,
  nameOf,
  latest = 6,
}: {
  notebook: Notebook;
  /** Short label for an author. Defaults to the first 6 hex chars of the key ID. */
  nameOf?: (keyId: KeyIdHex) => string | undefined;
  latest?: number;
}) {
  const [tracked, setTracked] = useState(notebook);
  const [published, setPublished] = useState(() => notebook.head());
  /** null until the user taps an entry; the inclusion check then shows the newest entry. */
  const [picked, setPicked] = useState<number | null>(null);
  const [attempt, setAttempt] = useState<RewriteAttempt | null>(null);
  if (tracked !== notebook) {
    setTracked(notebook);
    setPublished(notebook.head());
    setPicked(null);
    setAttempt(null);
  }

  const head = notebook.head();
  const name = (k: KeyIdHex) => nameOf?.(k) ?? k.slice(0, 6);
  const shown = [...notebook.entries(Math.max(0, head.size - latest))].reverse();
  const shownPick = picked ?? head.size - 1;
  const pickedEntry = notebook.get(shownPick);
  const inclusion = pickedEntry
    ? (() => {
        const proof = notebook.proveInclusion(pickedEntry.index);
        return { ok: nbm.verifyInclusion(head, pickedEntry.leaf, proof), hashes: proof.path.length };
      })()
    : null;

  return (
    <section className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-slate-200">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <BookLock className="size-4 text-slate-400" />
          The notebook
        </h2>
        <span className="text-xs text-slate-400">
          <span data-testid="notebook-size" className="font-mono text-base font-semibold text-slate-100">
            {head.size}
          </span>{' '}
          notes, nobody can erase
        </span>
      </header>

      <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-xs">
        <dt className="flex items-center gap-1 text-slate-400">
          <Fingerprint className="size-3.5" /> Head now
        </dt>
        <dd className="font-mono text-slate-100">
          {shortHash(head.root)} <span className="text-slate-500">at {head.size}</span>
        </dd>
        <dt className="flex items-center gap-1 text-slate-400">
          <Lock className="size-3.5" /> Published
        </dt>
        <dd className="flex items-center justify-between gap-2 font-mono text-slate-300">
          <span>
            {shortHash(published.root)} <span className="text-slate-500">at {published.size}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              setPublished(head);
              setAttempt(null);
            }}
            className="rounded border border-slate-600 px-1.5 py-0.5 font-sans text-[11px] text-slate-300 hover:bg-slate-800"
          >
            Publish head
          </button>
        </dd>
      </dl>

      {head.size === 0 ? (
        <p className="mt-3 text-xs text-slate-500">The notebook is empty. Notes appear here as they arrive.</p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-0.5 border-t border-slate-800 pt-2">
            {shown.map((e) => (
              <EntryLine key={e.index} e={e} name={name(e.note.author)} picked={e.index === shownPick} onPick={() => setPicked(e.index)} />
            ))}
          </ul>

          {pickedEntry && inclusion && (
            <div className="mt-2">
              <Check ok={inclusion.ok}>
                {inclusion.ok
                  ? `Entry #${pickedEntry.index} is in the notebook: ${inclusion.hashes} ${inclusion.hashes === 1 ? 'hash leads' : 'hashes lead'} from it to the head.`
                  : `Entry #${pickedEntry.index} does not match the head.`}
              </Check>
            </div>
          )}

          <div className="mt-3 border-t border-slate-800 pt-2">
            <button
              type="button"
              disabled={published.size === 0}
              onClick={() => setAttempt(attemptRewrite(notebook, published, rewriteTarget(notebook, published, picked)))}
              className="inline-flex items-center gap-1 rounded-md border border-red-700/70 bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-200 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <History className="size-3.5" />
              Rewrite history
            </button>
            {attempt && (
              <div className="mt-2 flex flex-col gap-1.5 text-xs">
                <p className="text-slate-300">
                  The Directorate changes entry #{attempt.index} in its copy:{' '}
                  <span className="text-slate-400 line-through">{summarize(attempt.original.note.body)}</span> becomes{' '}
                  <span className="text-red-200">{summarize(attempt.forged.note.body)}</span>.
                </p>
                <Check ok={attempt.forgedConsistent}>
                  {attempt.forgedConsistent
                    ? 'The copy still matches the published head.'
                    : `Rewritten copy (head ${shortHash(attempt.forgedHead.root)}) does not extend the published head ${shortHash(published.root)}. Consistency check failed.`}
                </Check>
                <Check ok={attempt.honestConsistent}>
                  {attempt.honestConsistent
                    ? 'The real notebook still extends the published head. Consistency check passed.'
                    : 'The real notebook no longer matches the published head.'}
                </Check>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
