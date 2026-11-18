// The signed note: the one format every module reads and writes. FROZEN after Tue 2026-11-17.
//
// Wire layout (big endian), at most 140 bytes so one note fits one ggwave sound message:
//
//   offset  size  field
//   0       1     version (high 4 bits) | kind code (low 4 bits)
//   1       8     author key ID (see keyIdOf)
//   9       4     seq, the author's own counter (uint32)
//   13      4     time, seconds (uint32). Real devices use Unix time; the simulation uses its clock.
//   17      n     payload, 0..59 bytes, layout depends on kind
//   17+n    64    Ed25519 signature over NOTE_SIGN_DOMAIN || bytes[0 .. 17+n)
//
// The note ID is SHA-256 of bytes[0 .. 17+n), the signed part. Verification is strict RFC 8032.
import { CASE_TAG_BYTES, FAMILY_TAG_BYTES, KEY_ID_BYTES, keyIdOf } from './identity';
import { bytesToHex, concatBytes, ed, hexToBytes, sha256, utf8ToBytes } from './crypto';
import type {
  CaseTagHex,
  FamilyTagHex,
  Identity,
  KeyIdHex,
  KeyLookup,
  LevelId,
  NoteId,
  NoteRefHex,
  PipeNodeId,
} from './types';

// ---------------------------------------------------------------- budget

export const NOTE_VERSION = 1;
export const NOTE_MAX_BYTES = 140;
export const NOTE_HEADER_BYTES = 1 + KEY_ID_BYTES + 4 + 4; // 17
export const NOTE_SIGNATURE_BYTES = 64;
export const NOTE_MAX_PAYLOAD_BYTES = NOTE_MAX_BYTES - NOTE_HEADER_BYTES - NOTE_SIGNATURE_BYTES; // 59
export const NOTE_REF_BYTES = 16;
export const NOTE_SIGN_DOMAIN = utf8ToBytes('groundtruth/note/v1');

// ---------------------------------------------------------------- kinds

