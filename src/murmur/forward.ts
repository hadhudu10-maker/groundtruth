// Store and forward: work out which notes the other side lacks, and take in what they send.
//
// There is no network and no two-way channel, so "what the other side has" is learned three ways:
//   1. they told us (a HAVE message: short IDs of what they hold, one sound message of up to 34 IDs),
//   2. they sent us a note (so they hold it), and
//   3. they wrote it (a resident always holds their own notes, once we know who we are passing to).
// We also remember what we offered this session, so the next tap offers the next batch instead of the
// same notes again. A wrong guess only costs time: a note they already hold is dropped quietly.
//
// Transport rule from the plan: sound carries one note, an animated QR bundle carries many.
import { FAMILY_TAG_BYTES, NOTE_HEADER_BYTES, NOTE_KINDS, NOTE_VERSION } from '../world';
import type { FamilyTagHex, KeyIdHex, NoteId } from '../world';
import { hexToBytes, bytesToHex } from './hex';
import { SOUND_MAX_MESSAGE_BYTES } from './sound';
import type { NoteStore, Outcome } from './store';

/** First byte of a HAVE message. Real notes start 0x11..0x18 and base64 fallback parts start 0x7e. */
export const HAVE_MARK = 0x7d;
export const SHORT_ID_BYTES = 4;
/** (140 - 1) / 4 = 34 note IDs in one sound message. */
export const HAVE_MAX_IDS = Math.floor((SOUND_MAX_MESSAGE_BYTES - 1) / SHORT_ID_BYTES);
/** Notes in one animated QR bundle. 40 notes is about 70 frames, 18 s of looping at 4 frames a second. */
export const BUNDLE_MAX_NOTES = 40;

/** First 4 bytes of a note ID as hex. A collision would only hide one note from one offer. */
export const shortIdOf = (id: NoteId): string => id.slice(0, SHORT_ID_BYTES * 2);

// ---------------------------------------------------------------- the HAVE message

/** Pack up to 34 note IDs (most useful first) into one sound message. */
export function encodeHave(ids: readonly NoteId[]): Uint8Array {
  const take = ids.slice(0, HAVE_MAX_IDS);
  const out = new Uint8Array(1 + take.length * SHORT_ID_BYTES);
  out[0] = HAVE_MARK;
  take.forEach((id, i) => out.set(hexToBytes(shortIdOf(id)), 1 + i * SHORT_ID_BYTES));
  return out;
}

/** Short IDs from a HAVE message, or null if these bytes are not one. */
export function decodeHave(bytes: Uint8Array): string[] | null {
  if (bytes.length < 1 || bytes.length > SOUND_MAX_MESSAGE_BYTES) return null;
  if (bytes[0] !== HAVE_MARK || (bytes.length - 1) % SHORT_ID_BYTES !== 0) return null;
  const ids: string[] = [];
  for (let pos = 1; pos < bytes.length; pos += SHORT_ID_BYTES) ids.push(bytesToHex(bytes.subarray(pos, pos + SHORT_ID_BYTES)));
  return ids;
}

// ---------------------------------------------------------------- the WANT message ("ask for my family")
//
// Family notes are carried by strangers who cannot open them. When a carrier meets a relative, the
// relative's notes should go first instead of waiting behind thousands of others. So a resident can
// say which families they belong to: one sound message of up to 34 four-byte family tags. The tags are
// already in clear in every family note, so this reveals nothing new. The city-scale model in
// spread.ts measures what this does (wantFirst).

/** First byte of a WANT message. */
export const WANT_MARK = 0x7c;
export const WANT_MAX_TAGS = Math.floor((SOUND_MAX_MESSAGE_BYTES - 1) / FAMILY_TAG_BYTES);

export function encodeWant(tags: readonly FamilyTagHex[]): Uint8Array {
  const take = [...new Set(tags)].slice(0, WANT_MAX_TAGS);
  const out = new Uint8Array(1 + take.length * FAMILY_TAG_BYTES);
  out[0] = WANT_MARK;
  take.forEach((t, i) => out.set(hexToBytes(t), 1 + i * FAMILY_TAG_BYTES));
  return out;
}

