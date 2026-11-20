import { describe, expect, test } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSim } from '../sim';
import { notebookFrom } from './notebook';
import { measureOutbreak, outbreakReport } from './outbreak';
import { attemptRewrite, DIRECTORATE, forgedReplacement } from './rewrite';
import { NotebookPanel } from './NotebookPanel';
import { OutbreakPanel } from './OutbreakPanel';

const report = measureOutbreak();

describe('rewrite history attempt', () => {
  const nb = report.notebook;
  const published = notebookFrom(report.notes.slice(0, 40)).head();

  test('every old entry: the forged copy fails, the honest notebook passes', () => {
    for (let i = 0; i < published.size; i++) {
      const a = attemptRewrite(nb, published, i);
      expect(a.forgedConsistent, `entry ${i}`).toBe(false);
      expect(a.honestConsistent).toBe(true);
      expect(a.forged.note.author).toBe(DIRECTORATE.keyId);
      expect(a.forgedHead.size).toBe(nb.head().size);
      expect(a.forgedHead.root).not.toBe(nb.head().root);
    }
  });

  test('the forged clinic tally keeps only half its cases', () => {
    const tally = nb.entries().find((e) => e.note.body.kind === 'sick' && e.note.body.caseTags.length > 1)!;
    const forged = forgedReplacement(tally);
    expect(forged.body.kind === 'sick' && forged.body.caseTags.length).toBe(
      Math.ceil((tally.note.body as { caseTags: string[] }).caseTags.length / 2),
    );
  });

  test('an entry outside the published head cannot be "rewritten"', () => {
    expect(() => attemptRewrite(nb, published, published.size)).toThrow(RangeError);
  });
});

describe('panels render at phone width with real numbers', () => {
  const dash = /[\u2013\u2014]/;

  test('NotebookPanel', () => {
    const html = renderToStaticMarkup(<NotebookPanel notebook={report.notebook} />);
    expect(html).toContain(String(report.notebook.head().size));
    expect(html).toContain('Rewrite history');
    expect(html).not.toMatch(dash);
    const empty = renderToStaticMarkup(<NotebookPanel notebook={notebookFrom([])} />);
    expect(empty).toContain('empty');
  });

  test('OutbreakPanel', () => {
    const html = renderToStaticMarkup(<OutbreakPanel report={report} />);
    expect(html).toContain(`${report.proof.outbreakUndercountRatio}x`);
    expect(html).toContain('Official');
    expect(html).not.toMatch(dash);
    const live = renderToStaticMarkup(<OutbreakPanel report={report} headline={{ ratio: 4.2, days: 10 }} />);
    expect(live).toContain('4.2x');
    expect(live).toContain('measured over a 10 day run');
    expect(live).toContain('Right now in the city, day 11');
    expect(renderToStaticMarkup(<OutbreakPanel report={report} headline={{ ratio: undefined, days: 10 }} />)).toContain('measuring...');
    const sim = createSim({ seed: 3, hazards: false });
    expect(() => renderToStaticMarkup(<OutbreakPanel report={outbreakReport(sim)} />)).not.toThrow();
  });
});
