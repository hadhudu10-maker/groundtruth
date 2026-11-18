// Placeholder data so the screens can be built before the simulation is wired in.
// These numbers are NOT from the simulation harness. The merge step replaces them with src/sim output.
import type { CityState, LevelState, ProofValues } from '../world'

const LEVEL_COUNT = 12

function level(id: number): LevelState {
  const depth = (id - 1) / (LEVEL_COUNT - 1)
  const population = Math.round(900 + depth * 2600)
  const actual = Math.round(population * (0.01 + depth * 0.09))
  return {
    id,
    population,
    power: 'on',
    air: Math.round((1 - depth * 0.45) * 100) / 100,
    water: id >= 10 ? 'suspect' : 'ok',
    received: { power: 22 - Math.round(depth * 10), water: 60, food: 1800 },
    sick: { actual, official: Math.round(actual * 0.3) },
  }
}

export function makeFixtureCity(): CityState {
  const levels = Array.from({ length: LEVEL_COUNT }, (_, i) => level(i + 1))
  levels[8] = { ...levels[8]!, power: 'flicker' }
  levels[11] = { ...levels[11]!, water: 'bad' }
  return { seed: 0, time: 0, network: 'up', levels }
}

/** Only some metrics, so the rail shows "not measured yet" for the rest. */
export const FIXTURE_PROOF: ProofValues = {
  blackoutWarningLeadHours: 6,
  deepLevelPowerSharePct: 41,
}
