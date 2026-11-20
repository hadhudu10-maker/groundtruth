import { describe, expect, it } from 'vitest'
import { PROBLEMS, problemById } from '../world'
import { createSim } from '../sim'
import { createCanary, powerReadings } from '../canary'
import { waterAlarms, waterLines, waterNotes } from '../ledger'
import { STORY_STEPS, STORY_WARMUP_HOURS, STEP_SECONDS, captionNumbers, railTally } from './story'

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

  it('steps 1, 4 and 6 make the real sim calls, and twice is harmless', () => {
    const sim = createSim({ seed: 42, hazards: false })
    for (const i of [0, 0, 3, 3, 5, 5]) STORY_STEPS[i]!.run!(sim)
    expect(sim.getState().hour).toBe(STORY_WARMUP_HOURS)
    const kinds = sim.getState().failures.map((f) => f.spec.kind).sort()
    expect(kinds).toEqual(['level-power-loss', 'level-power-loss', 'network-down', 'recycler-failure'])
    expect(sim.getState().network).toBe('down')
  })

  it('played at its own pace, step 4 shows a warning before level 12 goes dark and step 6 a do not drink flag', () => {
    const sim = createSim({ seed: 42, hazards: false })
    const at = (i: number) => sim.step(STEP_SECONDS) && STORY_STEPS[i]!.run?.(sim) // one simulated hour per second
    STORY_STEPS[0]!.run!(sim)
    for (const i of [1, 2, 3]) at(i)
    const warned = (t: number) => {
      const c = createCanary()
      for (const r of powerReadings(sim.observations())) if (r.time <= t) c.ingest(r)
      c.check(t)
      return c.active(t).some((a) => a.level === sim.levelCount && a.kind === 'flicker-rise')
    }
    let warnedAt: number | undefined
    for (let h = 0; h < STEP_SECONDS && warnedAt === undefined; h++) {
      sim.step(1)
      if (warned(sim.getState().time)) warnedAt = sim.getState().time
    }
    expect(warnedAt).toBeDefined()
    const out = sim.events().find((e) => e.what === 'level-out' && e.level === sim.levelCount)
    expect(out === undefined || out.time > warnedAt!).toBe(true)

    at(4)
    at(5)
    sim.step(STEP_SECONDS / 2)
    const state = sim.getState()
    const notes = waterNotes(sim, sim.observations().filter((o) => o.type === 'water'))
    const standing = waterAlarms(notes, waterLines(state)).filter((a) => a.time <= state.time && state.time < a.until)
    expect(standing.some((a) => a.feeds.includes(sim.levelCount))).toBe(true)
  })
})