/** Kind names in code order. The wire code is index + 1; 0 and 9..15 are reserved. */
export const NOTE_KINDS = ['text', 'power', 'family', 'water', 'sick', 'surface', 'witness', 'commit'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const POWER_EVENTS = ['ok', 'flicker', 'out', 'restored'] as const;
export type PowerEvent = (typeof POWER_EVENTS)[number];

export const WATER_RESULTS = ['ok', 'bad', 'unsure'] as const;
export type WaterResult = (typeof WATER_RESULTS)[number];

export const SICK_SOURCES = ['self', 'clinic'] as const;
export type SickSource = (typeof SICK_SOURCES)[number];

/** Units: o2 percent, co2 ppm, pm25 ug/m3, radiation uSv/h, temperature C, toxin index. */
export const SURFACE_METRICS = ['o2', 'co2', 'pm25', 'radiation', 'temperature', 'toxin'] as const;
export type SurfaceMetric = (typeof SURFACE_METRICS)[number];

/** For every topic `value` is a SHA-256 digest, except lottery-reveal where it is the seed itself. */
export const COMMIT_TOPICS = ['surface-rules', 'lottery-seed', 'lottery-reveal', 'fair-split', 'notebook-head'] as const;
export type CommitTopic = (typeof COMMIT_TOPICS)[number];

/** Problem 7. Any short message, 1..59 bytes of UTF-8. */
export interface TextBody {
  kind: 'text';
  text: string;
}
/** Problems 1 and 2. Written by a plugged-in device. 'ok' is the heartbeat the silence alarm watches. 5 bytes. */
export interface PowerBody {
  kind: 'power';
  level: LevelId;
  zone: number; // 0..255
  event: PowerEvent;
  durationS: number; // 0..65535, how long the power was gone (flicker), else 0
}
/** Problem 8. `sealed` is opaque here; murmur owns how it is locked to the family key. 5..59 bytes. */
export interface FamilyBody {
  kind: 'family';
  familyTag: FamilyTagHex;
  sealed: Uint8Array; // 1..55 bytes
}
/** Problem 4. A tap test at one node of the pipe map. 4 bytes. */
export interface WaterBody {
  kind: 'water';
  level: LevelId;
  tap: PipeNodeId; // 0..65535
  result: WaterResult;
}
/** Problem 9. A self report carries one case tag; a clinic tally carries up to 14. 6..58 bytes. */
export interface SickBody {
  kind: 'sick';
  level: LevelId;
  source: SickSource;
  caseTags: CaseTagHex[];
}
export interface SurfaceReading {
  metric: SurfaceMetric;
  value: number; // stored as a signed 32-bit integer of thousandths
}
/** Problem 13. A probe reading, 1..11 metrics. 7..57 bytes. */
export interface SurfaceBody {
  kind: 'surface';
  probe: number; // 0..65535
  readings: SurfaceReading[];
}
/** Problem 13. "I witnessed note X." Points at another note by its NoteRef. 16 bytes. */
export interface WitnessBody {
  kind: 'witness';
  ref: NoteRefHex;
}
/** Problems 13, 14, 2 and the notebook: publish a commitment before the outcome is known. 33 bytes. */
export interface CommitBody {
  kind: 'commit';
  topic: CommitTopic;
  value: Uint8Array; // 32 bytes
}

export type NoteBody =
  | TextBody
  | PowerBody
  | FamilyBody
  | WaterBody
  | SickBody
  | SurfaceBody
  | WitnessBody
  | CommitBody;

export type BodyOfKind<K extends NoteKind> = Extract<NoteBody, { kind: K }>;

export const SICK_MAX_TAGS = 14;
export const SURFACE_MAX_READINGS = 11;
export const FAMILY_MAX_SEALED_BYTES = NOTE_MAX_PAYLOAD_BYTES - FAMILY_TAG_BYTES; // 55

// ---------------------------------------------------------------- note types

/** A decoded note. Not yet trusted: its signature may not have been checked. */
export interface SignedNote<B extends NoteBody = NoteBody> {
  version: number;
  author: KeyIdHex;
  seq: number;
  time: number;
  body: B;
  id: NoteId;
  signature: Uint8Array;
  /** The exact wire bytes, signature included. This is what gets sent and stored. */
  bytes: Uint8Array;
}

declare const verifiedBrand: unique symbol;
/** A note whose signature was checked, or that we signed ourselves. Only these go in the notebook. */
export type VerifiedNote<B extends NoteBody = NoteBody> = SignedNote<B> & { readonly [verifiedBrand]: true };

export interface NoteDraft<B extends NoteBody = NoteBody> {
  seq: number;
  time: number;
  body: B;
}

export class NoteFormatError extends Error {
  override name = 'NoteFormatError';
}

// ---------------------------------------------------------------- byte helpers

const U32_MAX = 0xffffffff;

function int(n: number, min: number, max: number, what: string): number {
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new NoteFormatError(`${what} must be an integer in ${min}..${max}, got ${n}`);
  }
  return n;
}

function hex(h: string, bytes: number, what: string): Uint8Array {
  if (typeof h !== 'string' || h.length !== bytes * 2 || !/^[0-9a-f]+$/.test(h)) {
    throw new NoteFormatError(`${what} must be ${bytes * 2} lowercase hex chars`);
  }
  return hexToBytes(h);
}

function code<T extends string>(list: readonly T[], v: T, what: string): number {
  const i = list.indexOf(v);
  if (i < 0) throw new NoteFormatError(`unknown ${what}: ${String(v)}`);
  return i;
}

function pick<T extends string>(list: readonly T[], i: number, what: string): T {
  const v = list[i];
  if (v === undefined) throw new NoteFormatError(`unknown ${what} code ${i}`);
  return v;
}

