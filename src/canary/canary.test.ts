// The canary against the real simulation. The 500-run measurement at the bottom is the source of the
// problem 1 proof number.
import { describe, expect, test } from 'vitest';
import { demoScript, runHarness } from '../sim';
import { blackoutWarningLeadHours, measureWarnings, replayRun, scenarioFor } from '.';

const HOUR = 3600;

describe('warning before a scripted blackout', () => {
  test('a feeder failure on the deepest level is warned about before it goes dark', () => {
    const run = runHarness({
      seed: 7,
      hours: 120,
      hazards: false,
      script: [{ atHour: 72, trigger: { kind: 'level-power-loss', level: 12, rampHours: 8 } }],
    });
    const out = run.events.find((e) => e.what === 'level-out' && e.level === 12 && e.time > 72 * HOUR);
    expect(out).toBeDefined();
    const alerts = replayRun(run);
    const warning = alerts.find((a) => a.kind === 'flicker-rise' && a.level === 12 && a.blackoutAt === out!.time);
    expect(warning).toBeDefined();
    expect(warning!.firedAt).toBeLessThan(out!.time);
    expect((out!.time - warning!.firedAt) / HOUR).toBeGreaterThan(0.25);
  });

  test('the demo story is warned about before level 12 goes dark', () => {
    const run = runHarness({ seed: 42, hours: 48, hazards: false, script: demoScript() });
    const out = run.events.find((e) => e.what === 'level-out' && e.level === 12)!;
    const warning = replayRun(run).find((a) => a.kind === 'flicker-rise' && a.level === 12 && a.blackoutAt === out.time);
    expect(warning).toBeDefined();
    expect(warning!.firedAt).toBeLessThan(out.time);
  });
});

describe('silence alarm on the simulation', () => {
  test('every zone of a dark level raises a silence alarm soon after the blackout', () => {
    const run = runHarness({
      seed: 7,
      hours: 120,
      hazards: false,
      script: [{ atHour: 72, trigger: { kind: 'level-power-loss', level: 12, rampHours: 0 } }],
    });
    const out = run.events.find((e) => e.what === 'level-out' && e.level === 12)!;
    const silence = replayRun(run).filter((a) => a.kind === 'silence' && a.level === 12 && a.firedAt >= out.time - HOUR);
    expect(silence.map((a) => a.zone).sort()).toEqual([0, 1, 2, 3]);
    for (const a of silence) expect((a.firedAt - out.time) / HOUR).toBeLessThanOrEqual(2);
  });

  test('a silent level that was never dark does not exist: no silence alarm on any lit level', () => {
    const run = runHarness({ seed: 42, hours: 72, hazards: false });
    expect(replayRun(run).filter((a) => a.kind === 'silence')).toEqual([]);
  });
});

describe('calm runs', () => {
  test('seed 42 with hazards off raises no alert in three days', () => {
    expect(replayRun(runHarness({ seed: 42, hours: 72, hazards: false }))).toEqual([]);
  });

  test('across 30 calm seeds the shallow levels never raise a warning', () => {
    let shallow = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const run = runHarness({ seed, hours: 168, hazards: false });
      for (const a of replayRun(run)) {
        if (a.kind !== 'flicker-rise') continue;
        if (a.level <= 8) shallow++;
      }
    }
    // The deep levels do brown out most evenings, so some warnings are fair; the shallow levels never do.
    expect(shallow).toBe(0);
  });
});

describe('scenarios', () => {
  test('the scenario for a seed does not change', () => {
    expect(scenarioFor(13, 336)).toEqual(scenarioFor(13, 336));
    expect(scenarioFor(18, 336).scenario).toBe('calm');
  });
});

describe('500 seeded runs', () => {
  test('lead time, false alarms and misses are measured from the harness', { timeout: 120_000 }, () => {
    const report = measureWarnings({ runs: 500 });
    const { details: _details, ...summary } = report;
    console.log('canary measurement over 500 runs:', JSON.stringify(summary));

    expect(report.runs).toBe(500);
    expect(report.blackouts).toBeGreaterThan(500);
    // It sees most blackouts coming, with hours of warning at the median.
    expect(report.detectionRate).toBeGreaterThanOrEqual(0.8);
    expect(report.medianLeadHours).toBeGreaterThan(1);
    expect(report.p10LeadHours).toBeGreaterThan(0);
    // Warnings that are pure noise (the level was never short of power) are rare.
    expect(report.spuriousRate).toBeLessThan(0.01);
    expect(report.silence.falseAlarms).toBe(0);
    expect(report.silence.medianDelayHours).toBeLessThanOrEqual(2);
    // Every lead was positive and ended at a real level-out event.
    for (const d of report.details) if (d.leadHours !== undefined) expect(d.leadHours).toBeGreaterThan(0);
  });

  test('blackoutWarningLeadHours is the measured median, never a constant', { timeout: 120_000 }, () => {
    const small = blackoutWarningLeadHours({ runs: 60 });
    const report = measureWarnings({ runs: 60 });
    expect(small.blackoutWarningLeadHours).toBe(report.medianLeadHours);
    expect(Object.keys(small)).toEqual(['blackoutWarningLeadHours']);
    // A different seed range gives a different measured number, so it is not hand-typed.
    const other = blackoutWarningLeadHours({ runs: 60, firstSeed: 9001 });
    expect(other.blackoutWarningLeadHours).not.toBe(small.blackoutWarningLeadHours);
  });
});
