import { describe, expect, test } from 'vitest';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { createIdentity, decodeNote, noteRef, signNote } from '../world';
import type { Identity, KeyIdHex, VerifiedNote } from '../world';
import { notebookFrom } from '../ledger';
import {
  DEFAULT_SURFACE_RULES,
  MAX_READINGS,
  buildSurfaceScenario,
  evaluateEvidence,
  generateRun,
  measureSurface,
  observerLikelihoods,
  parseVerdictNote,
  readNotebook,
  rulesCommitNote,
  rulesFingerprint,
  surfaceProof,
  verdictNote,
  verdictOfRun,
  type SurfaceRules,
} from '.';

const T0 = 1_800_000_000;

function who(name: string, level: number): Identity {
  const sk = new Uint8Array(32);
  sk.set(utf8ToBytes(name).subarray(0, 32));
  return createIdentity({ name, level, secretKey: sk });
}

function reading(author: Identity, seq: number, time: number, o2 = 20.9): VerifiedNote {
  return signNote(
    {
      seq,
      time,
      body: {
        kind: 'surface',
        probe: 1,
        readings: [
          { metric: 'o2', value: o2 },
          { metric: 'co2', value: 450 },
          { metric: 'pm25', value: 9 },
          { metric: 'radiation', value: 0.15 },
          { metric: 'temperature', value: 16 },
          { metric: 'toxin', value: 0.1 },
        ],
      },
    },
    author,
  );
}

function witness(w: Identity, seq: number, time: number, target: VerifiedNote): VerifiedNote {
  return signNote({ seq, time, body: { kind: 'witness', ref: noteRef(target.id) } }, w);
}

describe('rules first', () => {
  test('the fingerprint is stable and changes with any threshold or witness rule', () => {
    expect(rulesFingerprint(DEFAULT_SURFACE_RULES)).toBe(rulesFingerprint(structuredClone(DEFAULT_SURFACE_RULES)));
    expect(rulesFingerprint(DEFAULT_SURFACE_RULES)).toMatch(/^[0-9a-f]{64}$/);
    const looser: SurfaceRules = structuredClone(DEFAULT_SURFACE_RULES);
    looser.thresholds.radiation.max = 5;
    expect(rulesFingerprint(looser)).not.toBe(rulesFingerprint(DEFAULT_SURFACE_RULES));
    expect(rulesFingerprint({ ...DEFAULT_SURFACE_RULES, minWitnesses: 2 })).not.toBe(rulesFingerprint(DEFAULT_SURFACE_RULES));
  });

  test('the commit note carries the fingerprint under topic surface-rules', () => {
    const org = who('organizer', 1);
    const note = rulesCommitNote(org, DEFAULT_SURFACE_RULES, 1, T0);
    expect(note.body.kind).toBe('commit');
    if (note.body.kind !== 'commit') return;
    expect(note.body.topic).toBe('surface-rules');
    expect(bytesToHex(note.body.value)).toBe(rulesFingerprint(DEFAULT_SURFACE_RULES));
  });
});

