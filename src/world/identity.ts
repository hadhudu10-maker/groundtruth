// Resident identity and the short IDs derived from keys. FROZEN after Tue 2026-11-17.
import { bytesToHex, concatBytes, ed, hexToBytes, sha256, utf8ToBytes } from './crypto';
import type { CaseTagHex, FamilyTagHex, Identity, KeyIdHex, LevelId } from './types';

export const KEY_ID_BYTES = 8;
export const FAMILY_TAG_BYTES = 4;
export const CASE_TAG_BYTES = 4;

const KEY_ID_DOMAIN = utf8ToBytes('groundtruth/key-id/v1');
const FAMILY_TAG_DOMAIN = utf8ToBytes('groundtruth/family-tag/v1');
const CASE_TAG_DOMAIN = utf8ToBytes('groundtruth/case-tag/v1');

function tag(domain: Uint8Array, data: Uint8Array, bytes: number): string {
  return bytesToHex(sha256(concatBytes(domain, data)).subarray(0, bytes));
}

/** Short key ID carried in every note. Receivers look up the full key they got by QR. */
export function keyIdOf(publicKey: Uint8Array): KeyIdHex {
  if (publicKey.length !== 32) throw new Error('public key must be 32 bytes');
  return tag(KEY_ID_DOMAIN, publicKey, KEY_ID_BYTES);
}

/** Public tag for a family key. Carried in family notes so relatives can spot theirs. */
export function familyTagOf(familyKey: Uint8Array): FamilyTagHex {
  if (familyKey.length !== 32) throw new Error('family key must be 32 bytes');
  return tag(FAMILY_TAG_DOMAIN, familyKey, FAMILY_TAG_BYTES);
}

/**
 * Tag for a sick person, so a self report and a clinic tally can be matched (problem 9).
 * Anyone who knows the key ID can compute it, so it links a case to a resident. Accepted for the demo.
 */
export function caseTagOf(keyId: KeyIdHex): CaseTagHex {
  return tag(CASE_TAG_DOMAIN, hexToBytes(keyId), CASE_TAG_BYTES);
}

/**
 * Make an identity. Pass `secretKey` (32 bytes) for seeded, repeatable identities in the
 * simulation; leave it out on a real device to use secure randomness.
 */
export function createIdentity(input: { name: string; level: LevelId; secretKey?: Uint8Array }): Identity {
  const secretKey = input.secretKey ?? ed.utils.randomSecretKey();
  if (secretKey.length !== 32) throw new Error('secret key must be 32 bytes');
  const publicKey = ed.getPublicKey(secretKey);
  return { name: input.name, level: input.level, publicKey, keyId: keyIdOf(publicKey), secretKey };
}
