import { describe, expect, test } from 'vitest';
import { createIdentity } from '../world';
import type { Identity, VerifiedNote } from '../world';
import { notebookFrom } from '../ledger';
import { Rng } from './rng';
import {
  buildLotteryScenario,
  closeNote,
  closeTimeFor,
  LOTTERY_ENTRY_WINDOW_S,
  drawCrew,
  lotteryProof,
  measureLottery,
  revealNote,
  runDraw,
  seedCommitNote,
  volunteerNote,
} from '.';

const T0 = 1_800_000_000;

function who(name: string, n: number): Identity {
  const sk = new Uint8Array(32);
  sk[0] = n + 1;
  sk[1] = name.length;
  return createIdentity({ name, level: 1 + (n % 6), secretKey: sk });
}

function setup(volunteers = 12, k = 4) {
  const organizer = who('organizer', 100);
  const seed = new Uint8Array(32).fill(7);
  const people = Array.from({ length: volunteers }, (_, i) => who(`v${i}`, i));
  const commit = seedCommitNote(organizer, seed, 1, T0);
  const vols = people.map((p, i) => volunteerNote(p, 1, T0 + 10 + i));
  const closeTime = closeTimeFor(commit);
  const close = closeNote(organizer, commit, vols, 2, closeTime);
  const reveal = revealNote(organizer, seed, 3, closeTime + 10);
  const all: VerifiedNote[] = [commit, ...vols, close, reveal];
  return { organizer, seed, people, commit, vols, close, reveal, all, closeTime, k };
}

describe('two different closes for one draw (security review M6)', () => {
  test('each group alone gets a result, but a copy holding both closes refuses the draw', () => {
    const s = setup();
    // A second close at the same fixed time that leaves one volunteer out, spread to another group.
    const otherClose = closeNote(s.organizer, s.commit, s.vols.slice(1), 4, s.closeTime);
    expect(runDraw(notebookFrom(s.all), s.organizer.keyId, s.k).ok).toBe(true);
    const both = runDraw(notebookFrom([...s.all, otherClose]), s.organizer.keyId, s.k);
    expect(both).toEqual({ ok: false, reason: 'two-closes' });
  });
});

describe('the close time is fixed by the commit', () => {
  test('entries close exactly one window after the seed commit', () => {
    const s = setup();
    expect(s.close.time).toBe(T0 + LOTTERY_ENTRY_WINDOW_S);
    expect(runDraw(notebookFrom(s.all), s.organizer.keyId, s.k).ok).toBe(true);
  });

  test('an organizer who closes at a moment of their choosing is caught', () => {
    const s = setup();
    // Close early, right after the first few volunteers, hoping for a better crew.
    for (const t of [T0 + 13, T0 + LOTTERY_ENTRY_WINDOW_S - 1, T0 + LOTTERY_ENTRY_WINDOW_S + 1]) {
      const picked = closeNote(s.organizer, s.commit, s.vols, 2, t);
      const reveal = revealNote(s.organizer, s.seed, 3, t + 10);
      const r = runDraw(notebookFrom([s.commit, ...s.vols, picked, reveal]), s.organizer.keyId, s.k);
      expect(r).toEqual({ ok: false, reason: 'close-time-changed' });
    }
  });
});