describe('witnessed readings, read from the notebook', () => {
  const org = who('organizer', 1);
  const probe = who('probe', 1);
  const a = who('amal', 2);
  const b = who('basil', 3);
  const c = who('cora', 3);
  const d = who('dev', 3);
  const levels = new Map<KeyIdHex, number>([a, b, c, d].map((x) => [x.keyId, x.level]));
  const commit = rulesCommitNote(org, DEFAULT_SURFACE_RULES, 1, T0);

  test('a reading counts once three distinct witnesses on two levels signed it', () => {
    const r = reading(probe, 1, T0 + 10);
    const nb = notebookFrom([commit, r, witness(a, 1, T0 + 11, r), witness(b, 1, T0 + 12, r), witness(c, 1, T0 + 13, r)]);
    const out = readNotebook(nb, DEFAULT_SURFACE_RULES, levels);
    expect(out.rulesCommitIndex).toBe(0);
    expect(out.readings).toHaveLength(1);
    expect(out.readings[0]).toMatchObject({ witnesses: 3, counted: true, looksSafe: true });
  });

  test('two witnesses are not enough', () => {
    const r = reading(probe, 1, T0 + 10);
    const nb = notebookFrom([commit, r, witness(a, 1, T0 + 11, r), witness(b, 1, T0 + 12, r)]);
    expect(readNotebook(nb, DEFAULT_SURFACE_RULES, levels).readings[0]).toMatchObject({ witnesses: 2, counted: false });
  });

  test('witnesses all on one level are not independent', () => {
    const r = reading(probe, 1, T0 + 10);
    const nb = notebookFrom([commit, r, witness(b, 1, T0 + 11, r), witness(c, 1, T0 + 12, r), witness(d, 1, T0 + 13, r)]);
    expect(readNotebook(nb, DEFAULT_SURFACE_RULES, levels).readings[0]).toMatchObject({ witnesses: 3, levelCount: 1, counted: false });
  });

  test('the same witness signing twice counts once, and the author cannot witness their own reading', () => {
    const r = reading(a, 1, T0 + 10);
    const nb = notebookFrom([
      commit,
      r,
      witness(a, 2, T0 + 11, r), // the author
      witness(b, 1, T0 + 12, r),
      witness(b, 2, T0 + 13, r), // same key again, new note
      witness(c, 1, T0 + 14, r),
    ]);
    expect(readNotebook(nb, DEFAULT_SURFACE_RULES, levels).readings[0]).toMatchObject({ witnesses: 2, counted: false });
  });

  test('a reading recorded before the rules commit does not count', () => {
    const early = reading(probe, 1, T0 - 50);
    const late = reading(probe, 2, T0 + 10);
    const nb = notebookFrom([
      early,
      witness(a, 1, T0 - 49, early),
      witness(b, 1, T0 - 48, early),
      witness(c, 1, T0 - 47, early),
      commit,
      late,
      witness(a, 2, T0 + 11, late),
      witness(b, 2, T0 + 12, late),
      witness(c, 2, T0 + 13, late),
    ]);
    const out = readNotebook(nb, DEFAULT_SURFACE_RULES, levels);
    expect(out.readings.map((x) => x.noteId)).toEqual([late.id]);
    expect(out.ignoredBeforeRules).toBe(1);
  });

  test('a backdated reading recorded after the commit is still ignored', () => {
    const sneaky = reading(probe, 1, T0 - 5);
    const nb = notebookFrom([commit, sneaky, witness(a, 1, T0 + 1, sneaky), witness(b, 1, T0 + 2, sneaky), witness(c, 1, T0 + 3, sneaky)]);
    expect(readNotebook(nb, DEFAULT_SURFACE_RULES, levels).readings).toHaveLength(0);
  });

  test('rules that differ from the committed ones find no commit, so nothing counts', () => {
    const r = reading(probe, 1, T0 + 10);
    const nb = notebookFrom([commit, r, witness(a, 1, T0 + 11, r), witness(b, 1, T0 + 12, r), witness(c, 1, T0 + 13, r)]);
    const swapped = { ...DEFAULT_SURFACE_RULES, minWitnesses: 1 };
    const out = readNotebook(nb, swapped, levels);
    expect(out.rulesCommitIndex).toBeNull();
    expect(out.readings).toHaveLength(0);
  });

  test('a reading that breaks a published threshold does not look safe', () => {
    const r = reading(probe, 1, T0 + 10, 17.5);
    const nb = notebookFrom([commit, r, witness(a, 1, T0 + 11, r), witness(b, 1, T0 + 12, r), witness(c, 1, T0 + 13, r)]);
    expect(readNotebook(nb, DEFAULT_SURFACE_RULES, levels).readings[0]).toMatchObject({ counted: true, looksSafe: false });
  });
});

describe('the surface model', () => {
  test('same seed, same run; different seeds differ', () => {
    const r1 = generateRun(7);
    const r2 = generateRun(7);
    expect(r2).toEqual(r1);
    expect(generateRun(8).readings[0]!.values).not.toEqual(r1.readings[0]!.values);
    expect(r1.readings).toHaveLength(MAX_READINGS);
  });

  test('the hidden truth is safe in about half the seeds', () => {
    let safe = 0;
    for (let s = 1; s <= 400; s++) if (generateRun(s).safe) safe++;
    expect(safe).toBeGreaterThan(160);
    expect(safe).toBeLessThan(240);
  });

  test('witnesses are mostly honest: forged readings rarely reach the threshold', () => {
    let forged = 0;
    let forgedCounted = 0;
    for (let s = 1; s <= 200; s++) {
      for (const r of generateRun(s).readings) {
        if (r.forged) {
          forged++;
          if (r.counted) forgedCounted++;
        }
      }
    }
    expect(forged).toBeGreaterThan(500);
    expect(forgedCounted / forged).toBeLessThan(0.2);
  });
});

