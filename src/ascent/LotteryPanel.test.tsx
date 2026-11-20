import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { LotteryPanel, buildLotteryScenario, lotteryProof, runDraw } from '.';

describe('LotteryPanel', () => {
  const sc = buildLotteryScenario(1);
  const official = runDraw(sc.notebook, sc.organizer.keyId, sc.k);
  const html = renderToStaticMarkup(<LotteryPanel seed={1} proof={lotteryProof()} />);

  test('shows commit, close, the crew and the re-run button', () => {
    expect(official.ok).toBe(true);
    expect(html).toContain('lottery-commit');
    expect(html).toContain('lottery-close');
    expect(html).toContain('Re-run the draw');
    if (official.ok) for (const id of official.crew) expect(html).toContain(sc.names.get(id)!);
  });

  test('the match share is the measured one', () => {
    expect(html).toContain(`${lotteryProof().lotteryRecheckMatchPct}% of re-runs`);
  });

  test('no em or en dashes', () => {
    expect(html).not.toMatch(/[–—]/);
  });
});
