import { lazy, Suspense, useState } from 'react'
import { CityCrossSection, Legend, ProblemRail, SimControls, useSim } from './ui'
import { NotebookPanel, OUTBREAK_SCENARIO, OutbreakPanel, useLedgerProof, useOutbreakReport } from './ledger'

const DevTest = lazy(() => import('./murmur/DevTest'))

export default function App() {
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
          <OutbreakPanel
            report={outbreak}
            headline={{ ratio: ledgerProof.outbreakUndercountRatio, days: OUTBREAK_SCENARIO.hours / 24 }}
          />
          <NotebookPanel notebook={outbreak.notebook} />
        </div>
        <div className="flex flex-col gap-3">
          <Legend />
          <ProblemRail proof={{ ...proof, ...ledgerProof }} />
        </div>
      </div>
    </main>
  )
}
