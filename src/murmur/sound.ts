// Data over sound with ggwave. Two layers:
//   1. Pure framing (works in Node, tested): turn a note into one or more sound messages and back.
//   2. A browser engine: play a message through the speaker, listen through the microphone.
//
// Finding from the Node test: ggwave's JS encode() accepts a Uint8Array and decode() returns a Uint8Array,
// so raw binary survives the round trip ('binary' mode, one sound message of up to 140 bytes). The 'base64'
// mode is a fallback in case a device mangles binary: the note is base64 text split across two messages.
import type { GgwaveApi } from 'ggwave';

export type SoundProtocol = 'normal' | 'fast' | 'fastest';
export type SoundMode = 'binary' | 'base64';

export const SOUND_MAX_MESSAGE_BYTES = 140;
const BASE64_CHUNK_CHARS = 100;
const FALLBACK_MARK = 0x7e; // '~'. Real notes start 0x11..0x18, so the two never collide.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------- framing

/**
 * Turn bytes into the sound messages to send. 'binary': the bytes as they are (one message).
 * 'base64': text messages `~<part>/<total>.<id>:<chunk>`, each at most 140 bytes.
 */
export function frameForSound(bytes: Uint8Array, mode: SoundMode, id = randomId()): Uint8Array[] {
  if (mode === 'binary') {
    if (bytes.length < 1 || bytes.length > SOUND_MAX_MESSAGE_BYTES) throw new Error('message must be 1..140 bytes');
    return [bytes.slice()];
  }
  const text = toBase64(bytes);
  const total = Math.ceil(text.length / BASE64_CHUNK_CHARS);
  const frames: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = text.slice(i * BASE64_CHUNK_CHARS, (i + 1) * BASE64_CHUNK_CHARS);
    frames.push(enc.encode(`~${i + 1}/${total}.${id}:${chunk}`));
  }
  return frames;
}

function randomId(): string {
  return Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
}

export interface Reassembled {
  bytes: Uint8Array;
  mode: SoundMode;
}

/** Feeds on decoded sound messages, returns whole payloads. Handles both modes, in any part order. */
export class SoundReassembler {
  private parts = new Map<string, { total: number; got: Map<number, string> }>();

  /** Returns the payload when one is complete, otherwise null. */
  push(message: Uint8Array): Reassembled | null {
    if (message.length === 0) return null;
    if (message[0] !== FALLBACK_MARK) return { bytes: message.slice(), mode: 'binary' };
    let text: string;
    try {
      text = dec.decode(message);
    } catch {
      return null;
    }
    const m = /^~(\d+)\/(\d+)\.([0-9a-f]{2}):(.*)$/s.exec(text);
    if (!m) return null;
    const part = Number(m[1]);
    const total = Number(m[2]);
    const id = m[3]!;
    if (part < 1 || total < 1 || total > 16 || part > total) return null;
    let entry = this.parts.get(id);
    if (!entry || entry.total !== total) {
      entry = { total, got: new Map() };
      this.parts.set(id, entry);
    }
    entry.got.set(part, m[4]!);
    if (entry.got.size < total) return null;
    this.parts.delete(id);
    let joined = '';
    for (let i = 1; i <= total; i++) joined += entry.got.get(i)!;
    try {
      return { bytes: fromBase64(joined), mode: 'base64' };
    } catch {
      return null;
    }
  }

  /** How many fallback parts are waiting for their other half. */
  pending(): number {
    return this.parts.size;
  }
}

// ---------------------------------------------------------------- ggwave (works in Node and browsers)

export async function loadGgwave(): Promise<GgwaveApi> {
  const mod = (await import('ggwave')) as unknown as { default?: unknown };
  // The package is CommonJS: depending on the bundler the factory is the module or its default export.
  const factory = (typeof mod.default === 'function' ? mod.default : mod) as () => Promise<GgwaveApi>;
  const gg = await factory();
  gg.disableLog?.();
  return gg;
}

export interface SoundEngine {
  gg: GgwaveApi;
  instance: number;
  sampleRate: number;
  protocols: Record<SoundProtocol, number>;
}

export function createEngine(gg: GgwaveApi, sampleRate: number): SoundEngine {
  const p = gg.getDefaultParameters();
  p.sampleRateInp = sampleRate;
  p.sampleRateOut = sampleRate;
  p.soundMarkerThreshold = 4; // same as ggwave's own browser example
  return {
    gg,
    instance: gg.init(p),
    sampleRate,
    protocols: {
      normal: gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_NORMAL!,
      fast: gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST!,
      fastest: gg.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FASTEST!,
    },
  };
}

