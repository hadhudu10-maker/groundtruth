import { describe, expect, it } from 'vitest';
import { FAMILY_MAX_SEALED_BYTES, decodeNote, familyTagOf, signNote } from '../world';
import type { FamilyBody, FamilyKey } from '../world';
import {
  FAMILY_MESSAGE_MAX_BYTES,
  FAMILY_PLAIN_MAX_BYTES,
  FamilyCodeError,
  createFamilyBook,
  decodeFamilyCode,
  decodeFamilyPlain,
  encodeFamilyCode,
  encodeFamilyPlain,
  makeFamily,
  openFamily,
  readFamily,
  sealFamily,
  writeFamilyNote,
} from './family';
import { bundleOf, createCounterpart, ingest, planOffer } from './forward';
import { NOW, memoryKv, pair, resident } from './testkit';

const enc = new TextEncoder();

function family(name = 'Okafor'): FamilyKey {
  return makeFamily(name);
}

describe('family plaintext: status plus a short message, 27 bytes at most', () => {
  it('fits the frozen limit: 12 byte nonce + 16 byte tag + 27 byte plaintext = 55', () => {
    expect(FAMILY_PLAIN_MAX_BYTES).toBe(27);
    expect(12 + 16 + FAMILY_PLAIN_MAX_BYTES).toBe(FAMILY_MAX_SEALED_BYTES);
    expect(FAMILY_MESSAGE_MAX_BYTES).toBe(25);
  });

  it('round trips condition, level and message', () => {
    const plain = encodeFamilyPlain({ condition: 'hurt', level: 11, message: 'at the clinic' });
    expect(plain.length).toBe(2 + 'at the clinic'.length);
    expect(decodeFamilyPlain(plain)).toEqual({ condition: 'hurt', level: 11, message: 'at the clinic' });
  });

  it('cuts a long message to fit without splitting a character', () => {
    const long = 'Mamá, todo bien aquí abajo, ya voy';
    const plain = encodeFamilyPlain({ condition: 'safe', level: 3, message: long });
    expect(plain.length).toBeLessThanOrEqual(FAMILY_PLAIN_MAX_BYTES);
    const out = decodeFamilyPlain(plain)!;
    expect(long.startsWith(out.message)).toBe(true);
    expect(enc.encode(out.message).length).toBeLessThanOrEqual(FAMILY_MESSAGE_MAX_BYTES);
    // "é" style two-byte characters at the cut never leave half a character behind
    const emoji = '😀'.repeat(10); // 4 bytes each
    const e = decodeFamilyPlain(encodeFamilyPlain({ condition: 'safe', level: 1, message: emoji }))!;
    expect(e.message).toBe('😀'.repeat(6));
  });

  it('rejects an unknown condition code or broken UTF-8', () => {
    expect(decodeFamilyPlain(Uint8Array.from([9, 1]))).toBeNull();
    expect(decodeFamilyPlain(Uint8Array.from([0, 1, 0xff]))).toBeNull();
    expect(decodeFamilyPlain(Uint8Array.from([0]))).toBeNull();
  });
});

describe('sealing with AES-GCM and the family key', () => {
  const author = '0123456789abcdef';
  const STAMP = { seq: 7, time: NOW };

  it('seal then open gives the status back, and the sealed bytes fit the note', async () => {
    const fam = family();
    const sealed = await sealFamily(fam, author, { condition: 'safe', level: 11, message: 'with Ana' }, STAMP);
    expect(sealed.length).toBe(12 + 2 + 8 + 16);
    expect(sealed.length).toBeLessThanOrEqual(FAMILY_MAX_SEALED_BYTES);
    expect(await openFamily(fam, author, sealed, STAMP)).toEqual({ condition: 'safe', level: 11, message: 'with Ana' });
  });

  it('a full message still fits in 55 bytes', async () => {
    const sealed = await sealFamily(family(), author, { condition: 'moving', level: 200, message: 'x'.repeat(80) }, STAMP);
    expect(sealed.length).toBe(FAMILY_MAX_SEALED_BYTES);
  });

  it('uses a fresh nonce each time, so the same status never looks the same twice', async () => {
    const fam = family();
    const a = await sealFamily(fam, author, { condition: 'safe', level: 2, message: '' }, STAMP);
    const b = await sealFamily(fam, author, { condition: 'safe', level: 2, message: '' }, STAMP);
    expect(a).not.toEqual(b);
  });

  it('the wrong key cannot open it', async () => {
    const sealed = await sealFamily(family('A'), author, { condition: 'safe', level: 4, message: '' }, STAMP);
    expect(await openFamily(family('B'), author, sealed, STAMP)).toBeNull();
  });

  it('any changed byte (nonce, ciphertext or tag) makes it fail', async () => {
    const fam = family();
    const sealed = await sealFamily(fam, author, { condition: 'help', level: 7, message: 'water' }, STAMP);
    for (const i of [0, 11, 12, 14, sealed.length - 1]) {
      const bad = sealed.slice();
      bad[i]! ^= 0x01;
      expect(await openFamily(fam, author, bad, STAMP)).toBeNull();
    }
    expect(await openFamily(fam, author, sealed.slice(0, 20), STAMP)).toBeNull();
  });

  it('is bound to its author: the same sealed bytes under another key ID do not open', async () => {
    const fam = family();
    const sealed = await sealFamily(fam, author, { condition: 'safe', level: 5, message: '' }, STAMP);
    expect(await openFamily(fam, 'fedcba9876543210', sealed, STAMP)).toBeNull();
  });

  it('is bound to the note\'s seq and time: the same sealed bytes under a newer header do not open', async () => {
    const fam = family();
    const sealed = await sealFamily(fam, author, { condition: 'help', level: 5, message: '' }, STAMP);
    expect(await openFamily(fam, author, sealed, { seq: STAMP.seq, time: STAMP.time + 3600 })).toBeNull();
    expect(await openFamily(fam, author, sealed, { seq: STAMP.seq + 1, time: STAMP.time })).toBeNull();
  });
});

