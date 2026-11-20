import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { runHarness } from '../sim';
import { FairSplitPanel } from '.';

describe('FairSplitPanel', () => {
  const run = runHarness({ seed: 42, hours: 168, hazards: false, script: [{ atHour: 12, trigger: { kind: 'generation-drop', fraction: 0.15 } }] });
  const state = run.timeline.at(-1)!;

  test('shows every level with both bars and the proof share from sim.proof()', () => {
    const html = renderToStaticMarkup(<FairSplitPanel state={state} proof={run.sim.proof()} />);
    expect(html).toContain('fair-bars-power');
    for (let l = 1; l <= 12; l++) expect(html).toContain(`>L${l}<`);
    expect(html).toContain(`${run.sim.proof().deepLevelPowerSharePct}%`);
    expect(html).toContain('Fair plan, same total');
  });

  test('no em or en dashes in the panel text', () => {
    expect(renderToStaticMarkup(<FairSplitPanel state={state} />)).not.toMatch(/[\u2013\u2014]/);
  });
});
