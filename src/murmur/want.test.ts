import { describe, expect, it } from 'vitest';
import {
  WANT_MARK,
  WANT_MAX_TAGS,
  createCounterpart,
  decodeWant,
  encodeWant,
  familyTagOfBytes,
  handleSound,
  planOffer,
} from './forward';
import { makeFamily, writeFamilyNote } from './family';
import { SOUND_MAX_MESSAGE_BYTES } from './sound';
import { NOW, pair, resident, text } from './testkit';

describe('WANT message (ask for my family)', () => {
  it('round trips family tags in one sound message', () => {
    const tags = [makeFamily('Ana').tag, makeFamily('Ben').tag];
    const bytes = encodeWant(tags);
    expect(bytes[0]).toBe(WANT_MARK);
    expect(decodeWant(bytes)).toEqual(tags);
  });

  it('fits 34 tags in 140 bytes and ignores bytes that are not a WANT message', () => {
    expect(WANT_MAX_TAGS).toBe(34);
    const many = Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(8, '0'));
    expect(encodeWant(many).length).toBeLessThanOrEqual(SOUND_MAX_MESSAGE_BYTES);
    expect(decodeWant(new Uint8Array([0x7d, 1, 2, 3, 4]))).toBeNull();
    expect(decodeWant(new Uint8Array([WANT_MARK, 1, 2, 3]))).toBeNull();
  });

  it('reads the family tag straight from a family note, and nothing from other notes', async () => {
    const a = resident('A');
    const fam = makeFamily('Ana');
    const note = await writeFamilyNote(a.device, fam, { condition: 'safe', level: 11, message: '' }, NOW);
    expect(familyTagOfBytes(note.bytes)).toBe(fam.tag);
    expect(familyTagOfBytes(text(a.device, 'hello', NOW).bytes)).toBeNull();
  });

  it('a carrier sends the asked-for family note first, ahead of newer notes', async () => {
    const carrier = resident('Carrier');
    const writer = resident('Ana', 11);
    pair(carrier.device, writer.device);
    const fam = makeFamily('Ana');
    const safe = await writeFamilyNote(writer.device, fam, { condition: 'safe', level: 11, message: '' }, NOW);
    carrier.store.receive(safe.bytes);
    for (let i = 1; i <= 50; i++) carrier.store.receive(text(carrier.device, `news ${i}`, NOW + i).bytes);

    const who = createCounterpart();
    expect(planOffer(carrier.store, who).items[0]!.id).not.toBe(safe.id); // newest first by default

    const heard = handleSound(carrier.store, who, encodeWant([fam.tag]));
    expect(heard).toEqual({ kind: 'want', tags: [fam.tag] });
    expect(planOffer(carrier.store, who).items[0]!.id).toBe(safe.id);
  });

  it('forgets what was asked for when starting over with someone new', () => {
    const who = createCounterpart();
    who.learnWant(['01020304']);
    expect(who.wants('01020304')).toBe(true);
    who.reset();
    expect(who.wants('01020304')).toBe(false);
  });
});
