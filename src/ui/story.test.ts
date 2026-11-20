import { describe, expect, it } from 'vitest'
import { PROBLEMS, problemById } from '../world'
import { createSim } from '../sim'
import { STORY_STEPS, STEP_SECONDS, captionNumbers, railTally } from './story'

describe('story mode', () => {
  it('has the 8 steps in order with the right problem IDs', () => {
    expect(STORY_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(STORY_STEPS.map((s) => s.problems)).toEqual([[], [7], [8], [1], [2], [4, 9], [13, 14], []])
    expect(STORY_STEPS.map((s) => s.title)).toEqual([
      'The Hollow', 'Pass it on', 'Family', 'Warning', 'Fair split', 'Water and outbreak', 'The surface', 'Close',
    ])
  })

  it('fits about 2.5 minutes and uses no em or en dashes', () => {
    expect(STORY_STEPS.length * STEP_SECONDS).toBeLessThanOrEqual(150)
    for (const s of STORY_STEPS) expect(`${s.title} ${s.says}`).not.toMatch(/[–—]/)
  })

  it('reads caption numbers from the ProofValues it is given', () => {
    const proof = { networkDownReachPct: 61, familiesReconnectedPct: 31, blackoutWarningLeadHours: 1.5, outbreakUndercountRatio: 4.2 }
    expect(captionNumbers(STORY_STEPS[1]!, proof)).toEqual([
      { id: 7, label: problemById(7).proof.label, value: '61%' },
    ])
    expect(captionNumbers(STORY_STEPS[3]!, proof)[0]!.value).toBe('1.5 h')
    expect(captionNumbers(STORY_STEPS[3]!, { blackoutWarningLeadHours: 9 })[0]!.value).toBe('9 h')
    // Missing values stay missing so the bar can say "measuring...".
    const step6 = captionNumbers(STORY_STEPS[5]!, proof)
    expect(step6.map((c) => c.value)).toEqual([null, '4.2x'])
    expect(captionNumbers(STORY_STEPS[0]!, proof)).toEqual([])
  })

  it('tallies the rail from the problem list', () => {
    expect(railTally()).toEqual({ lit: PROBLEMS.length - 1, half: 1 })
  })

  it('step 1 and 6 make the real sim calls, and twice is harmless', () => {
    const sim = createSim({ seed: 42, hazards: false })
    STORY_STEPS[0]!.run!(sim)
    STORY_STEPS[0]!.run!(sim)
    STORY_STEPS[5]!.run!(sim)
    STORY_STEPS[5]!.run!(sim)
    const kinds = sim.getState().failures.map((f) => f.spec.kind).sort()
    expect(kinds).toEqual(['level-power-loss', 'network-down', 'recycler-failure'])
    expect(sim.getState().network).toBe('down')
  })
})
