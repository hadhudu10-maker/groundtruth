import { motion } from 'framer-motion'
import { Droplet, Wifi, WifiOff, Wind, Zap, ZapOff } from 'lucide-react'
import type { CityState, LevelState } from '../world'

const POWER_LABEL: Record<LevelState['power'], string> = { on: 'Power on', flicker: 'Flickering', out: 'Power out' }
const WATER_LABEL: Record<LevelState['water'], string> = { ok: 'Water ok', suspect: 'Water suspect', bad: 'Water bad' }
const WATER_COLOR: Record<LevelState['water'], string> = {
  ok: 'text-sky-400',
  suspect: 'text-amber-400',
  bad: 'text-red-400',
}

function Windows({ level }: { level: LevelState }) {
  const count = Math.max(3, Math.min(14, Math.round(level.population / 250)))
  const lit = level.power !== 'out'
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <motion.span
          key={i}
          className="h-3 w-2 rounded-[2px] sm:w-3"
          animate={
            level.power === 'flicker'
              ? { opacity: [1, 0.15, 0.9, 0.1, 1], backgroundColor: '#fbbf24' }
              : { opacity: lit ? 1 : 0.5, backgroundColor: lit ? '#fde68a' : '#1e293b' }
          }
          transition={
            level.power === 'flicker'
              ? { duration: 1.2, repeat: Infinity, delay: (i % 5) * 0.13 }
              : { duration: 0.4 }
          }
        />
      ))}
    </div>
  )
}

function LevelRow({ level, selected, onSelect }: { level: LevelState; selected: boolean; onSelect: () => void }) {
  const out = level.power === 'out'
  const undercount = level.sick.actual > level.sick.official
  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Level ${level.id}: ${POWER_LABEL[level.power]}, ${WATER_LABEL[level.water]}`}
      data-testid={`level-${level.id}`}
      data-power={level.power}
      data-water={level.water}
      animate={{ backgroundColor: out ? '#05070a' : level.power === 'flicker' ? '#1f1a0e' : '#131b26' }}
      transition={{ duration: 0.4 }}
      className={`flex w-full items-center gap-2 border-b border-slate-800 px-2 py-2 text-left sm:gap-3 sm:px-3 ${
        selected ? 'outline outline-2 -outline-offset-2 outline-emerald-400' : ''
      }`}
    >
      <span className="w-8 shrink-0 font-mono text-xs text-slate-400">L{level.id}</span>
      <div className="min-w-0 flex-1">
        <Windows level={level} />
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
          <span className={`flex items-center gap-1 ${out ? 'font-semibold text-red-400' : level.power === 'flicker' ? 'text-amber-300' : 'text-emerald-300'}`}>
            {out ? <ZapOff className="size-3" /> : <Zap className="size-3" />}
            {POWER_LABEL[level.power]}
          </span>
          <span className={`flex items-center gap-1 ${WATER_COLOR[level.water]}`}>
            <Droplet className="size-3" />
            {WATER_LABEL[level.water]}
          </span>
          <span className="flex items-center gap-1 text-slate-400">
            <Wind className="size-3" />
            Air {Math.round(level.air * 100)}%
          </span>
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px] leading-tight">
        <div className="text-slate-300">{level.population.toLocaleString()} people</div>
        <div className={undercount ? 'text-red-300' : 'text-slate-400'}>
          sick {level.sick.actual} <span className="text-slate-500">(official {level.sick.official})</span>
        </div>
      </div>
    </motion.button>
  )
}

export function CityCrossSection({
  city,
  selectedId,
  onSelect,
}: {
  city: CityState
  selectedId?: number
  onSelect?: (id: number) => void
}) {
  const down = city.network === 'down'
  return (
    <section aria-label="Cross-section of the Hollow" className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900">
      <div className="flex items-center justify-between bg-slate-800 px-3 py-2 text-xs">
        <span className="font-semibold tracking-wide text-slate-200">THE HOLLOW, SIDE ON</span>
        <span
          data-testid="network-status"
          data-network={city.network}
          className={`flex items-center gap-1 font-medium ${down ? 'text-red-400' : 'text-emerald-400'}`}
        >
          {down ? <WifiOff className="size-4" /> : <Wifi className="size-4" />}
          Network {down ? 'down' : 'up'}
        </span>
      </div>
      <div className="h-2 bg-gradient-to-b from-slate-950 to-slate-800" aria-hidden />
      <div>
        {city.levels.map((l) => (
          <LevelRow key={l.id} level={l} selected={l.id === selectedId} onSelect={() => onSelect?.(l.id)} />
        ))}
      </div>
    </section>
  )
}
