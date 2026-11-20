import type { NoteBody } from '../world';

/** One short line describing a note, for lists on screen. */
export function summarize(body: NoteBody): string {
  switch (body.kind) {
    case 'text':
      return `"${body.text}"`;
    case 'power':
      return `level ${body.level}, zone ${body.zone}: ${body.event}`;
    case 'family':
      return `family ${body.familyTag}`;
    case 'water':
      return `level ${body.level}, tap ${body.tap}: ${body.result}`;
    case 'sick':
      return body.source === 'self'
        ? `level ${body.level}: self report`
        : `level ${body.level}: clinic tally, ${body.caseTags.length} ${body.caseTags.length === 1 ? 'case' : 'cases'}`;
    case 'surface':
      return `probe ${body.probe}, ${body.readings.length} readings`;
    case 'witness':
      return `witnessed ${body.ref.slice(0, 8)}`;
    case 'commit':
      return `commitment: ${body.topic}`;
  }
}
