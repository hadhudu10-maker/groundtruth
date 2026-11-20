// Problem 4, without pipe tracing: count bad tap reports per recycler line and flag the line.
//
// Every tap test a resident makes becomes a signed `water` note. Levels drinking from the same
// recycler form one line (SimLevelState.recycler, RecyclerState.feeds). When enough different
// residents on a line report bad water within a short window, the whole line is flagged "do not
// drink". The flag is raised from the notes alone; the sim's truth is used only to score it.
import { signNote, type LevelId, type NotebookEntry, type PipeNodeId, type VerifiedNote, type WaterBody } from '../world';
import { HOUR, residentIdentity, runHarness, type ScriptStep, type Sim, type SimCityState, type SimEvent, type SimOptions } from '../sim';

/** Bad reports count only if they are this recent. */
export const WATER_WINDOW_S = 12 * HOUR;
/** Different residents reporting bad water on one line within the window before it is flagged. */
export const WATER_THRESHOLD = 3;

export interface WaterLine {
  recycler: PipeNodeId;
  feeds: LevelId[];
}

export function waterLines(state: Pick<SimCityState, 'recyclers'>): WaterLine[] {
  return state.recyclers.map((r) => ({ recycler: r.id, feeds: [...r.feeds] }));
}

/** Sign every water observation as the resident who made it. Each resident's seq counts up from 1. */
export function waterNotes(
  sim: Pick<Sim, 'seed' | 'levelOfResident' | 'observations'>,
  observations: Iterable<ReturnType<Sim['observations']>[number]> = sim.observations(),
): VerifiedNote<WaterBody>[] {
  const seq = new Map<number, number>();
  const out: VerifiedNote<WaterBody>[] = [];
  for (const o of observations) {
    if (o.type !== 'water') continue;
    const n = (seq.get(o.resident) ?? 0) + 1;
    seq.set(o.resident, n);
    out.push(
      signNote<WaterBody>(
        { seq: n, time: o.time, body: { kind: 'water', level: o.level, tap: o.tap, result: o.result } },
        residentIdentity(sim, o.resident),
      ),
    );
  }
  return out;
}

export interface LineAlarm {
  recycler: PipeNodeId;
  feeds: LevelId[];
  /** Time of the report that crossed the threshold. */
  time: number;
  /** When the flag lapses: WATER_WINDOW_S after the last bad report on the line while it stood. */
  until: number;
  /** Distinct residents who reported bad water in the window when it was raised. */
  reporters: number;
}

/**
 * Read water notes in time order and flag a line whenever WATER_THRESHOLD different residents on it
 * report bad water within WATER_WINDOW_S. A line flags again only after its window has emptied.
 */
export function waterAlarms(
  source: Iterable<NotebookEntry | VerifiedNote>,
  lines: readonly WaterLine[],
  { window = WATER_WINDOW_S, threshold = WATER_THRESHOLD } = {},
): LineAlarm[] {
  const lineOfLevel = new Map<LevelId, WaterLine>();
  for (const l of lines) for (const lv of l.feeds) lineOfLevel.set(lv, l);
  const notes: { time: number; author: string; level: LevelId }[] = [];
  for (const item of source) {
    const note = 'note' in item ? item.note : item;
    if (note.body.kind === 'water' && note.body.result === 'bad') notes.push({ time: note.time, author: note.author, level: note.body.level });
  }
  notes.sort((a, b) => a.time - b.time);

  const recent = new Map<PipeNodeId, { time: number; author: string }[]>();
  const open = new Map<PipeNodeId, LineAlarm>();
  const out: LineAlarm[] = [];
  for (const n of notes) {
    const line = lineOfLevel.get(n.level);
    if (!line) continue;
    const standing = open.get(line.recycler);
    if (standing && n.time >= standing.until) open.delete(line.recycler);
    const list = (recent.get(line.recycler) ?? []).filter((r) => n.time - r.time < window);
    list.push({ time: n.time, author: n.author });
    recent.set(line.recycler, list);
    const alarm = open.get(line.recycler);
    if (alarm) {
      alarm.until = n.time + window;
      continue;
    }
    const reporters = new Set(list.map((r) => r.author)).size;
    if (reporters >= threshold) {
      const a: LineAlarm = { recycler: line.recycler, feeds: line.feeds, time: n.time, until: n.time + window, reporters };
      open.set(line.recycler, a);
      out.push(a);
    }
  }
  return out;
}