class Writer {
  private out: number[] = [];
  u8(n: number, what: string) {
    this.out.push(int(n, 0, 0xff, what));
  }
  u16(n: number, what: string) {
    int(n, 0, 0xffff, what);
    this.out.push(n >>> 8, n & 0xff);
  }
  u32(n: number, what: string) {
    int(n, 0, U32_MAX, what);
    this.out.push(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
  }
  i32(n: number, what: string) {
    int(n, -0x80000000, 0x7fffffff, what);
    this.u32(n >>> 0, what);
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.out.push(x);
  }
  done(): Uint8Array {
    return Uint8Array.from(this.out);
  }
}

class Reader {
  private pos = 0;
  private readonly buf: Uint8Array;
  private readonly view: DataView;
  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  get left() {
    return this.buf.length - this.pos;
  }
  private need(n: number) {
    if (this.left < n) throw new NoteFormatError('note is truncated');
  }
  u8() {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16() {
    this.need(2);
    const v = this.view.getUint16(this.pos);
    this.pos += 2;
    return v;
  }
  u32() {
    this.need(4);
    const v = this.view.getUint32(this.pos);
    this.pos += 4;
    return v;
  }
  i32() {
    this.need(4);
    const v = this.view.getInt32(this.pos);
    this.pos += 4;
    return v;
  }
  bytes(n: number) {
    this.need(n);
    const v = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }
  end() {
    if (this.left !== 0) throw new NoteFormatError(`${this.left} unexpected trailing bytes`);
  }
}

// ---------------------------------------------------------------- payload codec

/** Encode just the payload. Useful for a compose box that shows bytes left. Throws NoteFormatError. */
export function encodePayload(body: NoteBody): Uint8Array {
  const w = new Writer();
  switch (body.kind) {
    case 'text': {
      const t = utf8ToBytes(body.text);
      if (t.length < 1) throw new NoteFormatError('text is empty');
      w.bytes(t);
      break;
    }
    case 'power':
      w.u8(body.level, 'level');
      w.u8(body.zone, 'zone');
      w.u8(code(POWER_EVENTS, body.event, 'power event'), 'power event');
      w.u16(body.durationS, 'durationS');
      break;
    case 'family':
      if (body.sealed.length < 1 || body.sealed.length > FAMILY_MAX_SEALED_BYTES) {
        throw new NoteFormatError(`sealed must be 1..${FAMILY_MAX_SEALED_BYTES} bytes`);
      }
      w.bytes(hex(body.familyTag, FAMILY_TAG_BYTES, 'familyTag'));
      w.bytes(body.sealed);
      break;
    case 'water':
      w.u8(body.level, 'level');
      w.u16(body.tap, 'tap');
      w.u8(code(WATER_RESULTS, body.result, 'water result'), 'water result');
      break;
    case 'sick':
      if (body.caseTags.length < 1 || body.caseTags.length > SICK_MAX_TAGS) {
        throw new NoteFormatError(`caseTags must hold 1..${SICK_MAX_TAGS} tags`);
      }
      w.u8(body.level, 'level');
      w.u8(code(SICK_SOURCES, body.source, 'sick source'), 'sick source');
      for (const t of body.caseTags) w.bytes(hex(t, CASE_TAG_BYTES, 'caseTag'));
      break;
    case 'surface':
      if (body.readings.length < 1 || body.readings.length > SURFACE_MAX_READINGS) {
        throw new NoteFormatError(`readings must hold 1..${SURFACE_MAX_READINGS} entries`);
      }
      w.u16(body.probe, 'probe');
      for (const r of body.readings) {
        w.u8(code(SURFACE_METRICS, r.metric, 'surface metric'), 'surface metric');
        if (!Number.isFinite(r.value)) throw new NoteFormatError('reading value must be finite');
        w.i32(Math.round(r.value * 1000), 'reading value (thousandths)');
      }
      break;
    case 'witness':
      w.bytes(hex(body.ref, NOTE_REF_BYTES, 'ref'));
      break;
    case 'commit':
      if (body.value.length !== 32) throw new NoteFormatError('commit value must be 32 bytes');
      w.u8(code(COMMIT_TOPICS, body.topic, 'commit topic'), 'commit topic');
      w.bytes(body.value);
      break;
    default:
      throw new NoteFormatError(`unknown kind ${(body as { kind: unknown }).kind}`);
  }
  const out = w.done();
  if (out.length > NOTE_MAX_PAYLOAD_BYTES) {
    throw new NoteFormatError(`payload is ${out.length} bytes, max ${NOTE_MAX_PAYLOAD_BYTES}`);
  }
  return out;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodePayload(kind: NoteKind, payload: Uint8Array): NoteBody {
  const r = new Reader(payload);
  let body: NoteBody;
  switch (kind) {
    case 'text':
      if (payload.length < 1) throw new NoteFormatError('text is empty');
      try {
        body = { kind, text: utf8.decode(payload) };
      } catch {
        throw new NoteFormatError('text is not valid UTF-8');
      }
      return body;
    case 'power':
      body = {
        kind,
        level: r.u8(),
        zone: r.u8(),
        event: pick(POWER_EVENTS, r.u8(), 'power event'),
        durationS: r.u16(),
      };
      break;
    case 'family': {
      const familyTag = bytesToHex(r.bytes(FAMILY_TAG_BYTES));
      if (r.left < 1) throw new NoteFormatError('sealed is empty');
      body = { kind, familyTag, sealed: r.bytes(r.left) };
      break;
    }
    case 'water':
      body = { kind, level: r.u8(), tap: r.u16(), result: pick(WATER_RESULTS, r.u8(), 'water result') };
      break;
    case 'sick': {
      const level = r.u8();
      const source = pick(SICK_SOURCES, r.u8(), 'sick source');
      if (r.left < CASE_TAG_BYTES || r.left % CASE_TAG_BYTES !== 0) throw new NoteFormatError('bad caseTags length');
      const caseTags: CaseTagHex[] = [];
      while (r.left > 0) caseTags.push(bytesToHex(r.bytes(CASE_TAG_BYTES)));
      body = { kind, level, source, caseTags };
      break;
    }
    case 'surface': {
      const probe = r.u16();
      if (r.left < 5 || r.left % 5 !== 0) throw new NoteFormatError('bad readings length');
      const readings: SurfaceReading[] = [];
      while (r.left > 0) {
        const metric = pick(SURFACE_METRICS, r.u8(), 'surface metric');
        readings.push({ metric, value: r.i32() / 1000 });
      }
      body = { kind, probe, readings };
      break;
    }
    case 'witness':
      body = { kind, ref: bytesToHex(r.bytes(NOTE_REF_BYTES)) };
      break;
    case 'commit':
      body = { kind, topic: pick(COMMIT_TOPICS, r.u8(), 'commit topic'), value: r.bytes(32) };
      break;
  }
  r.end();
  return body;
}

// ---------------------------------------------------------------- sign, decode, verify

function signedMessage(signedPart: Uint8Array): Uint8Array {
  return concatBytes(NOTE_SIGN_DOMAIN, signedPart);
}

/** Total wire size of a note with this body. Always <= NOTE_MAX_BYTES or encodePayload throws. */
export function noteSize(body: NoteBody): number {
  return NOTE_HEADER_BYTES + encodePayload(body).length + NOTE_SIGNATURE_BYTES;
}

/** First 16 bytes of a note ID, the form notes use to point at each other. */
export function noteRef(id: NoteId): NoteRefHex {
  return id.slice(0, NOTE_REF_BYTES * 2);
}

/** Build and sign a note. The caller owns `seq`: it must go up by at least 1 for every note. */
export function signNote<B extends NoteBody>(draft: NoteDraft<B>, identity: Identity): VerifiedNote<B> {
  const w = new Writer();
  w.u8((NOTE_VERSION << 4) | (code(NOTE_KINDS, draft.body.kind, 'kind') + 1), 'kind');
  w.bytes(hex(identity.keyId, KEY_ID_BYTES, 'keyId'));
  w.u32(draft.seq, 'seq');
  w.u32(draft.time, 'time');
  const signedPart = concatBytes(w.done(), encodePayload(draft.body));
  const signature = ed.sign(signedMessage(signedPart), identity.secretKey);
  const bytes = concatBytes(signedPart, signature);
  if (bytes.length > NOTE_MAX_BYTES) throw new NoteFormatError(`note is ${bytes.length} bytes`);
  // Re-decode so the returned body is exactly what a receiver will see (for example rounded readings).
  return decodeNote(bytes) as VerifiedNote<B>;
}

/** Parse wire bytes. Does NOT check the signature. Throws NoteFormatError. */
export function decodeNote(bytes: Uint8Array): SignedNote {
  if (bytes.length > NOTE_MAX_BYTES) throw new NoteFormatError(`note is ${bytes.length} bytes, max ${NOTE_MAX_BYTES}`);
  if (bytes.length < NOTE_HEADER_BYTES + NOTE_SIGNATURE_BYTES) throw new NoteFormatError('note is truncated');
  const signedPart = bytes.slice(0, bytes.length - NOTE_SIGNATURE_BYTES);
  const signature = bytes.slice(bytes.length - NOTE_SIGNATURE_BYTES);
  const r = new Reader(signedPart);
  const head = r.u8();
  const version = head >> 4;
  if (version !== NOTE_VERSION) throw new NoteFormatError(`unsupported version ${version}`);
  const kind = pick(NOTE_KINDS, (head & 0x0f) - 1, 'kind');
  const author = bytesToHex(r.bytes(KEY_ID_BYTES));
  const seq = r.u32();
  const time = r.u32();
  const body = decodePayload(kind, r.bytes(r.left));
  return { version, author, seq, time, body, id: bytesToHex(sha256(signedPart)), signature, bytes: bytes.slice() };
}

/** Strict RFC 8032 check, and that the key really belongs to the note's author ID. */
export function verifyNote(note: SignedNote, publicKey: Uint8Array): note is VerifiedNote {
  if (publicKey.length !== 32 || keyIdOf(publicKey) !== note.author) return false;
  try {
    const signedPart = note.bytes.subarray(0, note.bytes.length - NOTE_SIGNATURE_BYTES);
    return ed.verify(note.signature, signedMessage(signedPart), publicKey, { zip215: false });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- duplicates and replays
//
// Rules, applied in this order by receiveNote after the signature checks out:
//   future     time is more than MAX_CLOCK_SKEW_S ahead of the receiver's clock
//   stale      time is more than MAX_NOTE_AGE_S behind the receiver's clock
//   duplicate  this exact note (same ID) was already accepted. Harmless; drop it quietly.
//   seq-reused the author already signed a DIFFERENT note with this seq. Keep the first, flag the author.
//   replay     seq is at or below the author's newest seq minus REPLAY_WINDOW: too old to tell apart
//              from a captured note being played back, so it is refused.
// Notes inside the window may arrive in any order; store and forward needs that.

export const MAX_NOTE_AGE_S = 7 * 24 * 3600;
export const MAX_CLOCK_SKEW_S = 3600;
export const REPLAY_WINDOW = 1024;

export type RejectReason =
  | 'malformed'
  | 'unknown-key'
  | 'bad-signature'
  | 'future'
  | 'stale'
  | 'duplicate'
  | 'seq-reused'
  | 'replay';

export type ReceiveResult = { ok: true; note: VerifiedNote } | { ok: false; reason: RejectReason; detail?: string };

interface AuthorWindow {
  newest: number;
  seen: Map<number, NoteId>;
}

/** Per-receiver memory of what each author has sent. One per device (or per simulated resident). */
export interface ReplayGuard {
  readonly authors: Map<KeyIdHex, AuthorWindow>;
}

export function createReplayGuard(): ReplayGuard {
  return { authors: new Map() };
}

/** Check a note against the guard without changing it. Null means it may be accepted. */
export function checkReplay(guard: ReplayGuard, note: SignedNote, now: number): RejectReason | null {
  if (note.time > now + MAX_CLOCK_SKEW_S) return 'future';
  if (now - note.time > MAX_NOTE_AGE_S) return 'stale';
  const w = guard.authors.get(note.author);
  if (!w) return null;
  const prior = w.seen.get(note.seq);
  if (prior === note.id) return 'duplicate';
  if (prior !== undefined) return 'seq-reused';
  if (note.seq <= w.newest - REPLAY_WINDOW) return 'replay';
  return null;
}

/** Remember an accepted note. Call only after checkReplay returned null. */
export function recordNote(guard: ReplayGuard, note: SignedNote): void {
  let w = guard.authors.get(note.author);
  if (!w) {
    w = { newest: note.seq, seen: new Map() };
    guard.authors.set(note.author, w);
  }
  w.seen.set(note.seq, note.id);
  if (note.seq > w.newest) {
    w.newest = note.seq;
    const floor = w.newest - REPLAY_WINDOW;
    for (const s of w.seen.keys()) if (s <= floor) w.seen.delete(s);
  }
}

/** The one door every incoming note goes through: decode, find key, verify, check replay, record. */
export function receiveNote(bytes: Uint8Array, keys: KeyLookup, guard: ReplayGuard, now: number): ReceiveResult {
  let note: SignedNote;
  try {
    note = decodeNote(bytes);
  } catch (e) {
    return { ok: false, reason: 'malformed', detail: e instanceof Error ? e.message : String(e) };
  }
  const publicKey = keys.get(note.author);
  if (!publicKey) return { ok: false, reason: 'unknown-key', detail: note.author };
  if (!verifyNote(note, publicKey)) return { ok: false, reason: 'bad-signature' };
  const reason = checkReplay(guard, note, now);
  if (reason) return { ok: false, reason };
  recordNote(guard, note);
  return { ok: true, note };
}
