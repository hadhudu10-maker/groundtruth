// One line per test attempt. The page shows them and offers "Copy results" so they can be pasted into notes.
export interface ResultLine {
  /** ISO time the line was written. */
  at: string;
  test: string;
  pass: boolean;
  /** Free text, for example "140 B, 12.4 s from first sound to verified". */
  detail: string;
  /** For sound: which framing worked ('binary' or 'base64'), and the protocol. */
  mode?: string;
}

export function formatResult(line: ResultLine, userAgent: string): string {
  const mode = line.mode ? ` | mode ${line.mode}` : '';
  return `${line.at} | ${line.test} | ${line.pass ? 'PASS' : 'FAIL'} | ${line.detail}${mode} | ${userAgent}`;
}

export function formatResults(lines: ResultLine[], userAgent: string): string {
  return lines.map((l) => formatResult(l, userAgent)).join('\n');
}
