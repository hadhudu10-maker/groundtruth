import { describe, expect, test } from 'vitest';
import { decodeNote, PROBLEMS, signNote, verifyNote, type CityState, type ProofMetric } from '../world';
import {
  createSim,
  demoScript,
  firstOutTimes,
  HOUR,
  recyclerNode,
  residentIdentity,
  runHarness,
  sourceLevelOf,
  type ScriptStep,
} from '.';

const WEEK = 24 * 7;

const script: ScriptStep[] = [
  { atHour: 10, trigger: { kind: 'generation-drop', fraction: 0.12 } },
  { atHour: 20, trigger: { kind: 'network-down' } },
  { atHour: 30, trigger: { kind: 'recycler-failure', level: 9 } },
  { atHour: 40, trigger: { kind: 'outbreak', level: 4, cases: 25 } },
  { atHour: 60, resolves: 0 },
  { atHour: 70, resolves: 1 },
];

describe('determinism', () => {
  test('the same seed and script give identical runs', () => {
    const a = runHarness({ seed: 42, hours: WEEK, script });
    const b = runHarness({ seed: 42, hours: WEEK, script });
    expect(JSON.stringify(b.timeline)).toBe(JSON.stringify(a.timeline));
    expect(JSON.stringify(b.observations)).toBe(JSON.stringify(a.observations));
    expect(b.events).toEqual(a.events);
    expect(b.proof).toEqual(a.proof);
    expect(b.sim.sickLists()).toEqual(a.sim.sickLists());
  });

  test('different seeds give different runs', () => {
    const a = runHarness({ seed: 1, hours: 48 });
    const b = runHarness({ seed: 2, hours: 48 });
    expect(JSON.stringify(b.timeline)).not.toBe(JSON.stringify(a.timeline));
  });

  test('reading state between steps does not change the run', () => {
    const quiet = createSim({ seed: 9 });
    quiet.step(WEEK);
    const nosy = createSim({ seed: 9 });
    for (let h = 0; h < WEEK; h++) {
      nosy.step(1);
      nosy.getState();
      nosy.sickLists();
      nosy.proof();
      nosy.observations(h * HOUR);
    }
    expect(JSON.stringify(nosy.getState())).toBe(JSON.stringify(quiet.getState()));
    expect(nosy.observations().length).toBe(quiet.observations().length);
  });

  test('observations come out in time order', () => {
    const { observations } = runHarness({ seed: 5, hours: 72, script });
    for (let i = 1; i < observations.length; i++) expect(observations[i]!.time).toBeGreaterThanOrEqual(observations[i - 1]!.time);
  });
});

describe('the contract', () => {
  test('state satisfies CityState: level 1 first, numbers in range', () => {
    const sim = createSim({ seed: 3 });
    sim.step(48);
    const state: CityState = sim.getState();
    expect(state.levels).toHaveLength(12);
    state.levels.forEach((l, i) => {
      expect(l.id).toBe(i + 1);
      expect(l.population).toBeGreaterThan(0);
      expect(['on', 'flicker', 'out']).toContain(l.power);
      expect(['ok', 'suspect', 'bad']).toContain(l.water);
      expect(l.air).toBeGreaterThanOrEqual(0);
      expect(l.air).toBeLessThanOrEqual(1);
      expect(l.received.power).toBeGreaterThanOrEqual(0);
      expect(l.received.power).toBeLessThanOrEqual(24);
      expect(l.received.water).toBeGreaterThanOrEqual(0);
      expect(l.received.food).toBeGreaterThan(0);
      expect(l.sick.actual).toBeGreaterThanOrEqual(0);
      expect(l.sick.official).toBeGreaterThanOrEqual(0);
    });
    expect(state.time).toBe(6 * HOUR + 48 * HOUR);
    expect(state.network).toBe('up');
  });

  test('deeper levels are more crowded and breathe worse air', () => {
    const { levels } = createSim({ seed: 11, hazards: false }).getState();
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!.population).toBeGreaterThan(levels[i - 1]!.population);
      expect(levels[i]!.air).toBeLessThan(levels[i - 1]!.air);
    }
  });

  test('proof fills only what it measures, and only known metrics', () => {
    const { proof } = runHarness({ seed: 4, hours: 72, hazards: false, script: demoScript() });
    const known = new Set<ProofMetric>(PROBLEMS.map((p) => p.proof.metric));
    for (const k of Object.keys(proof)) expect(known.has(k as ProofMetric)).toBe(true);
    expect(proof.deepLevelPowerSharePct).toBeGreaterThan(0);
    expect(proof.deepLevelPowerSharePct).toBeLessThan(100);
    // Not measured by the sim yet: other modules own these.
    expect(proof.blackoutWarningLeadHours).toBeUndefined();
    expect(proof.outbreakUndercountRatio).toBeUndefined();
  });

  test('state snapshots are stable between changes and replaced after them', () => {
    const sim = createSim({ seed: 1 });
    const s0 = sim.getState();
    expect(sim.getState()).toBe(s0);
    let calls = 0;
    const off = sim.subscribe(() => calls++);
    sim.step(1);
    expect(sim.getState()).not.toBe(s0);
    sim.trigger({ kind: 'network-down' });
    off();
    sim.step(1);
    expect(calls).toBe(2);
  });
});

