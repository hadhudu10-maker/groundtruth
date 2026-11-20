// The canary: reads power notes and raises two kinds of alert.
//
//  1. flicker-rise: the number of 'flicker' notes from one level in a sliding window climbs well
//     above that level's own baseline: what the same level counted in the same window of the day
//     over the previous days. Each level is judged against itself at that time of day, because deep
//     levels brown out a little every evening and top levels never do.
//  2. silence: a zone that has been sending an 'ok' heartbeat every hour stops. A dark zone sends
//     nothing, so silence is itself a signal, and it still works when the 'out' note never arrives.
//
// The monitor is causal: it only knows notes it has been given, in time order, and every alert
// records the moment it could first have fired. Thresholds were chosen by measurement; see
// DEFAULT_CONFIG and measure.ts.
import type { LevelId } from '../world';
import type { PowerReading } from './adapter';

const HOUR = 3600;
const DAY = 24 * HOUR;

export interface CanaryConfig {
  /** Sliding window for counting flickers, seconds. */
  windowS: number;
  /** The baseline is the mean count in the same window of the day over this many previous days. */
  baselineDays: number;
  /** No flicker warning until a level has been heard from for this many hours. */
  minBaselineHours: number;
  /** The window count must reach this multiple of the level's baseline count. */
  riseFactor: number;
  /** Baseline rate floor, flickers per hour, so a perfectly quiet level still has a sensible threshold. */
  floorRatePerHour: number;
  /** And never fire on fewer flickers than this in one window. */
  minFlickers: number;
  /** A zone is silent when its last 'ok' heartbeat is older than this, seconds. */
  silenceAfterS: number;
}

/**
 * Chosen by measuring, not guessing. Tuned on seeds 1001..1100 (100 runs), then confirmed on the
 * untouched seeds 1..500 (measureWarnings, scenario mix in measure.ts):
 *
 *   window 1 h, rise x4, at least 6 flickers (the setting below), 500 runs:
 *     2792 blackouts, 2463 warned (88%), 329 missed
 *     lead time before the sim's 'level-out': median 1.53 h, 10th percentile 0.59 h, 90th 2.75 h
 *     4582 warnings: 2194 not followed by a blackout (48%), but 2181 of those were real brownouts
 *       (supply under full around then, recovered in time) and only 13 (0.3%) were noise
 *     silence alarm: 2636 blackouts caught, median 1.0 h after the level went dark, 0 false alarms
 *
 *   What the grid showed (tuning seeds):
 *     a 2 h window and a 1 h window lead the same (~1.7 h) with the same detection;
 *     fewer than 4 flickers makes noise (8 to 100 spurious warnings per 100 runs);
 *     6 flickers removes the noise at the cost of ~0.2 h of median lead (1.73 h to 1.55 h);
 *     16 flickers cuts the median lead to 0.8 h and detection to 75%; 24 flickers to 0.4 h and 29%.
 *   The baseline is the same time of day on previous days: a plain 24 h median fired every evening on
 *   the deepest level (it browns out most evenings), which is the pattern, not a warning.
 *   Warnings for blackouts with no ramp (a feeder cut dead) cannot exist; the silence alarm covers those.
 */
export const DEFAULT_CONFIG: CanaryConfig = {
  windowS: HOUR,
  baselineDays: 3,
  minBaselineHours: 24,
  riseFactor: 4,
  floorRatePerHour: 0.25,
  minFlickers: 6,
  silenceAfterS: 2 * HOUR,
};

export type AlertKind = 'flicker-rise' | 'silence';

export interface Alert {
  kind: AlertKind;
  level: LevelId;
  /** Only silence alarms are per zone. */
  zone?: number;
  /** Sim time the alert first fired, seconds. For silence: the moment the threshold passed. */
  firedAt: number;
  /** Set when the alert stopped: the rate fell back, or the heartbeat returned. */
  clearedAt?: number;
  /** Flicker warnings only: the flicker count in the window when it fired, and the count that was needed. */
  count?: number;
  needed?: number;
  /** Flicker warnings only: when the level went dark after the warning, if it did. */
  blackoutAt?: number;
}

export interface Canary {
  /** Feed one power note. Notes must arrive in time order. Returns any alert this note started. */
  ingest(reading: PowerReading): Alert[];
  /** Move the clock to `now` (seconds): starts silence alarms, clears alerts that have ended. Returns new alerts. */
  check(now: number): Alert[];
  /** Alerts that are on at `now`. */
  active(now: number): Alert[];
  /** Every alert ever raised, in order, including cleared ones. */
  history(): readonly Alert[];
  config(): CanaryConfig;
}

