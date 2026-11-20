import { describe, expect, it } from 'vitest';
import { NOTE_MAX_BYTES } from '../world';
import { createBundleDecoder, createBundleEncoder } from './bundle';
import {
  BUNDLE_MAX_NOTES,
  HAVE_MARK,
  HAVE_MAX_IDS,
  bundleOf,
  createCounterpart,
  decodeHave,
  encodeHave,
  handleSound,
  haveIds,
  ingest,
  planOffer,
  shortIdOf,
} from './forward';
import { SOUND_MAX_MESSAGE_BYTES, SoundReassembler, frameForSound } from './sound';
import { NOW, pair, resident, text } from './testkit';

/** A pair of paired residents; A has written `count` notes into its own store. */
function twoWithNotes(count: number) {
  const a = resident('A');
  const b = resident('B');
  pair(a.device, b.device);
  const notes = Array.from({ length: count }, (_, i) => text(a.device, `note ${i + 1}`, NOW + i));
  for (const n of notes) a.store.receive(n.bytes);
  return { a, b, notes };
}

describe('HAVE message', () => {
  it('round trips short IDs and fits one sound message', () => {
    const { a, notes } = twoWithNotes(5);
    const bytes = encodeHave(haveIds(a.store));
    expect(bytes[0]).toBe(HAVE_MARK);
    expect(bytes.length).toBe(1 + 5 * 4);
    expect(decodeHave(bytes)).toEqual([...notes].reverse().map((n) => shortIdOf(n.id))); // newest first
  });

  it('caps at 34 IDs and never exceeds 140 bytes', () => {
    const a = resident('A');
    const ids = Array.from({ length: 100 }, (_, i) => text(a.device, `n${i}`).id);
    const bytes = encodeHave(ids);
    expect(HAVE_MAX_IDS).toBe(34);
    expect(bytes.length).toBe(1 + 34 * 4);
    expect(bytes.length).toBeLessThanOrEqual(SOUND_MAX_MESSAGE_BYTES);
    expect(decodeHave(bytes)).toHaveLength(34);
  });

  it('an empty HAVE means "I hold nothing"; anything else is not a HAVE', () => {
    expect(decodeHave(encodeHave([]))).toEqual([]);
    expect(decodeHave(new Uint8Array([HAVE_MARK, 1, 2, 3]))).toBeNull(); // not a multiple of 4
    expect(decodeHave(new Uint8Array([0x11, 1, 2, 3, 4]))).toBeNull();
    expect(decodeHave(new Uint8Array(0))).toBeNull();
  });

  it('cannot be mistaken for a note or a base64 fallback part', () => {
    expect(HAVE_MARK).not.toBe(0x7e);
    for (let kind = 1; kind <= 8; kind++) expect(((1 << 4) | kind) === HAVE_MARK).toBe(false);
  });
});

describe('what the other side lacks', () => {
  it('offers nothing when there is nothing, one note by sound, several by QR', () => {
    const { a, b } = twoWithNotes(0);
    const who = createCounterpart();
    expect(planOffer(a.store, who).recommended).toBe('none');
    const n1 = text(a.device, 'one');
    a.store.receive(n1.bytes);
    expect(planOffer(a.store, who).recommended).toBe('sound');
    a.store.receive(text(a.device, 'two').bytes);
    expect(planOffer(a.store, who).recommended).toBe('qr');
    expect(planOffer(b.store, who).recommended).toBe('none');
  });

  it('lists the newest first', () => {
    const { a, notes } = twoWithNotes(4);
    const offer = planOffer(a.store, createCounterpart());
    expect(offer.items.map((i) => i.id)).toEqual([...notes].reverse().map((n) => n.id));
  });

  it('leaves out what they told us they hold (HAVE)', () => {
    const { a, notes } = twoWithNotes(4);
    const who = createCounterpart();
    who.learnHave([shortIdOf(notes[3]!.id), shortIdOf(notes[1]!.id)]);
    expect(planOffer(a.store, who).items.map((i) => i.id)).toEqual([notes[2]!.id, notes[0]!.id]);
  });

  it('leaves out the notes they wrote themselves, once we know who they are', () => {
    const { a, b } = twoWithNotes(2);
    const theirs = text(b.device, 'from b');
    a.store.receive(theirs.bytes);
    const who = createCounterpart();
    expect(planOffer(a.store, who).items).toHaveLength(3);
    who.setResident(b.device.identity.keyId);
    const items = planOffer(a.store, who).items;
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.id === theirs.id)).toBe(false);
  });

  it('remembers what was offered so the next tap sends the next batch, until forgotten', () => {
    const { a } = twoWithNotes(3);
    const who = createCounterpart();
    const first = planOffer(a.store, who);
    who.markOffered([first.items[0]!.id]);
    expect(planOffer(a.store, who).items).toHaveLength(2);
    who.markOffered(planOffer(a.store, who).items.map((i) => i.id));
    expect(planOffer(a.store, who).recommended).toBe('none');
    who.forgetOffered();
    expect(planOffer(a.store, who).items).toHaveLength(3);
    who.reset();
    expect(who.stats()).toEqual({ confirmed: 0, offered: 0 });
  });

  it('caps one QR bundle at 40 notes and leaves the rest for the next round', () => {
    const { a } = twoWithNotes(45);
    const who = createCounterpart();
    const batch = bundleOf(planOffer(a.store, who));
    expect(batch).toHaveLength(BUNDLE_MAX_NOTES);
    who.markOffered(batch.map((i) => i.id));
    expect(planOffer(a.store, who).items).toHaveLength(5);
  });
});

