import { describe, expect, test } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import {
  createIdentity,
  NOTEBOOK_LEAF_PREFIX,
  NOTEBOOK_NODE_PREFIX,
  signNote,
  type Identity,
  type NotebookHead,
  type VerifiedNote,
} from '../world';
import { headDigest, notebook, notebookFrom, EMPTY_ROOT } from './notebook';
import { MerkleTree } from './merkle';

// ---------------------------------------------------------------- fixtures

function seededKey(n: number): Uint8Array {
  const k = new Uint8Array(32);
  k[0] = n & 0xff;
  k[1] = (n >> 8) & 0xff;
  k[31] = 7;
  return k;
}

const alice = createIdentity({ name: 'Alice', level: 3, secretKey: seededKey(1) });
const bram = createIdentity({ name: 'Bram', level: 11, secretKey: seededKey(2) });
const directorate = createIdentity({ name: 'Directorate', level: 1, secretKey: seededKey(3) });
const keys = new Map([alice, bram, directorate].map((i) => [i.keyId, i.publicKey] as const));

function textNote(who: Identity, seq: number, text = `note ${seq}`): VerifiedNote {
  return signNote({ seq, time: 1_000 + seq, body: { kind: 'text', text } }, who);
}

const NOTES: VerifiedNote[] = Array.from({ length: 64 }, (_, i) => textNote(i % 2 ? bram : alice, i));

/** The RFC 6962 definitions, written straight from section 2.1 with no caching: the oracle. */
const ref = {
  leaf: (b: Uint8Array) => sha256(concatBytes(Uint8Array.of(NOTEBOOK_LEAF_PREFIX), b)),
  node: (l: Uint8Array, r: Uint8Array) => sha256(concatBytes(Uint8Array.of(NOTEBOOK_NODE_PREFIX), l, r)),
  split: (n: number) => {
    let k = 1;
    while (k * 2 < n) k *= 2;
    return k;
  },
  mth(d: Uint8Array[]): Uint8Array {
    if (d.length === 0) return sha256(new Uint8Array(0));
    if (d.length === 1) return ref.leaf(d[0]!);
    const k = ref.split(d.length);
    return ref.node(ref.mth(d.slice(0, k)), ref.mth(d.slice(k)));
  },
  path(m: number, d: Uint8Array[]): Uint8Array[] {
    if (d.length <= 1) return [];
    const k = ref.split(d.length);
    return m < k
      ? [...ref.path(m, d.slice(0, k)), ref.mth(d.slice(k))]
      : [...ref.path(m - k, d.slice(k)), ref.mth(d.slice(0, k))];
  },
  subproof(m: number, d: Uint8Array[], b: boolean): Uint8Array[] {
    if (m === d.length) return b ? [] : [ref.mth(d)];
    const k = ref.split(d.length);
    return m <= k
      ? [...ref.subproof(m, d.slice(0, k), b), ref.mth(d.slice(k))]
      : [...ref.subproof(m - k, d.slice(k), false), ref.mth(d.slice(0, k))];
  },
};

const hex = (bs: Uint8Array[]) => bs.map(bytesToHex);

// ---------------------------------------------------------------- the tree itself

describe('Merkle tree (RFC 6962)', () => {
  test('empty root is SHA-256 of nothing', () => {
    expect(EMPTY_ROOT).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(notebook.createNotebook().head()).toEqual({ size: 0, root: EMPTY_ROOT });
  });

  test('matches the Certificate Transparency reference vector', () => {
    const leaves = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657', '606162636465666768696a6b6c6d6e6f'].map(
      (h) => hexToBytes(h),
    );
    const t = new MerkleTree();
    for (const l of leaves) t.push(ref.leaf(l));
    expect(bytesToHex(t.root(8))).toBe('5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328');
  });

  test('leafHash is SHA-256(0x00 || bytes)', () => {
    const n = NOTES[0]!;
    expect(notebook.leafHash(n.bytes)).toBe(bytesToHex(ref.leaf(n.bytes)));
  });

  test('root, inclusion paths and consistency paths match the oracle for every size 1..64', () => {
    const raw = NOTES.map((n) => n.bytes);
    const nb = notebookFrom(NOTES);
    for (let size = 1; size <= 64; size++) {
      const d = raw.slice(0, size);
      expect(nb.entries(0, size).length).toBe(size);
      const proof = nb.proveInclusion(0, size);
      expect(proof.size).toBe(size);
      for (let m = 0; m < size; m++) {
        expect(nb.proveInclusion(m, size).path).toEqual(hex(ref.path(m, d)));
      }
      for (let m = 1; m <= size; m++) {
        expect(nb.proveConsistency(m, size).path).toEqual(hex(ref.subproof(m, d, true)));
      }
    }
    expect(nb.head().root).toBe(bytesToHex(ref.mth(raw)));
  });
});