describe('family notes travel like any other note', () => {
  it('a relative opens the note; someone outside who knows only the tag cannot', async () => {
    const mum = resident('Mum', 3);
    const ana = resident('Ana', 11);
    const stranger = resident('Stranger', 6);
    pair(mum.device, ana.device);
    pair(mum.device, stranger.device);
    const fam = family();

    const note = await writeFamilyNote(ana.device, fam, { condition: 'safe', level: 11, message: '' }, NOW);
    expect(note.body.kind).toBe('family');
    expect((note.body as FamilyBody).familyTag).toBe(fam.tag);
    expect(mum.store.receive(note.bytes).kind).toBe('added');

    // The stranger saw the tag and tries to pass off a note for the family with their own key.
    const fake = new Uint8Array(40);
    const forged = signNote(
      { seq: stranger.device.nextSeq(), time: NOW + 60, body: { kind: 'family', familyTag: fam.tag, sealed: fake } },
      stranger.device.identity,
    );
    expect(mum.store.receive(forged.bytes).kind).toBe('added'); // a validly signed note, so it is kept and carried
    // ...and they copy Ana's sealed bytes into a note of their own.
    const copied = signNote(
      { seq: stranger.device.nextSeq(), time: NOW + 120, body: { ...(note.body as FamilyBody) } },
      stranger.device.identity,
    );
    mum.store.receive(copied.bytes);

    const board = await readFamily(fam, mum.store);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ author: ana.device.identity.keyId, condition: 'safe', level: 11, verified: true });

    // Without the key, the stranger reads nothing at all.
    stranger.store.receive(note.bytes);
    const wrong = { ...fam, key: makeFamily('guess').key };
    expect(await readFamily(wrong, stranger.store)).toEqual([]);
  });

  it('per relative the newest note by time wins, whatever order they arrive in', async () => {
    const mum = resident('Mum', 3);
    const ana = resident('Ana', 11);
    const ben = resident('Ben', 8);
    pair(mum.device, ana.device);
    pair(mum.device, ben.device);
    const fam = family();
    const older = await writeFamilyNote(ana.device, fam, { condition: 'hurt', level: 11, message: '' }, NOW - 3600);
    const newer = await writeFamilyNote(ana.device, fam, { condition: 'safe', level: 10, message: 'better' }, NOW - 60);
    const benNote = await writeFamilyNote(ben.device, fam, { condition: 'moving', level: 8, message: '' }, NOW - 600);
    mum.store.receive(newer.bytes);
    mum.store.receive(benNote.bytes);
    mum.store.receive(older.bytes); // arrives last, still loses

    const board = await readFamily(fam, mum.store);
    expect(board.map((r) => [r.author, r.condition, r.level])).toEqual([
      [ana.device.identity.keyId, 'safe', 10],
      [ben.device.identity.keyId, 'moving', 8],
    ]);
    expect(board[0]!.time).toBe(NOW - 60);
    expect(board[0]!.message).toBe('better');
  });

  it('a relay without the key carries it intact to a relative who opens it', async () => {
    const ana = resident('Ana', 11);
    const relay = resident('Relay', 7); // never paired with Ana, holds no family key
    const mum = resident('Mum', 3);
    pair(ana.device, mum.device);
    const fam = family();
    const note = await writeFamilyNote(ana.device, fam, { condition: 'safe', level: 11, message: 'love you' }, NOW);
    ana.store.receive(note.bytes);

    // Ana to relay by QR bundle.
    const toRelay = createCounterpart();
    ingest(relay.store, toRelay, bundleOf(planOffer(ana.store, createCounterpart())).map((i) => i.bytes));
    expect(relay.store.parked().map((p) => p.id)).toEqual([note.id]);

    // Relay to Mum.
    const items = bundleOf(planOffer(relay.store, createCounterpart()));
    expect(items).toHaveLength(1);
    expect(items[0]!.bytes).toEqual(note.bytes);
    expect(items[0]!.verified).toBe(false);
    const got = ingest(mum.store, createCounterpart(), items.map((i) => i.bytes));
    expect(got.added.map((n) => n.id)).toEqual([note.id]);

    const board = await readFamily(fam, mum.store);
    expect(board[0]).toMatchObject({ condition: 'safe', level: 11, message: 'love you', verified: true });
  });

  it('opens a relative note the device can only carry (author not paired), marked unchecked', async () => {
    const ana = resident('Ana', 11);
    const cousin = resident('Cousin', 5);
    const fam = family();
    const note = await writeFamilyNote(ana.device, fam, { condition: 'help', level: 11, message: '' }, NOW);
    expect(cousin.store.receive(note.bytes).kind).toBe('parked');
    const board = await readFamily(fam, cousin.store);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ condition: 'help', verified: false });
  });

  it('an old status re-wrapped with a newer time by someone without the key does not replace the real newest one', async () => {
    // Security review 2026-11-20: Mum has not paired with Ana, so she cannot check Ana's signature.
    // An outsider who overheard Ana's old "hurt" note copies its sealed bytes into a header that claims
    // Ana as author with a newer time and seq, and a junk signature.
    const ana = resident('Ana', 11);
    const mum = resident('Mum', 3);
    const fam = family();
    const old = await writeFamilyNote(ana.device, fam, { condition: 'hurt', level: 11, message: '' }, NOW - 7200);
    const now = await writeFamilyNote(ana.device, fam, { condition: 'safe', level: 10, message: '' }, NOW - 60);
    const forged = new Uint8Array(old.bytes);
    const view = new DataView(forged.buffer);
    view.setUint32(9, now.seq + 5); // seq
    view.setUint32(13, NOW); // time, newer than Ana's real newest note
    expect(mum.store.receive(old.bytes).kind).toBe('parked');
    expect(mum.store.receive(now.bytes).kind).toBe('parked');
    expect(mum.store.receive(forged).kind).toBe('parked');

    const board = await readFamily(fam, mum.store);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ condition: 'safe', level: 10, time: NOW - 60, verified: false });
  });

  it('the family note is a normal 140 byte note at most', async () => {
    const ana = resident('Ana', 11);
    const note = await writeFamilyNote(ana.device, family(), { condition: 'safe', level: 11, message: 'y'.repeat(40) }, NOW);
    expect(note.bytes.length).toBeLessThanOrEqual(140);
    expect(decodeNote(note.bytes).body.kind).toBe('family');
  });
});

