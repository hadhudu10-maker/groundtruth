import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { runHarness } from '../sim';
import { WarningPanel, measureWarnings } from '.';

describe('WarningPanel', () => {
  const ramp = runHarness({
    seed: 7,
    hours: 80,
    hazards: false,
    script: [{ atHour: 72, trigger: { kind: 'level-power-loss', level: 12, rampHours: 8 } }],
  });

  test('a calm moment shows no warnings', () => {
    const state = ramp.timeline[60]!;
    const html = renderToStaticMarkup(<WarningPanel state={state} observations={ramp.observations} />);
    expect(html).toContain('warning-none');
    expect(html).not.toContain('flicker-warning');
  });

  test('right before the blackout it shows a warning for level 12, and after it a silence alarm', () => {
    const out = ramp.events.find((e) => e.what === 'level-out' && e.level === 12 && e.time > 72 * 3600)!;
    const before = ramp.timeline.find((s) => s.time >= out.time)!;
    const html = renderToStaticMarkup(<WarningPanel state={before} observations={ramp.observations} />);
    expect(html).toContain('flicker-warning');
    expect(html).toContain('Level 12: flickers are rising');
    const later = ramp.timeline.at(-1)!;
    expect(renderToStaticMarkup(<WarningPanel state={later} observations={ramp.observations} />)).toContain('silence-alarm');
  });

  test('shows a measurement when given one, and offers to run it when not', () => {
    const state = ramp.timeline[60]!;
    const measured = measureWarnings({ runs: 10 });
    const withIt = renderToStaticMarkup(<WarningPanel state={state} observations={ramp.observations} measured={measured} />);
    expect(withIt).toContain(`${measured.medianLeadHours} h`);
    expect(renderToStaticMarkup(<WarningPanel state={state} observations={ramp.observations} />)).toContain('over 500 runs');
  });

  test('no em or en dashes in the panel text', () => {
    const html = renderToStaticMarkup(<WarningPanel state={ramp.timeline[75]!} observations={ramp.observations} />);
    expect(html).not.toMatch(/[\u2013\u2014]/);
  });
});
