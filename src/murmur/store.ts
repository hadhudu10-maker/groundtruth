// The note store: every note this device holds, kept in localStorage, keyed by NoteId.
//
// One rule: a note gets into the store only through `receiveNote` from src/world. That covers notes
// from sound, from QR, notes this device signs itself (they go through the same door), and notes read
// back from disk at startup (they are checked again). Nothing here trusts a note on its own say-so.
//
// Notes from authors whose key we do not hold cannot be checked yet. They are PARKED: not trusted,
// never shown as verified, but still carried so that a relay can pass them on to someone who can check
// them. When the author's card is scanned later, `retryParked` runs them through `receiveNote` again.
// Parked notes still obey the clock rules (future, stale): otherwise anyone, with no key at all, could
// date junk far in the future and it would sit at the front of every offer, city wide, since offers go
// newest first (security review, 2026-11-20).
import { checkReplay, createReplayGuard, decodeNote, receiveNote } from '../world';
import type { Identity, KeyIdHex, KeyLookup, NoteId, RejectReason, ReplayGuard, SignedNote, VerifiedNote } from '../world';
import { defaultStore } from './device';
import type { KeyValueStore } from './device';
import { bytesToHex, hexToBytes } from './hex';

export const NOTES_KEY = 'gt.murmur.notes.v1';
export const PARKED_KEY = 'gt.murmur.parked.v1';
/** Unverifiable notes kept for relaying. Oldest go first, so a flood of junk cannot grow the store forever. */
export const PARKED_MAX = 200;

/** What happened to one incoming note. Duplicates are a normal outcome, not an error. */
export type Outcome =
  | { kind: 'added'; note: VerifiedNote }
  | { kind: 'duplicate'; id: NoteId }
  | { kind: 'parked'; id: NoteId; author: KeyIdHex; isNew: boolean }
  | { kind: 'rejected'; reason: Exclude<RejectReason, 'duplicate' | 'unknown-key'>; detail?: string; id?: NoteId };

export interface ParkedNote {
  id: NoteId;
  author: KeyIdHex;
  seq: number;
  time: number;
  bytes: Uint8Array;
}

export interface NoteStore {
  /** The only way in. `now` is Unix seconds (default: the device clock). */
  receive(bytes: Uint8Array, now?: number): Outcome;
  /** Run parked notes through `receiveNote` again, for example after pairing. Returns how many were accepted. */
  retryParked(now?: number): number;
  /** Verified notes in the order they were accepted. */
  all(): VerifiedNote[];
  parked(): ParkedNote[];
  get(id: NoteId): VerifiedNote | undefined;
  has(id: NoteId): boolean;
  size(): number;
  /** For React's useSyncExternalStore: `subscribe` plus `version` as the snapshot. */
  subscribe(listener: () => void): () => void;
  version(): number;
}

/** The slice of a Device the store needs. A `Device` fits. */
export interface StoreOwner {
  identity: Pick<Identity, 'keyId' | 'publicKey'>;
  keys: KeyLookup;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function loadList(kv: KeyValueStore | null, key: string): Uint8Array[] {
  try {
    const raw = kv?.getItem(key);
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    const out: Uint8Array[] = [];
    for (const h of list) {
      try {
        if (typeof h === 'string') out.push(hexToBytes(h));
      } catch {
        /* skip a damaged entry */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function createNoteStore(
  owner: StoreOwner,
  kv: KeyValueStore | null = defaultStore(),
  clock: () => number = nowSeconds,
): NoteStore {
  // Our own key counts as a known key: notes we sign go through the same door, and when a peer
  // hands one of ours back it is simply a duplicate (or, after a wipe, a recovered note).
  const lookup: KeyLookup = {
    get: (id) => (id === owner.identity.keyId ? owner.identity.publicKey : owner.keys.get(id)),
  };
  const guard: ReplayGuard = createReplayGuard();
  const notes = new Map<NoteId, VerifiedNote>(); // insertion order = acceptance order
  const parkedMap = new Map<NoteId, ParkedNote>();
  const listeners = new Set<() => void>();
  let ver = 0;

  const save = () => {
    try {
      kv?.setItem(NOTES_KEY, JSON.stringify([...notes.values()].map((n) => bytesToHex(n.bytes))));
      kv?.setItem(PARKED_KEY, JSON.stringify([...parkedMap.values()].map((p) => bytesToHex(p.bytes))));
    } catch {
      /* storage full or blocked: the notes still work for this session */
    }
  };
  const emit = () => {
    ver += 1;
    for (const l of [...listeners]) l();
  };

  function park(note: SignedNote, now: number): Outcome {
    const late = checkReplay(createReplayGuard(), note, now); // only the clock rules can fire on an empty guard
    if (late === 'future' || late === 'stale') return { kind: 'rejected', reason: late, id: note.id };
    const isNew = !parkedMap.has(note.id);
    if (isNew) {
      parkedMap.set(note.id, { id: note.id, author: note.author, seq: note.seq, time: note.time, bytes: note.bytes });
      while (parkedMap.size > PARKED_MAX) parkedMap.delete(parkedMap.keys().next().value as NoteId);
      save();
      emit();
    }
    return { kind: 'parked', id: note.id, author: note.author, isNew };
  }

  function receive(bytes: Uint8Array, now: number = clock()): Outcome {
    let decoded: SignedNote;
    try {
      decoded = decodeNote(bytes);
    } catch (e) {
      return { kind: 'rejected', reason: 'malformed', detail: e instanceof Error ? e.message : String(e) };
    }
    // Quick quiet drop for a note already held: no signature work, no noise.
    if (notes.has(decoded.id)) return { kind: 'duplicate', id: decoded.id };
    const res = receiveNote(bytes, lookup, guard, now);
    if (res.ok) {
      notes.set(res.note.id, res.note);
      parkedMap.delete(res.note.id);
      save();
      emit();
      return { kind: 'added', note: res.note };
    }
    if (res.reason === 'duplicate') return { kind: 'duplicate', id: decoded.id };
    if (res.reason === 'unknown-key') return park(decoded, now);
    return { kind: 'rejected', reason: res.reason, detail: res.detail, id: decoded.id };
  }

  function retryParked(now: number = clock()): number {
    let accepted = 0;
    for (const p of [...parkedMap.values()]) {
      parkedMap.delete(p.id); // receive() puts it back if it still cannot be checked
      if (receive(p.bytes, now).kind === 'added') accepted += 1;
    }
    save();
    emit();
    return accepted;
  }

  // Read back from disk. Each note is checked again; `now` is the note's own time so age rules
  // do not throw away notes that were fine when they were stored.
  for (const bytes of loadList(kv, NOTES_KEY)) {
    try {
      const res = receiveNote(bytes, lookup, guard, decodeNote(bytes).time);
      if (res.ok) notes.set(res.note.id, res.note);
    } catch {
      /* a damaged entry is dropped */
    }
  }
  for (const bytes of loadList(kv, PARKED_KEY)) {
    try {
      const n = decodeNote(bytes);
      if (!notes.has(n.id)) parkedMap.set(n.id, { id: n.id, author: n.author, seq: n.seq, time: n.time, bytes: n.bytes });
    } catch {
      /* dropped */
    }
  }
  retryParked();
  ver = 0;

  return {
    receive,
    retryParked,
    all: () => [...notes.values()],
    parked: () => [...parkedMap.values()],
    get: (id) => notes.get(id),
    has: (id) => notes.has(id),
    size: () => notes.size,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => ver,
  };
}