describe('store and forward between two devices', () => {
  it('a bundle of many notes crosses by animated QR and lands in the other notebook, verified', async () => {
    const { a, b, notes } = twoWithNotes(12);
    const who = createCounterpart();
    const batch = bundleOf(planOffer(a.store, who));
    const enc = await createBundleEncoder(batch.map((i) => i.bytes));
    const dec = await createBundleDecoder();
    for (let i = 0; i < 400 && !dec.isComplete(); i++) dec.receive(enc.nextFrame());
    expect(dec.isComplete()).toBe(true);
    const mine = createCounterpart(); // B's view of A
    const summary = ingest(b.store, mine, dec.result(), NOW + 100);
    expect(summary.added).toHaveLength(12);
    expect(summary.duplicates).toBe(0);
    expect(summary.rejected).toEqual([]);
    expect(b.store.all().map((n) => n.id).sort()).toEqual(notes.map((n) => n.id).sort());
    // B now knows A holds all of them, so there is nothing to send back
    expect(planOffer(b.store, mine).recommended).toBe('none');
  });

  it('showing the same bundle again changes nothing and says nothing', async () => {
    const { a, b } = twoWithNotes(6);
    const items = bundleOf(planOffer(a.store, createCounterpart()));
    const bytes = items.map((i) => i.bytes);
    ingest(b.store, createCounterpart(), bytes, NOW + 10);
    const before = b.store.version();
    const again = ingest(b.store, createCounterpart(), bytes, NOW + 20);
    expect(again.added).toHaveLength(0);
    expect(again.duplicates).toBe(6);
    expect(again.rejected).toEqual([]);
    expect(b.store.version()).toBe(before);
  });

  it('a single note crosses by sound as raw binary and is verified on arrival', () => {
    const { a, b, notes } = twoWithNotes(1);
    const item = planOffer(a.store, createCounterpart()).items[0]!;
    expect(item.bytes.length).toBeLessThanOrEqual(NOTE_MAX_BYTES);
    const frames = frameForSound(item.bytes, 'binary');
    expect(frames).toHaveLength(1);
    const heard = new SoundReassembler().push(frames[0]!)!;
    const who = createCounterpart();
    const r = handleSound(b.store, who, heard.bytes, NOW + 5);
    expect(r).toMatchObject({ kind: 'note', outcome: { kind: 'added' } });
    expect(b.store.has(notes[0]!.id)).toBe(true);
    // the same sound heard twice (a second room, an echo) is dropped quietly
    expect(handleSound(b.store, who, heard.bytes, NOW + 6)).toEqual({ kind: 'note', outcome: { kind: 'duplicate', id: notes[0]!.id } });
  });

  it('a full 140 byte note survives sound framing and verification', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const full = text(a.device, 'x'.repeat(59));
    expect(full.bytes.length).toBe(NOTE_MAX_BYTES);
    const heard = new SoundReassembler().push(frameForSound(full.bytes, 'binary')[0]!)!;
    expect(handleSound(b.store, createCounterpart(), heard.bytes, NOW).kind).toBe('note');
    expect(b.store.has(full.id)).toBe(true);
  });

  it('a HAVE heard by sound tells the sender what to leave out', () => {
    const { a, b, notes } = twoWithNotes(3);
    // B already holds A's oldest note (earlier hand-off), then tells A by sound
    b.store.receive(notes[0]!.bytes, NOW + 50);
    const haveMsg = new SoundReassembler().push(frameForSound(encodeHave(haveIds(b.store)), 'binary')[0]!)!;
    const who = createCounterpart(); // A's view of B
    expect(handleSound(a.store, who, haveMsg.bytes)).toMatchObject({ kind: 'have', shortIds: [shortIdOf(notes[0]!.id)] });
    expect(planOffer(a.store, who).items.map((i) => i.id)).toEqual([notes[2]!.id, notes[1]!.id]);
  });

  it('rejects a forged note arriving by sound or QR and does not teach the sender anything', () => {
    const { a, b } = twoWithNotes(1);
    const bad = planOffer(a.store, createCounterpart()).items[0]!.bytes.slice();
    bad[bad.length - 5]! ^= 0x40;
    const who = createCounterpart();
    expect(handleSound(b.store, who, bad, NOW)).toMatchObject({ kind: 'note', outcome: { kind: 'rejected', reason: 'bad-signature' } });
    const s = ingest(b.store, who, [bad], NOW);
    expect(s.rejected).toEqual([{ reason: 'bad-signature', detail: undefined }]);
    expect(b.store.size()).toBe(0);
    expect(who.stats().confirmed).toBe(0);
  });

  it('ignores a damaged HAVE and an empty message', () => {
    const { b } = twoWithNotes(0);
    const who = createCounterpart();
    expect(handleSound(b.store, who, new Uint8Array([HAVE_MARK, 9, 9]))).toEqual({ kind: 'ignored' });
    expect(handleSound(b.store, who, new Uint8Array(0))).toEqual({ kind: 'ignored' });
  });
});