// ---------------------------------------------------------------- the notebook

describe('notebook basics', () => {
  test('append, get, find, entries and dedupe by note ID', () => {
    const nb = notebook.createNotebook();
    const a = nb.append(NOTES[0]!);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.entry.index).toBe(0);
    expect(a.head.size).toBe(1);
    const b = nb.append(NOTES[1]!);
    expect(b.ok && b.entry.index).toBe(1);
    const again = nb.append(NOTES[0]!);
    expect(again).toEqual({ ok: false, reason: 'already-recorded', existing: a.entry });
    expect(nb.head().size).toBe(2);
    expect(nb.get(1)?.note.id).toBe(NOTES[1]!.id);
    expect(nb.get(2)).toBeUndefined();
    expect(nb.get(-1)).toBeUndefined();
    expect(nb.find(NOTES[1]!.id)?.index).toBe(1);
    expect(nb.find('00'.repeat(32))).toBeUndefined();
    expect(nb.entries().map((e) => e.index)).toEqual([0, 1]);
    expect(nb.entries(1).map((e) => e.index)).toEqual([1]);
    expect(nb.entries()[0]!.leaf).toBe(notebook.leafHash(NOTES[0]!.bytes));
  });

  test('entries() is a copy: changing it does not change the notebook', () => {
    const nb = notebookFrom(NOTES.slice(0, 3));
    const list = nb.entries() as unknown as unknown[];
    list.pop();
    expect(nb.head().size).toBe(3);
  });

  test('proofs throw RangeError when asked about sizes the notebook never had', () => {
    const nb = notebookFrom(NOTES.slice(0, 5));
    expect(() => nb.proveInclusion(5)).toThrow(RangeError);
    expect(() => nb.proveInclusion(0, 6)).toThrow(RangeError);
    expect(() => nb.proveInclusion(-1)).toThrow(RangeError);
    expect(() => nb.proveConsistency(4, 3)).toThrow(RangeError);
    expect(() => nb.proveConsistency(1, 6)).toThrow(RangeError);
  });

  test('a notebook remembers its older heads exactly', () => {
    const nb = notebook.createNotebook();
    const heads: NotebookHead[] = [nb.head()];
    for (const n of NOTES.slice(0, 20)) {
      nb.append(n);
      heads.push(nb.head());
    }
    for (let s = 0; s <= 20; s++) expect(notebookFrom(NOTES.slice(0, s)).head()).toEqual(heads[s]);
  });
});

describe('inclusion proofs', () => {
  const full = notebookFrom(NOTES);
  const heads = Array.from({ length: 65 }, (_, s) => notebookFrom(NOTES.slice(0, s)).head());

  test('verify for every size 1..64 and every index', () => {
    for (let size = 1; size <= 64; size++) {
      for (let i = 0; i < size; i++) {
        const leaf = full.get(i)!.leaf;
        expect(notebook.verifyInclusion(heads[size]!, leaf, full.proveInclusion(i, size))).toBe(true);
      }
    }
  });

  test('fail for the wrong leaf, the wrong index, the wrong head or a bent path', () => {
    const size = 37;
    const head = heads[size]!;
    for (let i = 0; i < size; i++) {
      const proof = full.proveInclusion(i, size);
      const leaf = full.get(i)!.leaf;
      expect(notebook.verifyInclusion(head, full.get((i + 1) % size)!.leaf, proof)).toBe(false);
      expect(notebook.verifyInclusion(head, leaf, { ...proof, index: (i + 1) % size })).toBe(false);
      expect(notebook.verifyInclusion(heads[size + 1]!, leaf, proof)).toBe(false);
      expect(notebook.verifyInclusion({ ...head, size: size + 1 }, leaf, proof)).toBe(false);
      for (let p = 0; p < proof.path.length; p++) {
        const bent = [...proof.path];
        bent[p] = flipHex(bent[p]!);
        expect(notebook.verifyInclusion(head, leaf, { ...proof, path: bent })).toBe(false);
      }
      expect(notebook.verifyInclusion(head, leaf, { ...proof, path: [...proof.path, proof.path[0]!] })).toBe(false);
      expect(notebook.verifyInclusion(head, leaf, { ...proof, path: proof.path.slice(1) })).toBe(false);
    }
  });

  test('reject malformed input without throwing', () => {
    const head = heads[4]!;
    const proof = full.proveInclusion(1, 4);
    const leaf = full.get(1)!.leaf;
    expect(notebook.verifyInclusion(head, 'zz', proof)).toBe(false);
    expect(notebook.verifyInclusion(head, leaf, { ...proof, path: ['nothex'] })).toBe(false);
    expect(notebook.verifyInclusion(head, leaf, { ...proof, index: 4 })).toBe(false);
    expect(notebook.verifyInclusion(head, leaf, { ...proof, index: -1 })).toBe(false);
    expect(notebook.verifyInclusion(heads[0]!, leaf, { index: 0, size: 0, path: [] })).toBe(false);
  });
});