/** Family tags from a WANT message, or null if these bytes are not one. */
export function decodeWant(bytes: Uint8Array): FamilyTagHex[] | null {
  if (bytes.length < 1 || bytes.length > SOUND_MAX_MESSAGE_BYTES) return null;
  if (bytes[0] !== WANT_MARK || (bytes.length - 1) % FAMILY_TAG_BYTES !== 0) return null;
  const tags: FamilyTagHex[] = [];
  for (let pos = 1; pos < bytes.length; pos += FAMILY_TAG_BYTES) tags.push(bytesToHex(bytes.subarray(pos, pos + FAMILY_TAG_BYTES)));
  return tags;
}

const FAMILY_HEAD_BYTE = (NOTE_VERSION << 4) | (NOTE_KINDS.indexOf('family') + 1);

/** The family tag of a family note's wire bytes (the frozen layout puts it first in the payload), else null. */
export function familyTagOfBytes(bytes: Uint8Array): FamilyTagHex | null {
  if (bytes[0] !== FAMILY_HEAD_BYTE || bytes.length < NOTE_HEADER_BYTES + FAMILY_TAG_BYTES) return null;
  return bytesToHex(bytes.subarray(NOTE_HEADER_BYTES, NOTE_HEADER_BYTES + FAMILY_TAG_BYTES));
}

/** The IDs to put in a HAVE message: everything we hold or carry, newest first. */
export function haveIds(store: NoteStore): NoteId[] {
  return [...store.all(), ...store.parked()]
    .sort(newestFirst)
    .map((n) => n.id);
}

// ---------------------------------------------------------------- what the other side knows

export interface Counterpart {
  /** The resident we are handing to, if they are paired. Their own notes are known to be theirs. */
  setResident(keyId: KeyIdHex | null): void;
  /** They told us (a HAVE message). */
  learnHave(shortIds: readonly string[]): void;
  /** They asked for their families (a WANT message): those notes go first. */
  learnWant(tags: readonly FamilyTagHex[]): void;
  wants(tag: FamilyTagHex): boolean;
  /** They sent us this note, so they hold it. */
  learnHolds(id: NoteId): void;
  /** We offered these (sound or QR). Counted as held until `forgetOffered`, since there is no receipt. */
  markOffered(ids: readonly NoteId[]): void;
  /** "Send everything again", for when an offer was missed. */
  forgetOffered(): void;
  /** Start over with someone new. */
  reset(): void;
  holds(note: { id: NoteId; author: KeyIdHex }): boolean;
  stats(): { confirmed: number; offered: number };
}

export function createCounterpart(): Counterpart {
  let resident: KeyIdHex | null = null;
  const confirmed = new Set<string>();
  const offered = new Set<string>();
  const wanted = new Set<FamilyTagHex>();
  return {
    learnWant: (tags) => {
      for (const t of tags) wanted.add(t);
    },
    wants: (tag) => wanted.has(tag),
    setResident: (keyId) => {
      resident = keyId;
    },
    learnHave: (ids) => {
      for (const s of ids) confirmed.add(s);
    },
    learnHolds: (id) => {
      confirmed.add(shortIdOf(id));
    },
    markOffered: (ids) => {
      for (const id of ids) offered.add(shortIdOf(id));
    },
    forgetOffered: () => offered.clear(),
    reset: () => {
      resident = null;
      confirmed.clear();
      offered.clear();
      wanted.clear();
    },
    holds: (note) => {
      const s = shortIdOf(note.id);
      return (resident !== null && note.author === resident) || confirmed.has(s) || offered.has(s);
    },
    stats: () => ({ confirmed: confirmed.size, offered: offered.size }),
  };
}

// ---------------------------------------------------------------- the offer

export interface OfferItem {
  id: NoteId;
  author: KeyIdHex;
  seq: number;
  time: number;
  bytes: Uint8Array;
  /** False for parked notes: carried for others, not checked by this device. */
  verified: boolean;
}