describe('doubter and believer', () => {
  const lik = observerLikelihoods();

  test('the likelihoods come from the model and favour the true state', () => {
    expect(lik.pSafeLooksSafe).toBeGreaterThan(0.6);
    expect(lik.pUnsafeLooksSafe).toBeLessThan(0.3);
    expect(lik.pSafeLooksSafe).toBeGreaterThan(lik.pUnsafeLooksSafe);
  });

  test('they start at 0.05 and 0.95 and are not in agreement', () => {
    const out = evaluateEvidence([], lik);
    expect(out.doubter).toEqual([0.05]);
    expect(out.believer).toEqual([0.95]);
    expect(out.agreedAt).toBeNull();
  });

  test('the same evidence moves both the same way, and they meet', () => {
    const evidence = Array.from({ length: 8 }, () => ({ looksSafe: true, counted: true, signatures: 4 }));
    const out = evaluateEvidence(evidence, lik);
    expect(out.agreedAt).not.toBeNull();
    expect(out.verdict).toBe('safe');
    expect(out.doubter.at(-1)!).toBeGreaterThan(0.5);
    expect(out.believer.at(-1)!).toBeGreaterThan(0.5);
    expect(Math.abs(out.believer.at(-1)! - out.doubter.at(-1)!)).toBeLessThanOrEqual(0.1);
    expect(out.signaturesAtAgreement).toBe(4 * out.agreedAt!);
    const bad = evaluateEvidence(evidence.map((e) => ({ ...e, looksSafe: false })), lik);
    expect(bad.verdict).toBe('unsafe');
  });

  test('readings that did not reach the witness threshold do not move them', () => {
    const out = evaluateEvidence([{ looksSafe: true, counted: false, signatures: 2 }], lik);
    expect(out.doubter).toEqual([0.05]);
    expect(out.agreedAt).toBeNull();
  });
});

describe('notebook and model agree', () => {
  test.each([3, 11, 29])('seed %i: the verdict read from signed notes matches the model run', (seed) => {
    const sc = buildSurfaceScenario(seed, { earlyReadings: 0 });
    const fromRun = verdictOfRun(generateRun(seed));
    const fromNotes = sc.verdict;
    expect(fromNotes.verdict).toBe(fromRun.verdict);
    expect(fromNotes.agreedAt).toBe(fromRun.agreedAt);
    expect(fromNotes.signaturesAtAgreement).toBe(fromRun.signaturesAtAgreement);
    expect(fromNotes.doubter).toEqual(fromRun.doubter);
  });

  test('the demo scenario records an early reading that is ignored, and a verdict note that fits one sound message', () => {
    const sc = buildSurfaceScenario(5);
    expect(sc.readout.ignoredBeforeRules).toBe(1);
    const note = verdictNote(sc.organizer, sc.verdict.verdict === 'unsafe' ? 'unsafe' : 'safe', 99, T0);
    expect(note.bytes.length).toBeLessThanOrEqual(140);
    expect(decodeNote(note.bytes).body.kind).toBe('text');
  });
});

describe('the verdict note', () => {
  const org = who('organizer', 1);
  test('carries the verdict and the rules fingerprint in 59 bytes or fewer', () => {
    for (const v of ['safe', 'unsafe'] as const) {
      const n = verdictNote(org, v, 5, T0);
      if (n.body.kind !== 'text') throw new Error('not text');
      expect(new TextEncoder().encode(n.body.text).length).toBeLessThanOrEqual(59);
      expect(parseVerdictNote(n)).toEqual({ verdict: v, rulesPrefix: rulesFingerprint(DEFAULT_SURFACE_RULES).slice(0, 16) });
    }
  });
  test('ordinary text is not a verdict', () => {
    expect(parseVerdictNote(signNote({ seq: 1, time: T0, body: { kind: 'text', text: 'hello' } }, org))).toBeNull();
  });
});

describe('measured over 500 seeded runs', () => {
  const m = measureSurface(500);
  test('they agree on the true answer in nearly every run', () => {
    expect(m.runs).toBe(500);
    expect(m.agreedCorrectPct).toBeGreaterThanOrEqual(95);
    expect(m.wrongPct).toBeLessThanOrEqual(3);
    expect(m.agreedCorrectPct + m.wrongPct + m.undecidedPct).toBeCloseTo(100, 5);
  });
  test('witnessesToAgreement is a real median that exceeds the per-reading minimum', () => {
    expect(m.witnessesToAgreement).toBeGreaterThan(DEFAULT_SURFACE_RULES.minWitnesses);
    expect(m.witnessesToAgreement).toBeLessThan(200);
  });
  test('surfaceProof exports exactly the measured value', () => {
    expect(surfaceProof(500)).toEqual({ witnessesToAgreement: m.witnessesToAgreement });
  });
});
