import { describe, expect, test } from 'vitest';
import type { PowerEvent } from '../world';
import { createCanary, powerReadings, type PowerReading } from '.';

const H = 3600;
const ZONES = 4;

const note = (time: number, level: number, zone: number, event: PowerEvent, durationS = 0): PowerReading => ({
  time,
  body: { kind: 'power', level, zone, event, durationS },
});

/** Hourly heartbeats from every zone of `level` for hours [from, to), plus the given flicker times. */
function quietHours(level: number, from: number, to: number, flickersAt: number[] = []): PowerReading[] {
  const out: PowerReading[] = [];
  for (let h = from; h < to; h++) for (let z = 0; z < ZONES; z++) out.push(note(h * H, level, z, 'ok'));
  for (const t of flickersAt) out.push(note(t, level, 0, 'flicker', 5));
  return out.sort((a, b) => a.time - b.time);
}

function feed(monitor: ReturnType<typeof createCanary>, readings: PowerReading[]) {
  for (const r of readings) monitor.ingest(r);
}

describe('adapter', () => {
  test('a power observation maps one to one onto a PowerBody and keeps its time', () => {
    const out = powerReadings([
      { type: 'power', time: 7200, level: 9, zone: 2, event: 'flicker', durationS: 14 },
      { type: 'sick', time: 7300, level: 9, source: 'self', resident: 1 },
    ]);
    expect(out).toEqual([{ time: 7200, body: { kind: 'power', level: 9, zone: 2, event: 'flicker', durationS: 14 } }]);
  });
});

describe('flicker warning', () => {
  test('stays quiet on a level that only has its usual rare flicker', () => {
    const monitor = createCanary();
    // One stray flicker every 8 hours for two days.
    const strays = Array.from({ length: 6 }, (_, i) => (8 * i + 3) * H + 600);
    feed(monitor, quietHours(12, 0, 48, strays));
    monitor.check(48 * H);
    expect(monitor.history().filter((a) => a.kind === 'flicker-rise')).toEqual([]);
  });

  test('fires when the flicker rate jumps well above the level s own baseline', () => {
    const monitor = createCanary();
    const burst = [40, 41, 42, 43, 44, 45].map((m) => 30 * H + m * 60);
    feed(monitor, quietHours(12, 0, 31, burst));
    const warnings = monitor.history().filter((a) => a.kind === 'flicker-rise');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.level).toBe(12);
    // It fires on a flicker inside the burst, not before and not after.
    expect(warnings[0]!.firedAt).toBeGreaterThanOrEqual(burst[0]!);
    expect(warnings[0]!.firedAt).toBeLessThanOrEqual(burst[burst.length - 1]!);
  });

  test('judges each level against its own baseline', () => {
    const monitor = createCanary();
    // Level 11 flickers about once an hour all day long (its normal). Level 3 normally never flickers.
    const busy = Array.from({ length: 30 }, (_, i) => i * H + 1800);
    feed(monitor, quietHours(11, 0, 30, busy));
    // The same count in a short span is a rise on level 3 only.
    const burst = [10, 20, 30, 40, 45, 50].map((m) => 28 * H + m * 60);
    feed(monitor, quietHours(3, 0, 30, burst));
    const levels = monitor.history().filter((a) => a.kind === 'flicker-rise').map((a) => a.level);
    expect(levels).toEqual([3]);
  });

  test('does not fire before it has seen enough history to know the baseline', () => {
    const monitor = createCanary();
    const burst = [0, 1, 2, 3, 4, 5].map((m) => 1 * H + m * 60);
    feed(monitor, quietHours(12, 0, 2, burst));
    expect(monitor.history()).toEqual([]);
  });

  test('clears once the rate falls back, and can fire again later', () => {
    const monitor = createCanary();
    const burst1 = [0, 1, 2, 3, 4, 5].map((m) => 30 * H + m * 60);
    const burst2 = [0, 1, 2, 3, 4, 5].map((m) => 50 * H + m * 60);
    feed(monitor, quietHours(12, 0, 55, [...burst1, ...burst2]));
    monitor.check(55 * H);
    const warnings = monitor.history().filter((a) => a.kind === 'flicker-rise');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]!.clearedAt).toBeDefined();
    expect(monitor.active(55 * H).filter((a) => a.kind === 'flicker-rise')).toHaveLength(0);
  });
});

describe('silence alarm', () => {
  test('fires when a zone s heartbeats stop for longer than the threshold', () => {
    const monitor = createCanary();
    feed(monitor, quietHours(12, 0, 10)); // last heartbeat at hour 9
    monitor.check(10 * H + 600);
    expect(monitor.active(10 * H + 600)).toEqual([]);
    monitor.check(9 * H + 3 * H);
    const silent = monitor.active(12 * H).filter((a) => a.kind === 'silence');
    expect(silent.map((a) => a.zone).sort()).toEqual([0, 1, 2, 3]);
    expect(silent.every((a) => a.level === 12 && a.firedAt > 9 * H)).toBe(true);
  });

  test('clears when the heartbeat comes back', () => {
    const monitor = createCanary();
    feed(monitor, quietHours(12, 0, 10));
    monitor.check(14 * H);
    expect(monitor.active(14 * H).filter((a) => a.kind === 'silence').length).toBe(ZONES);
    feed(monitor, [note(14 * H, 12, 0, 'restored', 5 * H), note(14 * H, 12, 0, 'ok')]);
    monitor.check(14 * H + 60);
    expect(monitor.active(14 * H + 60).filter((a) => a.kind === 'silence').map((a) => a.zone)).toEqual([1, 2, 3]);
  });

  test('a zone that never sent a heartbeat cannot be silent', () => {
    const monitor = createCanary();
    monitor.check(100 * H);
    expect(monitor.history()).toEqual([]);
  });
});
