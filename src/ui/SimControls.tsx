import { Pause, Play, RotateCcw, SkipForward, Wrench } from 'lucide-react'
import type { FailureSpec, Sim, SimCityState } from '../sim'

function describe(f: FailureSpec): string {
  switch (f.kind) {
    case 'level-power-loss':
      return `Level ${f.level ?? 'deepest'} feeder failing`
    case 'generation-drop':
      return `Generators down ${Math.round(f.fraction * 100)}%`
    case 'network-down':
      return 'Network shut down by the Directorate'
    case 'recycler-failure':
      return f.level !== undefined ? `Recycler on level ${f.level} broken` : `Recycler ${f.recycler ?? ''} broken`
    case 'outbreak':
      return `Outbreak on level ${f.level} (${f.cases} cases)`
    case 'food-shortage':
      return `Food deliveries down ${Math.round(f.fraction * 100)}%`
  }
}

function clock(state: SimCityState): string {
  const day = Math.floor(state.time / 86400) + 1
  return `Day ${day}, ${String(state.hourOfDay).padStart(2, '0')}:00`
}

const btn =
  'inline-flex items-center gap-1 rounded-md border border-slate-600 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40'
const danger =
  'inline-flex items-center gap-1 rounded-md border border-red-700/70 bg-red-950/30 px-2.5 py-1.5 text-xs font-medium text-red-200 hover:bg-red-900/40 disabled:cursor-not-allowed disabled:opacity-40'

/** Time controls and the failure buttons. Everything here acts on the real simulation. */
export function SimControls({
  sim,
  state,
  selectedId,
  playing,
  onPlaying,
  onReset,
}: {
  sim: Sim
  state: SimCityState
  selectedId: number
  playing: boolean
  onPlaying: (playing: boolean) => void
  onReset: () => void
}) {
  const networkDown = state.network === 'down'
  const levelCut = state.failures.some((f) => f.spec.kind === 'level-power-loss' && f.spec.level === selectedId)
  return (
    <section aria-label="Simulation controls" className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="sim-clock" className="mr-1 font-mono text-sm text-slate-100">
          {clock(state)}
        </span>
        <button type="button" className={btn} onClick={() => onPlaying(!playing)} data-testid="play-toggle">
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? 'Pause' : 'Play'}
        </button>
        <button type="button" className={btn} onClick={() => sim.step(1)}>
          <SkipForward className="size-3.5" />1 hour
        </button>
        <button type="button" className={btn} onClick={() => sim.step(24)}>
          <SkipForward className="size-3.5" />1 day
        </button>
        <button type="button" className={btn} onClick={onReset}>
          <RotateCcw className="size-3.5" />
          Reset
        </button>
        <span className="ml-auto text-slate-500">Seed {sim.seed}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-slate-300">Level {selectedId}:</span>
        <button
          type="button"
          className={danger}
          disabled={levelCut}
          data-testid="cut-power"
          onClick={() => sim.trigger({ kind: 'level-power-loss', level: selectedId, rampHours: 2 })}
        >
          Cut power
        </button>
        <button type="button" className={danger} onClick={() => sim.trigger({ kind: 'recycler-failure', level: selectedId })}>
          Break recycler
        </button>
        <button type="button" className={danger} onClick={() => sim.trigger({ kind: 'outbreak', level: selectedId, cases: 20 })}>
          Outbreak
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-slate-300">Whole Hollow:</span>
        <button
          type="button"
          className={danger}
          disabled={networkDown}
          data-testid="kill-network"
          onClick={() => sim.trigger({ kind: 'network-down' })}
        >
          Kill the network
        </button>
        <button type="button" className={danger} onClick={() => sim.trigger({ kind: 'generation-drop', fraction: 0.1 })}>
          Generators lose 10%
        </button>
        <button type="button" className={danger} onClick={() => sim.trigger({ kind: 'food-shortage', fraction: 0.2 })}>
          Food short 20%
        </button>
      </div>

      {state.failures.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-slate-800 pt-2" data-testid="active-failures">
          {state.failures.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-2 text-red-200">
              <span>{describe(f.spec)}</span>
              <button type="button" className={btn} onClick={() => sim.resolve(f.id)}>
                <Wrench className="size-3.5" />
                Fix
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-slate-500">Tap a level to pick it. Every number on this page comes from the simulation.</p>
    </section>
  )
}
