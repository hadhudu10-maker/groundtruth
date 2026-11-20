import { useState } from 'react'
import { CityCrossSection, FIXTURE_PROOF, FixtureControls, ProblemRail, makeFixtureCity } from './ui'
import type { CityState, LevelState } from './world'

export default function App() {
  // Fixture state for now. The merge step replaces this with the real simulation.
  const [city, setCity] = useState<CityState>(makeFixtureCity)
  const [selectedId, setSelectedId] = useState(12)

  const setPower = (id: number, power: LevelState['power']) =>
    setCity((c) => ({ ...c, levels: c.levels.map((l) => (l.id === id ? { ...l, power } : l)) }))
  const setNetwork = (network: CityState['network']) => setCity((c) => ({ ...c, network }))

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
          <CityCrossSection city={city} selectedId={selectedId} onSelect={setSelectedId} />
          <FixtureControls city={city} selectedId={selectedId} onPower={setPower} onNetwork={setNetwork} />
        </div>
        <ProblemRail proof={FIXTURE_PROOF} />
      </div>
    </main>
  )
}
