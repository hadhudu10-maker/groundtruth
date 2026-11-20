import { describe, expect, test } from 'vitest';
import { createSim, runHarness, type ScriptStep } from '../sim';
import { RESOURCES, maximinSplit, fairSplit } from '.';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('maximinSplit (javascript-lp-solver)', () => {
  test('equal needs and a shortage: everyone gets the same share', () => {
    const r = maximinSplit({ supply: 60, needs: [30, 30, 30] });
    expect(r.allocation.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([20, 20, 20]);
    expect(r.worstShare).toBeCloseTo(2 / 3, 6);
  });

  test('unequal needs: the same share of need, not the same amount', () => {
    const r = maximinSplit({ supply: 30, needs: [10, 20, 30] });
    expect(r.allocation[0]).toBeCloseTo(5, 6);
    expect(r.allocation[1]).toBeCloseTo(10, 6);
    expect(r.allocation[2]).toBeCloseTo(15, 6);
  });

  test('plenty of supply: everyone gets exactly their need and the rest is left over', () => {
    const r = maximinSplit({ supply: 100, needs: [10, 20, 30] });
    expect(r.allocation.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([10, 20, 30]);
    expect(r.worstShare).toBeCloseTo(1, 6);
    expect(r.leftover).toBeCloseTo(40, 6);
  });

  test('no supply gives nothing and does not throw', () => {
    const r = maximinSplit({ supply: 0, needs: [10, 20] });
    expect(r.allocation).toEqual([0, 0]);
  });

  test('a level that needs nothing gets nothing', () => {
    const r = maximinSplit({ supply: 10, needs: [0, 20] });
    expect(r.allocation[0]).toBe(0);
    expect(r.allocation[1]).toBeCloseTo(10, 6);
  });
});

/** A week of the Hollow with a generator shortage, so the deep levels pay. */
function shortWeek(seed = 42, fraction = 0.1) {
  const script: ScriptStep[] = [{ atHour: 12, trigger: { kind: 'generation-drop', fraction } }];
  return runHarness({ seed, hours: 24 * 7, hazards: false, script });
}

describe('proof of unfairness', () => {
  test('deepLevelPowerSharePct is exactly what sim.proof() reports when given the proof', () => {
    for (const [seed, fraction] of [[1, 0.05], [42, 0.1], [7, 0.2], [99, 0.3]] as const) {
      const run = shortWeek(seed, fraction);
      const split = fairSplit(run.timeline.at(-1)!, { proof: run.sim.proof() });
      expect(split.deepLevelPowerSharePct).toBeDefined();
      expect(split.deepLevelPowerSharePct).toBe(run.sim.proof().deepLevelPowerSharePct);
    }
  });

  test('from the state alone it agrees with sim.proof() to within the 0.1 h rounding of the state', () => {
    for (const [seed, fraction] of [[1, 0.05], [42, 0.1], [7, 0.2], [99, 0.3]] as const) {
      const run = shortWeek(seed, fraction);
      const got = fairSplit(run.timeline.at(-1)!).deepLevelPowerSharePct!;
      expect(Math.abs(got - run.sim.proof().deepLevelPowerSharePct!)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
    const run = runHarness({ seed: 5, hours: 72, hazards: false });
    expect(Math.abs(fairSplit(run.timeline.at(-1)!).deepLevelPowerSharePct! - run.sim.proof().deepLevelPowerSharePct!)).toBeLessThanOrEqual(0.2);
  });

  test('a fresh sim has no power hours to compare yet, and the proof option fills it in', () => {
    const sim = createSim({ seed: 5, hazards: false });
    expect(fairSplit(sim.getState(), { proof: sim.proof() }).deepLevelPowerSharePct).toBe(sim.proof().deepLevelPowerSharePct);
  });

  test('during a shortage the deepest level gets far fewer hours than the top level', () => {
    const split = fairSplit(shortWeek(42, 0.15).timeline.at(-1)!);
    const power = split.resources.power;
    const top = power.levels[0]!;
    const deepest = power.levels.at(-1)!;
    expect(top.level).toBe(1);
    expect(deepest.level).toBe(12);
    expect(deepest.actual).toBeLessThan(top.actual);
    expect(split.deepLevelPowerSharePct!).toBeLessThan(100);
    expect(split.unfair).toBe(true);
    expect(split.resources.power.gapPoints).toBeGreaterThan(0);
  });

  test('per-person water and food come straight from the level states', () => {
    const state = shortWeek().timeline.at(-1)!;
    const split = fairSplit(state);
    state.levels.forEach((l, i) => {
      expect(split.resources.water.levels[i]!.actual).toBe(l.received.water);
      expect(split.resources.food.levels[i]!.actual).toBe(l.received.food);
      expect(split.resources.power.levels[i]!.population).toBe(l.population);
    });
    // The Directorate weights food toward the top: the deepest level eats less per person.
    expect(split.resources.food.levels.at(-1)!.actual).toBeLessThan(split.resources.food.levels[0]!.actual);
  });

  test('power hours per day on the run basis are the run average, on the day basis the last 24 hours', () => {
    const state = shortWeek().timeline.at(-1)!;
    const run = fairSplit(state, { powerBasis: 'run' });
    const day = fairSplit(state, { powerBasis: 'day' });
    state.levels.forEach((l, i) => {
      expect(run.resources.power.levels[i]!.actual).toBeCloseTo((l.powerHoursTotal / (state.hour + 1)) * 24, 1);
      expect(day.resources.power.levels[i]!.actual).toBe(l.received.power);
    });
  });
});

describe('the fair alternative', () => {
  const cases = [
    ['calm week', () => runHarness({ seed: 3, hours: 24 * 7, hazards: false }).timeline.at(-1)!],
    ['10% drop', () => shortWeek(42, 0.1).timeline.at(-1)!],
    ['30% drop', () => shortWeek(11, 0.3).timeline.at(-1)!],
    ['hazards on', () => runHarness({ seed: 21, hours: 24 * 10, hazards: true }).timeline.at(-1)!],
    ['food shortage', () => runHarness({ seed: 8, hours: 72, hazards: false, script: [{ atHour: 6, trigger: { kind: 'food-shortage', fraction: 0.25 } }] }).timeline.at(-1)!],
  ] as const;

  for (const [name, make] of cases) {
    test(`${name}: never gives the worst-off level less than the actual split, and conserves totals`, () => {
      const split = fairSplit(make());
      for (const resource of RESOURCES) {
        const r = split.resources[resource];
        // Worst-off by share of need.
        expect(r.worstFairShare).toBeGreaterThanOrEqual(r.worstActualShare - 1e-6);
        // Same total supply, in person-units: nothing created, nothing lost, unless supply beat need.
        const tol = 1e-6 * Math.max(1, r.totalActual);
        if (r.totalActual <= r.totalNeed) expect(Math.abs(r.totalFair - r.totalActual)).toBeLessThan(tol + 1e-3 * r.totalActual);
        else expect(r.totalFair).toBeLessThanOrEqual(r.totalNeed + tol);
        // No level is given more than it needs.
        for (const l of r.levels) expect(l.fair).toBeLessThanOrEqual(r.need + 1e-6);
        // The fair split levels every level to the same share when there is a shortage.
        if (r.totalActual < r.totalNeed * 0.999) {
          const shares = r.levels.map((l) => l.fair / r.need);
          expect(Math.max(...shares) - Math.min(...shares)).toBeLessThan(1e-6);
        }
      }
    });
  }

  test('the same total supply: person-hours of power in equals person-hours of power out', () => {
    const state = shortWeek(42, 0.2).timeline.at(-1)!;
    const p = fairSplit(state).resources.power;
    const actual = sum(p.levels.map((l) => l.actual * l.population));
    const fair = sum(p.levels.map((l) => l.fair * l.population));
    expect(fair).toBeCloseTo(actual, 3);
  });

  test('raises the deepest level and lowers the top one when power is short', () => {
    const p = fairSplit(shortWeek(42, 0.2).timeline.at(-1)!).resources.power;
    expect(p.levels.at(-1)!.fair).toBeGreaterThan(p.levels.at(-1)!.actual);
    expect(p.levels[0]!.fair).toBeLessThanOrEqual(p.levels[0]!.actual);
  });
});