describe('the draw', () => {
  test('the same crew comes out of notebook copies that received the notes in different orders', () => {
    const s = setup();
    const base = runDraw(notebookFrom(s.all), s.organizer.keyId, s.k);
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    expect(base.crew).toHaveLength(s.k);
    const rng = new Rng(3);
    for (let i = 0; i < 25; i++) {
      const r = runDraw(notebookFrom(rng.shuffled(s.all)), s.organizer.keyId, s.k);
      expect(r.ok && r.crew).toEqual(base.crew);
    }
  });

  test('the crew is drawn from the volunteers only', () => {
    const s = setup();
    const r = runDraw(notebookFrom(s.all), s.organizer.keyId, s.k);
    if (!r.ok) throw new Error(r.reason);
    const ids = new Set(s.people.map((p) => p.keyId));
    for (const c of r.crew) expect(ids.has(c)).toBe(true);
    expect(r.entrants).toHaveLength(12);
  });

  test('a reveal that does not match the commit is rejected', () => {
    const s = setup();
    const lie = revealNote(s.organizer, new Uint8Array(32).fill(9), 3, s.closeTime + 10);
    const r = runDraw(notebookFrom([s.commit, ...s.vols, s.close, lie]), s.organizer.keyId, s.k);
    expect(r).toEqual({ ok: false, reason: 'reveal-mismatch' });
  });

  test('changing the seed after the commit is detected', () => {
    const s = setup();
    const second = seedCommitNote(s.organizer, new Uint8Array(32).fill(9), 4, s.closeTime + 5);
    const r = runDraw(notebookFrom([...s.all, second]), s.organizer.keyId, s.k);
    expect(r).toEqual({ ok: false, reason: 'seed-changed' });
  });

  test('an entrant added after the close is excluded and changes nothing', () => {
    const s = setup();
    const base = runDraw(notebookFrom(s.all), s.organizer.keyId, s.k);
    const late = volunteerNote(who('late', 50), 1, s.closeTime + 1);
    const r = runDraw(notebookFrom([...s.all, late]), s.organizer.keyId, s.k);
    expect(r.ok).toBe(true);
    if (!r.ok || !base.ok) return;
    expect(r.entrants).not.toContain(late.author);
    expect(r.crew).toEqual(base.crew);
  });

  test('a seed committed after the close is rejected', () => {
    const s = setup();
    const lateCommit = seedCommitNote(s.organizer, s.seed, 9, s.closeTime + 5);
    const r = runDraw(notebookFrom([...s.vols, s.close, lateCommit, s.reveal]), s.organizer.keyId, s.k);
    expect(r.ok).toBe(false);
  });

  test('not revealed yet, or revealed before the close, is not a result', () => {
    const s = setup();
    expect(runDraw(notebookFrom([s.commit, ...s.vols, s.close]), s.organizer.keyId, s.k)).toEqual({ ok: false, reason: 'not-revealed' });
    expect(runDraw(notebookFrom([s.commit, ...s.vols]), s.organizer.keyId, s.k)).toEqual({ ok: false, reason: 'not-closed' });
    expect(runDraw(notebookFrom([...s.vols]), s.organizer.keyId, s.k)).toEqual({ ok: false, reason: 'no-commit' });
    const early = revealNote(s.organizer, s.seed, 0, s.closeTime - 5);
    expect(runDraw(notebookFrom([s.commit, ...s.vols, s.close, early]), s.organizer.keyId, s.k)).toEqual({
      ok: false,
      reason: 'reveal-before-close',
    });
  });

  test('the organizer cannot grind the close digest with volunteer notes of its own', () => {
    // Security review 2026-11-20: the organizer knows the seed before the close. If its own volunteer
    // notes counted, each new seq would give a new close digest and a new crew to choose from.
    const s = setup();
    const base = runDraw(notebookFrom(s.all), s.organizer.keyId, s.k);
    if (!base.ok) throw new Error(base.reason);
    for (let seq = 10; seq < 40; seq++) {
      const own = volunteerNote(s.organizer, seq, T0 + 20);
      const close = closeNote(s.organizer, s.commit, [...s.vols, own], 2, s.closeTime);
      expect(close.body).toEqual(s.close.body); // the digest ignores the organizer's note
      const r = runDraw(notebookFrom([s.commit, ...s.vols, own, close, s.reveal]), s.organizer.keyId, s.k);
      if (!r.ok) throw new Error(r.reason);
      expect(r.entrants).not.toContain(s.organizer.keyId);
      expect(r.crew).toEqual(base.crew);
    }
  });

  test('a copy missing a volunteer cannot reproduce the published close', () => {
    const s = setup();
    const r = runDraw(notebookFrom(s.all.filter((n) => n !== s.vols[3])), s.organizer.keyId, s.k);
    expect(r).toEqual({ ok: false, reason: 'roll-mismatch' });
  });

  test('the ranking depends on the seed and on the close digest', () => {
    const entrants = Array.from({ length: 20 }, (_, i) => who(`e${i}`, i).keyId);
    const a = drawCrew(new Uint8Array(32).fill(1), new Uint8Array(32).fill(5), entrants, 5);
    const b = drawCrew(new Uint8Array(32).fill(2), new Uint8Array(32).fill(5), entrants, 5);
    const c = drawCrew(new Uint8Array(32).fill(1), new Uint8Array(32).fill(6), entrants, 5);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
    expect(drawCrew(new Uint8Array(32).fill(1), new Uint8Array(32).fill(5), [...entrants].reverse(), 5)).toEqual(a);
  });

  test('a crew larger than the entrants is everyone', () => {
    const e = [who('a', 1).keyId, who('b', 2).keyId];
    expect(drawCrew(new Uint8Array(32), new Uint8Array(32), e, 5)).toHaveLength(2);
  });
});

describe('measured over 200 residents', () => {
  const m = measureLottery(200);
  test('every independent re-run picks the same crew', () => {
    expect(m.residents).toBe(200);
    expect(m.matchPct).toBe(100);
    expect(m.crew).toHaveLength(m.k);
  });
  test('lotteryProof exports the measured value', () => {
    expect(lotteryProof(200)).toEqual({ lotteryRecheckMatchPct: m.matchPct });
  });
  test('the scenario has a late volunteer that never gets in', () => {
    const sc = buildLotteryScenario(1);
    expect(sc.lateVolunteers.length).toBeGreaterThan(0);
    const r = runDraw(sc.notebook, sc.organizer.keyId, sc.k);
    expect(r.ok && sc.lateVolunteers.some((l) => r.entrants.includes(l))).toBe(false);
  });
});
