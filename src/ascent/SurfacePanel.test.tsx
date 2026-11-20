import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { SurfacePanel, buildSurfaceScenario, rulesFingerprint } from '.';

describe('SurfacePanel', () => {
  const html = renderToStaticMarkup(<SurfacePanel seed={5} />);
  const sc = buildSurfaceScenario(5);

  test('shows the rules fingerprint, the readings, the curves and the verdict', () => {
    expect(html).toContain(rulesFingerprint(sc.rules).slice(0, 4));
    expect(html).toContain('surface-readings');
    expect(html).toContain('surface-curves');
    expect(html).toContain('surface-verdict');
    expect(html).toContain(`surface:${sc.verdict.verdict}`);
  });

  test('the witness total comes from the notebook readout', () => {
    expect(html).toContain(`${sc.verdict.signaturesAtAgreement} witness signatures`);
  });

  test('no em or en dashes', () => {
    expect(html).not.toMatch(/[–—]/);
  });
});
