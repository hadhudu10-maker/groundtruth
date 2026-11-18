// Shared types used by every module. FROZEN after Tue 2026-11-17.
// Modules may extend these in their own folder (for example `type SimLevel = LevelState & {...}`),
// but must not change them here.

/** Lowercase hex, 16 chars. First 8 bytes of a domain-separated SHA-256 of the public key. */
export type KeyIdHex = string;
/** Lowercase hex, 8 chars. Identifies a family key without revealing it. */
export type FamilyTagHex = string;
/** Lowercase hex, 8 chars. Lets two sick lists match the same person. */
export type CaseTagHex = string;
/** Lowercase hex, 64 chars. SHA-256 of a note's signed bytes. */
export type NoteId = string;
/** Lowercase hex, 32 chars. First 16 bytes of a NoteId, used inside notes to point at other notes. */
export type NoteRefHex = string;

/** A level of the Hollow. 1 is the top level; larger numbers are deeper. Fits in one byte. */
export type LevelId = number;
/** A node on the water pipe map (a tap, junction or recycler). Fits in two bytes. */
export type PipeNodeId = number;

/** What a resident shares when pairing by QR. Enough to verify their notes later. */
export interface ResidentCard {
  publicKey: Uint8Array; // 32 bytes, Ed25519
  name: string;
  level: LevelId;
}

/** A known resident. `keyId` is always `keyIdOf(publicKey)`. */
export interface Resident extends ResidentCard {
  keyId: KeyIdHex;
}

/** The device owner's own identity. The secret key never leaves the device. */
export interface Identity extends Resident {
  secretKey: Uint8Array; // 32 bytes
}

/** Anything that maps a key ID to a public key. A `Map<KeyIdHex, Uint8Array>` works. */
export interface KeyLookup {
  get(keyId: KeyIdHex): Uint8Array | undefined;
}

/** A secret shared by one family, swapped in person by QR. `tag` is `familyTagOf(key)`. */
export interface FamilyKey {
  tag: FamilyTagHex;
  key: Uint8Array; // 32 bytes
  name: string;
}

/** What a family note says once unsealed. The sealing scheme is owned by murmur. */
export type FamilyCondition = 'safe' | 'help' | 'hurt' | 'moving';
export interface FamilyStatus {
  condition: FamilyCondition;
  level: LevelId;
}

/** Rationed resources. Units: power in hours per day, water in litres and food in kcal per person per day. */
export type Resource = 'power' | 'water' | 'food';

/** One level as the simulation reports it. Every number here comes from the harness. */
export interface LevelState {
  id: LevelId;
  population: number;
  power: 'on' | 'flicker' | 'out';
  /** Air quality, 0 (unbreathable) to 1 (clean). */
  air: number;
  water: 'ok' | 'suspect' | 'bad';
  /** What the level actually received today, in the units listed on `Resource`. */
  received: Record<Resource, number>;
  /** True cases in the simulation, and the number the Directorate publishes. */
  sick: { actual: number; official: number };
}

/** The whole Hollow at one moment of simulated time. */
export interface CityState {
  seed: number;
  /** Simulated clock in seconds. Same scale as a note's `time`. */
  time: number;
  network: 'up' | 'down';
  /** Index 0 is level 1, the top. */
  levels: LevelState[];
}
