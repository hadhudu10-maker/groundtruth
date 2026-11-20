import { describe, expect, test } from 'vitest';
import { createSim, demoScript, residentIdentity, runHarness } from '../sim';
import { caseTagOf, NOTE_MAX_BYTES, SICK_MAX_TAGS, signNote, verifyNote, type SickBody, type VerifiedNote } from '../world';
import { notebookFrom } from './notebook';
import {
  chapman,
  clinicVolunteer,
  estimateOutbreak,
  measureOutbreak,
  OUTBREAK_SCENARIO,
  outbreakReport,
  rankSupplies,
  sickNotes,
} from './outbreak';

const sim10days = () => {
  const sim = createSim({ seed: 13 });
  sim.step(10 * 24);
  return sim;
};

describe('Chapman estimate', () => {
  test('N = (n1 + 1)(n2 + 1)/(m + 1) - 1', () => {
    expect(chapman(0, 0, 0)).toBe(0);
    expect(chapman(10, 10, 10)).toBe(10);
    expect(chapman(20, 15, 5)).toBeCloseTo((21 * 16) / 6 - 1, 10);
    expect(chapman(7, 0, 0)).toBe(7);
  });

  test('never below the number of people actually named', () => {
    for (let n1 = 0; n1 < 15; n1++)
      for (let n2 = 0; n2 < 15; n2++)
        for (let m = 0; m <= Math.min(n1, n2); m++) expect(chapman(n1, n2, m)).toBeGreaterThanOrEqual(n1 + n2 - m - 1e-9);
  });
});

describe('sick notes from the two lists', () => {
  const sim = sim10days();
  const notes = sickNotes(sim);
  const lists = sim.sickLists();

  test('a self report is signed by the sick resident and carries their own case tag', () => {
    const self = notes.filter((n) => n.body.source === 'self');
    expect(self.length).toBe(lists.self.length);
    for (const [i, n] of self.entries()) {
      const who = residentIdentity(sim, lists.self[i]!);
      expect(n.author).toBe(who.keyId);
      expect(verifyNote(n, who.publicKey)).toBe(true);
      expect(n.body.caseTags).toEqual([caseTagOf(who.keyId)]);
      expect(n.body.level).toBe(who.level);
    }
  });

  test('clinic tallies carry up to 14 case tags, signed by a volunteer on that level', () => {
    const clinic = notes.filter((n) => n.body.source === 'clinic');
    expect(clinic.length).toBeGreaterThan(0);
    const tags = clinic.flatMap((n) => n.body.caseTags);
    expect(new Set(tags).size).toBe(lists.clinic.length);
    for (const r of lists.clinic) expect(tags).toContain(caseTagOf(residentIdentity(sim, r).keyId));
    for (const n of clinic) {
      expect(n.body.caseTags.length).toBeGreaterThanOrEqual(1);
      expect(n.body.caseTags.length).toBeLessThanOrEqual(SICK_MAX_TAGS);
      const volunteer = clinicVolunteer(sim, n.body.level);
      expect(volunteer.level).toBe(n.body.level);
      expect(n.author).toBe(volunteer.keyId);
      expect(verifyNote(n, volunteer.publicKey)).toBe(true);
    }
  });

  test('every note fits one sound message and every ID is unique', () => {
    for (const n of notes) expect(n.bytes.length).toBeLessThanOrEqual(NOTE_MAX_BYTES);
    expect(new Set(notes.map((n) => n.id)).size).toBe(notes.length);
  });
});

describe('estimate from the notebook alone', () => {
  const sim = sim10days();
  const nb = notebookFrom(sickNotes(sim));

  test('per level n1, n2 and m match the two lists matched by case tag', () => {
    const est = estimateOutbreak(nb.entries());
    for (const row of est) {
      const { self, clinic } = sim.sickLists(row.level);
      const both = self.filter((r) => clinic.includes(r)).length;
      expect([row.self, row.clinic, row.both]).toEqual([self.length, clinic.length, both]);
      expect(row.named).toBe(self.length + clinic.length - both);
      expect(row.estimate).toBeCloseTo(chapman(self.length, clinic.length, both), 10);
    }
    // Only levels with at least one sick note appear, in level order.
    const withNotes = sim.getState().levels.map((l) => l.id).filter((id) => {
      const { self, clinic } = sim.sickLists(id);
      return self.length + clinic.length > 0;
    });
    expect(est.map((r) => r.level)).toEqual(withNotes);
  });

  test('a repeated note, or a self report about someone else, does not change the count', () => {
    const entries = nb.entries();
    const base = estimateOutbreak(entries);
    const someone = residentIdentity(sim, 5);
    const lie = signNote<SickBody>({ seq: 9, time: 1, body: { kind: 'sick', level: 12, source: 'self', caseTags: ['deadbeef'] } }, someone);
    const notes: VerifiedNote[] = [...entries.map((e) => e.note), entries[0]!.note, lie];
    expect(estimateOutbreak(notes)).toEqual(base);
  });

  test('non-sick notes are ignored', () => {
    const someone = residentIdentity(sim, 5);
    const text = signNote({ seq: 1, time: 1, body: { kind: 'text', text: 'hello' } }, someone);
    expect(estimateOutbreak([text, ...nb.entries().map((e) => e.note)])).toEqual(estimateOutbreak(nb.entries()));
  });
});