describe('power: the deep levels lose first', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8])('under a generator shortage a deep level fails before upper levels (seed %i)', (seed) => {
    const run = runHarness({
      seed,
      hours: 48,
      hazards: false,
      script: [{ atHour: 2, trigger: { kind: 'generation-drop', fraction: 0.3 } }],
    });
    const out = firstOutTimes(run.events);
    expect(out.has(12)).toBe(true);
    expect(out.has(1)).toBe(false);
    // Whenever a level goes dark, every level below it is already dark.
    for (const [level, t] of out) {
      for (let deeper = level + 1; deeper <= 12; deeper++) {
        expect(out.get(deeper)).toBeDefined();
        expect(out.get(deeper)!).toBeLessThanOrEqual(t);
      }
    }
    // And the totals agree: the deepest level got fewer power hours than the top.
    const last = run.timeline.at(-1)!;
    expect(last.levels[11]!.powerHoursTotal).toBeLessThan(last.levels[0]!.powerHoursTotal);
  });

  test('"deep level loses power" flickers first, then goes dark, then comes back', () => {
    const sim = createSim({ seed: 21, hazards: false });
    sim.step(12);
    const id = sim.trigger({ kind: 'level-power-loss', rampHours: 6 });
    const flickersPerHour: number[] = [];
    let wentOut = -1;
    for (let h = 1; h <= 8; h++) {
      sim.step(1);
      const deepest = sim.getState().levels[11]!;
      flickersPerHour.push(deepest.zones.reduce((s, z) => s + z.flickersLastHour, 0));
      if (deepest.power === 'out' && wentOut < 0) wentOut = h;
    }
    expect(wentOut).toBeGreaterThan(1);
    expect(sim.getState().levels[11]!.power).toBe('out');
    expect(sim.getState().levels[0]!.power).toBe('on');
    // Warning signs before the dark: more flickers in the ramp than in a normal hour.
    expect(Math.max(...flickersPerHour.slice(0, wentOut - 1))).toBeGreaterThan(4);
    // A dark zone sends no heartbeat (the silence the canary listens for).
    const t = sim.getState().time;
    expect(sim.observations(t).some((o) => o.type === 'power' && o.level === 12 && o.event === 'ok')).toBe(false);
    sim.resolve(id);
    sim.step(1);
    expect(sim.getState().levels[11]!.power).not.toBe('out');
    const restored = sim.observations(sim.getState().time).filter((o) => o.type === 'power' && o.level === 12 && o.event === 'restored');
    expect(restored).toHaveLength(4);
    expect(restored[0]!.type === 'power' && restored[0]!.durationS).toBeGreaterThan(0);
  });

  test('losing power cascades into air and water', () => {
    const sim = createSim({ seed: 8, hazards: false });
    sim.step(6);
    const before = sim.getState().levels[11]!;
    sim.trigger({ kind: 'level-power-loss', rampHours: 0 });
    sim.step(24);
    const after = sim.getState().levels[11]!;
    expect(after.power).toBe('out');
    expect(after.received.power).toBe(0);
    expect(after.air).toBeLessThan(before.air - 0.2);
    expect(after.received.water).toBeLessThan(before.received.water / 2);
  });
});

