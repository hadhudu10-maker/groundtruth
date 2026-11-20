import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createSim, type Sim } from '../sim'

/** The seed the live site and the video use. Same seed, same city, same numbers. */
export const DEMO_SEED = 42
/** Real milliseconds per simulated hour while playing. */
export const HOUR_MS = 1000

function makeSim(seed: number): Sim {
  // Hazards off: nothing breaks unless someone presses a failure button, so the demo is repeatable.
  return createSim({ seed, hazards: false })
}

/** One live simulation for the page. Every number on screen comes from here. */
export function useSim(seed = DEMO_SEED) {
  const [sim, setSim] = useState(() => makeSim(seed))
  const state = useSyncExternalStore(sim.subscribe, sim.getState)
  const [playing, setPlaying] = useState(true)

  useEffect(() => {
    if (!playing) return
    const timer = setInterval(() => sim.step(1), HOUR_MS)
    return () => clearInterval(timer)
  }, [sim, playing])

  // `state` changes on every step, trigger and resolve; recompute the proof numbers then.
  const proof = useMemo(() => (state ? sim.proof() : {}), [sim, state])

  return {
    sim,
    state,
    proof,
    playing,
    setPlaying,
    reset: () => setSim(makeSim(seed)),
  }
}
