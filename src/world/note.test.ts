import { describe, expect, it } from 'vitest';
import {
  MAX_CLOCK_SKEW_S,
  MAX_NOTE_AGE_S,
  NOTE_HEADER_BYTES,
  NOTE_MAX_BYTES,
  NOTE_MAX_PAYLOAD_BYTES,
  NOTE_SIGNATURE_BYTES,
  NoteFormatError,
  PROBLEMS,
  REPLAY_WINDOW,
  SICK_MAX_TAGS,
  SURFACE_MAX_READINGS,
  caseTagOf,
  createIdentity,
  createReplayGuard,
  decodeNote,
  familyTagOf,
  noteRef,
  noteSize,
  receiveNote,
  signNote,
  verifyNote,
  type Identity,
  type NoteBody,
} from './index';

const NOW = 1_800_000_000;

function seededIdentity(byte: number, name = 'Ana', level = 11): Identity {
  return createIdentity({ name, level, secretKey: new Uint8Array(32).fill(byte) });
}

const ana = seededIdentity(1);
const ben = seededIdentity(2, 'Ben', 3);
const keys = new Map([
  [ana.keyId, ana.publicKey],
  [ben.keyId, ben.publicKey],
]);

/** The largest legal body of every kind. */
const maxBodies: NoteBody[] = [
  { kind: 'text', text: 'x'.repeat(NOTE_MAX_PAYLOAD_BYTES) },
  { kind: 'power', level: 255, zone: 255, event: 'flicker', durationS: 65535 },
  { kind: 'family', familyTag: familyTagOf(new Uint8Array(32).fill(9)), sealed: new Uint8Array(55).fill(7) },
  { kind: 'water', level: 12, tap: 65535, result: 'bad' },
  { kind: 'sick', level: 12, source: 'clinic', caseTags: Array.from({ length: SICK_MAX_TAGS }, () => caseTagOf(ana.keyId)) },
  {
    kind: 'surface',
    probe: 65535,
    readings: Array.from({ length: SURFACE_MAX_READINGS }, (_, i) => ({ metric: 'co2' as const, value: -1234.567 + i })),
  },
  { kind: 'witness', ref: 'ab'.repeat(16) },
  { kind: 'commit', topic: 'lottery-seed', value: new Uint8Array(32).fill(3) },
];

describe('size budget', () => {
  it('splits 140 bytes into 17 header, 59 content, 64 signature', () => {
    expect(NOTE_HEADER_BYTES + NOTE_MAX_PAYLOAD_BYTES + NOTE_SIGNATURE_BYTES).toBe(NOTE_MAX_BYTES);
    expect(NOTE_MAX_BYTES).toBe(140);
  });

  it.each(maxBodies.map((b) => [b.kind, b] as const))('largest %s note fits in 140 bytes', (_, body) => {
    const note = signNote({ seq: 1, time: NOW, body }, ana);
    expect(note.bytes.length).toBeLessThanOrEqual(NOTE_MAX_BYTES);
    expect(note.bytes.length).toBe(noteSize(body));
  });

  it('a full text note is exactly 140 bytes', () => {
    expect(signNote({ seq: 1, time: NOW, body: maxBodies[0]! }, ana).bytes.length).toBe(140);
  });

  it('refuses content one byte over budget', () => {
    expect(() => signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'x'.repeat(60) } }, ana)).toThrow(NoteFormatError);
    expect(() => decodeNote(new Uint8Array(141))).toThrow(NoteFormatError);
  });

  it('counts multi-byte characters as bytes, not letters', () => {
    expect(() => signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'é'.repeat(30) } }, ana)).toThrow(NoteFormatError);
  });

  it('refuses out-of-range fields', () => {
    const bad: NoteBody[] = [
      { kind: 'power', level: 256, zone: 0, event: 'ok', durationS: 0 },
      { kind: 'water', level: 1, tap: 1.5, result: 'ok' },
      { kind: 'sick', level: 1, source: 'self', caseTags: [] },
      { kind: 'witness', ref: 'AB'.repeat(16) },
      { kind: 'commit', topic: 'fair-split', value: new Uint8Array(31) },
    ];
    for (const body of bad) expect(() => signNote({ seq: 1, time: NOW, body }, ana)).toThrow(NoteFormatError);
    expect(() => signNote({ seq: -1, time: NOW, body: maxBodies[1]! }, ana)).toThrow(NoteFormatError);
  });
});

