import { lazy, Suspense, useMemo, useState } from 'react'
import { CityCrossSection, Legend, ProblemRail, SimControls, useSim } from './ui'
import { WarningPanel, useWarningProof } from './canary'
import { FAIRSHARE_SCENARIO_LABEL, FairSplitPanel, measureFairShare } from './fairshare'
import { NotebookPanel, OUTBREAK_SCENARIO, OutbreakPanel, useLedgerProof, useOutbreakReport } from './ledger'

const DevTest = lazy(() => import('./murmur/DevTest'))
const PassItOn = lazy(() => import('./murmur/PassItOn'))

export default function App() {
  if (location.hash === '#pass') {
    return (
      <Suspense fallback={<p className="p-4 text-slate-400">Loading...</p>}>
        <PassItOn />
      </Suspense>
    )
  }
  if (location.hash === '#devtest') {
    return (
      <Suspense fallback={<p className="p-4 text-slate-400">Loading device tests...</p>}>
        <DevTest />
      </Suspense>
    )
  }
  return <Dashboard />
}

function Dashboard() {
  const { sim, state, proof, playing, setPlaying, reset } = useSim()
  const [selectedId, setSelectedId] = useState(sim.levelCount)
  // The live sim's sick lists, signed into a notebook once per simulated day.
  const outbreak = useOutbreakReport(sim, state)
  // Rail numbers for problems 4 and 9 come from fixed harness runs, measured in a worker.
  const ledgerProof = useLedgerProof()
  // Problem 1's lead time is the median over 500 seeded runs, measured in a worker.
  const warning = useWarningProof()
  // Problem 2's number and bars come from one fixed shortage week, so they never drift (a few ms).
  const fair = useMemo(() => measureFairShare(), [])

  return (
    <main className="mx-auto max-w-6xl p-3 sm:p-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Groundtruth</h1>
        <p className="text-sm text-slate-400">
          Signed notes, passed hand to hand, kept in a notebook nobody can erase.
        </p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-3">
          <SimControls
            sim={sim}
            state={state}
            selectedId={selectedId}
            playing={playing}
            onPlaying={setPlaying}
            onReset={reset}
          />
          <CityCrossSection city={state} selectedId={selectedId} onSelect={setSelectedId} />
          <WarningPanel state={state} observations={sim.observations()} measured={warning.report} pending={!warning.report} />
          <FairSplitPanel state={fair.state} proof={fair.proof} caption={FAIRSHARE_SCENARIO_LABEL} />
          <OutbreakPanel
            report={outbreak}
            headline={{ ratio: ledgerProof.outbreakUndercountRatio, days: OUTBREAK_SCENARIO.hours / 24 }}
          />
          <NotebookPanel notebook={outbreak.notebook} />
        </div>
        <div className="flex flex-col gap-3">
          <Legend />
          <ProblemRail proof={{ ...proof, ...fair.proof, ...ledgerProof, ...warning.proof }} />
        </div>
      </div>
    </main>
  )
}
