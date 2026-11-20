// City-scale spread with the network down (proof numbers for problems 7 and 8).
//
// Real at human scale, simulated at city scale: the residents and their levels come from the Hollow
// simulation (createSim, population, levelOfResident). Every random draw comes from pure-rand, so a seed
// always gives the same run. No number here is typed by hand: the rail reads what measureSpread returns.
//
// The model, one round per simulated hour, starting at 06:00 when the network goes down:
//   - People pass notes only while awake (06:00 to 22:00).
//   - Each awake hour a resident starts a hand-off with probability `meetChance` (so about one hand-off
//     an hour each, counting the ones others start). The partner lives on the same level (85%) or on the
//     level just above or below (15%).
//   - `courierShare` of residents (porters, crews, medics) walk one level up or down every hour and start
//     `courierMeetings` hand-offs an hour wherever they are.
//   - A hand-off goes both ways. It is an animated QR bundle with probability `qrShare` (up to 40 notes,
//     newest first; the whole bundle arrives or none of it does, `qrSuccess`), otherwise sound
//     (`soundSeconds` of playing, 9.3 to 13.5 s per note, each note arriving with `soundNoteSuccess`).
//   - A relay keeps at most `carryLimit` notes it cannot check (store.ts PARKED_MAX = 200). Notes of
//     its own family are paired and kept for good.
//   - With `wantFirst`, the receiver asks for its family (a WANT message) and the giver sends those
//     notes first, each taking one place, before filling the rest of the room as usual.
//
// Problem 7, networkDownReachPct: one warning note is written by a random resident on the deepest level
// at the start. Being the newest note it rides at the front of every bundle. Reach = share of residents
// holding it 24 hours later; the rail shows the median over 200 seeded runs.
//
// Problem 8, familiesReconnectedPct: `splitShare` of residents belong to families of 2 to 5 split
// across levels (each extra member lives elsewhere with probability 1/2). Every one of them writes one
// "safe" note in the first hour, so their notes compete for room in bundles and in relays' storage.
// Each run follows up to 32 of those notes in full (whole families, about 8 a run) and treats the rest
// as background traffic of the same kind: a note gets into a bundle with probability
// bundle size / notes waiting, and a relay drops notes at random once it would carry more than
// `carryLimit`. The rail counts a family when at least one member holds the "safe" note of a relative
// living on another level within 48 hours (the label: families who got a "safe" note). The strict
// count, every member holding every relative's note, is reported next to it. Share over all followed
// families in 200 runs.
//
// Assumptions that are not measured: meeting rates, the courier share, the split share and the QR
// versus sound mix. Measured on real phones (Tue 2026-11-17, airplane mode): a 140 byte note crosses
// by sound in 9.3 s (fast) to 13.5 s (normal), every attempt passed both ways; an animated QR bundle
// delivered 20 of 20 notes. We use 0.85 for both success rates, the 95% lower bound on 20 of 20
// (rule of three), so the numbers lean low rather than high.
//
// Measured with the defaults, seeds 1..200 (Fri 2026-11-20, 3.7 s in Node). The rail reads measureSpread,
// not these lines:
//   networkDownReachPct     61   (median; reach climbs from hour 7 and stops at hour 16 when people sleep)
//   familiesReconnectedPct  31   (546 of 1763 followed split families heard "safe" from a relative on
//                                another level; this is the rail label's question. Strict version, every
//                                member holding every relative's note: 4 of 1763.)
// "Ask for my family" (wantFirst, the WANT message in forward.ts) is what moves this number: without it
// the same runs give 9% (162 of 1763), because a relative's note waits behind about 4000 others for one
// of 40 places in a bundle. Asking costs one sound message, counted against the sound budget.
// Tried and dropped (40 runs): a "courier mode" carrying 5000 unchecked notes gave 13% alone and nothing
// on top of asking. Carry limits of 2000 or 20000 do not help either: the limit is bundle room, not storage.
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';
import { createSim } from '../sim';
import type { ProofValues } from '../world';

export interface SpreadParams {
  reachHours: number;
  familyHours: number;
  meetChance: number;
  sameLevelShare: number;
  courierShare: number;
  courierMeetings: number;
  qrShare: number;
  qrSuccess: number;
  bundleNotes: number;
  soundSeconds: number;
  soundNoteSuccess: number;
  carryLimit: number;
  splitShare: number;
  /** "Ask for my family": the receiver names its family tag and the giver sends those notes first. */
  wantFirst: boolean;
}

export const DEFAULT_SPREAD: SpreadParams = {
  reachHours: 24,
  familyHours: 48,
  meetChance: 0.5,
  sameLevelShare: 0.85,
  courierShare: 0.02,
  courierMeetings: 3,
  qrShare: 0.6,
  qrSuccess: 0.85,
  bundleNotes: 40, // forward.ts BUNDLE_MAX_NOTES
  soundSeconds: 60,
  soundNoteSuccess: 0.85,
  carryLimit: 200, // store.ts PARKED_MAX
  splitShare: 0.25,
  wantFirst: true, // the app does this: the WANT message in forward.ts
};