describe('family code: the QR shown in person to join a family', () => {
  it('round trips the key, family name and the shower\'s card, in QR alphanumeric characters', () => {
    const ana = resident('Ana', 11);
    const fam = family('Okafor');
    const code = encodeFamilyCode(fam, { publicKey: ana.device.identity.publicKey, name: 'Ana', level: 11 });
    expect(code).toMatch(/^GTF1:[0-9A-F]+$/);
    const back = decodeFamilyCode(code);
    expect(back.family.key).toEqual(fam.key);
    expect(back.family.tag).toBe(familyTagOf(fam.key));
    expect(back.family.name).toBe('Okafor');
    expect(back.card).toEqual({ publicKey: ana.device.identity.publicKey, name: 'Ana', level: 11 });
  });

  it('rejects other codes and damaged ones', () => {
    expect(() => decodeFamilyCode('GT1:ABCD')).toThrow(FamilyCodeError);
    expect(() => decodeFamilyCode('GTF1:ABC')).toThrow(FamilyCodeError);
    expect(() => decodeFamilyCode('GTF1:' + '00'.repeat(20))).toThrow(FamilyCodeError);
  });
});

describe('family book: family keys kept with the device record', () => {
  it('stores families and members, and reads them back', () => {
    const kv = memoryKv();
    const book = createFamilyBook(kv);
    const fam = family('Okafor');
    book.add(fam);
    book.addMember(fam.tag, 'aaaaaaaaaaaaaaaa');
    book.addMember(fam.tag, 'aaaaaaaaaaaaaaaa');
    book.add({ ...fam, name: 'renamed' }); // joining twice keeps one record
    const again = createFamilyBook(kv);
    expect(again.families()).toHaveLength(1);
    expect(again.get(fam.tag)!.key).toEqual(fam.key);
    expect(again.get(fam.tag)!.name).toBe('Okafor');
    expect(again.get(fam.tag)!.members).toEqual(['aaaaaaaaaaaaaaaa']);
  });

  it('survives damaged storage', () => {
    const kv = memoryKv();
    kv.setItem('gt.device.families.v1', '{not json');
    expect(createFamilyBook(kv).families()).toEqual([]);
  });
});
