import { describe, expect, it } from 'vitest';
import { REPLAY_WINDOW, signNote } from '../world';
import { NOTES_KEY, PARKED_KEY, PARKED_MAX, createNoteStore } from './store';
import { NOW, pair, resident, text } from './testkit';

describe('note store: the only door is receiveNote', () => {
  it('accepts a note from a paired resident and holds it by NoteId', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const n = text(a.device, 'water is out on level 4');
    const out = b.store.receive(n.bytes);
    expect(out.kind).toBe('added');
    expect(b.store.size()).toBe(1);
    expect(b.store.has(n.id)).toBe(true);
    expect(b.store.get(n.id)?.body).toEqual({ kind: 'text', text: 'water is out on level 4' });
  });

  it('signs and keeps its own notes through the same door, and an echo is a duplicate', () => {
    const a = resident('A');
    const n = text(a.device, 'mine');
    expect(a.store.receive(n.bytes).kind).toBe('added');
    expect(a.store.receive(n.bytes).kind).toBe('duplicate');
    expect(a.store.size()).toBe(1);
  });

  it('drops a duplicate quietly: same outcome, no second copy, no change signal', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const n = text(a.device, 'once');
    b.store.receive(n.bytes);
    let signals = 0;
    b.store.subscribe(() => signals++);
    for (let i = 0; i < 5; i++) expect(b.store.receive(n.bytes)).toEqual({ kind: 'duplicate', id: n.id });
    expect(b.store.size()).toBe(1);
    expect(signals).toBe(0);
  });

  it('rejects a note with a damaged signature or body', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const n = text(a.device, 'real');
    const badSig = n.bytes.slice();
    badSig[badSig.length - 1]! ^= 1;
    expect(b.store.receive(badSig)).toMatchObject({ kind: 'rejected', reason: 'bad-signature' });
    const badBody = n.bytes.slice();
    badBody[20]! ^= 1;
    expect(b.store.receive(badBody)).toMatchObject({ kind: 'rejected', reason: 'bad-signature' });
    expect(b.store.size()).toBe(0);
  });

  it('rejects junk bytes as malformed without throwing', () => {
    const b = resident('B');
    expect(b.store.receive(new Uint8Array([1, 2, 3]))).toMatchObject({ kind: 'rejected', reason: 'malformed' });
    expect(b.store.receive(new Uint8Array(0))).toMatchObject({ kind: 'rejected', reason: 'malformed' });
    expect(b.store.receive(new Uint8Array(200).fill(0x11))).toMatchObject({ kind: 'rejected', reason: 'malformed' });
  });

  it('rejects a second, different note that reuses a seq, and keeps the first', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const first = signNote({ seq: 7, time: NOW, body: { kind: 'text', text: 'first' } }, a.device.identity);
    const forged = signNote({ seq: 7, time: NOW, body: { kind: 'text', text: 'second' } }, a.device.identity);
    expect(b.store.receive(first.bytes).kind).toBe('added');
    expect(b.store.receive(forged.bytes)).toMatchObject({ kind: 'rejected', reason: 'seq-reused' });
    expect(b.store.size()).toBe(1);
    expect(b.store.has(first.id)).toBe(true);
  });

  it('rejects a captured note played back long after the author moved on, but takes late arrivals inside the window', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const old = signNote({ seq: 1, time: NOW, body: { kind: 'text', text: 'old' } }, a.device.identity);
    const late = signNote({ seq: 500, time: NOW, body: { kind: 'text', text: 'late' } }, a.device.identity);
    const newer = signNote({ seq: 500 + REPLAY_WINDOW + 5, time: NOW, body: { kind: 'text', text: 'new' } }, a.device.identity);
    expect(b.store.receive(late.bytes).kind).toBe('added');
    expect(b.store.receive(newer.bytes).kind).toBe('added');
    expect(b.store.receive(old.bytes)).toMatchObject({ kind: 'rejected', reason: 'replay' });
    // seq 500 is inside the window of 1024 below the newest, so out of order is fine
    const inside = signNote({ seq: 600, time: NOW, body: { kind: 'text', text: 'inside' } }, a.device.identity);
    expect(b.store.receive(inside.bytes).kind).toBe('added');
  });

  it('rejects stale and future notes against the receiver clock', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const stale = text(a.device, 'ancient', NOW - 8 * 24 * 3600);
    const future = text(a.device, 'tomorrow', NOW + 2 * 3600);
    expect(b.store.receive(stale.bytes, NOW)).toMatchObject({ kind: 'rejected', reason: 'stale' });
    expect(b.store.receive(future.bytes, NOW)).toMatchObject({ kind: 'rejected', reason: 'future' });
  });

  it('accepts notes that arrive out of order', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const notes = [1, 2, 3, 4].map((i) => text(a.device, `n${i}`));
    for (const n of [notes[2]!, notes[0]!, notes[3]!, notes[1]!]) expect(b.store.receive(n.bytes).kind).toBe('added');
    expect(b.store.size()).toBe(4);
  });
});

