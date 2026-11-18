// One place that configures @noble/ed25519 so the synchronous API works everywhere
// (the simulation signs thousands of notes and should not await each one).
import * as ed from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

ed.hashes.sha512 = sha512;

export { ed, sha256, bytesToHex, concatBytes, hexToBytes, utf8ToBytes };
