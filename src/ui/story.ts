import { PROBLEMS, problemById, type Problem, type ProofValues } from '../world'
import type { Sim } from '../sim'
import { formatProof } from './format'

/** Seconds each step stays up. Eight steps make about 2.4 minutes. */
export const STEP_SECONDS = 18

export interface StoryStep {
  n: number
  title: string
  /** Brief problem IDs this step answers, in the order shown. */
  problems: readonly Problem['id'][]
  /** `data-story` names of the panels shown, scrolled to in order across the step. */
  targets: readonly string[]
  /** One plain sentence of what is happening. */
  says: string
  /** Real simulation calls, the same ones the failure buttons make. Safe to run twice. */
  run?: (sim: Sim) => void
  /** Click the notebook panel's own "Rewrite history" button partway through. */
  rewriteHistory?: boolean
}

/**
 * Calm simulated hours before the first failure (run instantly when the story starts). The blackout
 * warning compares each level with its own past, the Directorate publishes its count each morning, and
 * the notebook fills with sick notes, so without them steps 4 and 6 would have nothing to show.
 */
export const STORY_WARMUP_HOURS = 72

function has(sim: Sim, kind: string, level?: number): boolean {
  return sim.getState().failures.some((f) => f.spec.kind === kind && (level === undefined || ('level' in f.spec && f.spec.level === level)))
}

export const STORY_STEPS: readonly StoryStep[] = [
  {
    n: 1,
    title: 'The Hollow',
    problems: [],
    targets: ['city'],
    says: 'Three ordinary days pass. Then a deep level loses power and the Directorate shuts the network down. Nothing here needs it from now on.',
    run: (sim) => {
      const hour = sim.getState().hour
      if (hour < STORY_WARMUP_HOURS) sim.step(STORY_WARMUP_HOURS - hour)
      const deep = sim.levelCount - 1
      if (!has(sim, 'level-power-loss', deep)) sim.trigger({ kind: 'level-power-loss', level: deep, rampHours: 2 })
      if (!has(sim, 'network-down')) sim.trigger({ kind: 'network-down' })
    },
  },
  {
    n: 2,
    title: 'Pass it on',
    problems: [7],
    targets: ['spread'],
    says: 'Signed notes hop from phone to phone by sound and QR. This is real on two phones in airplane mode; the city number below is the seeded simulation.',
  },
  {
    n: 3,
    title: 'Family',
    problems: [8],
    targets: ['spread'],
    says: 'Family notes are locked to a family key and carried by anyone. When a relative asks for their family, carriers hand those notes over first.',
  },
  {
    n: 4,
    title: 'Warning',
    problems: [1],
    targets: ['city', 'warning'],
    says: "Level 12's power starts to fail. Plugged-in devices write power notes, the flickers rise, and the warning fires before the level goes dark.",
    run: (sim) => {
      if (!has(sim, 'level-power-loss', sim.levelCount)) sim.trigger({ kind: 'level-power-loss', level: sim.levelCount, rampHours: 8 })
    },
  },
  {
    n: 5,
    title: 'Fair split',
    problems: [2],
    targets: ['fair'],
    says: 'The same notes, added up per level, show the deep levels got a fraction of the hours. The fair plan sits next to it.',
  },
  {
    n: 6,
    title: 'Water and outbreak',
    problems: [4, 9],
    targets: ['water', 'outbreak', 'notebook'],
    says: 'Bad tap tests pile up on one recycler line until it gets a "do not drink" flag. Two lists reveal the real case count, then the Directorate tries to rewrite the notebook.',
    run: (sim) => {
      if (!has(sim, 'recycler-failure', sim.levelCount)) sim.trigger({ kind: 'recycler-failure', level: sim.levelCount })
    },
    rewriteHistory: true,
  },
  {
    n: 7,
    title: 'The surface',
    problems: [13, 14],
    targets: ['surface', 'lottery'],
    says: 'Readings arrive, witnesses sign, and a doubter and a believer agree. The verdict is a signed note anyone can pass on. Then the first crew is drawn by a lottery anyone can re-run.',
  },
  {
    n: 8,
    title: 'Close',
    problems: [],
    targets: ['rail'],
    says: 'The notebook that proved the water was bad is the one that proved the air was good.',
  },
]

export interface CaptionNumber {
  id: Problem['id']
  label: string
  /** Formatted value, or null while the harness has not produced it yet. */
  value: string | null
}

/** The numbers a step shows, read from the same ProofValues the rail uses. */
export function captionNumbers(step: StoryStep, proof: ProofValues): CaptionNumber[] {
  return step.problems.map((id) => {
    const p = problemById(id)
    const v = proof[p.proof.metric]
    return { id, label: p.proof.label, value: v === undefined ? null : formatProof(p, v) }
  })
}

/** The close step's "7 lit, 1 half lit", counted from the problem list. */
export function railTally(): { lit: number; half: number } {
  return {
    lit: PROBLEMS.filter((p) => p.status === 'full').length,
    half: PROBLEMS.filter((p) => p.status === 'partial').length,
  }
}
