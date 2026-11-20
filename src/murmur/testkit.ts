// Shared helpers for the murmur tests: in-memory storage, throwaway residents, quick signed notes.
import { createNoteStore } from './store';
import { signNote } from '../world';
import type { VerifiedNote } from '../world';
import { createDevice } from './device';
import type { Device, KeyValueStore } from './device';

export const NOW = 1_800_000_000;

export function memoryKv(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

export function resident(name: string, level = 1) {
  const kv = memoryKv();
  const device = createDevice(name, level, kv);
  return { kv, device, store: createNoteStore(device, kv, () => NOW) };
}

export function pair(a: Device, b: Device) {
  a.addPeer({ publicKey: b.identity.publicKey, name: b.identity.name, level: b.identity.level });
  b.addPeer({ publicKey: a.identity.publicKey, name: a.identity.name, level: a.identity.level });
}

export function text(d: Device, t: string, time = NOW): VerifiedNote {
  return signNote({ seq: d.nextSeq(), time, body: { kind: 'text', text: t } }, d.identity);
}