export interface Offer {
  /** Everything the other side lacks, newest first. */
  items: OfferItem[];
  /** Nothing to send, one note (sound), or several (animated QR bundle). */
  recommended: 'none' | 'sound' | 'qr';
}

function newestFirst(a: { time: number; seq: number; id: NoteId }, b: { time: number; seq: number; id: NoteId }): number {
  return b.time - a.time || b.seq - a.seq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Notes this device holds or carries that the other side is not known to hold. */
export function planOffer(store: NoteStore, who: Counterpart): Offer {
  const items: OfferItem[] = [];
  for (const n of store.all()) {
    if (!who.holds(n)) items.push({ id: n.id, author: n.author, seq: n.seq, time: n.time, bytes: n.bytes, verified: true });
  }
  for (const p of store.parked()) {
    if (!who.holds(p)) items.push({ id: p.id, author: p.author, seq: p.seq, time: p.time, bytes: p.bytes, verified: false });
  }
  // Notes for the families they asked for go first, then everything else, newest first.
  const isWanted = (i: OfferItem) => {
    const tag = familyTagOfBytes(i.bytes);
    return tag !== null && who.wants(tag);
  };
  items.sort((a, b) => Number(isWanted(b)) - Number(isWanted(a)) || newestFirst(a, b));
  return { items, recommended: items.length === 0 ? 'none' : items.length === 1 ? 'sound' : 'qr' };
}

/** The part of an offer one QR bundle carries. The rest goes on the next tap. */
export function bundleOf(offer: Offer): OfferItem[] {
  return offer.items.slice(0, BUNDLE_MAX_NOTES);
}

// ---------------------------------------------------------------- taking things in

export interface IngestSummary {
  added: Extract<Outcome, { kind: 'added' }>['note'][];
  duplicates: number;
  /** Notes from authors we have no key for, kept aside and unchecked. */
  parked: number;
  rejected: { reason: Extract<Outcome, { kind: 'rejected' }>['reason']; detail?: string }[];
}

function learnFrom(who: Counterpart, outcome: Outcome): void {
  if (outcome.kind === 'added') who.learnHolds(outcome.note.id);
  else if (outcome.kind === 'duplicate' || outcome.kind === 'parked') who.learnHolds(outcome.id);
}

/** Feed many notes (a scanned bundle) through the store. Every one goes through `receiveNote`. */
export function ingest(store: NoteStore, who: Counterpart, notes: readonly Uint8Array[], now?: number): IngestSummary {
  const out: IngestSummary = { added: [], duplicates: 0, parked: 0, rejected: [] };
  for (const bytes of notes) {
    const o = store.receive(bytes, now);
    learnFrom(who, o);
    if (o.kind === 'added') out.added.push(o.note);
    else if (o.kind === 'duplicate') out.duplicates += 1;
    else if (o.kind === 'parked') {
      if (o.isNew) out.parked += 1;
      else out.duplicates += 1;
    } else out.rejected.push({ reason: o.reason, detail: o.detail });
  }
  return out;
}

export type SoundResult =
  | { kind: 'have'; shortIds: string[] }
  | { kind: 'want'; tags: FamilyTagHex[] }
  | { kind: 'note'; outcome: Outcome }
  | { kind: 'ignored' };

/** One whole message heard by sound: either a HAVE message or a note. */
export function handleSound(store: NoteStore, who: Counterpart, bytes: Uint8Array, now?: number): SoundResult {
  if (bytes.length === 0) return { kind: 'ignored' };
  if (bytes[0] === HAVE_MARK) {
    const ids = decodeHave(bytes);
    if (!ids) return { kind: 'ignored' };
    who.learnHave(ids);
    return { kind: 'have', shortIds: ids };
  }
  if (bytes[0] === WANT_MARK) {
    const tags = decodeWant(bytes);
    if (!tags) return { kind: 'ignored' };
    who.learnWant(tags);
    return { kind: 'want', tags };
  }
  const outcome = store.receive(bytes, now);
  learnFrom(who, outcome);
  return { kind: 'note', outcome };
}
