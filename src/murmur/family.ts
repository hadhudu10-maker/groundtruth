// Family notes (problem 8): a status locked to a family key, carried by anyone, newest wins.
//
// Sealing uses the browser's built-in Web Crypto, AES-GCM with the 32-byte family key:
//   sealed = nonce (12 random bytes) || ciphertext || GCM tag (16 bytes)      at most 55 bytes
//   plaintext = condition (1 byte) || level (1 byte) || message (UTF-8, 0..25 bytes, cut to fit)
//   additional data = "groundtruth/family/v2" || family tag (4 bytes) || author key ID (8 bytes)
//                     || seq (uint32 big endian) || time (uint32 big endian)
// The author key ID in the additional data stops anyone from copying a relative's sealed bytes into a
// note signed with their own key. The seq and time stop anyone from re-wrapping an OLD sealed status in
// a header with a newer time: a reader who has not paired with the author cannot check the signature,
// and "newest wins" would otherwise show the old status as current (security review, 2026-11-20).
// The family key is shared only in person, by QR (never by sound).
import { FAMILY_MAX_SEALED_BYTES, familyTagOf, signNote } from '../world';
import type { FamilyCondition, FamilyKey, FamilyStatus, FamilyTagHex, KeyIdHex, ResidentCard, VerifiedNote } from '../world';
import { decodeNote } from '../world';
import type { Device, KeyValueStore } from './device';
import { defaultStore } from './device';
import { bytesToHex, hexToBytes } from './hex';
import type { NoteStore } from './store';

export const FAMILY_CONDITIONS: readonly FamilyCondition[] = ['safe', 'help', 'hurt', 'moving'];
export const FAMILY_NONCE_BYTES = 12;
export const FAMILY_GCM_TAG_BYTES = 16;
export const FAMILY_PLAIN_MAX_BYTES = FAMILY_MAX_SEALED_BYTES - FAMILY_NONCE_BYTES - FAMILY_GCM_TAG_BYTES; // 27
export const FAMILY_MESSAGE_MAX_BYTES = FAMILY_PLAIN_MAX_BYTES - 2; // 25
export const FAMILY_NAME_MAX_BYTES = 24;
export const FAMILIES_KEY = 'gt.device.families.v1';

const AAD_DOMAIN = new TextEncoder().encode('groundtruth/family/v2');
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export interface FamilyMessage extends FamilyStatus {
  message: string;
}

/** The signed header fields of the note that carries the sealed bytes. They are bound into the seal. */
export interface FamilyStamp {
  seq: number;
  time: number;
}

/** Copy into a fresh ArrayBuffer-backed view, which is what Web Crypto's types ask for. */
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

/** Longest prefix of `s` whose UTF-8 fits in `max` bytes, never splitting a character. */
export function cutUtf8(s: string, max: number): string {
  let out = '';
  let used = 0;
  for (const ch of s) {
    const n = enc.encode(ch).length;
    if (used + n > max) break;
    out += ch;
    used += n;
  }
  return out;
}

export function encodeFamilyPlain(m: FamilyMessage): Uint8Array {
  const code = FAMILY_CONDITIONS.indexOf(m.condition);
  if (code < 0) throw new Error(`unknown condition ${m.condition}`);
  if (!Number.isInteger(m.level) || m.level < 0 || m.level > 255) throw new Error('level must be 0..255');
  const msg = enc.encode(cutUtf8(m.message ?? '', FAMILY_MESSAGE_MAX_BYTES));
  const out = new Uint8Array(2 + msg.length);
  out[0] = code;
  out[1] = m.level;
  out.set(msg, 2);
  return out;
}

export function decodeFamilyPlain(b: Uint8Array): FamilyMessage | null {
  if (b.length < 2 || b.length > FAMILY_PLAIN_MAX_BYTES) return null;
  const condition = FAMILY_CONDITIONS[b[0]!];
  if (!condition) return null;
  try {
    return { condition, level: b[1]!, message: dec.decode(b.subarray(2)) };
  } catch {
    return null;
  }
}

