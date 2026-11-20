import { describe, expect, it } from 'vitest';
import { createIdentity, createReplayGuard, receiveNote, signNote, NOTE_MAX_PAYLOAD_BYTES } from '../world';
import type { NoteBody } from '../world';
import { CardFormatError, decodeCard, encodeCard } from './card';
import { createBundleDecoder, createBundleEncoder, packNotes, unpackNotes } from './bundle';
import { createDevice, loadDevice } from './device';
import type { KeyValueStore } from './device';
import { SoundReassembler, createEngine, decodeChunk, encodeWaveform, frameForSound, loadGgwave } from './sound';

const NOW = 1_800_000_000;

function demoIdentity() {
  return createIdentity({ name: 'Mac', level: 3 });
}

function fullTextNote(id = demoIdentity(), seq = 1) {
  const text = 'x'.repeat(NOTE_MAX_PAYLOAD_BYTES);
  return { id, note: signNote({ seq, time: NOW, body: { kind: 'text', text } }, id) };
}

describe('card', () => {
  it('round trips a card', () => {
    const id = demoIdentity();
    const text = encodeCard({ publicKey: id.publicKey, name: 'Mac', level: 3 });
    expect(text.startsWith('GT1:')).toBe(true);
    expect(/^[0-9A-Z:]+$/.test(text)).toBe(true); // QR alphanumeric mode
    const back = decodeCard(text);
    expect(back.name).toBe('Mac');
    expect(back.level).toBe(3);
    expect(Array.from(back.publicKey)).toEqual(Array.from(id.publicKey));
  });

  it('keeps non-ASCII names and tolerates lowercase and spaces', () => {
    const id = demoIdentity();
    const text = encodeCard({ publicKey: id.publicKey, name: 'Zoë 🔦', level: 12 });
    expect(decodeCard(` ${text.toLowerCase()} `).name).toBe('Zoë 🔦');
  });

  it('rejects junk', () => {
    expect(() => decodeCard('hello')).toThrow(CardFormatError);
    expect(() => decodeCard('GT1:ZZ')).toThrow(CardFormatError);
    expect(() => decodeCard('GT1:0102')).toThrow(CardFormatError);
    const id = demoIdentity();
    expect(() => encodeCard({ publicKey: id.publicKey, name: '', level: 1 })).toThrow(CardFormatError);
    expect(() => encodeCard({ publicKey: id.publicKey, name: 'a'.repeat(33), level: 1 })).toThrow(CardFormatError);
    expect(() => encodeCard({ publicKey: id.publicKey, name: 'a', level: 300 })).toThrow(CardFormatError);
  });
});