describe('the estimate finds the hidden cases', () => {
  test.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i: far closer to the real count than the official number', (seed) => {
    const r = measureOutbreak({ ...OUTBREAK_SCENARIO, seed });
    const { official, estimate, actual, named } = r.total;
    expect(official).toBeLessThan(actual);
    expect(named).toBeLessThanOrEqual(actual);
    expect(estimate).toBeGreaterThan(named);
    expect(Math.abs(estimate - actual)).toBeLessThan(Math.abs(official - actual) / 2);
  });

  test('over 20 seeds: typically within a quarter of the truth, and on the low side (a conservative floor)', () => {
    const errors = Array.from({ length: 20 }, (_, i) => {
      const t = measureOutbreak({ ...OUTBREAK_SCENARIO, seed: 100 + i }).total;
      return (t.estimate - t.actual) / t.actual;
    }).sort((a, b) => a - b);
    const median = (errors[9]! + errors[10]!) / 2;
    expect(Math.abs(median)).toBeLessThan(0.25);
    expect(median).toBeLessThan(0);
  });

  test('works during the demo story too, while the official count is frozen', () => {
    const r = measureOutbreak({ seed: 42, hours: 10 * 24, hazards: false, script: demoScript() });
    expect(r.total.estimate).toBeGreaterThan(r.total.official * 5);
    expect(Math.abs(r.total.estimate - r.total.actual) / r.total.actual).toBeLessThan(0.35);
  });
});

describe('the proof number', () => {
  test('outbreakUndercountRatio is estimate over official from a harness run, same every time', () => {
    const a = measureOutbreak();
    const b = measureOutbreak();
    expect(a.proof).toEqual(b.proof);
    const ratio = a.total.estimate / a.total.official;
    expect(a.proof.outbreakUndercountRatio).toBeCloseTo(ratio, 1);
    expect(a.proof.outbreakUndercountRatio).toBeGreaterThan(1.5);
    expect(a.notebook.head().size).toBe(a.notes.length);
  });

  test('no official cases means not measured, never a made-up number', () => {
    const sim = createSim({ seed: 3, hazards: false });
    sim.step(1);
    const r = outbreakReport(sim);
    if (r.total.official === 0) expect(r.proof).toEqual({});
  });
});

describe('supply ranking', () => {
  test('splits every unit in proportion to estimated cases, highest first', () => {
    const rows = [
      { level: 3, estimate: 10 },
      { level: 11, estimate: 50 },
      { level: 12, estimate: 40 },
      { level: 1, estimate: 0 },
    ];
    const r = rankSupplies(100, rows);
    expect(r.map((x) => x.level)).toEqual([11, 12, 3, 1]);
    expect(r.map((x) => x.units)).toEqual([50, 40, 10, 0]);
    expect(r.map((x) => x.sharePct)).toEqual([50, 40, 10, 0]);
  });

  test('rounds so the units always add up, and never hands out more than given', () => {
    const rows = [7, 7, 7].map((estimate, i) => ({ level: i + 1, estimate }));
    const r = rankSupplies(10, rows);
    expect(r.reduce((s, x) => s + x.units, 0)).toBe(10);
    // Ties go to the deeper level first.
    expect(r.map((x) => x.units)).toEqual([4, 3, 3]);
    expect(r[0]!.level).toBe(3);
    for (const units of [0, 1, 99, 1000]) {
      const m = measureOutbreak();
      expect(rankSupplies(units, m.levels).reduce((s, x) => s + x.units, 0)).toBe(units);
    }
  });

  test('no cases anywhere: nothing to rank by, nothing handed out', () => {
    expect(rankSupplies(10, [{ level: 1, estimate: 0 }]).map((x) => x.units)).toEqual([0]);
  });
});
