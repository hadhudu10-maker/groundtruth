import { describe, expect, it } from 'vitest';
import { BUNDLE_MAX_NOTES } from './forward';
import { DEFAULT_SPREAD, measureSpread, runSpread, spreadProof } from './spread';
import { PARKED_MAX } from './store';

describe('city-scale spread with the network down', () => {
  it('uses the app\'s real limits: 40 notes a bundle, 200 unchecked notes carried', () => {
    expect(DEFAULT_SPREAD.bundleNotes).toBe(BUNDLE_MAX_NOTES);
    expect(DEFAULT_SPREAD.carryLimit).toBe(PARKED_MAX);
  });

  it('is repeatable: the same seed gives the same run', () => {
    const a = runSpread(7);
    const b = runSpread(7);
    expect(a).toEqual(b);
    expect(runSpread(8).reachByHour).not.toEqual(a.reachByHour);
  });

  it('reach only grows, starts at one resident and stays within the city', () => {
    const r = runSpread(3);
    expect(r.reachByHour).toHaveLength(DEFAULT_SPREAD.reachHours + 1);
    expect(r.reachByHour[0]).toBeCloseTo(1 / r.population, 6);
    for (let h = 1; h < r.reachByHour.length; h++) expect(r.reachByHour[h]!).toBeGreaterThanOrEqual(r.reachByHour[h - 1]!);
    expect(r.reachByHour.at(-1)!).toBeLessThanOrEqual(1);
    expect(r.splitFamilies).toBeGreaterThan(0);
  });

  it('nothing moves when no hand-off ever works', () => {
    const r = runSpread(3, { qrSuccess: 0, soundNoteSuccess: 0 });
    expect(r.reachByHour.at(-1)).toBeCloseTo(1 / r.population, 6);
    expect(r.familiesReconnected).toBe(0);
    expect(r.familiesHeard).toBe(0);
  });

  it('every fully reconnected family has also heard from a relative', () => {
    const r = runSpread(5);
    expect(r.familiesHeard).toBeGreaterThanOrEqual(r.familiesReconnected);
    expect(r.familiesHeard).toBeLessThanOrEqual(r.splitFamilies);
  });

  it('with perfect, unlimited hand-offs nearly everyone is reached and families reconnect', () => {
    const r = runSpread(3, { qrSuccess: 1, soundNoteSuccess: 1, qrShare: 1, bundleNotes: 1e9, carryLimit: 1e9, meetChance: 1 });
    expect(r.reachByHour.at(-1)!).toBeGreaterThan(0.95);
    expect(r.familiesReconnected / r.splitFamilies).toBeGreaterThan(0.9);
    expect(r.familiesHeard / r.splitFamilies).toBeGreaterThan(0.9);
  });

  it('gives both rail numbers as whole percents from seeded runs', () => {
    const m = measureSpread({ runs: 3 });
    const p = spreadProof(m);
    expect(Object.keys(p).sort()).toEqual(['familiesReconnectedPct', 'networkDownReachPct']);
    expect(Number.isInteger(p.networkDownReachPct)).toBe(true);
    expect(p.networkDownReachPct!).toBeGreaterThanOrEqual(0);
    expect(p.networkDownReachPct!).toBeLessThanOrEqual(100);
    expect(p.familiesReconnectedPct!).toBeGreaterThanOrEqual(0);
    expect(p.familiesReconnectedPct!).toBeLessThanOrEqual(100);
    expect(m.reachByHour).toHaveLength(DEFAULT_SPREAD.reachHours + 1);
  });
});