describe('sign and verify', () => {
  it.each(maxBodies.map((b) => [b.kind, b] as const))('%s round trips through the wire', (_, body) => {
    const sent = signNote({ seq: 7, time: NOW, body }, ana);
    const got = receiveNote(sent.bytes, keys, createReplayGuard(), NOW);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.note.author).toBe(ana.keyId);
    expect(got.note.seq).toBe(7);
    expect(got.note.time).toBe(NOW);
    expect(got.note.id).toBe(sent.id);
    expect(got.note.body).toEqual(sent.body);
  });

  it('keeps surface readings to the thousandth', () => {
    const note = signNote({ seq: 1, time: NOW, body: { kind: 'surface', probe: 4, readings: [{ metric: 'o2', value: 20.9461 }] } }, ana);
    expect(note.body.readings[0]!.value).toBe(20.946);
  });

  it('signing is deterministic, so the same note has the same ID', () => {
    const a = signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'safe' } }, ana);
    const b = signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'safe' } }, ana);
    expect(a.id).toBe(b.id);
    expect(noteRef(a.id)).toHaveLength(32);
  });

  it('seeded identities are repeatable and distinct', () => {
    expect(seededIdentity(1).keyId).toBe(ana.keyId);
    expect(ana.keyId).not.toBe(ben.keyId);
    expect(ana.keyId).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('tampering', () => {
  const note = signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'Level 9 has power until 18:00' } }, ana);

  it('any single flipped bit, anywhere in the note, is caught', () => {
    for (let i = 0; i < note.bytes.length; i++) {
      for (const bit of [0x01, 0x80]) {
        const forged = note.bytes.slice();
        forged[i]! ^= bit;
        const got = receiveNote(forged, keys, createReplayGuard(), NOW);
        expect(got.ok, `byte ${i} bit ${bit}`).toBe(false);
      }
    }
  });

  it('a note claiming to be from Ana but signed by Ben fails', () => {
    const fromBen = signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'hi' } }, ben);
    const forged = fromBen.bytes.slice();
    forged.set(ana.keyId.match(/../g)!.map((h) => parseInt(h, 16)), 1);
    const got = receiveNote(forged, keys, createReplayGuard(), NOW);
    expect(got).toMatchObject({ ok: false, reason: 'bad-signature' });
  });

  it('a key that does not match the author ID is refused', () => {
    expect(verifyNote(note, ben.publicKey)).toBe(false);
    expect(verifyNote(note, ana.publicKey)).toBe(true);
  });

  it('a stranger is refused', () => {
    const stranger = seededIdentity(3);
    const got = receiveNote(signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'hi' } }, stranger).bytes, keys, createReplayGuard(), NOW);
    expect(got).toMatchObject({ ok: false, reason: 'unknown-key' });
  });

  it('a truncated note is malformed', () => {
    expect(receiveNote(note.bytes.slice(0, 80), keys, createReplayGuard(), NOW)).toMatchObject({ ok: false, reason: 'malformed' });
  });
});

describe('duplicates and replays', () => {
  const text = (seq: number, t = 'hi', time = NOW) => signNote({ seq, time, body: { kind: 'text', text: t } }, ana);

  it('the same note twice is a duplicate', () => {
    const guard = createReplayGuard();
    const n = text(1);
    expect(receiveNote(n.bytes, keys, guard, NOW).ok).toBe(true);
    expect(receiveNote(n.bytes, keys, guard, NOW)).toMatchObject({ ok: false, reason: 'duplicate' });
  });

  it('a different note with a used seq is refused', () => {
    const guard = createReplayGuard();
    expect(receiveNote(text(5, 'first').bytes, keys, guard, NOW).ok).toBe(true);
    expect(receiveNote(text(5, 'second').bytes, keys, guard, NOW)).toMatchObject({ ok: false, reason: 'seq-reused' });
  });

  it('notes may arrive out of order inside the window', () => {
    const guard = createReplayGuard();
    for (const seq of [10, 3, 7, 1]) expect(receiveNote(text(seq).bytes, keys, guard, NOW).ok).toBe(true);
  });

  it('an old note played back after the window has moved on is a replay', () => {
    const guard = createReplayGuard();
    const old = text(1);
    expect(receiveNote(old.bytes, keys, guard, NOW).ok).toBe(true);
    expect(receiveNote(text(1 + REPLAY_WINDOW).bytes, keys, guard, NOW).ok).toBe(true);
    expect(receiveNote(old.bytes, keys, guard, NOW)).toMatchObject({ ok: false, reason: 'replay' });
    expect(receiveNote(text(2).bytes, keys, guard, NOW).ok).toBe(true);
  });

  it('a week-old note is stale and a note from the future is refused', () => {
    const guard = createReplayGuard();
    expect(receiveNote(text(1, 'hi', NOW - MAX_NOTE_AGE_S - 1).bytes, keys, guard, NOW)).toMatchObject({ ok: false, reason: 'stale' });
    expect(receiveNote(text(2, 'hi', NOW + MAX_CLOCK_SKEW_S + 1).bytes, keys, guard, NOW)).toMatchObject({ ok: false, reason: 'future' });
    expect(receiveNote(text(3, 'hi', NOW - MAX_NOTE_AGE_S).bytes, keys, guard, NOW).ok).toBe(true);
  });

  it('each author has their own counter', () => {
    const guard = createReplayGuard();
    expect(receiveNote(text(1).bytes, keys, guard, NOW).ok).toBe(true);
    expect(receiveNote(signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'hi' } }, ben).bytes, keys, guard, NOW).ok).toBe(true);
  });
});

describe('problems', () => {
  it('claims 7 problems fully and 14 partially', () => {
    expect(PROBLEMS.map((p) => p.id).sort((a, b) => a - b)).toEqual([1, 2, 4, 7, 8, 9, 13, 14]);
    expect(PROBLEMS.filter((p) => p.status === 'partial').map((p) => p.id)).toEqual([14]);
    expect(new Set(PROBLEMS.map((p) => p.proof.metric)).size).toBe(PROBLEMS.length);
  });

  it('has no em or en dashes', () => {
    expect(JSON.stringify(PROBLEMS)).not.toMatch(new RegExp('[\\u2013\\u2014]'));
  });
});
