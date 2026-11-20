import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react'
import { problemById, type ProofValues } from '../world'
import type { Sim } from '../sim'
import { STEP_SECONDS, STORY_STEPS, captionNumbers, railTally } from './story'

const TICK_MS = 250
const btn =
  'inline-flex items-center gap-1 rounded-md border border-slate-600 px-2.5 py-1.5 text-sm font-medium text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40'

function highlight(target: string | null) {
  document.querySelectorAll('[data-story-active]').forEach((el) => el.removeAttribute('data-story-active'))
  if (!target) return
  const el = document.querySelector(`[data-story="${target}"]`)
  if (!el) return
  el.setAttribute('data-story-active', 'true')
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** The "Play the story" button. While a story runs it shows the caption bar instead. */
export function StoryMode({
  sim,
  proof,
  onReset,
  onFocus,
}: {
  sim: Sim
  proof: ProofValues
  onReset: () => void
  /** Problem IDs to light up on the rail. */
  onFocus: (ids: readonly number[]) => void
}) {
  const [index, setIndex] = useState<number | null>(null)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const elapsedRef = useRef(0)
  elapsedRef.current = elapsed

  const step = index === null ? null : STORY_STEPS[index]!
  const last = STORY_STEPS.length - 1

  const go = (i: number) => {
    setIndex(Math.max(0, Math.min(last, i)))
    setElapsed(0)
  }
  const start = () => {
    onReset()
    setPaused(false)
    go(0)
  }
  const exit = () => {
    setIndex(null)
    highlight(null)
    onFocus([])
    onReset()
  }

  // Real simulation calls for the step. Re-runs when reset swaps in a new sim.
  useEffect(() => {
    if (step) step.run?.(sim)
  }, [step, sim])

  // Scroll and ring each panel in turn across the step; step 6 also presses the notebook's own button.
  useEffect(() => {
    if (!step) return
    onFocus(step.problems)
    const timers: number[] = []
    step.targets.forEach((t, i) => {
      timers.push(window.setTimeout(() => highlight(t), (i * STEP_SECONDS * 1000) / step.targets.length / 1.4))
    })
    if (step.rewriteHistory) {
      timers.push(
        window.setTimeout(() => {
          const b = [...document.querySelectorAll<HTMLButtonElement>('[data-story="notebook"] button')].find((x) =>
            x.textContent?.includes('Rewrite history'),
          )
          if (b && !b.disabled) b.click()
        }, STEP_SECONDS * 1000 * 0.62),
      )
    }
    return () => timers.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Auto-advance. The last step stays up until the user exits.
  useEffect(() => {
    if (index === null || paused) return
    const t = setInterval(() => {
      const next = elapsedRef.current + TICK_MS
      if (next >= STEP_SECONDS * 1000) {
        if (index < last) go(index + 1)
      } else setElapsed(next)
    }, TICK_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused])

  if (!step || index === null) {
    return (
      <button type="button" data-testid="story-play" onClick={start} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-900/40 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-800/50">
        <Play className="size-4" />
        Play the story
      </button>
    )
  }

  const numbers = captionNumbers(step, proof)
  const tally = railTally()
  return (
    <>
      <div aria-hidden className="h-[50vh]" />
      <section
        aria-label="Story captions"
        data-testid="story-bar"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[50vh] overflow-y-auto border-t-2 border-emerald-600 bg-slate-950/97 px-4 py-2 shadow-2xl"
      >
        <div className="mx-auto max-w-3xl">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-mono text-xs text-emerald-300" data-testid="story-step">
              Step {step.n} of {STORY_STEPS.length}
            </p>
            <div className="h-1 flex-1 overflow-hidden rounded bg-slate-800">
              <div className="h-full bg-emerald-500" style={{ width: `${(elapsed / (STEP_SECONDS * 1000)) * 100}%` }} />
            </div>
          </div>
          <h2 className="mt-1 text-lg font-semibold text-slate-50">{step.title}</h2>
          {step.problems.map((id) => (
            <p key={id} className="mt-0.5 text-[11px] italic leading-tight text-slate-400 sm:text-xs">
              <span className="font-mono not-italic text-slate-500">#{id} </span>
              {problemById(id).brief}
            </p>
          ))}
          <p className="mt-1.5 text-sm leading-snug text-slate-100">{step.says}</p>
          {numbers.map((c) => (
            <p key={c.id} className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-800 pt-2">
              <span className="text-xs leading-snug text-slate-400">{c.label}</span>
              <span data-testid={`story-number-${c.id}`} className={c.value === null ? 'text-xs text-slate-500' : 'shrink-0 font-mono text-xl font-semibold text-emerald-300'}>
                {c.value ?? 'measuring...'}
              </span>
            </p>
          ))}
          {step.n === STORY_STEPS.length && (
            <p className="mt-2 border-t border-slate-800 pt-2 text-sm text-emerald-200" data-testid="story-tally">
              Rail: {tally.lit} lit, {tally.half} half lit.
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={btn} onClick={() => go(index - 1)} disabled={index === 0}>
              <ChevronLeft className="size-4" />
              Back
            </button>
            <button type="button" className={btn} onClick={() => setPaused(!paused)} data-testid="story-pause">
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" className={btn} onClick={() => go(index + 1)} disabled={index === last}>
              Next
              <ChevronRight className="size-4" />
            </button>
            <button type="button" className={`${btn} ml-auto`} onClick={exit} data-testid="story-exit">
              <X className="size-4" />
              Exit
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
