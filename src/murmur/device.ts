// This device's identity and the keys of people it has paired with, kept in localStorage.
// One record holds the secret key, name, level and the note counter together, so they cannot drift apart.
import { createIdentity, keyIdOf } from '../world';
import { bytesToHex, hexToBytes } from './hex';
import type { Identity, KeyIdHex, LevelId, Resident, ResidentCard } from '../world';

export const IDENTITY_KEY = 'gt.device.identity.v1';
export const PEERS_KEY = 'gt.device.peers.v1';

interface StoredIdentity {
  secretKey: string; // hex
  name: string;
  level: LevelId;
  seq: number; // the last seq already used
}

/** The slice of Storage we need. Lets tests pass a plain Map-backed object. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // private mode or blocked storage
  }
}

function read<T>(store: KeyValueStore | null, key: string): T | null {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export interface Device {
  identity: Identity;
  /** Returns a fresh seq, saved before it is returned, so a crash never reuses one. */
  nextSeq(): number;
  /** Known residents by key ID. Usable directly as a KeyLookup for receiveNote. */
  keys: Map<KeyIdHex, Uint8Array>;
  peers(): Resident[];
  addPeer(card: ResidentCard): Resident;
}

/** Load the stored identity, or return null if this device has none yet. */
export function loadDevice(store: KeyValueStore | null = defaultStore()): Device | null {
  const rec = read<StoredIdentity>(store, IDENTITY_KEY);
  if (!rec) return null;
  return buildDevice(store, rec);
}

/** Make and store a new identity with a random key. */
export function createDevice(name: string, level: LevelId = 1, store: KeyValueStore | null = defaultStore()): Device {
  const identity = createIdentity({ name, level });
  const rec: StoredIdentity = { secretKey: bytesToHex(identity.secretKey), name, level, seq: 0 };
  store?.setItem(IDENTITY_KEY, JSON.stringify(rec));
  return buildDevice(store, rec);
}

function buildDevice(store: KeyValueStore | null, rec: StoredIdentity): Device {
  const identity = createIdentity({ name: rec.name, level: rec.level, secretKey: hexToBytes(rec.secretKey) });
  const peerRecords = read<Record<KeyIdHex, { publicKey: string; name: string; level: LevelId }>>(store, PEERS_KEY) ?? {};
  const keys = new Map<KeyIdHex, Uint8Array>();
  const residents = new Map<KeyIdHex, Resident>();
  for (const [keyId, p] of Object.entries(peerRecords)) {
    const publicKey = hexToBytes(p.publicKey);
    keys.set(keyId, publicKey);
    residents.set(keyId, { publicKey, name: p.name, level: p.level, keyId });
  }
  const savePeers = () => {
    const out: Record<string, { publicKey: string; name: string; level: LevelId }> = {};
    for (const r of residents.values()) out[r.keyId] = { publicKey: bytesToHex(r.publicKey), name: r.name, level: r.level };
    try {
      store?.setItem(PEERS_KEY, JSON.stringify(out));
    } catch {
      /* storage full or blocked: the map still works for this session */
    }
  };
  let seq = rec.seq;
  return {
    identity,
    keys,
    nextSeq() {
      seq += 1;
      store?.setItem(IDENTITY_KEY, JSON.stringify({ ...rec, seq }));
      return seq;
    },
    peers: () => [...residents.values()],
    addPeer(card) {
      const resident: Resident = { ...card, keyId: keyIdOf(card.publicKey) };
      keys.set(resident.keyId, card.publicKey);
      residents.set(resident.keyId, resident);
      savePeers();
      return resident;
    },
  };
}
