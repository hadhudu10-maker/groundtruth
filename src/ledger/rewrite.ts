// The demo's "rewrite history" attempt, as plain functions so it can be tested without a screen.
// The Directorate quietly changes an old entry in its own copy of the notebook, then tries to show
// that its copy still extends the head residents published earlier. The check fails.
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { createIdentity, signNote, type Identity, type Notebook, type NotebookEntry, type NotebookHead, type VerifiedNote } from '../world';
import { notebook, rewriteHistory } from './notebook';

/** A fixed, made-up signer for the forger. Residents have never paired with it. */
export const DIRECTORATE: Identity = createIdentity({
  name: 'Directorate',
  level: 1,
  secretKey: sha256(utf8ToBytes('groundtruth/demo/directorate')),
});

/** What the forger writes instead: a clinic tally with half its cases gone, or "All is well." */
export function forgedReplacement(entry: NotebookEntry, forger: Identity = DIRECTORATE): VerifiedNote {
  const { body, seq, time } = entry.note;
  if (body.kind === 'sick' && body.caseTags.length > 1) {
    const caseTags = body.caseTags.slice(0, Math.ceil(body.caseTags.length / 2));
    return signNote({ seq, time, body: { ...body, caseTags } }, forger);
  }
  return signNote({ seq, time, body: { kind: 'text', text: 'All is well.' } }, forger);
}

export interface RewriteAttempt {
  index: number;
  original: NotebookEntry;
  forged: NotebookEntry;
  forgedHead: NotebookHead;
  /** The forger's own copy checked against the published head. Always false unless nothing changed. */
  forgedConsistent: boolean;
  /** The honest notebook checked against the same head, for contrast. */
  honestConsistent: boolean;
}

/** Rewrite entry `index` (which must be inside the published head) in a copy and run both checks. */
export function attemptRewrite(source: Notebook, published: NotebookHead, index: number, forger: Identity = DIRECTORATE): RewriteAttempt {
  const original = source.get(index);
  if (!original || index >= published.size) throw new RangeError(`entry ${index} is not inside the published head`);
  const copy = rewriteHistory(source, index, forgedReplacement(original, forger));
  const forgedHead = copy.head();
  return {
    index,
    original,
    forged: copy.get(index)!,
    forgedHead,
    forgedConsistent: notebook.verifyConsistency(published, forgedHead, copy.proveConsistency(published.size)),
    honestConsistent: notebook.verifyConsistency(published, source.head(), source.proveConsistency(published.size)),
  };
}