describe('relaying through someone who cannot check the notes', () => {
  it('A to B to C: B carries A\'s notes unchecked, C checks them, and B can check them later', () => {
    const a = resident('A');
    const b = resident('B');
    const c = resident('C');
    pair(a.device, c.device); // C knows A. B knows neither.
    const n1 = text(a.device, 'meet at the pump');
    const n2 = text(a.device, 'bring water');
    // A hands both to B by bundle. B cannot check them, so it parks them.
    const atB = ingest(b.store, createCounterpart(), [n1.bytes, n2.bytes], NOW);
    expect(atB.added).toHaveLength(0);
    expect(atB.parked).toBe(2);
    expect(b.store.size()).toBe(0);
    // B offers what it carries to C, marked as unverified on B's side.
    const offer = planOffer(b.store, createCounterpart());
    expect(offer.items).toHaveLength(2);
    expect(offer.items.every((i) => !i.verified)).toBe(true);
    // C checks them against A's key.
    const atC = ingest(c.store, createCounterpart(), offer.items.map((i) => i.bytes), NOW);
    expect(atC.added).toHaveLength(2);
    expect(c.store.all().every((n) => n.author === a.device.identity.keyId)).toBe(true);
    // Later B pairs with A and the carried notes are checked and promoted.
    b.device.addPeer({ publicKey: a.device.identity.publicKey, name: 'A', level: 1 });
    expect(b.store.retryParked(NOW)).toBe(2);
    expect(planOffer(b.store, createCounterpart()).items.every((i) => i.verified)).toBe(true);
  });

  it('a carried note that fails the check at the far end is rejected there', () => {
    const a = resident('A');
    const b = resident('B');
    const c = resident('C');
    pair(a.device, c.device);
    const n = text(a.device, 'real');
    const bad = n.bytes.slice();
    bad[25]! ^= 1;
    ingest(b.store, createCounterpart(), [bad], NOW);
    const offer = planOffer(b.store, createCounterpart());
    const atC = ingest(c.store, createCounterpart(), offer.items.map((i) => i.bytes), NOW);
    expect(atC.added).toHaveLength(0);
    expect(atC.rejected).toHaveLength(1);
    expect(c.store.size()).toBe(0);
  });
});
