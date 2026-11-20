import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { runHarness } from '../sim';
import { FAIRSHARE_SCENARIO, FAIRSHARE_SCENARIO_LABEL, FairSplitPanel, measureFairShare } from '.';

describe('fair split rail number', () => {
  test('is pinned: the same on every call', () => {
    expect(measureFairShare().proof).toEqual(measureFairShare().proof);
  });

  test('is exactly the harness number for the scenario', () => {
    expect(measureFairShare().proof.deepLevelPowerSharePct).toBe(runHarness(FAIRSHARE_SCENARIO).proof.deepLevelPowerSharePct);
  });

  test('shows the shortage hitting the deepest level, unlike a calm week', () => {
    const short = measureFairShare().proof.deepLevelPowerSharePct!;
    const calm = runHarness({ ...FAIRSHARE_SCENARIO, script: [] }).proof.deepLevelPowerSharePct!;
    expect(short).toBeLessThan(80);
    expect(calm).toBeGreaterThan(90);
  });

  test('the panel headline matches the rail and names the scenario', () => {
    const m = measureFairShare();
    const html = renderToStaticMarkup(<FairSplitPanel state={m.state} proof={m.proof} caption={FAIRSHARE_SCENARIO_LABEL} />);
    expect(html).toContain(`${m.proof.deepLevelPowerSharePct}%`);
    expect(html).toContain(FAIRSHARE_SCENARIO_LABEL);
    expect(html).not.toMatch(/[–—]/);
  });
});
