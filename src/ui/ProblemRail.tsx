import { CheckCircle2, CircleDot } from 'lucide-react'
import { PROBLEMS, type Problem, type ProofValues } from '../world'
import { formatProof } from './format'

function ProblemCard({ problem, proof, active }: { problem: Problem; proof: ProofValues; active: boolean }) {
  const value = proof[problem.proof.metric]
  const partial = problem.status === 'partial'
  return (
    <li
      data-testid={`problem-${problem.id}`}
      data-story-active={active ? 'true' : undefined}
      className={`rounded-lg border p-3 ${partial ? 'border-amber-700/60 bg-amber-950/20' : 'border-slate-700 bg-slate-900'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">
          <span className="mr-1.5 font-mono text-xs text-slate-400">#{problem.id}</span>
          {problem.title}
        </h3>
        <span
          data-status={problem.status}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
            partial ? 'bg-amber-900/50 text-amber-200' : 'bg-emerald-900/50 text-emerald-200'
          }`}
        >
          {partial ? <CircleDot className="size-3" /> : <CheckCircle2 className="size-3" />}
          {partial ? 'Half lit' : 'Lit'}
        </span>
      </div>
      <p className="mt-1.5 text-xs italic leading-snug text-slate-400">{problem.brief}</p>
      <p className="mt-2 text-xs leading-snug text-slate-300">
        <span className="font-semibold text-slate-200">On screen: </span>
        {problem.moment}
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-800 pt-2">
        <span className="text-[11px] leading-snug text-slate-400">{problem.proof.label}</span>
        {value === undefined ? (
          <span data-testid={`proof-${problem.id}`} className="shrink-0 text-xs text-slate-500">
            not measured yet
          </span>
        ) : (
          <span data-testid={`proof-${problem.id}`} className="shrink-0 font-mono text-lg font-semibold text-emerald-300">
            {formatProof(problem, value)}
          </span>
        )}
      </div>
    </li>
  )
}

/** By the brief's number, so judges can match each card to the brief. */
const BY_NUMBER = [...PROBLEMS].sort((a, b) => a.id - b.id)

export function ProblemRail({ proof, activeIds = [] }: { proof: ProofValues; activeIds?: readonly number[] }) {
  return (
    <section aria-label="Problem rail">
      <h2 className="mb-2 text-lg font-semibold text-slate-100">Problems answered</h2>
      <ol className="flex flex-col gap-2">
        {BY_NUMBER.map((p) => (
          <ProblemCard key={p.id} problem={p} proof={proof} active={activeIds.includes(p.id)} />
        ))}
      </ol>
    </section>
  )
}
