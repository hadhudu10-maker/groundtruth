// The notebook nobody can erase: an append-only Merkle log of signed notes (RFC 6962 style).
// Implements the frozen interface in src/world/notebook.ts.
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import {
  decodeNote,
  verifyNote,
  type ConsistencyProof,
  type HashHex,
  type InclusionProof,
  type KeyLookup,
  type Notebook,
  type NotebookAudit,
  type NotebookEntry,
  type NotebookHead,
  type NotebookModule,
  type NoteId,
  type SignedNote,
  type VerifiedNote,
} from '../world';
import { emptyRoot, hashLeaf, MerkleTree, verifyConsistencyPath, verifyInclusionPath } from './merkle';

export const EMPTY_ROOT: HashHex = bytesToHex(emptyRoot());

const HASH_HEX = /^[0-9a-f]{64}$/;

/** Hex to 32 bytes, or null if it is not a lowercase 64-char hash. Verifiers never throw. */
function hash(h: unknown): Uint8Array | null {
  return typeof h === 'string' && HASH_HEX.test(h) ? hexToBytes(h) : null;
}

function hashes(list: unknown): Uint8Array[] | null {
  if (!Array.isArray(list)) return null;
  const out: Uint8Array[] = [];
  for (const h of list) {
    const b = hash(h);
    if (!b) return null;
    out.push(b);
  }
  return out;
}

function createNotebook(): Notebook {
  const tree = new MerkleTree();
  const list: NotebookEntry[] = [];
  const byId = new Map<NoteId, NotebookEntry>();

  const head = (size = tree.size): NotebookHead => ({ size, root: bytesToHex(tree.root(size)) });

  return {
    head: () => head(),
    append(note: VerifiedNote) {
      const existing = byId.get(note.id);
      if (existing) return { ok: false, reason: 'already-recorded', existing };
      const leaf = hashLeaf(note.bytes);
      const entry: NotebookEntry = { index: list.length, note, leaf: bytesToHex(leaf) };
      tree.push(leaf);
      list.push(entry);
      byId.set(note.id, entry);
      return { ok: true, entry, head: head() };
    },
    get: (index) => list[index],
    find: (id) => byId.get(id),
    entries: (start, end) => list.slice(start, end),
    proveInclusion(index, size = tree.size) {
      return { index, size, path: tree.inclusionPath(index, size).map(bytesToHex) };
    },
    proveConsistency(fromSize, toSize = tree.size) {
      return { fromSize, toSize, path: tree.consistencyPath(fromSize, toSize).map(bytesToHex) };
    },
  };
}

function verifyInclusion(head: NotebookHead, leaf: HashHex, proof: InclusionProof): boolean {
  if (proof.size !== head.size) return false;
  const l = hash(leaf);
  const root = hash(head.root);
  const path = hashes(proof.path);
  if (!l || !root || !path) return false;
  return verifyInclusionPath(l, proof.index, proof.size, path, root);
}

function verifyConsistency(older: NotebookHead, newer: NotebookHead, proof: ConsistencyProof): boolean {
  if (proof.fromSize !== older.size || proof.toSize !== newer.size) return false;
  const a = hash(older.root);
  const b = hash(newer.root);
  const path = hashes(proof.path);
  if (!a || !b || !path) return false;
  return verifyConsistencyPath(older.size, newer.size, a, b, path);
}

function auditNotebook(noteBytes: readonly Uint8Array[], claimed: NotebookHead, keys: KeyLookup): NotebookAudit {
  const tree = new MerkleTree();
  for (let i = 0; i < noteBytes.length; i++) {
    const bytes = noteBytes[i]!;
    let note: SignedNote;
    try {
      note = decodeNote(bytes);
    } catch {
      return { ok: false, firstBadIndex: i, reason: 'bad-signature' };
    }
    const key = keys.get(note.author);
    if (!key) return { ok: false, firstBadIndex: i, reason: 'unknown-key' };
    if (!verifyNote(note, key)) return { ok: false, firstBadIndex: i, reason: 'bad-signature' };
    tree.push(hashLeaf(bytes));
  }
  // Every entry is a genuine signed note; now the head must commit to exactly this list.
  // A swapped, dropped or re-signed entry cannot be pinned to one index from the root alone, so -1.
  if (tree.size !== claimed.size) return { ok: false, firstBadIndex: -1, reason: 'size-mismatch' };
  const head: NotebookHead = { size: tree.size, root: bytesToHex(tree.root()) };
  if (head.root !== claimed.root) return { ok: false, firstBadIndex: -1, reason: 'root-mismatch' };
  return { ok: true, head };
}

export const notebook = {
  createNotebook,
  leafHash: (noteBytes: Uint8Array): HashHex => bytesToHex(hashLeaf(noteBytes)),
  verifyInclusion,
  verifyConsistency,
  auditNotebook,
} satisfies NotebookModule;

/**
 * The 32 bytes a resident publishes in a `commit` note with topic 'notebook-head':
 * SHA-256(uint32 big-endian size || root bytes).
 */
export function headDigest(head: NotebookHead): Uint8Array {
  const size = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, head.size);
  return sha256(concatBytes(size, hexToBytes(head.root)));
}

/** A fresh notebook holding `notes` in order (duplicates skipped). */
export function notebookFrom(notes: Iterable<VerifiedNote>): Notebook {
  const nb = createNotebook();
  for (const n of notes) nb.append(n);
  return nb;
}

/**
 * The demo's forger: a copy of `source` where entry `index` is replaced by `replacement`, every
 * later entry kept in place. The original is never touched (it has no edit or delete).
 */
export function rewriteHistory(source: Notebook, index: number, replacement: VerifiedNote): Notebook {
  const notes = source.entries().map((e) => (e.index === index ? replacement : e.note));
  return notebookFrom(notes);
}

/** Short fingerprint for screens: the first 8 hex chars, grouped. */
export function shortHash(h: HashHex, chars = 8): string {
  return h.slice(0, chars).replace(/(.{4})(?=.)/g, '$1 ');
}
