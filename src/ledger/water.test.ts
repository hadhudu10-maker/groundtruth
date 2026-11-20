import { beforeAll, describe, expect, test } from 'vitest';
import { createSim, HOUR, recyclerNode, residentIdentity } from '../sim';
import { signNote, verifyNote, type VerifiedNote, type WaterBody } from '../world';
import { notebookFrom } from './notebook';
import {
  measureWater,
  WATER_SCENARIO,
  WATER_THRESHOLD,
  WATER_WINDOW_S,
  waterAlarms,
  waterLines,
  waterNotes,
  type WaterMeasurement,
} from './water';

const sim = createSim({ seed: 6, hazards: false });
const lines = waterLines(sim.getState());

function bad(resident: number, level: number, time: number): VerifiedNote<WaterBody> {
  return signNote<WaterBody>({ seq: time, time, body: { kind: 'water', level, tap: level * 100 + 1, result: 'bad' } }, residentIdentity(sim, resident));
}

describe('water notes', () => {
  test('one signed note per water observation, by the resident who tested, seq counting up', () => {
    const s = createSim({ seed: 6, hazards: false });
    s.trigger({ kind: 'recycler-failure', level: 12 });
    s.step(48);
    const obs = s.observations().filter((o) => o.type === 'water');
    const notes = waterNotes(s);
    expect(notes.length).toBe(obs.length);
    const lastSeq = new Map<string, number>();
    for (const [i, n] of notes.entries()) {
      const o = obs[i]!;
      const who = residentIdentity(s, o.resident);
      expect(verifyNote(n, who.publicKey)).toBe(true);
      expect(n.body).toEqual({ kind: 'water', level: o.level, tap: o.tap, result: o.result });
      expect(n.time).toBe(o.time);
      expect(n.seq).toBeGreaterThan(lastSeq.get(n.author) ?? 0);
      lastSeq.set(n.author, n.seq);
    }
  });
});

describe('line alarms', () => {
  test(`${WATER_THRESHOLD} different residents on one line within the window flag the whole line`, () => {
    const notes = [bad(15000, 12, 100), bad(15001, 11, 200), bad(15002, 12, 300)];
    const alarms = waterAlarms(notes, lines);
    expect(alarms).toHaveLength(1);
    expect(alarms[0]!.recycler).toBe(recyclerNode(11));
    expect(alarms[0]!.feeds).toEqual([11, 12]);
    expect(alarms[0]!.time).toBe(300);
    expect(alarms[0]!.reporters).toBe(3);
  });

  test('two reporters, one loud resident, reports spread out, or reports on different lines do not', () => {
    expect(waterAlarms([bad(15000, 12, 100), bad(15001, 12, 200)], lines)).toEqual([]);
    expect(waterAlarms([bad(15000, 12, 100), bad(15000, 12, 200), bad(15000, 12, 300)], lines)).toEqual([]);
    expect(waterAlarms([bad(15000, 12, 0), bad(15001, 12, WATER_WINDOW_S), bad(15002, 12, 2 * WATER_WINDOW_S)], lines)).toEqual([]);
    expect(waterAlarms([bad(15000, 12, 100), bad(15001, 10, 200), bad(15002, 8, 300)], lines)).toEqual([]);
  });

  test('a flag stays up while reports keep coming, lapses after a quiet window, and can be raised again', () => {
    const t = (h: number) => h * HOUR;
    const notes = [
      bad(15000, 12, t(0)), bad(15001, 12, t(1)), bad(15002, 12, t(2)), // raised at h2
      bad(15003, 11, t(10)), // keeps it up until h22
      bad(15004, 12, t(30)), bad(15005, 12, t(31)), bad(15006, 12, t(32)), // lapsed at h22, raised again at h32
    ];
    const alarms = waterAlarms(notebookFrom(notes).entries(), lines);
    expect(alarms.map((a) => [a.time / HOUR, a.until / HOUR])).toEqual([
      [2, 10 + WATER_WINDOW_S / HOUR],
      [32, 32 + WATER_WINDOW_S / HOUR],
    ]);
  });

  test('a broken recycler gets its line flagged within hours, and no other line is flagged', () => {
    const s = createSim({ seed: 6, hazards: false });
    s.trigger({ kind: 'recycler-failure', level: 12 });
    s.step(24);
    const alarms = waterAlarms(waterNotes(s), waterLines(s.getState()));
    expect(alarms.length).toBeGreaterThan(0);
    expect(alarms.every((a) => a.recycler === recyclerNode(11))).toBe(true);
    const start = s.events().find((e) => e.what === 'water-bad')!.time;
    expect(alarms[0]!.time - start).toBeLessThan(12 * HOUR);
  });
});

describe('badWaterWarnedPct from harness runs', () => {
  let m: WaterMeasurement;
  beforeAll(() => {
    m = measureWater();
  }, 120_000);

  test('most residents on a line that goes bad are warned before it does', () => {
    expect(m.runs).toBe(WATER_SCENARIO.seeds.length);
    expect(m.exposures.length).toBeGreaterThan(20);
    expect(m.proof.badWaterWarnedPct).toBeGreaterThan(50);
    expect(m.proof.badWaterWarnedPct).toBeLessThanOrEqual(100);
    const warnedPop = m.exposures.filter((e) => e.warned).reduce((s, e) => s + e.population, 0);
    const pop = m.exposures.reduce((s, e) => s + e.population, 0);
    expect(m.proof.badWaterWarnedPct).toBeCloseTo((100 * warnedPop) / pop, 1);
    for (const e of m.exposures) if (e.warned) expect(e.leadHours).toBeGreaterThanOrEqual(0);
  });

  test('false flags on clean lines are rare: under one per 20-day run', () => {
    expect(m.falseAlarms).toBeLessThan(m.runs);
  });

  test('same seeds, same number', () => {
    const a = measureWater({ seeds: [3, 4], hours: 20 * 24, hazards: true });
    const b = measureWater({ seeds: [3, 4], hours: 20 * 24, hazards: true });
    expect(a.proof).toEqual(b.proof);
    expect(a.exposures).toEqual(b.exposures);
  }, 30_000);
});