function asInt8(f: Float32Array): Int8Array {
  return new Int8Array(f.buffer, f.byteOffset, f.byteLength);
}

/** Audio samples for one sound message. Volume is ggwave's 0..100 scale. */
export function encodeWaveform(engine: SoundEngine, data: Uint8Array, protocol: SoundProtocol, volume = 50): Float32Array {
  const raw = engine.gg.encode(engine.instance, data, engine.protocols[protocol], volume);
  const copy = new Uint8Array(raw.length); // the module reuses its buffer, so copy before anything else runs
  copy.set(new Uint8Array(raw.buffer, raw.byteOffset, raw.length));
  return new Float32Array(copy.buffer);
}

/** Feed one chunk of microphone samples (any length). Returns decoded bytes or null. */
export function decodeChunk(engine: SoundEngine, samples: Float32Array): Uint8Array | null {
  const copy = new Float32Array(samples.length);
  copy.set(samples);
  const out = engine.gg.decode(engine.instance, asInt8(copy));
  return out && out.length > 0 ? Uint8Array.from(out) : null;
}

// ---------------------------------------------------------------- browser audio

type AudioCtor = typeof AudioContext;

export interface LiveEngine {
  engine: SoundEngine;
  ctx: AudioContext;
}

/**
 * Call straight from a tap handler. The AudioContext is created and resumed before the first `await`,
 * because iOS Safari only unlocks audio inside the tap itself. Then ggwave loads.
 */
export function startLiveEngine(): Promise<LiveEngine> {
  const AC: AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioCtor }).webkitAudioContext;
  let ctx: AudioContext;
  try {
    ctx = new AC({ sampleRate: 48000 });
  } catch {
    ctx = new AC(); // some Safari versions refuse a fixed rate; ggwave resamples from whatever we get
  }
  const resumed = ctx.resume();
  try {
    // A silent blip finishes the iOS unlock.
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    blip.connect(ctx.destination);
    blip.start(0);
  } catch {
    /* not fatal */
  }
  return (async () => {
    const [gg] = await Promise.all([loadGgwave(), resumed]);
    return { engine: createEngine(gg, ctx.sampleRate), ctx };
  })();
}

/** Plays one message. `ended` resolves when the sound has finished. */
export function playMessage(
  live: LiveEngine,
  data: Uint8Array,
  protocol: SoundProtocol,
): { durationS: number; ended: Promise<void> } {
  const wave = encodeWaveform(live.engine, data, protocol);
  const buffer = live.ctx.createBuffer(1, wave.length, live.ctx.sampleRate);
  buffer.getChannelData(0).set(wave);
  const source = live.ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(live.ctx.destination);
  const ended = new Promise<void>((resolve) => {
    source.onended = () => resolve();
  });
  source.start(0);
  return { durationS: wave.length / live.ctx.sampleRate, ended };
}

export interface HeardMessage {
  bytes: Uint8Array;
  /** performance.now() when the current run of sound began (best guess), and when the message decoded. */
  onsetMs: number;
  decodedMs: number;
}

export interface Listener {
  stop(): void;
}

const LOUD_RMS = 0.01;
const QUIET_GAP_MS = 1500;

/** Opens the microphone with ggwave's own constraints (all processing off) and decodes what it hears. */
export async function startListening(live: LiveEngine, onMessage: (m: HeardMessage) => void): Promise<Listener> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: false },
  });
  const source = live.ctx.createMediaStreamSource(stream);
  const processor = live.ctx.createScriptProcessor(1024, 1, 1);
  let lastLoud = -Infinity;
  let onset = 0;
  processor.onaudioprocess = (e) => {
    const samples = e.inputBuffer.getChannelData(0);
    const now = performance.now();
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
    if (Math.sqrt(sum / samples.length) > LOUD_RMS) {
      if (now - lastLoud > QUIET_GAP_MS) onset = now;
      lastLoud = now;
    }
    const bytes = decodeChunk(live.engine, samples);
    if (bytes) onMessage({ bytes, onsetMs: onset || now, decodedMs: now });
  };
  source.connect(processor);
  processor.connect(live.ctx.destination); // Chrome only runs the processor when it is connected
  return {
    stop() {
      processor.onaudioprocess = null;
      processor.disconnect();
      source.disconnect();
      for (const t of stream.getTracks()) t.stop();
    },
  };
}