describe('note store: parked notes from unknown authors', () => {
  it('parks an unverifiable note, never counts it as held, then verifies it after pairing', () => {
    const a = resident('A');
    const b = resident('B');
    const n = text(a.device, 'hello from a stranger');
    const out = b.store.receive(n.bytes);
    expect(out).toEqual({ kind: 'parked', id: n.id, author: a.device.identity.keyId, isNew: true });
    expect(b.store.size()).toBe(0);
    expect(b.store.parked()).toHaveLength(1);
    expect(b.store.receive(n.bytes)).toMatchObject({ kind: 'parked', isNew: false });
    expect(b.store.parked()).toHaveLength(1);

    b.device.addPeer({ publicKey: a.device.identity.publicKey, name: 'A', level: 1 });
    expect(b.store.retryParked()).toBe(1);
    expect(b.store.size()).toBe(1);
    expect(b.store.parked()).toHaveLength(0);
  });

  it('a parked note with a forged signature fails once the author is known', () => {
    const a = resident('A');
    const b = resident('B');
    const n = text(a.device, 'forged');
    const bad = n.bytes.slice();
    bad[30]! ^= 0xff;
    expect(b.store.receive(bad).kind).toBe('parked');
    b.device.addPeer({ publicKey: a.device.identity.publicKey, name: 'A', level: 1 });
    expect(b.store.retryParked()).toBe(0);
    expect(b.store.size()).toBe(0);
    expect(b.store.parked()).toHaveLength(0); // dropped, not kept forever
  });

  it('caps parked notes so junk cannot grow the store without limit', () => {
    const a = resident('A');
    const b = resident('B');
    for (let i = 0; i < PARKED_MAX + 20; i++) b.store.receive(text(a.device, `n${i}`).bytes);
    expect(b.store.parked()).toHaveLength(PARKED_MAX);
  });
});

describe('note store: kept on disk', () => {
  it('survives a restart, and a repeat after restart is still a duplicate', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const n1 = text(a.device, 'one');
    const n2 = text(a.device, 'two');
    b.store.receive(n1.bytes);
    b.store.receive(n2.bytes);
    const again = createNoteStore(b.device, b.kv, () => NOW);
    expect(again.all().map((n) => n.id)).toEqual([n1.id, n2.id]);
    expect(again.receive(n1.bytes).kind).toBe('duplicate');
  });

  it('keeps notes older than a week on reload (age rules apply to arrivals, not to our own disk)', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const n = text(a.device, 'kept', NOW - 3 * 24 * 3600);
    b.store.receive(n.bytes);
    const later = createNoteStore(b.device, b.kv, () => NOW + 30 * 24 * 3600);
    expect(later.size()).toBe(1);
  });

  it('checks notes again on load: a tampered or damaged disk entry is dropped', () => {
    const a = resident('A');
    const b = resident('B');
    pair(a.device, b.device);
    const good = text(a.device, 'good');
    const tampered = text(a.device, 'tampered');
    b.store.receive(good.bytes);
    b.store.receive(tampered.bytes);
    const list = JSON.parse(b.kv.data.get(NOTES_KEY)!) as string[];
    list[1] = list[1]!.slice(0, 40) + '00' + list[1]!.slice(42); // change a byte inside the signed part
    list.push('not hex at all', 'abcd');
    b.kv.data.set(NOTES_KEY, JSON.stringify(list));
    const again = createNoteStore(b.device, b.kv, () => NOW);
    expect(again.all().map((n) => n.id)).toEqual([good.id]);
  });

  it('survives garbage in storage', () => {
    const b = resident('B');
    b.kv.data.set(NOTES_KEY, '{"nope":true}');
    b.kv.data.set(PARKED_KEY, 'not json');
    expect(createNoteStore(b.device, b.kv, () => NOW).size()).toBe(0);
  });

  it('keeps parked notes across a restart and promotes them once the key is known', () => {
    const a = resident('A');
    const b = resident('B');
    b.store.receive(text(a.device, 'waiting').bytes);
    const again = createNoteStore(b.device, b.kv, () => NOW);
    expect(again.parked()).toHaveLength(1);
    b.device.addPeer({ publicKey: a.device.identity.publicKey, name: 'A', level: 1 });
    const third = createNoteStore(b.device, b.kv, () => NOW); // loads with the key present
    expect(third.size()).toBe(1);
    expect(third.parked()).toHaveLength(0);
  });

  it('works with no storage at all', () => {
    const a = resident('A');
    const store = createNoteStore(a.device, null, () => NOW);
    expect(store.receive(text(a.device, 'x').bytes).kind).toBe('added');
  });

  it('tells subscribers when the store changes', () => {
    const a = resident('A');
    let signals = 0;
    const off = a.store.subscribe(() => signals++);
    const v = a.store.version();
    a.store.receive(text(a.device, 'x').bytes);
    expect(signals).toBe(1);
    expect(a.store.version()).toBeGreaterThan(v);
    off();
    a.store.receive(text(a.device, 'y').bytes);
    expect(signals).toBe(1);
  });
});
