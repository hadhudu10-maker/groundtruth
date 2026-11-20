// Problem 9: the real size of the outbreak, from the notebook alone.
//
// Two incomplete lists of people who are sick right now: residents who reported themselves, and
// residents a clinic volunteer tallied. Each person has a case tag (caseTagOf their key ID), so the
// lists can be matched without names. The overlap tells how much both lists miss (capture-recapture,
// Chapman's form): N = (n1 + 1)(n2 + 1)/(m + 1) - 1, worked out per level and added up, because
// clinic reach differs a lot between the top and the deep levels.
//
// Measured over many seeds the estimate lands below the truth (median about 18% low): both lists
// favour cases that have lasted longer, so the overlap looks bigger than it is. The ratio we show is
// therefore a floor. The real gap is at least that big.
import {
  caseTagOf,
  signNote,
  SICK_MAX_TAGS,
  type CaseTagHex,
  type Identity,
  type LevelId,
  type Notebook,
  type NotebookEntry,
  type ProofValues,
  type SickBody,
  type VerifiedNote,
} from '../world';
import { residentIdentity, runHarness, type ScriptStep, type Sim, type SimOptions } from '../sim';
import { notebookFrom } from './notebook';

/** Same seed as the live site (src/ui DEMO_SEED). Ten days in, read at 06:00 just after the Directorate publishes. */
export const OUTBREAK_SCENARIO: SimOptions & { hours: number; script?: ScriptStep[] } = {
  seed: 42,
  hours: 10 * 24,
  hazards: false,
};

/** Chapman's capture-recapture estimate. n1, n2: sizes of the two lists; m: people on both. */
export function chapman(n1: number, n2: number, m: number): number {
  return ((n1 + 1) * (n2 + 1)) / (m + 1) - 1;
}

// ---------------------------------------------------------------- notes from the sim

type SickSim = Pick<Sim, 'seed' | 'population' | 'levelOfResident' | 'sickLists' | 'getState'>;

const volunteers = new Map<string, Identity>();

/** The clinic volunteer who signs a level's tallies: that level's first resident, a stand-in. */
export function clinicVolunteer(sim: Pick<Sim, 'seed' | 'population' | 'levelOfResident'>, level: LevelId): Identity {
  const key = `${sim.seed}:${level}`;
  let id = volunteers.get(key);
  if (!id) {
    // Residents are numbered top level first, so the first resident of a level is a binary search away.
    let lo = 0;
    let hi = sim.population - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sim.levelOfResident(mid) >= level) hi = mid;
      else lo = mid + 1;
    }
    if (sim.levelOfResident(lo) !== level) throw new Error(`no residents on level ${level}`);
    id = residentIdentity(sim, lo);
    volunteers.set(key, id);
  }
  return id;
}

/** Clinic tallies use their own seq range so they never collide with the volunteer's own notes. */
const CLINIC_SEQ_BASE = 1000;

/**
 * Turn the sim's two sick lists into signed `sick` notes, as residents and volunteers would write them:
 * one self report per resident (their own case tag), and clinic tallies of up to 14 tags per note.
 */
export function sickNotes(sim: SickSim): VerifiedNote<SickBody>[] {
  const { time, levels } = sim.getState();
  const out: VerifiedNote<SickBody>[] = [];
  for (const { id: level } of levels) {
    const { self, clinic } = sim.sickLists(level);
    for (const r of self) {
      const who = residentIdentity(sim, r);
      out.push(signNote<SickBody>({ seq: 1, time, body: { kind: 'sick', level, source: 'self', caseTags: [caseTagOf(who.keyId)] } }, who));
    }
    if (clinic.length === 0) continue;
    const volunteer = clinicVolunteer(sim, level);
    const tags = clinic.map((r) => caseTagOf(residentIdentity(sim, r).keyId));
    for (let i = 0; i * SICK_MAX_TAGS < tags.length; i++) {
      const caseTags = tags.slice(i * SICK_MAX_TAGS, (i + 1) * SICK_MAX_TAGS);
      out.push(signNote<SickBody>({ seq: CLINIC_SEQ_BASE + i, time, body: { kind: 'sick', level, source: 'clinic', caseTags } }, volunteer));
    }
  }
  return out;
}

// ---------------------------------------------------------------- the estimate

export interface LevelEstimate {
  level: LevelId;
  /** n1: people who reported themselves. */
  self: number;
  /** n2: people a clinic tallied. */
  clinic: number;
  /** m: people on both lists. */
  both: number;
  /** People named on at least one list. */
  named: number;
  /** Chapman estimate of everyone sick on the level, named or not. */
  estimate: number;
}

/**
 * Estimate the outbreak per level from notebook entries (or plain verified notes). Reads only the
 * notes: a self report counts only when its case tag is its own author's, and every person counts once.
 */
