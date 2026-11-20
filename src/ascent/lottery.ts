// Problem 14, the half we claim: who goes up first, drawn so anyone can re-run and check it.
//
// Commit, close, reveal:
//   1. The organizer publishes `commit` 'lottery-seed' with SHA-256(seed). The seed stays secret.
//   2. Residents volunteer with a signed text note. Entries close at a time the organizer announces
//      with a `commit` 'notebook-head' whose value is the digest of the roll (the seed commit plus
//      every volunteer note signed before the close, in a fixed order).
//   3. The organizer reveals the seed in a `commit` 'lottery-reveal'.
//   4. Everyone ranks the entrants by SHA-256(seed || close digest || keyId) and takes the first k.
//
// Why the organizer cannot choose the crew: when the seed is committed, the close digest does not
// exist yet. It depends on volunteer notes that other people sign afterwards, so the organizer cannot
// pick a seed that favours anyone. Changing the seed after the commit fails the hash check, and the
// ranking has no free choice left once both values are public.
//
// The close time is fixed by the commit: entries close exactly LOTTERY_ENTRY_WINDOW_S after the seed
// commit's signed time, and a re-run rejects any other close ('close-time-changed'). Without this the
// organizer, who knows the seed, could watch the volunteers arrive and close at whichever moment gave
// the crew they wanted. (Lead review, 2026-11-20.)
//
// The organizer's own volunteer notes never count (security review, 2026-11-20). The organizer knows the
// seed before the close, and every note in the roll changes the close digest, so by signing its own
// volunteer note with a different seq or time it could try thousands of digests and publish the one that
// gives the crew it wants. Excluding its notes removes that lever from an organizer acting alone.
//
// Honest limits: an organizer working with an accomplice (a real resident, or a throwaway key residents
// have paired with) can still grind: the accomplice signs many variants of a volunteer note and spreads
// only the one the organizer picks. Only a draw where volunteers add their own secret, or a public random
// value after the close, would stop that. The organizer could also leave out a volunteer whose note has
// not spread widely; that volunteer's own copy then says 'roll-mismatch', so it is visible to them. And
// the organizer could refuse to reveal and so cancel a draw (visible to everyone).
// A copy that is missing a legitimate volunteer note cannot reproduce the close digest and says so
// ('roll-mismatch') instead of giving a different crew.
//
// Entrants are found by their signed time, not by notebook position, because two residents'
// notebooks hold the same notes in different orders. The close digest uses the same fixed order
// (time, then note ID), so every copy computes the same value.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { createIdentity, signNote } from '../world';
import type { Identity, KeyIdHex, Notebook, SignedNote, VerifiedNote } from '../world';
import { headDigest, notebookFrom } from '../ledger';
import { Rng, subSeed } from './rng';

export const VOLUNTEER_TEXT = 'volunteer: first up';

/** Entries close this long after the seed commit, fixed in advance so the organizer has no choice. */
export const LOTTERY_ENTRY_WINDOW_S = 3600;

/** The only valid close time for a seed commit. */
export function closeTimeFor(seedCommit: SignedNote): number {
  return seedCommit.time + LOTTERY_ENTRY_WINDOW_S;
}

export function volunteerNote(identity: Identity, seq: number, time: number): VerifiedNote {
  return signNote({ seq, time, body: { kind: 'text', text: VOLUNTEER_TEXT } }, identity);
}

export function seedCommitment(seed: Uint8Array): Uint8Array {
  return sha256(seed);
}

export function seedCommitNote(organizer: Identity, seed: Uint8Array, seq: number, time: number): VerifiedNote {
  return signNote({ seq, time, body: { kind: 'commit', topic: 'lottery-seed', value: seedCommitment(seed) } }, organizer);
}

export function revealNote(organizer: Identity, seed: Uint8Array, seq: number, time: number): VerifiedNote {
  return signNote({ seq, time, body: { kind: 'commit', topic: 'lottery-reveal', value: seed } }, organizer);
}

const isVolunteer = (n: SignedNote) => n.body.kind === 'text' && n.body.text === VOLUNTEER_TEXT;

/** Volunteer notes signed strictly before `closeTime`, not by the organizer, in the fixed order every copy uses. */
function rollVolunteers<N extends SignedNote>(notes: Iterable<N>, closeTime: number, organizer: KeyIdHex): N[] {
  return [...notes]
    .filter((n) => isVolunteer(n) && n.time < closeTime && n.author !== organizer)
    .sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
}

