// Measures the canary against the simulation harness: how many hours of warning it gives before a
// level goes dark, how often it cries wolf, and how many blackouts it misses. Nothing here is typed
// in by hand: every figure is computed from seeded runs of `runHarness`.
//
// Ground truth is the sim's own 'level-out' event. Lead time = time of that event minus the time the
// warning fired. A warning is false when it never ended in a blackout of its level.
import type { ProofValues } from '../world';
import { POWER_ON_RATIO, runHarness, type HarnessRun, type ScriptStep } from '../sim';
import { powerReadings } from './adapter';
import { createCanary, DEFAULT_CONFIG, type Alert, type CanaryConfig } from './monitor';

const HOUR = 3600;

/** The scenario mix, by seed. Each seed picks one; the run is the same every time. */
export type Scenario = 'feeder-ramp' | 'generation-drop' | 'instant-blackout' | 'calm';

export interface MeasureOptions {
  /** Number of seeded runs. Default 500. */
  runs?: number;
  /** First seed. Default 1. */
  firstSeed?: number;
  /** Simulated hours per run. Default 336 (two weeks). */
  hours?: number;
  config?: Partial<CanaryConfig>;
}

export interface Blackout {
  seed: number;
  scenario: Scenario;
  level: number;
  /** Sim time of the 'level-out' event, seconds. */
  outAt: number;
  /** When the flicker warning fired, if it did. */
  warnedAt?: number;
  /** Hours between the warning and the blackout. Missing if the blackout was missed. */
  leadHours?: number;
  /** Hours between the blackout and the first silence alarm for that level. */
  silenceDelayHours?: number;
}

export interface WarningReport {
  runs: number;
  hoursPerRun: number;
  scenarios: Record<Scenario, number>;
  blackouts: number;
  warned: number;
  missed: number;
  /** warned / blackouts. */
  detectionRate: number;
  /** Median hours of warning over the blackouts that were warned. This is the proof number. */
  medianLeadHours: number;
  p10LeadHours: number;
  p90LeadHours: number;
  /** Blackouts that a flicker warning cannot see by design: the feeder is cut with no ramp. */
  instantBlackouts: number;
  instantWarned: number;
  /** Flicker warnings raised, and the share that never ended in a blackout. */
  warnings: number;
  falseWarnings: number;
  falseAlarmRate: number;
  /**
   * Of the false warnings: the level really was short of power around then (supply below full for a
   * while) but recovered before going dark, versus no strain at all (pure noise).
   */
  brownoutWarnings: number;
  spuriousWarnings: number;
  spuriousRate: number;
  /** False warnings per level per simulated day, over every run. */
  falseWarningsPerLevelDay: number;
  /** Same, over the calm runs alone (no failure at all, hazards off). */
  calmRuns: number;
  calmFalseWarnings: number;
  silence: {
    /** Blackouts where some zone of the level raised a silence alarm. */
    detected: number;
    medianDelayHours: number;
    /** Silence alarms on a level that was not dark. */
    falseAlarms: number;
    alarms: number;
  };
  /** Blackouts, warned and median lead by the scenario of the run they happened in (natural ones count too). */
  byScenario: Record<Scenario, { blackouts: number; warned: number; medianLeadHours: number }>;
  details: Blackout[];
}

