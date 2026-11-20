// Resident card: what two people swap by QR to learn each other's public key.
// Text format so any QR reader returns it unchanged: "GT1:" + uppercase hex of
// [level u8][public key 32 bytes][name, UTF-8]. Uppercase hex fits QR alphanumeric mode (small, dense-free codes).
import type { ResidentCard } from '../world';

export const CARD_PREFIX = 'GT1:';
export const CARD_NAME_MAX_BYTES = 32;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });

export class CardFormatError extends Error {
  override name = 'CardFormatError';
}

function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s.toUpperCase();
}

function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(h)) throw new CardFormatError('card is not valid hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function encodeCard(card: ResidentCard): string {
  if (card.publicKey.length !== 32) throw new CardFormatError('public key must be 32 bytes');
  if (!Number.isInteger(card.level) || card.level < 0 || card.level > 255) {
    throw new CardFormatError('level must be an integer in 0..255');
  }
  const name = enc.encode(card.name);
  if (name.length < 1 || name.length > CARD_NAME_MAX_BYTES) {
    throw new CardFormatError(`name must be 1..${CARD_NAME_MAX_BYTES} bytes of UTF-8`);
  }
  const body = new Uint8Array(1 + 32 + name.length);
  body[0] = card.level;
  body.set(card.publicKey, 1);
  body.set(name, 33);
  return CARD_PREFIX + toHex(body);
}

export function decodeCard(text: string): ResidentCard {
  const t = text.trim();
  if (!t.toUpperCase().startsWith(CARD_PREFIX)) throw new CardFormatError('not a Groundtruth card');
  const body = fromHex(t.slice(CARD_PREFIX.length));
  if (body.length < 34) throw new CardFormatError('card is too short');
  if (body.length > 33 + CARD_NAME_MAX_BYTES) throw new CardFormatError('card name is too long');
  let name: string;
  try {
    name = dec.decode(body.subarray(33));
  } catch {
    throw new CardFormatError('card name is not valid UTF-8');
  }
  return { level: body[0]!, publicKey: body.slice(1, 33), name };
}