const TRACKED_MAX = 32;
const AWAKE_FROM = 6;
const AWAKE_TO = 22;

export interface SpreadRun {
  seed: number;
  population: number;
  /** Share of residents holding the warning, index = hours since it was written (0..reachHours). */
  reachByHour: number[];
  splitFamilies: number;
  /** Strict: every member holds every relative's note. */
  familiesReconnected: number;
  /** The rail's number: at least one member holds a note from a relative on another level. */
  familiesHeard: number;
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function runSpread(seed: number, overrides: Partial<SpreadParams> = {}): SpreadRun {
  const P = { ...DEFAULT_SPREAD, ...overrides };
  const sim = createSim({ seed, hazards: false });
  const pop = sim.population;
  const levels = sim.levelCount;
  const g = xoroshiro128plus(seed ^ 0x5eed7);
  const float = () => (g.next() >>> 0) / 4294967296;
  const int = (n: number) => Math.floor(float() * n);

  // ---- residents by level; couriers move, everyone else stays home
  const home = new Uint8Array(pop);
  const byLevel: number[][] = Array.from({ length: levels + 1 }, () => []);
  for (let r = 0; r < pop; r++) {
    home[r] = sim.levelOfResident(r);
    byLevel[home[r]!]!.push(r);
  }
  const isCourier = new Uint8Array(pop);
  const where = Uint8Array.from(home);
  const couriers: number[] = [];
  for (let r = 0; r < pop; r++) if (float() < P.courierShare) (isCourier[r] = 1), couriers.push(r);
  const staying = byLevel.map((list) => list.filter((r) => !isCourier[r]));

  // ---- followed split families: whole families, at most 32 notes, one bit per note
  const famMask = new Uint32Array(pop); // bits of the resident's own family's notes (own note included)
  const ownBit = new Uint32Array(pop);
  const held = new Uint32Array(pop);
  const families: number[][] = [];
  const taken = new Uint8Array(pop);
  let bits = 0;
  const pickOn = (level: number) => {
    const list = staying[level]!;
    for (let tries = 0; tries < 50; tries++) {
      const r = list[int(list.length)]!;
      if (!taken[r]) return (taken[r] = 1), r;
    }
    return -1;
  };
  while (true) {
    const size = 2 + int(4);
    if (bits + size > TRACKED_MAX) break;
    const base = 1 + int(levels);
    const lv = [base];
    for (let i = 1; i < size; i++) lv.push(float() < 0.5 ? base : 1 + ((base - 1 + 1 + int(levels - 1)) % levels));
    if (lv.every((l) => l === base)) lv[size - 1] = 1 + ((base - 1 + 1 + int(levels - 1)) % levels);
    const members = lv.map(pickOn);
    if (members.some((m) => m < 0)) break;
    let mask = 0;
    members.forEach((m, i) => {
      ownBit[m] = (1 << (bits + i)) >>> 0;
      mask |= ownBit[m]!;
    });
    for (const m of members) famMask[m] = mask >>> 0;
    families.push(members);
    bits += size;
  }
  // Each followed note stands for `scale` real notes in circulation.
  const writers = Math.max(bits, Math.round(P.splitShare * pop));
  const scale = writers / Math.max(1, bits);

  // ---- the warning note
  const reach = new Uint8Array(pop);
  const deepest = byLevel[levels]!;
  reach[deepest[int(deepest.length)]!] = 1;
  let reached = 1;
  const reachByHour = [reached / pop];

  // ---- one direction of a hand-off
  const pass = (a: number, b: number) => {
    const qr = float() < P.qrShare;
    let room: number;
    let noteOk: number;
    if (qr) {
      if (float() >= P.qrSuccess) return;
      room = P.bundleNotes;
      noteOk = 1;
    } else {
      room = Math.floor(P.soundSeconds / (9.3 + 4.2 * float()));
      noteOk = P.soundNoteSuccess;
    }
    // Asking for your family is one more sound message before the hand-off. Count its time against
    // the same budget (it does not use QR room, which is shown after).
    if (P.wantFirst && !qr && famMask[b]) room -= 1;
    if (reach[a] && !reach[b]) {
      room -= 1; // the warning is newest, so it goes first
      if (noteOk >= 1 || float() < noteOk) (reach[b] = 1), reached++;
    }
    let lacking = held[a]! & ~held[b]!;
    if (!lacking || room <= 0) return;
    let got = 0;
    if (P.wantFirst) {
      // b named its family tag: a sends b's family notes first, each one its own slot.
      for (let x = lacking & famMask[b]!; x && room > 0; x &= x - 1) {
        const bit = x & -x;
        room -= 1;
        if (noteOk >= 1 || float() < noteOk) got |= bit;
      }
      lacking &= ~famMask[b]!;
    }
    const p = room <= 0 || !lacking ? 0 : Math.min(1, room / (popcount(lacking) * scale)) * noteOk;
    for (let x = lacking; p > 0 && x; x &= x - 1) {
      const bit = x & -x;
      if (p >= 1 || float() < p) got |= bit;
    }
    if (!got) return;
    held[b] = (held[b]! | got) >>> 0;
    // Room for notes this relay cannot check is limited; drop at random beyond it.
    let strangers = held[b]! & ~famMask[b]!;
    const allow = P.carryLimit / scale;
    const keep = Math.floor(allow) + (float() < allow % 1 ? 1 : 0);
    let n = popcount(strangers);
    while (n > keep) {
      let k = int(n);
      let x = strangers;
      while (k--) x &= x - 1;
      const bit = x & -x;
      strangers &= ~bit;
      held[b] = (held[b]! & ~bit) >>> 0;
      n--;
    }
  };

  let couriersOn: number[][] = [];
  const partnerOn = (level: number) => {
    const here = staying[level]!;
    const extra = couriersOn[level]!;
    const n = here.length + extra.length;
    const k = int(n);
    return k < here.length ? here[k]! : extra[k - here.length]!;
  };
  const meet = (a: number) => {
    let level = where[a]!;
    if (float() >= P.sameLevelShare) level = level === 1 ? 2 : level === levels ? levels - 1 : level + (float() < 0.5 ? -1 : 1);
    const b = partnerOn(level);
    if (b === a) return;
    pass(a, b);
    pass(b, a);
  };

  const hours = Math.max(P.reachHours, P.familyHours);
  for (let h = 0; h < hours; h++) {
    if (h === 0) for (let r = 0; r < pop; r++) if (ownBit[r]) held[r] = ownBit[r]!;
    for (const c of couriers) {
      const l = where[c]!;
      where[c] = l === 1 ? 2 : l === levels ? levels - 1 : l + (float() < 0.5 ? -1 : 1);
    }
    couriersOn = Array.from({ length: levels + 1 }, () => []);
    for (const c of couriers) couriersOn[where[c]!]!.push(c);
    const hod = (AWAKE_FROM + h) % 24;
    if (hod >= AWAKE_FROM && hod < AWAKE_TO) {
      for (let r = 0; r < pop; r++) {
        if (isCourier[r]) for (let k = 0; k < P.courierMeetings; k++) meet(r);
        else if (float() < P.meetChance) meet(r);
      }
    }
    if (h < P.reachHours) reachByHour.push(reached / pop);
  }

  const familiesReconnected = families.filter((members) => members.every((m) => (held[m]! & famMask[m]!) === famMask[m])).length;
  // The rail's question ("families who got a 'safe' note"): someone in the family holds the note of a
  // relative who lives on another level.
  const familiesHeard = families.filter((members) =>
    members.some((m) => {
      let elsewhere = 0;
      for (const o of members) if (o !== m && home[o] !== home[m]) elsewhere |= ownBit[o]!;
      return (held[m]! & elsewhere) !== 0;
    }),
  ).length;
  return { seed, population: pop, reachByHour, splitFamilies: families.length, familiesReconnected, familiesHeard };
}

export interface SpreadSummary {
  runs: number;
  /** Median over runs of the share of residents reached, per hour (0..reachHours). */
  reachByHour: number[];
  medianReach: number;
  splitFamilies: number;
  familiesReconnected: number;
  familiesHeard: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function measureSpread(opts: { runs?: number; firstSeed?: number; params?: Partial<SpreadParams> } = {}): SpreadSummary {
  const runs = opts.runs ?? 200;
  const first = opts.firstSeed ?? 1;
  const all: SpreadRun[] = [];
  for (let i = 0; i < runs; i++) all.push(runSpread(first + i, opts.params));
  const hours = all[0]!.reachByHour.length;
  const reachByHour = Array.from({ length: hours }, (_, h) => median(all.map((r) => r.reachByHour[h]!)));
  return {
    runs,
    reachByHour,
    medianReach: reachByHour[hours - 1]!,
    splitFamilies: all.reduce((s, r) => s + r.splitFamilies, 0),
    familiesReconnected: all.reduce((s, r) => s + r.familiesReconnected, 0),
    familiesHeard: all.reduce((s, r) => s + r.familiesHeard, 0),
  };
}

export function spreadProof(s: SpreadSummary): Pick<ProofValues, 'networkDownReachPct' | 'familiesReconnectedPct'> {
  return {
    networkDownReachPct: Math.round(100 * s.medianReach),
    // Matches the rail label in src/world/problems.ts: families who got a "safe" note from a relative.
    familiesReconnectedPct: Math.round((100 * s.familiesHeard) / Math.max(1, s.splitFamilies)),
  };
}
