// The Merkle tree under the notebook, exactly as RFC 6962 section 2.1 defines it, with the
// verification steps of RFC 9162 sections 2.1.3.2 and 2.1.4.2.
//
//   leaf hash  = SHA-256(0x00 || entry bytes)
//   node hash  = SHA-256(0x01 || left || right)
//   MTH({})    = SHA-256 of zero bytes
//   MTH(D[n])  = node(MTH(D[0:k]), MTH(D[k:n])) with k the largest power of two below n
//
// The tree is append-only. Every complete, aligned subtree of 2^h leaves is hashed once and
// cached, so a root, an inclusion path or a consistency path for any past size costs O(log n).
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from '@noble/hashes/utils.js';
import { NOTEBOOK_LEAF_PREFIX, NOTEBOOK_NODE_PREFIX } from '../world';

const LEAF = Uint8Array.of(NOTEBOOK_LEAF_PREFIX);
const NODE = Uint8Array.of(NOTEBOOK_NODE_PREFIX);

export const emptyRoot = (): Uint8Array => sha256(new Uint8Array(0));
export const hashLeaf = (bytes: Uint8Array): Uint8Array => sha256(concatBytes(LEAF, bytes));
export const hashNode = (left: Uint8Array, right: Uint8Array): Uint8Array => sha256(concatBytes(NODE, left, right));

/** Largest power of two strictly below n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

const isPow2 = (n: number) => n > 0 && (n & (n - 1)) === 0;

export class MerkleTree {
  /** layers[h][i] = hash of the complete subtree of 2^h leaves starting at leaf i * 2^h. */
  private readonly layers: Uint8Array[][] = [[]];

  get size(): number {
    return this.layers[0]!.length;
  }

  /** Add a leaf hash (already prefixed with 0x00 and hashed). */
  push(leaf: Uint8Array): void {
    this.layers[0]!.push(leaf);
    // Close every subtree this leaf completes.
    let h = 0;
    while (this.layers[h]!.length % 2 === 0) {
      const layer = this.layers[h]!;
      const parent = hashNode(layer[layer.length - 2]!, layer[layer.length - 1]!);
      if (!this.layers[h + 1]) this.layers.push([]);
      this.layers[h + 1]!.push(parent);
      h++;
    }
  }

  leaf(index: number): Uint8Array | undefined {
    return this.layers[0]![index];
  }

  /** MTH(D[start : start + n]). In RFC recursion `start` is always a multiple of the left split. */
  private mth(start: number, n: number): Uint8Array {
    if (n === 0) return emptyRoot();
    if (isPow2(n) && start % n === 0) {
      const h = Math.log2(n);
      const cached = this.layers[h]?.[start / n];
      if (cached) return cached;
    }
    const k = split(n);
    return hashNode(this.mth(start, k), this.mth(start + k, n - k));
  }

  /** Root of the tree as it was when it held `size` leaves. */
  root(size = this.size): Uint8Array {
    this.checkSize(size);
    return this.mth(0, size);
  }

  /** PATH(m, D[size]) from RFC 6962 2.1.1, leaf to root order. */
  inclusionPath(index: number, size = this.size): Uint8Array[] {
    this.checkSize(size);
    if (!Number.isInteger(index) || index < 0 || index >= size) {
      throw new RangeError(`index ${index} is outside a notebook of ${size} entries`);
    }
    const out: Uint8Array[] = [];
    const walk = (m: number, start: number, n: number) => {
      if (n <= 1) return;
      const k = split(n);
      if (m < k) {
        walk(m, start, k);
        out.push(this.mth(start + k, n - k));
      } else {
        walk(m - k, start + k, n - k);
        out.push(this.mth(start, k));
      }
    };
    walk(index, 0, size);
    return out;
  }

  /** PROOF(m, D[n]) from RFC 6962 2.1.2. Empty when m is 0 or m equals n. */
  consistencyPath(fromSize: number, toSize = this.size): Uint8Array[] {
    this.checkSize(toSize);
    if (!Number.isInteger(fromSize) || fromSize < 0 || fromSize > toSize) {
      throw new RangeError(`cannot prove ${fromSize} entries against ${toSize}`);
    }
    if (fromSize === 0) return [];
    const out: Uint8Array[] = [];
    const sub = (m: number, start: number, n: number, complete: boolean) => {
      if (m === n) {
        if (!complete) out.push(this.mth(start, n));
        return;
      }
      const k = split(n);
      if (m <= k) {
        sub(m, start, k, complete);
        out.push(this.mth(start + k, n - k));
      } else {
        sub(m - k, start + k, n - k, false);
        out.push(this.mth(start, k));
      }
    };
    sub(fromSize, 0, toSize, true);
    return out;
  }

  private checkSize(size: number) {
    if (!Number.isInteger(size) || size < 0 || size > this.size) {
      throw new RangeError(`the notebook has never had ${size} entries (it has ${this.size})`);
    }
  }
}

const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** RFC 9162 2.1.3.2. True if `leaf` sits at `index` in the tree of `size` leaves with this `root`. */
export function verifyInclusionPath(leaf: Uint8Array, index: number, size: number, path: Uint8Array[], root: Uint8Array): boolean {
  if (!Number.isInteger(index) || !Number.isInteger(size) || index < 0 || index >= size) return false;
  let fn = index;
  let sn = size - 1;
  let r = leaf;
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = hashNode(p, r);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      r = hashNode(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && equal(r, root);
}

/** RFC 9162 2.1.4.2. True if the tree (toSize, toRoot) extends (fromSize, fromRoot) unchanged. */
export function verifyConsistencyPath(
  fromSize: number,
  toSize: number,
  fromRoot: Uint8Array,
  toRoot: Uint8Array,
  path: Uint8Array[],
): boolean {
  if (!Number.isInteger(fromSize) || !Number.isInteger(toSize) || fromSize < 0 || fromSize > toSize) return false;
  if (fromSize === toSize) return path.length === 0 && equal(fromRoot, toRoot);
  if (fromSize === 0) return path.length === 0 && equal(fromRoot, emptyRoot());
  if (path.length === 0) return false;
  const proof = isPow2(fromSize) ? [fromRoot, ...path] : path;
  let fn = fromSize - 1;
  let sn = toSize - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  let fr = proof[0]!;
  let sr = proof[0]!;
  for (const c of proof.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = hashNode(c, fr);
      sr = hashNode(c, sr);
      if (fn % 2 === 0) {
        while (fn % 2 === 0 && fn !== 0) {
          fn = Math.floor(fn / 2);
          sn = Math.floor(sn / 2);
        }
      }
    } else {
      sr = hashNode(sr, c);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && equal(fr, fromRoot) && equal(sr, toRoot);
}
