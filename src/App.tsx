import { lazy, Suspense, useMemo, useState } from 'react'
import { CityCrossSection, Legend, ProblemRail, SimControls, StoryMode, useSim } from './ui'
import { WarningPanel, useWarningProof } from './canary'
import { FAIRSHARE_SCENARIO_LABEL, FairSplitPanel, measureFairShare } from './fairshare'
import { NotebookPanel, OUTBREAK_SCENARIO, OutbreakPanel, useLedgerProof, useOutbreakReport } from './ledger'
import { LotteryPanel, SurfacePanel, lotteryProof, surfaceProof } from './ascent'
// Straight from the file, not './murmur', so the sound and QR libraries stay out of the dashboard bundle.
import { SpreadPanel, useSpreadProof } from './murmur/SpreadPanel'

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
  const [storyIds, setStoryIds] = useState<readonly number[]>([])
  // The live sim's sick lists, signed into a notebook once per simulated day.
  const outbreak = useOutbreakReport(sim, state)
  // Rail numbers for problems 4 and 9 come from fixed harness runs, measured in a worker.
  const ledgerProof = useLedgerProof()
  // Problem 1's lead time is the median over 500 seeded runs, measured in a worker.
  const warning = useWarningProof()
  // Problem 2's number and bars come from one fixed shortage week, so they never drift (a few ms).
  const fair = useMemo(() => measureFairShare(), [])
  // Problems 7 and 8: 200 seeded spread runs, measured in a worker.
  const spread = useSpreadProof()
  // Problems 13 and 14: 500 seeded surface runs and 200 re-runs of the draw (about 0.2 s together).
  const ascentProof = useMemo(() => ({ ...surfaceProof(), ...lotteryProof() }), [])

  const allProof = { ...proof, ...fair.proof, ...ledgerProof, ...warning.proof, ...spread.proof, ...ascentProof }

  return (
    <main className="mx-auto max-w-6xl p-3 sm:p-5">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Groundtruth</h1>
        <p className="text-sm text-slate-400">
          Signed notes, passed hand to hand, kept in a notebook nobody can erase.
        </p>
        <StoryMode sim={sim} proof={allProof} onReset={reset} onFocus={setStoryIds} />
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
          <div data-story="city"><CityCrossSection city={state} selectedId={selectedId} onSelect={setSelectedId} /></div>
          <div data-story="spread"><SpreadPanel summary={spread.summary} /></div>
          <div data-story="warning"><WarningPanel state={state} observations={sim.observations()} measured={warning.report} pending={!warning.report} /></div>
          <div data-story="fair"><FairSplitPanel state={fair.state} proof={fair.proof} caption={FAIRSHARE_SCENARIO_LABEL} /></div>
          <div data-story="outbreak">
            <OutbreakPanel
              report={outbreak}
              headline={{ ratio: ledgerProof.outbreakUndercountRatio, days: OUTBREAK_SCENARIO.hours / 24 }}
            />
          </div>
          <div data-story="notebook"><NotebookPanel notebook={outbreak.notebook} /></div>
          <div data-story="surface"><SurfacePanel /></div>
          <div data-story="lottery"><LotteryPanel proof={ascentProof} /></div>
        </div>
        <div className="flex flex-col gap-3">
          <Legend />
          <div data-story="rail">
            <ProblemRail proof={allProof} activeIds={storyIds} />
          </div>
        </div>
      </div>
    </main>
  )
}