function aad(tag: FamilyTagHex, author: KeyIdHex, stamp: FamilyStamp): Uint8Array<ArrayBuffer> {
  const t = hexToBytes(tag);
  const a = hexToBytes(author);
  const out = new Uint8Array(AAD_DOMAIN.length + t.length + a.length + 8);
  out.set(AAD_DOMAIN, 0);
  out.set(t, AAD_DOMAIN.length);
  out.set(a, AAD_DOMAIN.length + t.length);
  const view = new DataView(out.buffer, AAD_DOMAIN.length + t.length + a.length, 8);
  view.setUint32(0, stamp.seq >>> 0);
  view.setUint32(4, stamp.time >>> 0);
  return out;
}

const importKey = (key: Uint8Array, use: KeyUsage) =>
  crypto.subtle.importKey('raw', buf(key), 'AES-GCM', false, [use]);

/** A new family with a random 32-byte key. */
export function makeFamily(name: string): FamilyKey {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return { key, tag: familyTagOf(key), name: cutUtf8(name, FAMILY_NAME_MAX_BYTES) };
}

export async function sealFamily(family: FamilyKey, author: KeyIdHex, m: FamilyMessage, stamp: FamilyStamp): Promise<Uint8Array> {
  const nonce = crypto.getRandomValues(new Uint8Array(FAMILY_NONCE_BYTES));
  const k = await importKey(family.key, 'encrypt');
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(family.tag, author, stamp) }, k, buf(encodeFamilyPlain(m))),
  );
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return out;
}

/** Null if the key is wrong, the bytes were changed, or the author, seq or time do not match. */
export async function openFamily(
  family: FamilyKey,
  author: KeyIdHex,
  sealed: Uint8Array,
  stamp: FamilyStamp,
  key?: CryptoKey,
): Promise<FamilyMessage | null> {
  if (sealed.length < FAMILY_NONCE_BYTES + FAMILY_GCM_TAG_BYTES + 2) return null;
  try {
    const k = key ?? (await importKey(family.key, 'decrypt'));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(sealed.subarray(0, FAMILY_NONCE_BYTES)), additionalData: aad(family.tag, author, stamp) },
      k,
      buf(sealed.subarray(FAMILY_NONCE_BYTES)),
    );
    return decodeFamilyPlain(new Uint8Array(plain));
  } catch {
    return null;
  }
}

/** Seal and sign a family note. Hand the result to `store.receive` like any note you write. */
export async function writeFamilyNote(device: Device, family: FamilyKey, m: FamilyMessage, time: number): Promise<VerifiedNote> {
  const seq = device.nextSeq();
  const sealed = await sealFamily(family, device.identity.keyId, m, { seq, time });
  return signNote({ seq, time, body: { kind: 'family', familyTag: family.tag, sealed } }, device.identity);
}

export interface RelativeStatus extends FamilyMessage {
  author: KeyIdHex;
  time: number;
  seq: number;
  noteId: string;
  /** False when the author is not paired, so only the family key (not the signature) vouches for it. */
  verified: boolean;
}

/** Every relative's newest status (by note time) that this store holds, newest first. */
export async function readFamily(family: FamilyKey, store: Pick<NoteStore, 'all' | 'parked'>): Promise<RelativeStatus[]> {
  const candidates: { id: string; author: KeyIdHex; seq: number; time: number; sealed: Uint8Array; verified: boolean }[] = [];
  for (const n of store.all()) {
    if (n.body.kind === 'family' && n.body.familyTag === family.tag) {
      candidates.push({ id: n.id, author: n.author, seq: n.seq, time: n.time, sealed: n.body.sealed, verified: true });
    }
  }
  for (const p of store.parked()) {
    try {
      const n = decodeNote(p.bytes);
      if (n.body.kind === 'family' && n.body.familyTag === family.tag) {
        candidates.push({ id: n.id, author: n.author, seq: n.seq, time: n.time, sealed: n.body.sealed, verified: false });
      }
    } catch {
      /* not readable */
    }
  }
  candidates.sort((a, b) => b.time - a.time || b.seq - a.seq);
  const key = await importKey(family.key, 'decrypt');
  const best = new Map<KeyIdHex, RelativeStatus>();
  for (const c of candidates) {
    if (best.has(c.author)) continue; // a newer note from this relative already opened
    const m = await openFamily(family, c.author, c.sealed, { seq: c.seq, time: c.time }, key);
    if (m) best.set(c.author, { ...m, author: c.author, time: c.time, seq: c.seq, noteId: c.id, verified: c.verified });
  }
  return [...best.values()].sort((a, b) => b.time - a.time);
}

// ---------------------------------------------------------------- family code (QR, in person only)