/** A tiny seeded generator (mulberry32) for choosing scenario parameters. Not the sim's own streams. */
function prng(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function scenarioOf(seed: number): Scenario {
  const m = seed % 10;
  if (m < 4) return 'feeder-ramp'; // 40%
  if (m < 7) return 'generation-drop'; // 30%
  if (m < 8) return 'instant-blackout'; // 10%
  return 'calm'; // 20%
}

/** The script and hazard setting for one seed. */
export function scenarioFor(seed: number, hours: number): { scenario: Scenario; hazards: boolean; script: ScriptStep[] } {
  const scenario = scenarioOf(seed);
  const r = prng(seed);
  const atHour = 48 + Math.floor(r() * Math.max(1, hours - 48 - 48));
  const level = 6 + Math.floor(r() * 7); // 6..12, the old feeders
  if (scenario === 'calm') return { scenario, hazards: false, script: [] };
  if (scenario === 'feeder-ramp') {
    const rampHours = 3 + Math.floor(r() * 8); // 3..10, the same range the hazard model uses
    return { scenario, hazards: true, script: [{ atHour, trigger: { kind: 'level-power-loss', level, rampHours } }, { atHour: atHour + rampHours + 12, resolves: 0 }] };
  }
  if (scenario === 'generation-drop') {
    const fraction = 0.1 + 0.3 * r(); // 10..40% of generation lost
    return { scenario, hazards: true, script: [{ atHour, trigger: { kind: 'generation-drop', fraction } }, { atHour: atHour + 6 + Math.floor(r() * 18), resolves: 0 }] };
  }
  return { scenario, hazards: true, script: [{ atHour, trigger: { kind: 'level-power-loss', level, rampHours: 0 } }, { atHour: atHour + 12, resolves: 0 }] };
}

/** Replay one finished run through a fresh canary, hour by hour, and return the alerts it raised. */
export function replayRun(run: HarnessRun, config: Partial<CanaryConfig> = {}): Alert[] {
  const canary = createCanary(config);
  const readings = powerReadings(run.observations);
  const endTime = run.timeline[run.timeline.length - 1]!.time + HOUR;
  const startTime = run.timeline[0]!.time;
  let i = 0;
  for (let t = startTime; t <= endTime; t += HOUR) {
    while (i < readings.length && readings[i]!.time <= t) canary.ingest(readings[i++]!);
    canary.check(t);
  }
  return [...canary.history()];
}

/** Level-out intervals per level from the run's events: [outAt, restoredAt or Infinity). */
function darkIntervals(run: HarnessRun): Map<number, Array<[number, number]>> {
  const out = new Map<number, Array<[number, number]>>();
  for (const e of run.events) {
    if (e.level === undefined) continue;
    if (e.what === 'level-out') {
      const list = out.get(e.level) ?? [];
      list.push([e.time, Infinity]);
      out.set(e.level, list);
    } else if (e.what === 'level-restored') {
      const last = out.get(e.level)?.at(-1);
      if (last) last[1] = e.time;
    }
  }
  return out;
}

const quantile = (xs: number[], q: number): number => {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
};
const round2 = (x: number) => Math.round(x * 100) / 100;

/** Blackouts in the first hours of a run happen before any baseline exists, so they are left out. */
const WARM_UP_HOURS = 24;

export function measureWarnings(options: MeasureOptions = {}): WarningReport {
  const runs = options.runs ?? 500;
  const firstSeed = options.firstSeed ?? 1;
  const hours = options.hours ?? 336;
  const cfg: CanaryConfig = { ...DEFAULT_CONFIG, ...options.config };

  const scenarios: Record<Scenario, number> = { 'feeder-ramp': 0, 'generation-drop': 0, 'instant-blackout': 0, calm: 0 };
  const details: Blackout[] = [];
  let warnings = 0;
  let falseWarnings = 0;
  let brownout = 0;
  let spurious = 0;
  let calmFalse = 0;
  let silenceAlarms = 0;
  let silenceFalse = 0;
  const lastHoursCensored = 12;

  for (let seed = firstSeed; seed < firstSeed + runs; seed++) {
    const sc = scenarioFor(seed, hours);
    scenarios[sc.scenario]++;
    const run = runHarness({ seed, hours, hazards: sc.hazards, script: sc.script });
    const alerts = replayRun(run, cfg);
    const startTime = run.timeline[0]!.time;
    const endTime = run.timeline[run.timeline.length - 1]!.time;
    const dark = darkIntervals(run);

    const outs = run.events.filter((e) => e.what === 'level-out' && e.level !== undefined && e.time - startTime >= WARM_UP_HOURS * HOUR);
    const flicker = alerts.filter((a) => a.kind === 'flicker-rise');
    const silence = alerts.filter((a) => a.kind === 'silence');

    for (const e of outs) {
      const b: Blackout = { seed, scenario: sc.scenario, level: e.level!, outAt: e.time };
      const w = flicker.find((a) => a.level === e.level && a.blackoutAt === e.time && a.firedAt <= e.time);
      if (w) {
        b.warnedAt = w.firedAt;
        b.leadHours = round2((e.time - w.firedAt) / HOUR);
      }
      const s = silence.filter((a) => a.level === e.level && a.firedAt >= e.time - HOUR && a.firedAt <= e.time + 6 * HOUR);
      if (s.length > 0) b.silenceDelayHours = round2((Math.min(...s.map((a) => a.firedAt)) - e.time) / HOUR);
      details.push(b);
    }

    for (const a of flicker) {
      if (a.firedAt > endTime - lastHoursCensored * HOUR) continue; // the run ended before we could tell
      warnings++;
      if (a.blackoutAt === undefined) {
        falseWarnings++;
        // Hours near the warning in which the level's supply was under full.
        const h0 = Math.round((a.firedAt - startTime) / HOUR);
        let strained = false;
        for (let h = Math.max(0, h0 - 1); h <= Math.min(run.timeline.length - 1, h0 + 1); h++) {
          if (run.timeline[h]!.levels[a.level - 1]!.supplyRatio < POWER_ON_RATIO) strained = true;
        }
        if (strained) brownout++;
        else spurious++;
        if (sc.scenario === 'calm') calmFalse++;
      }
    }
    for (const a of silence) {
      silenceAlarms++;
      const intervals = dark.get(a.level) ?? [];
      // A silence alarm is fair if the level was dark at some point since the zone's last heartbeat.
      const lastHeard = a.firedAt - cfg.silenceAfterS;
      if (!intervals.some(([from, to]) => from >= lastHeard - HOUR && from <= a.firedAt && to > from)) silenceFalse++;
    }
  }

  const lead = details.filter((d) => d.leadHours !== undefined).map((d) => d.leadHours!);
  const delays = details.filter((d) => d.silenceDelayHours !== undefined).map((d) => d.silenceDelayHours!);
  const instant = details.filter((d) => d.scenario === 'instant-blackout');
  const levelDays = (runs * hours * 12) / 24;

  return {
    runs,
    hoursPerRun: hours,
    scenarios,
    blackouts: details.length,
    warned: lead.length,
    missed: details.length - lead.length,
    detectionRate: details.length ? round2(lead.length / details.length) : 0,
    medianLeadHours: round2(quantile(lead, 0.5)),
    p10LeadHours: round2(quantile(lead, 0.1)),
    p90LeadHours: round2(quantile(lead, 0.9)),
    instantBlackouts: instant.length,
    instantWarned: instant.filter((d) => d.leadHours !== undefined).length,
    warnings,
    falseWarnings,
    falseAlarmRate: warnings ? round2(falseWarnings / warnings) : 0,
    brownoutWarnings: brownout,
    spuriousWarnings: spurious,
    spuriousRate: warnings ? round2(spurious / warnings) : 0,
    falseWarningsPerLevelDay: round2(falseWarnings / levelDays),
    calmRuns: scenarios.calm,
    calmFalseWarnings: calmFalse,
    silence: {
      detected: delays.length,
      medianDelayHours: round2(quantile(delays, 0.5)),
      falseAlarms: silenceFalse,
      alarms: silenceAlarms,
    },
    byScenario: Object.fromEntries(
      (Object.keys(scenarios) as Scenario[]).map((k) => {
        const ds = details.filter((d) => d.scenario === k);
        const ls = ds.filter((d) => d.leadHours !== undefined).map((d) => d.leadHours!);
        return [k, { blackouts: ds.length, warned: ls.length, medianLeadHours: round2(quantile(ls, 0.5)) }];
      }),
    ) as WarningReport['byScenario'],
    details,
  };
}

/**
 * The proof number for problem 1: the median hours of warning before a level goes dark, measured
 * over seeded harness runs. Never typed in; run it and it comes out of the simulation.
 */
export function blackoutWarningLeadHours(options: MeasureOptions = {}): Pick<ProofValues, 'blackoutWarningLeadHours'> {
  const report = measureWarnings(options);
  return report.warned > 0 ? { blackoutWarningLeadHours: report.medianLeadHours } : {};
}