interface LevelState {
  firstSeen: number;
  flickers: number[]; // times, ascending, pruned to the baseline horizon
  outSince?: number;
  alert?: Alert;
}

export function createCanary(overrides: Partial<CanaryConfig> = {}): Canary {
  const cfg: CanaryConfig = { ...DEFAULT_CONFIG, ...overrides };
  const levels = new Map<LevelId, LevelState>();
  const lastOk = new Map<string, number>(); // `${level}:${zone}` -> time
  const silent = new Map<string, Alert>();
  const alerts: Alert[] = [];
  let clock = -Infinity;

  const key = (level: LevelId, zone: number) => `${level}:${zone}`;

  function countIn(l: LevelState, from: number, to: number): number {
    let n = 0;
    for (const t of l.flickers) if (t > from && t <= to) n++;
    return n;
  }

  /** The flicker count a level's window must reach before it counts as a rise. */
  function needed(l: LevelState, now: number): number {
    // Count the same window of the day on each previous day that this level has been heard in.
    let total = 0;
    let days = 0;
    for (let d = 1; d <= cfg.baselineDays; d++) {
      const to = now - d * DAY;
      if (to - cfg.windowS < l.firstSeen) break;
      total += countIn(l, to - cfg.windowS, to);
      days++;
    }
    const expected = days > 0 ? total / days : 0;
    const floor = (cfg.floorRatePerHour * cfg.windowS) / HOUR;
    return Math.max(cfg.minFlickers, Math.ceil(cfg.riseFactor * Math.max(expected, floor)));
  }

  function levelOf(id: LevelId, time: number): LevelState {
    let l = levels.get(id);
    if (!l) {
      l = { firstSeen: time, flickers: [] };
      levels.set(id, l);
    }
    return l;
  }

  function settle(now: number): Alert[] {
    if (now > clock) clock = now;
    const fresh: Alert[] = [];
    // Flicker warnings end when the window has calmed to under half of what it took to fire.
    for (const l of levels.values()) {
      const a = l.alert;
      if (!a) continue;
      if (l.outSince !== undefined && a.blackoutAt === undefined) a.blackoutAt = l.outSince;
      const quiet = countIn(l, now - cfg.windowS, now) < Math.ceil((a.needed ?? cfg.minFlickers) / 2);
      if (quiet && l.outSince === undefined) {
        a.clearedAt = now;
        l.alert = undefined;
      }
    }
    // Silence: any zone whose last heartbeat is older than the threshold.
    for (const [k, t] of lastOk) {
      if (silent.has(k) || now - t <= cfg.silenceAfterS) continue;
      const [level, zone] = k.split(':').map(Number) as [number, number];
      const a: Alert = { kind: 'silence', level, zone, firedAt: t + cfg.silenceAfterS };
      silent.set(k, a);
      alerts.push(a);
      fresh.push(a);
    }
    return fresh;
  }

  return {
    ingest(r) {
      const { time, body } = r;
      const fresh = settle(time);
      const l = levelOf(body.level, time);
      const k = key(body.level, body.zone);
      if (body.event === 'ok' || body.event === 'restored') {
        if (body.event === 'ok') {
          lastOk.set(k, time);
          const s = silent.get(k);
          if (s) {
            s.clearedAt = time;
            silent.delete(k);
          }
        }
        if (body.event === 'restored') l.outSince = undefined;
        if (body.event === 'restored' && l.alert) {
          l.alert.clearedAt = time;
          l.alert = undefined;
        }
      } else if (body.event === 'out') {
        l.outSince ??= time;
        if (l.alert && l.alert.blackoutAt === undefined) l.alert.blackoutAt = time;
      } else {
        // flicker
        l.flickers.push(time);
        const horizon = time - cfg.baselineDays * DAY - cfg.windowS;
        while (l.flickers.length > 0 && l.flickers[0]! <= horizon) l.flickers.shift();
        if (!l.alert && l.outSince === undefined && time - l.firstSeen >= cfg.minBaselineHours * HOUR) {
          const count = countIn(l, time - cfg.windowS, time);
          const need = needed(l, time);
          if (count >= need) {
            const a: Alert = { kind: 'flicker-rise', level: body.level, firedAt: time, count, needed: need };
            l.alert = a;
            alerts.push(a);
            fresh.push(a);
          }
        }
      }
      return fresh;
    },
    check: settle,
    active(now) {
      return alerts.filter((a) => a.firedAt <= now && (a.clearedAt === undefined || a.clearedAt > now));
    },
    history: () => alerts,
    config: () => ({ ...cfg }),
  };
}