export const FAMILY_CODE_PREFIX = 'GTF1:';
export class FamilyCodeError extends Error {
  override name = 'FamilyCodeError';
}

/** "GTF1:" + uppercase hex of [key 32][name length u8][family name][level u8][public key 32][your name]. */
export function encodeFamilyCode(family: FamilyKey, card: ResidentCard): string {
  const fname = enc.encode(cutUtf8(family.name, FAMILY_NAME_MAX_BYTES));
  const pname = enc.encode(cutUtf8(card.name, 32));
  const out = new Uint8Array(32 + 1 + fname.length + 1 + 32 + pname.length);
  let i = 0;
  out.set(family.key, i), (i += 32);
  out[i++] = fname.length;
  out.set(fname, i), (i += fname.length);
  out[i++] = card.level;
  out.set(card.publicKey, i), (i += 32);
  out.set(pname, i);
  return FAMILY_CODE_PREFIX + bytesToHex(out).toUpperCase();
}

export function decodeFamilyCode(text: string): { family: FamilyKey; card: ResidentCard } {
  const t = text.trim();
  if (!t.toUpperCase().startsWith(FAMILY_CODE_PREFIX)) throw new FamilyCodeError('not a family code');
  let b: Uint8Array;
  try {
    b = hexToBytes(t.slice(FAMILY_CODE_PREFIX.length));
  } catch {
    throw new FamilyCodeError('family code is not valid hex');
  }
  if (b.length < 32 + 1 + 1 + 32 + 1) throw new FamilyCodeError('family code is too short');
  const key = b.slice(0, 32);
  const fl = b[32]!;
  if (fl > FAMILY_NAME_MAX_BYTES || b.length < 33 + fl + 1 + 32 + 1) throw new FamilyCodeError('family code is damaged');
  try {
    const name = dec.decode(b.subarray(33, 33 + fl));
    const level = b[33 + fl]!;
    const publicKey = b.slice(34 + fl, 66 + fl);
    const pname = dec.decode(b.subarray(66 + fl));
    if (pname.length < 1 || enc.encode(pname).length > 32) throw new FamilyCodeError('bad name');
    return { family: { key, tag: familyTagOf(key), name }, card: { publicKey, name: pname, level } };
  } catch (e) {
    throw e instanceof FamilyCodeError ? e : new FamilyCodeError('family code is damaged');
  }
}

// ---------------------------------------------------------------- family book (stored next to the identity)

export interface FamilyRecord extends FamilyKey {
  members: KeyIdHex[];
}

export interface FamilyBook {
  families(): FamilyRecord[];
  get(tag: FamilyTagHex): FamilyRecord | undefined;
  /** Join or make a family. Joining one already held keeps the existing record. */
  add(family: FamilyKey): FamilyRecord;
  addMember(tag: FamilyTagHex, keyId: KeyIdHex): void;
}

export function createFamilyBook(kv: KeyValueStore | null = defaultStore()): FamilyBook {
  const map = new Map<FamilyTagHex, FamilyRecord>();
  try {
    const raw = kv?.getItem(FAMILIES_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      for (const r of list as { key: string; name: string; members: string[] }[]) {
        try {
          const key = hexToBytes(r.key);
          if (key.length !== 32) continue;
          const tag = familyTagOf(key);
          map.set(tag, { key, tag, name: String(r.name), members: Array.isArray(r.members) ? r.members.map(String) : [] });
        } catch {
          /* skip a damaged entry */
        }
      }
    }
  } catch {
    /* damaged storage: start empty */
  }
  const save = () => {
    try {
      kv?.setItem(
        FAMILIES_KEY,
        JSON.stringify([...map.values()].map((f) => ({ key: bytesToHex(f.key), name: f.name, members: f.members }))),
      );
    } catch {
      /* storage full or blocked */
    }
  };
  return {
    families: () => [...map.values()],
    get: (tag) => map.get(tag),
    add(family) {
      const tag = familyTagOf(family.key);
      let rec = map.get(tag);
      if (!rec) {
        rec = { key: family.key.slice(), tag, name: family.name, members: [] };
        map.set(tag, rec);
        save();
      }
      return rec;
    },
    addMember(tag, keyId) {
      const rec = map.get(tag);
      if (!rec || rec.members.includes(keyId)) return;
      rec.members.push(keyId);
      save();
    },
  };
}