export function estimateOutbreak(source: Iterable<NotebookEntry | VerifiedNote>): LevelEstimate[] {
  const lists = new Map<LevelId, { self: Set<CaseTagHex>; clinic: Set<CaseTagHex> }>();
  const listsOf = (level: LevelId) => {
    let l = lists.get(level);
    if (!l) lists.set(level, (l = { self: new Set(), clinic: new Set() }));
    return l;
  };
  for (const item of source) {
    const note = 'note' in item ? item.note : item;
    const body = note.body;
    if (body.kind !== 'sick') continue;
    const l = listsOf(body.level);
    if (body.source === 'self') {
      const own = caseTagOf(note.author);
      if (body.caseTags.length === 1 && body.caseTags[0] === own) l.self.add(own);
    } else {
      for (const t of body.caseTags) l.clinic.add(t);
    }
  }
  return [...lists.entries()]
    .sort(([a], [b]) => a - b)
    .map(([level, { self, clinic }]) => {
      let both = 0;
      for (const t of self) if (clinic.has(t)) both++;
      return {
        level,
        self: self.size,
        clinic: clinic.size,
        both,
        named: self.size + clinic.size - both,
        estimate: chapman(self.size, clinic.size, both),
      };
    });
}

// ---------------------------------------------------------------- against the sim's numbers

export interface OutbreakRow extends LevelEstimate {
  /** What the Directorate publishes. */
  official: number;
  /** Ground truth from the simulation, for the "were we right" column. Never used by the estimate. */
  actual: number;
}

export interface OutbreakReport {
  time: number;
  levels: OutbreakRow[];
  total: { official: number; estimate: number; actual: number; named: number };
  notes: VerifiedNote<SickBody>[];
  notebook: Notebook;
  /** `outbreakUndercountRatio` = estimate / official over the whole Hollow, rounded to 0.1. Missing if official is 0. */
  proof: Pick<ProofValues, 'outbreakUndercountRatio'>;
}

/** Sign the sim's sick lists into a fresh notebook, estimate from it, and set it against the sim. */
export function outbreakReport(sim: SickSim): OutbreakReport {
  const state = sim.getState();
  const notes = sickNotes(sim);
  const nb = notebookFrom(notes);
  const est = new Map(estimateOutbreak(nb.entries()).map((e) => [e.level, e]));
  const levels: OutbreakRow[] = state.levels.map((l) => ({
    ...(est.get(l.id) ?? { level: l.id, self: 0, clinic: 0, both: 0, named: 0, estimate: 0 }),
    official: l.sick.official,
    actual: l.sick.actual,
  }));
  const sum = (k: 'official' | 'estimate' | 'actual' | 'named') => levels.reduce((s, r) => s + r[k], 0);
  const total = { official: sum('official'), estimate: sum('estimate'), actual: sum('actual'), named: sum('named') };
  const proof: OutbreakReport['proof'] = {};
  if (total.official > 0) proof.outbreakUndercountRatio = Math.round((10 * total.estimate) / total.official) / 10;
  return { time: state.time, levels, total, notes, notebook: nb, proof };
}

/** Run the harness and report. Defaults to OUTBREAK_SCENARIO: this is where the rail's number comes from. */
export function measureOutbreak(options: SimOptions & { hours: number; script?: ScriptStep[] } = OUTBREAK_SCENARIO): OutbreakReport {
  return outbreakReport(runHarness(options).sim);
}

// ---------------------------------------------------------------- supplies

export interface SupplyShare {
  level: LevelId;
  estimate: number;
  units: number;
  /** Share of all units, percent, rounded to 0.1. */
  sharePct: number;
}

/**
 * Split `units` across levels in proportion to estimated real cases (largest remainder, so whole
 * units always add up to `units`). Highest first; ties go to the deeper level.
 */
export function rankSupplies(units: number, rows: readonly { level: LevelId; estimate: number }[]): SupplyShare[] {
  const total = rows.reduce((s, r) => s + Math.max(0, r.estimate), 0);
  const deeperFirst = (a: { level: number }, b: { level: number }) => b.level - a.level;
  const raw = rows.map((r) => {
    const exact = total > 0 ? (units * Math.max(0, r.estimate)) / total : 0;
    return { level: r.level, estimate: r.estimate, exact, units: Math.floor(exact) };
  });
  let left = units - raw.reduce((s, r) => s + r.units, 0);
  if (total > 0) {
    for (const r of [...raw].sort((a, b) => b.exact - b.units - (a.exact - a.units) || deeperFirst(a, b))) {
      if (left <= 0) break;
      r.units++;
      left--;
    }
  }
  return raw
    .map(({ level, estimate, units: u }) => ({ level, estimate, units: u, sharePct: units > 0 ? Math.round((1000 * u) / units) / 10 : 0 }))
    .sort((a, b) => b.units - a.units || b.estimate - a.estimate || deeperFirst(a, b));
}
