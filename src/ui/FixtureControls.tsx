import type { CityState, LevelState } from '../world'

const POWERS: LevelState['power'][] = ['on', 'flicker', 'out']

/** Stand-in for the failure buttons the merge step adds. Edits the fixture only. */
export function FixtureControls({
  city,
  selectedId,
  onPower,
  onNetwork,
}: {
  city: CityState
  selectedId: number
  onPower: (id: number, power: LevelState['power']) => void
  onNetwork: (network: CityState['network']) => void
}) {
  const sel = city.levels.find((l) => l.id === selectedId)
  const btn = (active: boolean) =>
    `rounded-md border px-2.5 py-1.5 text-xs font-medium ${
      active ? 'border-emerald-400 bg-emerald-900/40 text-emerald-100' : 'border-slate-600 text-slate-300 hover:bg-slate-800'
    }`
  return (
    <div className="rounded-lg border border-dashed border-slate-600 p-3 text-xs">
      <p className="mb-2 text-slate-400">Fixture controls (placeholder data, not from the simulation). Tap a level, then set its power.</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-slate-300">Level {selectedId}:</span>
        {POWERS.map((p) => (
          <button key={p} type="button" data-testid={`set-power-${p}`} className={btn(sel?.power === p)} onClick={() => onPower(selectedId, p)}>
            {p}
          </button>
        ))}
        <span className="ml-2 text-slate-300">Network:</span>
        {(['up', 'down'] as const).map((n) => (
          <button key={n} type="button" data-testid={`set-network-${n}`} className={btn(city.network === n)} onClick={() => onNetwork(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}
