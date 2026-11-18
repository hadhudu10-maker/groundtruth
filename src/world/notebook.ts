// The notebook interface: types and signatures only. src/ledger implements it on Thursday.
// FROZEN after Tue 2026-11-17.
//
// It is an append-only Merkle log in the style of Certificate Transparency (RFC 6962):
//   leaf hash = SHA-256(0x00 || note.bytes)          (the full wire bytes, signature included)
//   node hash = SHA-256(0x01 || left || right)
//   empty root = SHA-256 of zero bytes
// A head (size + root) commits to every note before it. Anyone holding an older head can ask
// for a consistency proof; if history was rewritten, the proof cannot be built and the check fails.
import type { KeyLookup, NoteId } from './types';
import type { VerifiedNote } from './note';

export const NOTEBOOK_LEAF_PREFIX = 0x00;
export const NOTEBOOK_NODE_PREFIX = 0x01;

/** Lowercase hex, 64 chars. */
export type HashHex = string;

/** A snapshot of the notebook. Residents pass heads around (as `commit` notes, topic 'notebook-head'). */
export interface NotebookHead {
  size: number;
  root: HashHex;
}

export interface NotebookEntry {
  index: number;
  note: VerifiedNote;
  leaf: HashHex;
}

/** Proves entry `index` is in the notebook whose head has `size` entries. */
export interface InclusionProof {
  index: number;
  size: number;
  path: HashHex[];
}

/** Proves the notebook at `toSize` still contains, unchanged, everything it held at `fromSize`. */
export interface ConsistencyProof {
  fromSize: number;
  toSize: number;
  path: HashHex[];
}

export type AppendResult =
  | { ok: true; entry: NotebookEntry; head: NotebookHead }
  | { ok: false; reason: 'already-recorded'; existing: NotebookEntry };

/** Result of re-checking a whole notebook from scratch. */
export type NotebookAudit =
  | { ok: true; head: NotebookHead }
  | {
      ok: false;
      /** First entry that does not match, or -1 when only the head is wrong. */
      firstBadIndex: number;
      reason: 'bad-signature' | 'unknown-key' | 'root-mismatch' | 'size-mismatch';
    };

/** One resident's copy of the notebook. Append-only: there is deliberately no edit or delete. */
export interface Notebook {
  head(): NotebookHead;
  /** Adds a verified note. A note already recorded (same ID) is not added twice. */
  append(note: VerifiedNote): AppendResult;
  get(index: number): NotebookEntry | undefined;
  find(id: NoteId): NotebookEntry | undefined;
  /** Entries in order, from `start` (inclusive) to `end` (exclusive). */
  entries(start?: number, end?: number): readonly NotebookEntry[];
  /** `size` defaults to the current size. Throws RangeError if `index >= size`. */
  proveInclusion(index: number, size?: number): InclusionProof;
  /** `toSize` defaults to the current size. Throws RangeError if `fromSize > toSize`. */
  proveConsistency(fromSize: number, toSize?: number): ConsistencyProof;
}

/** What src/ledger must export. Declare it as `export const notebook = {...} satisfies NotebookModule`. */
export interface NotebookModule {
  createNotebook(): Notebook;
  leafHash(noteBytes: Uint8Array): HashHex;
  /** True if `leaf` sits at `proof.index` under `head`. */
  verifyInclusion(head: NotebookHead, leaf: HashHex, proof: InclusionProof): boolean;
  /** True if `newer` extends `older` without changing any earlier entry. The "rewrite history" check. */
  verifyConsistency(older: NotebookHead, newer: NotebookHead, proof: ConsistencyProof): boolean;
  /** Re-verify every signature and recompute the root from raw bytes, then compare with `claimed`. */
  auditNotebook(noteBytes: readonly Uint8Array[], claimed: NotebookHead, keys: KeyLookup): NotebookAudit;
}