export interface Exposure {
  level: LevelId;
  /** Sim time the level's water went bad (the sim's 'water-bad' event). */
  time: number;
  population: number;
  /** A flag on the level's line was standing when the water went bad. */
  warned: boolean;
  /** Hours of warning, when warned. */
  leadHours?: number;
}

/** Score alarms against the sim's 'water-bad' events. */
export function scoreWarnings(
  alarms: readonly LineAlarm[],
  events: readonly SimEvent[],
  state: Pick<SimCityState, 'levels'>,
): Exposure[] {
  const pop = new Map(state.levels.map((l) => [l.id, l.population]));
  return events
    .filter((e) => e.what === 'water-bad' && e.level !== undefined)
    .map((e) => {
      const level = e.level!;
      const before = alarms.filter((a) => a.feeds.includes(level) && a.time <= e.time && e.time < a.until);
      const first = before.length ? Math.min(...before.map((a) => a.time)) : undefined;
      return {
        level,
        time: e.time,
        population: pop.get(level) ?? 0,
        warned: first !== undefined,
        leadHours: first !== undefined ? (e.time - first) / HOUR : undefined,
      };
    });
}

export interface WaterRunReport {
  notes: VerifiedNote<WaterBody>[];
  alarms: LineAlarm[];
  exposures: Exposure[];
  /** Flags raised while every level on the line had clean ('ok') water the whole time the flag stood. */
  falseAlarms: number;
}

export function waterRun(options: SimOptions & { hours: number; script?: ScriptStep[] }): WaterRunReport {
  const run = runHarness(options);
  const state = run.sim.getState();
  const notes = waterNotes(run.sim, run.observations);
  const alarms = waterAlarms(notes, waterLines(state));
  const exposures = scoreWarnings(alarms, run.events, state);
  // Ground truth per hour, from the harness timeline: was any level on the line not clean?
  const dirty = (a: LineAlarm) =>
    run.timeline.some(
      (s) => s.time >= a.time - WATER_WINDOW_S && s.time <= a.until && s.levels.some((l) => a.feeds.includes(l.id) && l.water !== 'ok'),
    );
  const falseAlarms = alarms.filter((a) => !dirty(a)).length;
  return { notes, alarms, exposures, falseAlarms };
}

/**
 * The scenario behind badWaterWarnedPct: the Hollow left to wear out on its own (hazards on, so
 * recyclers both wear down slowly and break suddenly), 20 days, seeds 1..20.
 */
export const WATER_SCENARIO = { seeds: Array.from({ length: 20 }, (_, i) => i + 1), hours: 20 * 24, hazards: true } as const;

export interface WaterMeasurement {
  runs: number;
  exposures: Exposure[];
  falseAlarms: number;
  /** Share of residents on lines that went bad who were warned first, percent, rounded to 0.1. Missing if no line went bad. */
  proof: { badWaterWarnedPct?: number };
}

export function measureWater(scenario: { seeds: readonly number[]; hours: number; hazards?: boolean; script?: ScriptStep[] } = WATER_SCENARIO): WaterMeasurement {
  const exposures: Exposure[] = [];
  let falseAlarms = 0;
  for (const seed of scenario.seeds) {
    const r = waterRun({ seed, hours: scenario.hours, hazards: scenario.hazards, script: scenario.script });
    exposures.push(...r.exposures);
    falseAlarms += r.falseAlarms;
  }
  const total = exposures.reduce((s, e) => s + e.population, 0);
  const warned = exposures.filter((e) => e.warned).reduce((s, e) => s + e.population, 0);
  const proof: WaterMeasurement['proof'] = {};
  if (total > 0) proof.badWaterWarnedPct = Math.round((1000 * warned) / total) / 10;
  return { runs: scenario.seeds.length, exposures, falseAlarms, proof };
}