describe('consistency proofs', () => {
  const full = notebookFrom(NOTES);
  const heads = Array.from({ length: 65 }, (_, s) => notebookFrom(NOTES.slice(0, s)).head());

  test('verify for every pair of sizes 0 <= m <= n <= 64', () => {
    for (let n = 0; n <= 64; n++) {
      for (let m = 0; m <= n; m++) {
        expect(notebook.verifyConsistency(heads[m]!, heads[n]!, full.proveConsistency(m, n))).toBe(true);
      }
    }
  });

  test('fail when the heads are swapped, mislabelled or the path is bent', () => {
    for (const [m, n] of [
      [1, 2],
      [3, 7],
      [4, 8],
      [5, 64],
      [32, 33],
      [63, 64],
    ] as const) {
      const proof = full.proveConsistency(m, n);
      expect(notebook.verifyConsistency(heads[n]!, heads[m]!, proof)).toBe(false);
      expect(notebook.verifyConsistency(heads[m]!, heads[n]!, { ...proof, fromSize: m + 1 })).toBe(false);
      expect(notebook.verifyConsistency(heads[m]!, { ...heads[n]!, root: heads[n - 1]!.root }, proof)).toBe(false);
      for (let p = 0; p < proof.path.length; p++) {
        const bent = [...proof.path];
        bent[p] = flipHex(bent[p]!);
        expect(notebook.verifyConsistency(heads[m]!, heads[n]!, { ...proof, path: bent })).toBe(false);
      }
      expect(notebook.verifyConsistency(heads[m]!, heads[n]!, { ...proof, path: [...proof.path, proof.path[0]!] })).toBe(false);
    }
  });

  test('same size: only an empty proof and an identical root pass', () => {
    const h = heads[9]!;
    expect(notebook.verifyConsistency(h, h, { fromSize: 9, toSize: 9, path: [] })).toBe(true);
    expect(notebook.verifyConsistency(h, { ...h, root: heads[8]!.root }, { fromSize: 9, toSize: 9, path: [] })).toBe(false);
    expect(notebook.verifyConsistency(h, h, { fromSize: 9, toSize: 9, path: [h.root] })).toBe(false);
  });
});

// ---------------------------------------------------------------- rewriting history

