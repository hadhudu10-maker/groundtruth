// Many signed notes in one animated, looping QR (bc-ur fountain codes).
// Pack: [len u8][note bytes] repeated. The pack is wrapped as a UR "bytes" and split into frames.
// Frames can be scanned in any order, any frame can be missed, and the loop never has to restart.
import { Buffer } from 'buffer';
import { NOTE_MAX_BYTES } from '../world';

// bc-ur and its helpers expect a Node-style global Buffer. Browsers have none.
const g = globalThis as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;

// Loaded after the Buffer shim above, so use a dynamic import.
const loadUr = () => import('@ngraveio/bc-ur');

/** Bytes of note data per frame. Smaller means simpler QR codes (easier to scan) but more frames. */
export const BUNDLE_FRAGMENT_BYTES = 80;
/** Frames shown per second by the display. */
export const BUNDLE_FPS = 4;

export class BundleFormatError extends Error {
  override name = 'BundleFormatError';
}

/** Pack notes (each at most 140 bytes) into one byte string. */
export function packNotes(notes: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const n of notes) {
    if (n.length < 1 || n.length > NOTE_MAX_BYTES) throw new BundleFormatError(`note of ${n.length} bytes does not fit`);
    total += 1 + n.length;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const n of notes) {
    out[pos++] = n.length;
    out.set(n, pos);
    pos += n.length;
  }
  return out;
}

/** Inverse of packNotes. Throws on a truncated or padded pack. */
export function unpackNotes(data: Uint8Array): Uint8Array[] {
  const notes: Uint8Array[] = [];
  let pos = 0;
  while (pos < data.length) {
    const len = data[pos++]!;
    if (len < 1 || len > NOTE_MAX_BYTES || pos + len > data.length) throw new BundleFormatError('bundle is damaged');
    notes.push(data.slice(pos, pos + len));
    pos += len;
  }
  return notes;
}

export interface BundleEncoder {
  /** Frames needed at minimum (pure fragments). More frames may be produced; the loop never ends. */
  readonly frameCount: number;
  /** Next frame text, uppercase so QR alphanumeric mode applies. Cycles forever. */
  nextFrame(): string;
}

export async function createBundleEncoder(
  notes: Uint8Array[],
  fragmentBytes = BUNDLE_FRAGMENT_BYTES,
): Promise<BundleEncoder> {
  const { UR, UREncoder } = await loadUr();
  const ur = UR.fromBuffer(Buffer.from(packNotes(notes)));
  const encoder = new UREncoder(ur, fragmentBytes);
  return {
    frameCount: encoder.fragmentsLength,
    nextFrame: () => encoder.nextPart().toUpperCase(),
  };
}

export interface BundleDecoder {
  /** Feed one scanned frame. Returns false if the frame was not a bundle frame or was rejected. */
  receive(frame: string): boolean;
  /** 0..1. */
  progress(): number;
  isComplete(): boolean;
  /** The notes, once complete. Throws before then, or if the pack is damaged. */
  result(): Uint8Array[];
}

export async function createBundleDecoder(): Promise<BundleDecoder> {
  const { URDecoder } = await loadUr();
  const decoder = new URDecoder();
  return {
    receive(frame) {
      try {
        return decoder.receivePart(frame.trim().toLowerCase());
      } catch {
        return false;
      }
    },
    progress: () => (decoder.isComplete() ? 1 : decoder.getProgress()),
    isComplete: () => decoder.isComplete() && decoder.isSuccess(),
    result() {
      if (!decoder.isComplete() || !decoder.isSuccess()) throw new BundleFormatError('bundle is not complete');
      return unpackNotes(new Uint8Array(decoder.resultUR().decodeCBOR()));
    },
  };
}