/** The digest of the roll: the seed commit, then the volunteers before the close, as a notebook head. */
export function rollDigest(seedCommit: VerifiedNote, notes: Iterable<VerifiedNote>, closeTime: number): Uint8Array {
  return headDigest(notebookFrom([seedCommit, ...rollVolunteers(notes, closeTime, seedCommit.author)]).head());
}

/** The organizer closes entries. `closeTime` is the note's own signed time. */
export function closeNote(
  organizer: Identity,
  seedCommit: VerifiedNote,
  notes: Iterable<VerifiedNote>,
  seq: number,
  closeTime: number,
): VerifiedNote {
  return signNote(
    { seq, time: closeTime, body: { kind: 'commit', topic: 'notebook-head', value: rollDigest(seedCommit, notes, closeTime) } },
    organizer,
  );
}

/** Rank by SHA-256(seed || close digest || keyId), smallest first, and take `k`. Input order does not matter. */
export function drawCrew(seed: Uint8Array, closeDigest: Uint8Array, entrants: readonly KeyIdHex[], k: number): KeyIdHex[] {
  return rankEntrants(seed, closeDigest, entrants).slice(0, k);
}

export function rankEntrants(seed: Uint8Array, closeDigest: Uint8Array, entrants: readonly KeyIdHex[]): KeyIdHex[] {
  return [...new Set(entrants)]
    .map((id) => ({ id, rank: bytesToHex(sha256(concatBytes(seed, closeDigest, hexToBytes(id)))) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map((x) => x.id);
}

export type DrawFailure =
  | 'no-commit'
  | 'seed-changed'
  | 'not-closed'
  | 'close-time-changed'
  | 'commit-after-close'
  | 'not-revealed'
  | 'reveal-before-close'
  | 'reveal-mismatch'
  | 'roll-mismatch';

export type DrawResult =
  | {
      ok: true;
      crew: KeyIdHex[];
      entrants: KeyIdHex[];
      ranking: KeyIdHex[];
      seedCommit: string;
      closeDigest: string;
      closeTime: number;
    }
  | { ok: false; reason: DrawFailure };

/**
 * Re-run the whole draw from one resident's own notebook copy. Checks the order of the organizer's
 * three notes by their own signed counter (the same in every copy), the seed against its commit, and
 * that this copy rebuilds the published close digest.
 */
export function runDraw(nb: Notebook, organizer: KeyIdHex, k: number): DrawResult {
  const notes = nb.entries().map((e) => e.note);
  const mine = notes.filter((n) => n.author === organizer);
  const commits = (topic: string) =>
    mine
      .filter((n) => n.body.kind === 'commit' && n.body.topic === topic)
      .sort((a, b) => a.seq - b.seq);

  const seeds = commits('lottery-seed');
  const first = seeds[0];
  if (!first || first.body.kind !== 'commit') return { ok: false, reason: 'no-commit' };
  const commitHex = bytesToHex(first.body.value);
  if (seeds.some((s) => s.body.kind === 'commit' && bytesToHex(s.body.value) !== commitHex)) {
    return { ok: false, reason: 'seed-changed' };
  }

  const heads = commits('notebook-head');
  const close = heads.find((h) => h.seq > first.seq);
  if (!close || close.body.kind !== 'commit') return { ok: false, reason: heads.length ? 'commit-after-close' : 'not-closed' };
  if (close.time < first.time) return { ok: false, reason: 'commit-after-close' };
  if (close.time !== closeTimeFor(first)) return { ok: false, reason: 'close-time-changed' };

  const reveals = commits('lottery-reveal');
  const reveal = reveals[0];
  if (!reveal || reveal.body.kind !== 'commit') return { ok: false, reason: 'not-revealed' };
  if (reveals.some((r) => r.seq <= close.seq)) return { ok: false, reason: 'reveal-before-close' };
  if (reveals.some((r) => r.body.kind !== 'commit' || bytesToHex(sha256(r.body.value)) !== commitHex)) {
    return { ok: false, reason: 'reveal-mismatch' };
  }

  const digest = rollDigest(first, notes, close.time);
  if (bytesToHex(digest) !== bytesToHex(close.body.value)) return { ok: false, reason: 'roll-mismatch' };

  const entrants = [...new Set(rollVolunteers(notes, close.time, organizer).map((n) => n.author))];
  const ranking = rankEntrants(reveal.body.value, digest, entrants);
  return {
    ok: true,
    crew: ranking.slice(0, k),
    entrants,
    ranking,
    seedCommit: commitHex,
    closeDigest: bytesToHex(digest),
    closeTime: close.time,
  };
}

// ---------------------------------------------------------------- a whole lottery, and its measurement

export const LOTTERY_T0 = 1_800_000_000;

export interface LotteryScenario {
  seed: number;
  k: number;
  organizer: Identity;
  volunteers: Identity[];
  names: Map<KeyIdHex, string>;
  /** Volunteers who signed after the close. They are in every notebook but never in the draw. */
  lateVolunteers: KeyIdHex[];
  commit: VerifiedNote;
  close: VerifiedNote;
  reveal: VerifiedNote;
  /** Every note, in the organizer's own order. */
  notes: VerifiedNote[];
  notebook: Notebook;
  secretSeed: Uint8Array;
}

export function buildLotteryScenario(seed: number, opts: { volunteers?: number; k?: number } = {}): LotteryScenario {
  const nVol = opts.volunteers ?? 30;
  const k = opts.k ?? 5;
  const rng = new Rng(subSeed(seed, 21));
  const names = new Map<KeyIdHex, string>();
  const make = (name: string, level: number) => {
    const id = createIdentity({ name, level, secretKey: rng.bytes(32) });
    names.set(id.keyId, name);
    return id;
  };
  const organizer = make('Organizer', 1);
  const volunteers = Array.from({ length: nVol }, (_, i) => make(`V${i + 1}`, 1 + (i % 12)));
  const late = [make('Late 1', 3), make('Late 2', 9)];
  const secretSeed = rng.bytes(32);

  const commit = seedCommitNote(organizer, secretSeed, 1, LOTTERY_T0);
  const vols = volunteers.map((v, i) => volunteerNote(v, 1, LOTTERY_T0 + 60 + i * 20));
  // Ordinary traffic in the same notebook, so the roll has to pick its notes out of a crowd.
  const chatter = volunteers.slice(0, 8).map((v, i) => signNote({ seq: 2, time: LOTTERY_T0 + 90 + i * 20, body: { kind: 'text', text: `hello from ${v.name}` } }, v));
  const closeTime = closeTimeFor(commit);
  const close = closeNote(organizer, commit, vols, 2, closeTime);
  const lateNotes = late.map((l, i) => volunteerNote(l, 1, closeTime + 30 + i * 10));
  const reveal = revealNote(organizer, secretSeed, 3, closeTime + 120);
  const notes = [commit, ...vols, ...chatter, close, ...lateNotes, reveal];
  return {
    seed,
    k,
    organizer,
    volunteers,
    names,
    lateVolunteers: late.map((l) => l.keyId),
    commit,
    close,
    reveal,
    notes,
    notebook: notebookFrom(notes),
    secretSeed,
  };
}

export interface LotteryMeasurement {
  residents: number;
  k: number;
  /** Share of independent re-runs, each on a copy in its own order, that got the same crew. */
  matchPct: number;
  crew: KeyIdHex[];
}

const lotteryCache = new Map<number, LotteryMeasurement>();

/** 200 simulated residents, each with a notebook copy in a different order, each re-running the draw. */
export function measureLottery(residents = 200, seed = 1): LotteryMeasurement {
  const key = residents * 1000 + seed;
  const hit = lotteryCache.get(key);
  if (hit) return hit;
  const sc = buildLotteryScenario(seed);
  const official = runDraw(sc.notebook, sc.organizer.keyId, sc.k);
  const crew = official.ok ? official.crew : [];
  const rng = new Rng(subSeed(seed, 22));
  let same = 0;
  for (let i = 0; i < residents; i++) {
    const copy = notebookFrom(rng.shuffled(sc.notes));
    const r = runDraw(copy, sc.organizer.keyId, sc.k);
    if (official.ok && r.ok && r.crew.length === crew.length && r.crew.every((c, j) => c === crew[j])) same++;
  }
  const m = { residents, k: sc.k, matchPct: (100 * same) / residents, crew };
  lotteryCache.set(key, m);
  return m;
}

/** The ProofValues subset for problem 14. Never hand-typed. */
export function lotteryProof(residents = 200): { lotteryRecheckMatchPct: number } {
  return { lotteryRecheckMatchPct: measureLottery(residents).matchPct };
}
