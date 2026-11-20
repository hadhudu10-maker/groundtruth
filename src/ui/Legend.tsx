import type { ReactNode } from 'react'
import { CheckCircle2, CircleDot, Droplet, Wifi, WifiOff, Wind, Wrench, Zap, ZapOff } from 'lucide-react'

function Row({ sample, children }: { sample: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className="flex w-24 shrink-0 items-center gap-1 pt-px">{sample}</span>
      <span className="text-slate-300">{children}</span>
    </li>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-sm font-semibold text-amber-200/80">{title}</h3>
      <ul className="flex flex-col gap-1.5">{children}</ul>
    </div>
  )
}

const win = (color: string, opacity = 1) => (
  <span className="h-3 w-2 rounded-[2px]" style={{ backgroundColor: color, opacity }} aria-hidden />
)

/** Explains every mark on the dashboard. Uses the same icons and colors as the real components. */
export function Legend() {
  return (
    <details open className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-[11px]" data-testid="legend">
      <summary className="cursor-pointer text-base font-semibold text-slate-100">How to read this</summary>
      <div className="mt-3 flex flex-col gap-3">
        <Group title="The Hollow, side on">
          <Row sample={<span className="font-mono text-slate-400">L1 to L12</span>}>
            One row per level. L1 is the top, L12 the deepest and worst off.
          </Row>
          <Row sample={<>{win('#fde68a')}{win('#fde68a')}{win('#fde68a')}</>}>Lit windows: the level has power. More windows, more people.</Row>
          <Row sample={<>{win('#fbbf24', 0.4)}{win('#fbbf24')}{win('#fbbf24', 0.2)}</>}>Blinking amber: the power is flickering.</Row>
          <Row sample={<>{win('#1e293b', 0.5)}{win('#1e293b', 0.5)}{win('#1e293b', 0.5)}</>}>Dark windows: the power is out.</Row>
          <Row
            sample={
              <>
                <Zap className="size-3 text-emerald-300" />
                <Zap className="size-3 text-amber-300" />
                <ZapOff className="size-3 text-red-400" />
              </>
            }
          >
            Power on, flickering, or out.
          </Row>
          <Row
            sample={
              <>
                <Droplet className="size-3 text-sky-400" />
                <Droplet className="size-3 text-amber-400" />
                <Droplet className="size-3 text-red-400" />
              </>
            }
          >
            Tap water ok, suspect, or bad.
          </Row>
          <Row sample={<span className="flex items-center gap-1 text-slate-400"><Wind className="size-3" />Air 90%</span>}>
            Air quality. 100% is clean.
          </Row>
          <Row sample={<span className="text-slate-300">909 people</span>}>How many people live on the level.</Row>
          <Row
            sample={
              <span>
                <span className="text-red-300">sick 12</span> <span className="text-slate-500">(4)</span>
              </span>
            }
          >
            Real lung sickness cases, then the Directorate's official count in brackets. Red means the official number is too low.
          </Row>
          <Row
            sample={
              <>
                <Wifi className="size-3.5 text-emerald-400" />
                <WifiOff className="size-3.5 text-red-400" />
              </>
            }
          >
            The Directorate's network, up or shut down.
          </Row>
          <Row sample={<span className="h-3 w-10 rounded-sm outline outline-2 outline-emerald-400" />}>The level you picked. Tap any level.</Row>
        </Group>

        <Group title="Controls">
          <Row sample={<span className="font-mono text-slate-100">Day 1, 06:00</span>}>Simulated time. One hour passes each second while playing.</Row>
          <Row sample={<span className="rounded border border-red-700/70 bg-red-950/30 px-1.5 py-0.5 text-red-200">Cut power</span>}>
            Red buttons make something go wrong in the simulation.
          </Row>
          <Row sample={<span className="flex items-center gap-1 rounded border border-slate-600 px-1.5 py-0.5 text-slate-200"><Wrench className="size-3" />Fix</span>}>
            Ends that failure.
          </Row>
        </Group>

        <Group title="Problems answered">
          <Row sample={<span className="flex items-center gap-1 rounded-full bg-emerald-900/50 px-1.5 text-emerald-200"><CheckCircle2 className="size-3" />Lit</span>}>
            We answer this problem from the brief in full.
          </Row>
          <Row sample={<span className="flex items-center gap-1 rounded-full bg-amber-900/50 px-1.5 text-amber-200"><CircleDot className="size-3" />Half lit</span>}>
            We answer part of it (14: the lottery only).
          </Row>
          <Row sample={<span className="italic text-slate-400">Blackouts in...</span>}>The brief's exact words.</Row>
          <Row sample={<span className="font-mono text-sm font-semibold text-emerald-300">66.7%</span>}>
            The number that proves it, measured by the simulation.
          </Row>
          <Row sample={<span className="text-slate-500">not measured yet</span>}>That part is not built yet.</Row>
        </Group>
      </div>
    </details>
  )
}
