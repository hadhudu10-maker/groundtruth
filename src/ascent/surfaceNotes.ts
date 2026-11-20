// The surface as signed notes: probe readings (`surface`), witness signatures (`witness`), the
// rules commit, and the verdict note. Counting is done from notebook order, never from a side list.
import { bytesToHex } from '@noble/hashes/utils.js';
import { SURFACE_METRICS, createIdentity, noteRef, signNote } from '../world';
import type { Identity, KeyIdHex, LevelId, Notebook, SignedNote, SurfaceMetric, VerifiedNote } from '../world';
import { notebookFrom } from '../ledger';
import { Rng, subSeed } from './rng';
import { DEFAULT_SURFACE_RULES, readingLooksSafe, rulesCommitNote, rulesFingerprint } from './rules';
import type { SurfaceRules } from './rules';
import { MAX_READINGS, evaluateEvidence, generateRun, verdictOfRun } from './surfaceSim';
import type { MetricValues, Observation, SimReading } from './surfaceSim';

export interface LevelLookup {
  get(keyId: KeyIdHex): LevelId | undefined;
}

export interface ReadoutReading {
  noteId: string;
  /** Notebook index of the reading. */
  index: number;
  author: KeyIdHex;
  time: number;
  values: Partial<Record<SurfaceMetric, number>>;
  /** Distinct witnesses with a known level, not counting the author. */
  witnesses: number;
  levelCount: number;
  counted: boolean;
  looksSafe: boolean;
}

export interface Readout {
  /** Notebook index of the first commit that matches these rules, or null if the rules were never published. */
  rulesCommitIndex: number | null;
  readings: ReadoutReading[];
  /** Readings in the notebook that came before the rules commit (or claim a time before it). They do not count. */
  ignoredBeforeRules: number;
}

/**
 * Read the notebook under a set of rules.
 * A reading counts only if (1) the rules were committed first, (2) the reading sits after that commit in
 * notebook order and its signed time is not earlier than the commit's, and (3) enough distinct witnesses
 * on enough different levels signed it. The author never witnesses their own reading.
 */
export function readNotebook(nb: Notebook, rules: SurfaceRules, levels: LevelLookup): Readout {
  const want = rulesFingerprint(rules);
  const entries = nb.entries();
  const commit = entries.find((e) => e.note.body.kind === 'commit' && e.note.body.topic === 'surface-rules' && bytesToHex(e.note.body.value) === want);
  if (!commit) return { rulesCommitIndex: null, readings: [], ignoredBeforeRules: 0 };

  const signers = new Map<string, Set<KeyIdHex>>();
  for (const e of entries) {
    if (e.note.body.kind !== 'witness') continue;
    let s = signers.get(e.note.body.ref);
    if (!s) signers.set(e.note.body.ref, (s = new Set()));
    s.add(e.note.author);
  }

  const readings: ReadoutReading[] = [];
  let ignored = 0;
  for (const e of entries) {
    const body = e.note.body;
    if (body.kind !== 'surface') continue;
    if (e.index < commit.index || e.note.time < commit.note.time) {
      ignored++;
      continue;
    }
    const values: Partial<Record<SurfaceMetric, number>> = {};
    for (const r of body.readings) values[r.metric] = r.value;
    const who = [...(signers.get(noteRef(e.note.id)) ?? [])].filter((k) => k !== e.note.author && levels.get(k) !== undefined);
    const levelCount = new Set(who.map((k) => levels.get(k))).size;
    const safe = readingLooksSafe(rules, values);
    readings.push({
      noteId: e.note.id,
      index: e.index,
      author: e.note.author,
      time: e.note.time,
      values,
      witnesses: who.length,
      levelCount,
      counted: safe !== null && who.length >= rules.minWitnesses && levelCount >= rules.minLevels,
      looksSafe: safe === true,
    });
  }
  return { rulesCommitIndex: commit.index, readings, ignoredBeforeRules: ignored };
}

export function observeReadout(readout: Readout): Observation {
  return evaluateEvidence(readout.readings.map((r) => ({ looksSafe: r.looksSafe, counted: r.counted, signatures: r.witnesses })));
}

// ---------------------------------------------------------------- the verdict note

export interface VerdictInfo {
  verdict: 'safe' | 'unsafe';
  /** First 16 hex chars of the rules fingerprint. */
  rulesPrefix: string;
}

/**
 * A short signed text note that carries the verdict and the rules fingerprint. At most 59 bytes, so
 * it travels phone to phone with the existing pass-it-on code.
 */