describe('rewriting history is caught', () => {
  const PUBLISHED_AT = 24;
  const honest = notebookFrom(NOTES.slice(0, 40));
  const published = notebookFrom(NOTES.slice(0, PUBLISHED_AT)).head();

  /** What a forger does: rebuild the notebook from a changed list, then try to prove it extends the old head. */
  function forgeAndCheck(forged: VerifiedNote[]): { consistent: boolean; head: NotebookHead } {
    const nb = notebookFrom(forged);
    const head = nb.head();
    if (head.size < PUBLISHED_AT) return { consistent: false, head };
    const own = notebook.verifyConsistency(published, head, nb.proveConsistency(PUBLISHED_AT));
    // The forger can also replay the honest notebook's proof; that must not help.
    const borrowed =
      head.size <= honest.head().size &&
      notebook.verifyConsistency(published, head, honest.proveConsistency(PUBLISHED_AT, head.size));
    return { consistent: own || borrowed, head };
  }

  test('an honest notebook that only grew passes', () => {
    expect(notebook.verifyConsistency(published, honest.head(), honest.proveConsistency(PUBLISHED_AT))).toBe(true);
  });

  test('tampering with any byte of any earlier entry fails', () => {
    for (let i = 0; i < PUBLISHED_AT; i++) {
      for (const at of [0, 20, NOTES[i]!.bytes.length - 1]) {
        const forged = NOTES.slice(0, 40).map((n, j) => (j === i ? tamper(n, at) : n));
        expect(forgeAndCheck(forged).consistent, `entry ${i} byte ${at}`).toBe(false);
      }
    }
  });

  test('replacing an earlier entry with a different, validly signed note fails', () => {
    for (let i = 0; i < PUBLISHED_AT; i++) {
      const forged = NOTES.slice(0, 40).map((n, j) => (j === i ? textNote(directorate, 900 + j, 'all is well') : n));
      expect(forgeAndCheck(forged).consistent, `entry ${i}`).toBe(false);
    }
  });

  test('swapping any two earlier entries fails', () => {
    for (let i = 0; i < PUBLISHED_AT; i++) {
      for (let j = i + 1; j < 40; j++) {
        const forged = NOTES.slice(0, 40);
        [forged[i], forged[j]] = [forged[j]!, forged[i]!];
        expect(forgeAndCheck(forged).consistent, `swap ${i} ${j}`).toBe(false);
      }
    }
  });

  test('dropping any earlier entry fails, even if the forger pads the end back to the same size', () => {
    for (let i = 0; i < PUBLISHED_AT; i++) {
      const dropped = NOTES.slice(0, 40).filter((_, j) => j !== i);
      expect(forgeAndCheck(dropped).consistent, `drop ${i}`).toBe(false);
      expect(forgeAndCheck([...dropped, NOTES[40]!]).consistent, `drop ${i} and pad`).toBe(false);
    }
  });

  test('inserting a note anywhere before the published head fails', () => {
    const extra = textNote(directorate, 500, 'inserted');
    for (let i = 0; i < PUBLISHED_AT; i++) {
      const forged = [...NOTES.slice(0, i), extra, ...NOTES.slice(i, 40)];
      expect(forgeAndCheck(forged).consistent, `insert at ${i}`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------- audit and head digest

describe('auditNotebook', () => {
  const notes = NOTES.slice(0, 30);
  const head = notebookFrom(notes).head();
  const raw = notes.map((n) => n.bytes);

  test('passes for the honest bytes', () => {
    expect(notebook.auditNotebook(raw, head, keys)).toEqual({ ok: true, head });
  });

  test('reports the first entry whose bytes were changed', () => {
    for (const i of [0, 7, 29]) {
      const bad = raw.map((b, j) => (j === i || j === 29 ? tamper(notes[j]!, 30).bytes : b));
      expect(notebook.auditNotebook(bad, head, keys)).toEqual({ ok: false, firstBadIndex: i, reason: 'bad-signature' });
    }
  });

  test('reports garbage bytes as a bad signature at that index', () => {
    const bad = [...raw];
    bad[3] = new Uint8Array([1, 2, 3]);
    expect(notebook.auditNotebook(bad, head, keys)).toEqual({ ok: false, firstBadIndex: 3, reason: 'bad-signature' });
  });

  test('reports an author nobody knows', () => {
    const stranger = createIdentity({ name: 'Stranger', level: 2, secretKey: seededKey(99) });
    const bad = [...raw];
    bad[5] = textNote(stranger, 5).bytes;
    expect(notebook.auditNotebook(bad, head, keys)).toEqual({ ok: false, firstBadIndex: 5, reason: 'unknown-key' });
  });

  test('a reordered or forged-but-signed notebook fails on the root; a short one on the size', () => {
    const swapped = [...raw];
    [swapped[2], swapped[3]] = [swapped[3]!, swapped[2]!];
    expect(notebook.auditNotebook(swapped, head, keys)).toEqual({ ok: false, firstBadIndex: -1, reason: 'root-mismatch' });
    const replaced = [...raw];
    replaced[4] = textNote(directorate, 4).bytes;
    expect(notebook.auditNotebook(replaced, head, keys)).toEqual({ ok: false, firstBadIndex: -1, reason: 'root-mismatch' });
    expect(notebook.auditNotebook(raw.slice(0, 29), head, keys)).toEqual({ ok: false, firstBadIndex: -1, reason: 'size-mismatch' });
  });
});

describe('headDigest', () => {
  test('is SHA-256(uint32 BE size || root bytes), 32 bytes, and changes with either field', () => {
    const head = notebookFrom(NOTES.slice(0, 300 % 64)).head();
    const sizeBytes = new Uint8Array(4);
    new DataView(sizeBytes.buffer).setUint32(0, head.size);
    const d = headDigest(head);
    expect(d.length).toBe(32);
    expect(bytesToHex(d)).toBe(bytesToHex(sha256(concatBytes(sizeBytes, hexToBytes(head.root)))));
    expect(bytesToHex(headDigest({ ...head, size: head.size + 1 }))).not.toBe(bytesToHex(d));
    expect(bytesToHex(headDigest({ size: 0x01020304, root: EMPTY_ROOT }))).toBe(
      bytesToHex(sha256(concatBytes(Uint8Array.of(1, 2, 3, 4), hexToBytes(EMPTY_ROOT)))),
    );
  });

  test('fits in a notebook-head commit note', () => {
    const head = notebookFrom(NOTES.slice(0, 10)).head();
    const note = signNote({ seq: 1, time: 5, body: { kind: 'commit', topic: 'notebook-head', value: headDigest(head) } }, alice);
    expect(note.body.kind === 'commit' && bytesToHex(note.body.value)).toBe(bytesToHex(headDigest(head)));
  });
});

// ---------------------------------------------------------------- helpers

function flipHex(h: string): string {
  return (h[0] === '0' ? '1' : '0') + h.slice(1);
}

function tamper(n: VerifiedNote, at: number): VerifiedNote {
  const bytes = n.bytes.slice();
  bytes[at] = bytes[at]! ^ 0x01;
  return { ...n, bytes } as VerifiedNote;
}