describe('sickness: the official count is too low', () => {
  test.each([1, 2, 3, 4, 5])('official cases undercount actual cases (seed %i)', (seed) => {
    const run = runHarness({ seed, hours: 10 * 24 });
    let checked = 0;
    for (const state of run.timeline.slice(48)) {
      const actual = state.levels.reduce((s, l) => s + l.sick.actual, 0);
      const official = state.levels.reduce((s, l) => s + l.sick.official, 0);
      if (actual < 30) continue;
      expect(official).toBeLessThan(actual);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    const last = run.timeline.at(-1)!;
    const deep = last.levels.slice(6);
    const actual = deep.reduce((s, l) => s + l.sick.actual, 0);
    const official = deep.reduce((s, l) => s + l.sick.official, 0);
    expect(actual / Math.max(1, official)).toBeGreaterThan(1.5);
  });

  test('two incomplete sick lists overlap, and both miss some cases', () => {
    const sim = createSim({ seed: 13 });
    sim.step(10 * 24);
    const { self, clinic } = sim.sickLists();
    const actual = sim.getState().levels.reduce((s, l) => s + l.sick.actual, 0);
    const both = self.filter((r) => clinic.includes(r)).length;
    expect(self.length).toBeGreaterThan(0);
    expect(clinic.length).toBeGreaterThan(0);
    expect(both).toBeGreaterThan(0);
    expect(self.length + clinic.length - both).toBeLessThan(actual);
    // Every listed resident is on the level the list claims.
    for (const r of sim.sickLists(12).self) expect(sim.levelOfResident(r)).toBe(12);
  });

  test('the official count freezes while the network is down', () => {
    const sim = createSim({ seed: 17, hazards: false });
    sim.step(30); // past the first 06:00 publication
    sim.trigger({ kind: 'network-down' });
    const frozen = sim.getState().levels.map((l) => l.sick.official);
    sim.step(48);
    expect(sim.getState().network).toBe('down');
    expect(sim.getState().levels.map((l) => l.sick.official)).toEqual(frozen);
  });
});

describe('water', () => {
  test('a broken recycler sends bad water down its whole line, and only its line', () => {
    const sim = createSim({ seed: 6, hazards: false });
    const id = sim.trigger({ kind: 'recycler-failure', level: 12 });
    sim.step(3);
    const src = sourceLevelOf(12);
    expect(src).toBe(11);
    const state = sim.getState();
    expect(state.recyclers.find((r) => r.id === recyclerNode(11))!.contaminated).toBe(true);
    expect(state.levels[10]!.water).toBe('bad');
    expect(state.levels[11]!.water).toBe('bad');
    expect(state.levels[11]!.recycler).toBe(recyclerNode(11));
    expect(state.levels[0]!.water).toBe('ok');
    sim.step(24);
    const bad = sim.observations().filter((o) => o.type === 'water' && o.result === 'bad');
    expect(bad.filter((o) => o.level >= 11).length).toBeGreaterThan(bad.filter((o) => o.level < 11).length);
    sim.resolve(id);
    sim.step(1);
    expect(sim.getState().levels[11]!.water).toBe('ok');
  });

  test('the pipe map connects every tap to exactly one recycler', () => {
    const { pipeMap } = createSim({ seed: 1 });
    const parent = new Map(pipeMap.edges.map((e) => [e.to, e.from]));
    const recyclers = new Set(pipeMap.nodes.filter((n) => n.kind === 'recycler').map((n) => n.id));
    for (const tap of pipeMap.nodes.filter((n) => n.kind === 'tap')) {
      let node = tap.id;
      while (parent.has(node)) node = parent.get(node)!;
      expect(recyclers.has(node)).toBe(true);
      expect(node).toBe(recyclerNode(sourceLevelOf(tap.level)));
    }
    for (const n of pipeMap.nodes) expect(n.id).toBeLessThanOrEqual(0xffff);
  });
});

describe('the demo story', () => {
  test('the deepest level visibly fails and the network goes dark', () => {
    const run = runHarness({ seed: 2026, hours: 48, hazards: false, script: demoScript() });
    const last = run.timeline.at(-1)!;
    expect(last.levels[11]!.power).toBe('out');
    expect(last.levels[0]!.power).toBe('on');
    expect(last.network).toBe('down');
    expect(last.levels[11]!.water).toBe('bad');
  });
});

describe('residents as signers', () => {
  test('seeded identities are stable and sign notes that verify', () => {
    const sim = createSim({ seed: 31 });
    const a = residentIdentity(sim, 1234);
    const again = residentIdentity({ seed: 31, levelOfResident: sim.levelOfResident }, 1234);
    expect(again.keyId).toBe(a.keyId);
    expect(residentIdentity(sim, 1235).keyId).not.toBe(a.keyId);
    const other = createSim({ seed: 32 });
    expect(residentIdentity(other, 1234).keyId).not.toBe(a.keyId);
    expect(a.level).toBe(sim.levelOfResident(1234));

    const note = signNote(
      { seq: 1, time: sim.getState().time, body: { kind: 'power', level: a.level, zone: 0, event: 'flicker', durationS: 3 } },
      a,
    );
    expect(verifyNote(decodeNote(note.bytes), a.publicKey)).toBe(true);
  });
});