export function verdictNote(
  identity: Identity,
  verdict: 'safe' | 'unsafe',
  seq: number,
  time: number,
  rules: SurfaceRules = DEFAULT_SURFACE_RULES,
): VerifiedNote {
  return signNote({ seq, time, body: { kind: 'text', text: `surface:${verdict} rules:${rulesFingerprint(rules).slice(0, 16)}` } }, identity);
}

export function parseVerdictNote(note: SignedNote): VerdictInfo | null {
  if (note.body.kind !== 'text') return null;
  const m = /^surface:(safe|unsafe) rules:([0-9a-f]{16})$/.exec(note.body.text);
  return m ? { verdict: m[1] as 'safe' | 'unsafe', rulesPrefix: m[2]! } : null;
}

// ---------------------------------------------------------------- a whole scenario in signed notes

export const SCENARIO_T0 = 1_800_000_000;

export interface SurfaceScenario {
  seed: number;
  /** The hidden truth the model drew. The panel shows it only as a check, after the verdict. */
  truthSafe: boolean;
  rules: SurfaceRules;
  organizer: Identity;
  probe: Identity;
  forger: Identity;
  residents: Identity[];
  names: Map<KeyIdHex, string>;
  levels: Map<KeyIdHex, LevelId>;
  notebook: Notebook;
  notes: VerifiedNote[];
  rulesNote: VerifiedNote;
  /** Note IDs of readings the forger posted. */
  forgedIds: Set<string>;
  readout: Readout;
  verdict: Observation;
}

export interface ScenarioOptions {
  rules?: SurfaceRules;
  /** Readings recorded before the rules commit. They are ignored. */
  earlyReadings?: number;
}

/** Build one full run as real signed notes in a real notebook, stopping when doubter and believer agree. */
export function buildSurfaceScenario(seed: number, opts: ScenarioOptions = {}): SurfaceScenario {
  const rules = opts.rules ?? DEFAULT_SURFACE_RULES;
  const early = opts.earlyReadings ?? 1;
  const run = generateRun(seed, { rules, readings: MAX_READINGS + (early > 0 ? early : 0) });
  const mainReadings = run.readings.slice(early);
  const plan = verdictOfRun({ ...run, readings: mainReadings });
  const used = plan.agreedIndex === null ? mainReadings : mainReadings.slice(0, plan.agreedIndex + 1);

  const keys = new Rng(subSeed(seed, 7));
  const names = new Map<KeyIdHex, string>();
  const levels = new Map<KeyIdHex, LevelId>();
  const make = (name: string, level: number) => {
    const id = createIdentity({ name, level, secretKey: keys.bytes(32) });
    names.set(id.keyId, name);
    levels.set(id.keyId, level);
    return id;
  };
  const organizer = make('Organizer', 1);
  const probe = make('Probe 1', 1);
  const forger = make('Forger', 1);
  const residents = run.residents.map((r) => make(`R${r.index + 1} L${r.level}`, r.level));

  const seqs = new Map<KeyIdHex, number>();
  const next = (id: Identity) => {
    const s = (seqs.get(id.keyId) ?? 0) + 1;
    seqs.set(id.keyId, s);
    return s;
  };
  const notes: VerifiedNote[] = [];
  const forgedIds = new Set<string>();
  let clock = SCENARIO_T0 - 60 * (early + 1);

  const post = (r: SimReading) => {
    const author = r.forged ? forger : probe;
    const note = signNote(
      {
        seq: next(author),
        time: clock,
        body: { kind: 'surface', probe: r.index, readings: SURFACE_METRICS.map((metric) => ({ metric, value: (r.values as MetricValues)[metric] })) },
      },
      author,
    );
    notes.push(note);
    if (r.forged) forgedIds.add(note.id);
    for (const idx of r.signers) {
      clock += 1;
      const w = residents[idx]!;
      notes.push(signNote({ seq: next(w), time: clock, body: { kind: 'witness', ref: noteRef(note.id) } }, w));
    }
    clock += 59;
  };

  for (const r of run.readings.slice(0, early)) post(r);
  clock = SCENARIO_T0;
  const rulesNote = rulesCommitNote(organizer, rules, next(organizer), clock);
  notes.push(rulesNote);
  clock += 60;
  for (const r of used) post(r);

  const notebook = notebookFrom(notes);
  const readout = readNotebook(notebook, rules, levels);
  return {
    seed,
    truthSafe: run.safe,
    rules,
    organizer,
    probe,
    forger,
    residents,
    names,
    levels,
    notebook,
    notes,
    rulesNote,
    forgedIds,
    readout,
    verdict: observeReadout(readout),
  };
}
