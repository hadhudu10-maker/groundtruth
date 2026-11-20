import { useState } from 'react'
import { CityCrossSection, ProblemRail, SimControls, useSim } from './ui'

export default function App() {
  const { sim, state, proof, playing, setPlaying, reset } = useSim()
  const [selectedId, setSelectedId] = useState(sim.levelCount)

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
        </div>
        <ProblemRail proof={proof} />
      </div>
    </main>
  )
}