describe('bundle', () => {
  function twentyNotes() {
    const id = demoIdentity();
    const bodies: NoteBody[] = [];
    for (let i = 0; i < 20; i++) {
      const m = i % 4;
      bodies.push(
        m === 0
          ? { kind: 'text', text: `note number ${i} from the test bundle` }
          : m === 1
            ? { kind: 'power', level: 3, zone: i, event: 'ok', durationS: 0 }
            : m === 2
              ? { kind: 'water', level: 3, tap: 300 + i, result: 'ok' }
              : { kind: 'surface', probe: 7, readings: [{ metric: 'o2', value: 20.9 }] },
      );
    }
    const notes = bodies.map((body, i) => signNote({ seq: i + 1, time: NOW, body }, id));
    return { id, notes };
  }

  it('packs and unpacks', () => {
    const { notes } = twentyNotes();
    const back = unpackNotes(packNotes(notes.map((n) => n.bytes)));
    expect(back.map((b) => Array.from(b))).toEqual(notes.map((n) => Array.from(n.bytes)));
    expect(() => unpackNotes(Uint8Array.of(50, 1, 2))).toThrow();
  });

  it('round trips 20 signed notes through animated QR frames, in order', async () => {
    const { id, notes } = twentyNotes();
    const enc = await createBundleEncoder(notes.map((n) => n.bytes));
    const dec = await createBundleDecoder();
    let frames = 0;
    while (!dec.isComplete() && frames < enc.frameCount * 4) {
      const f = enc.nextFrame();
      expect(f).toBe(f.toUpperCase());
      expect(dec.receive(f)).toBe(true);
      frames++;
    }
    expect(dec.isComplete()).toBe(true);
    expect(dec.progress()).toBe(1);
    const out = dec.result();
    expect(out).toHaveLength(20);
    const keys = new Map([[id.keyId, id.publicKey]]);
    const guard = createReplayGuard();
    for (const bytes of out) expect(receiveNote(bytes, keys, guard, NOW).ok).toBe(true);
  });

  it('round trips with frames out of order, repeated and missed', async () => {
    const { notes } = twentyNotes();
    const enc = await createBundleEncoder(notes.map((n) => n.bytes));
    const all: string[] = [];
    for (let i = 0; i < enc.frameCount * 3; i++) all.push(enc.nextFrame());
    // Drop every third frame, then shuffle deterministically, and repeat some.
    const kept = all.filter((_, i) => i % 3 !== 1);
    const shuffled = kept.map((f, i) => [(i * 7919) % kept.length, f] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const dec = await createBundleDecoder();
    for (const f of [...shuffled, shuffled[0]!, shuffled[1]!]) {
      dec.receive(f);
      if (dec.isComplete()) break;
    }
    expect(dec.isComplete()).toBe(true);
    expect(dec.result().map((b) => Array.from(b))).toEqual(notes.map((n) => Array.from(n.bytes)));
  });

  it('ignores a frame that is not a bundle frame', async () => {
    const dec = await createBundleDecoder();
    expect(dec.receive('GT1:00')).toBe(false);
    expect(dec.progress()).toBe(0);
    expect(() => dec.result()).toThrow();
  });
});

describe('sound framing', () => {
  it('binary mode sends the note untouched in one message', () => {
    const { note } = fullTextNote();
    expect(note.bytes.length).toBe(140);
    const frames = frameForSound(note.bytes, 'binary');
    expect(frames).toHaveLength(1);
    const r = new SoundReassembler().push(frames[0]!);
    expect(r?.mode).toBe('binary');
    expect(Array.from(r!.bytes)).toEqual(Array.from(note.bytes));
  });

  it('base64 fallback splits a 140 byte note into two messages that each fit', () => {
    const { note } = fullTextNote();
    const frames = frameForSound(note.bytes, 'base64', 'ab');
    expect(frames).toHaveLength(2);
    for (const f of frames) expect(f.length).toBeLessThanOrEqual(140);
    const re = new SoundReassembler();
    expect(re.push(frames[0]!)).toBeNull();
    expect(re.pending()).toBe(1);
    const r = re.push(frames[1]!);
    expect(r?.mode).toBe('base64');
    expect(Array.from(r!.bytes)).toEqual(Array.from(note.bytes));
    expect(re.pending()).toBe(0);
  });

  it('reassembles fallback parts out of order and keeps separate sends apart', () => {
    const a = fullTextNote(undefined, 1).note.bytes;
    const b = fullTextNote(undefined, 2).note.bytes;
    const fa = frameForSound(a, 'base64', '01');
    const fb = frameForSound(b, 'base64', '02');
    const re = new SoundReassembler();
    expect(re.push(fa[1]!)).toBeNull();
    expect(re.push(fb[0]!)).toBeNull();
    expect(Array.from(re.push(fa[0]!)!.bytes)).toEqual(Array.from(a));
    expect(Array.from(re.push(fb[1]!)!.bytes)).toEqual(Array.from(b));
  });

  it('drops garbage fallback messages', () => {
    const re = new SoundReassembler();
    expect(re.push(new TextEncoder().encode('~oops'))).toBeNull();
    expect(re.push(new Uint8Array(0))).toBeNull();
    expect(re.push(new TextEncoder().encode('~3/2.ab:xx'))).toBeNull();
  });
});

describe('ggwave carries raw binary (real WASM, streamed decode)', () => {
  async function roundTrip(data: Uint8Array, protocol: 'normal' | 'fast') {
    const engine = createEngine(await loadGgwave(), 48000);
    const wave = encodeWaveform(engine, data, protocol);
    let got: Uint8Array | null = null;
    for (let i = 0; i < wave.length + 48000 && !got; i += 1024) {
      const chunk = new Float32Array(1024);
      chunk.set(wave.subarray(i, i + 1024));
      got = decodeChunk(engine, chunk);
    }
    return { got, seconds: wave.length / 48000 };
  }

  it('a signed 140 byte note survives the sound layer and still verifies', async () => {
    const { id, note } = fullTextNote();
    const { got, seconds } = await roundTrip(note.bytes, 'fast');
    expect(seconds).toBeGreaterThan(5);
    expect(got).not.toBeNull();
    expect(Array.from(got!)).toEqual(Array.from(note.bytes));
    const res = receiveNote(new SoundReassembler().push(got!)!.bytes, new Map([[id.keyId, id.publicKey]]), createReplayGuard(), NOW);
    expect(res.ok).toBe(true);
  }, 60_000);

  it('bytes 0x00 and 0xFF are not mangled', async () => {
    const data = new Uint8Array(100).map((_, i) => (i % 2 === 0 ? 0 : 255));
    const { got } = await roundTrip(data, 'normal');
    expect(Array.from(got!)).toEqual(Array.from(data));
  }, 60_000);

  it('the base64 fallback messages also survive the sound layer', async () => {
    const { note } = fullTextNote();
    const re = new SoundReassembler();
    let result = null;
    for (const f of frameForSound(note.bytes, 'base64')) {
      const { got } = await roundTrip(f, 'fast');
      result = re.push(got!);
    }
    expect(Array.from(result!.bytes)).toEqual(Array.from(note.bytes));
  }, 60_000);
});

describe('device', () => {
  function memoryStore(): KeyValueStore {
    const m = new Map<string, string>();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
  }

  it('keeps identity and seq across reloads, and raises seq before use', () => {
    const store = memoryStore();
    expect(loadDevice(store)).toBeNull();
    const d = createDevice('Phone', 2, store);
    expect(d.nextSeq()).toBe(1);
    expect(d.nextSeq()).toBe(2);
    const again = loadDevice(store)!;
    expect(again.identity.keyId).toBe(d.identity.keyId);
    expect(again.identity.name).toBe('Phone');
    expect(again.nextSeq()).toBe(3);
  });

  it('stores peers and uses them as a key lookup', () => {
    const store = memoryStore();
    const d = createDevice('Phone', 1, store);
    const mac = demoIdentity();
    const r = d.addPeer({ publicKey: mac.publicKey, name: 'Mac', level: 3 });
    expect(r.keyId).toBe(mac.keyId);
    const reloaded = loadDevice(store)!;
    expect(reloaded.peers().map((p) => p.name)).toEqual(['Mac']);
    expect(Array.from(reloaded.keys.get(mac.keyId)!)).toEqual(Array.from(mac.publicKey));
  });
});

describe('QR images decode back to the same text', () => {
  async function throughQr(text: string): Promise<string> {
    const { default: encodeQR } = await import('qr');
    const { decodeQR } = await import('qr/decode.js');
    const m = encodeQR(text, 'raw', { ecc: 'medium', border: 2 });
    const scale = 4;
    const size = m.length * scale;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = m[Math.floor(y / scale)]![Math.floor(x / scale)] ? 0 : 255;
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return decodeQR({ width: size, height: size, data });
  }

  it('a resident card', async () => {
    const text = encodeCard({ publicKey: demoIdentity().publicKey, name: 'Phone', level: 1 });
    expect(await throughQr(text)).toBe(text);
  });

  it('every bundle frame of 20 notes', async () => {
    const id = demoIdentity();
    const notes = Array.from({ length: 20 }, (_, i) =>
      signNote({ seq: i + 1, time: NOW, body: { kind: 'text', text: 'y'.repeat(NOTE_MAX_PAYLOAD_BYTES) } }, id).bytes,
    );
    const enc = await createBundleEncoder(notes);
    for (let i = 0; i < 6; i++) {
      const f = enc.nextFrame();
      expect(await throughQr(f)).toBe(f);
    }
  });
});
