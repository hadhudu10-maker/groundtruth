// The Family tab on /#pass (problem 8). Make or join a family by QR in person, set your status, and see
// each relative's newest status. Family notes travel with every other note on the Notes tab: anyone carries
// them, only family can open them.
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { FamilyCondition, KeyIdHex } from '../world';
import type { Device } from './device';
import {
  FAMILY_MESSAGE_MAX_BYTES,
  FamilyCodeError,
  createFamilyBook,
  decodeFamilyCode,
  encodeFamilyCode,
  makeFamily,
  readFamily,
  writeFamilyNote,
} from './family';
import type { RelativeStatus } from './family';
import { QrScan } from './QrScan';
import { QrView } from './QrView';
import type { NoteStore } from './store';
import { btnPrimary, btnSecondary, card } from './styles';

const nowS = () => Math.floor(Date.now() / 1000);
const byteLength = (s: string) => new TextEncoder().encode(s).length;

export const CONDITION_LABEL: Record<FamilyCondition, string> = {
  safe: 'safe',
  help: 'needs help',
  hurt: 'hurt',
  moving: 'moving',
};
const CONDITION_BUTTON: { c: FamilyCondition; label: string; cls: string }[] = [
  { c: 'safe', label: 'Safe', cls: 'bg-emerald-700 active:bg-emerald-800' },
  { c: 'help', label: 'Need help', cls: 'bg-amber-700 active:bg-amber-800' },
  { c: 'hurt', label: 'Hurt', cls: 'bg-rose-700 active:bg-rose-800' },
  { c: 'moving', label: 'Moving', cls: 'bg-sky-700 active:bg-sky-800' },
];

/** "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  return `${d} days ago`;
}

/** "Ana: safe, level 11, 12 minutes ago" */
export function statusLine(name: string, r: Pick<RelativeStatus, 'condition' | 'level' | 'time'>, now: number): string {
  return `${name}: ${CONDITION_LABEL[r.condition]}, level ${r.level}, ${ago(now - r.time)}`;
}

export function FamilyTab({ device, store }: { device: Device; store: NoteStore }) {
  const book = useMemo(() => createFamilyBook(), []);
  const version = useSyncExternalStore(store.subscribe, store.version);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const families = book.families();
  const [tag, setTag] = useState<string>(() => families[0]?.tag ?? '');
  const fam = book.get(tag) ?? families[0];

  // clock for "12 minutes ago"
  const [now, setNow] = useState(nowS);
  useEffect(() => {
    const t = setInterval(() => setNow(nowS()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ---------------------------------------------------------------- make or join
  const [newName, setNewName] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [scan, setScan] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const lastBad = useRef('');

  const make = () => {
    const f = book.add(makeFamily(newName.trim()));
    setTag(f.tag);
    setNewName('');
    setShowCode(true);
    setMsg({ tone: 'ok', text: `Family "${f.name}" made. Show its code to each relative, in person.` });
  };

  const onScan = (text: string) => {
    try {
      const { family, card: who } = decodeFamilyCode(text);
      if (who.publicKey.every((b, i) => b === device.identity.publicKey[i])) {
        setMsg({ tone: 'bad', text: 'That is your own family code. Scan your relative\'s screen.' });
        return;
      }
      const known = !!book.get(family.tag);
      const f = book.add(family);
      const peer = device.addPeer(who);
      book.addMember(f.tag, peer.keyId);
      store.retryParked(nowS());
      setScan(false);
      setTag(f.tag);
      setMsg({
        tone: 'ok',
        text: known
          ? `${peer.name} added to "${f.name}". Now let them scan your code too.`
          : `Joined "${f.name}" with ${peer.name}. Show your family code back so they get your key.`,
      });
      bump();
    } catch (e) {
      if (lastBad.current !== text) {
        lastBad.current = text;
        setMsg({ tone: 'bad', text: e instanceof FamilyCodeError ? e.message : 'Could not read that code.' });
      }
    }
  };

  // ---------------------------------------------------------------- my status
  const [level, setLevel] = useState(String(device.identity.level));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const levelN = Number(level);
  const levelOk = Number.isInteger(levelN) && levelN >= 1 && levelN <= 255;
  const noteBytes = byteLength(note);
  const send = async (condition: FamilyCondition) => {
    if (!fam || !levelOk || busy) return;
    setBusy(true);
    try {
      const n = await writeFamilyNote(device, fam, { condition, level: levelN, message: note.trim() }, nowS());
      store.receive(n.bytes, nowS());
      setNote('');
      setMsg({ tone: 'ok', text: `Signed: you are ${CONDITION_LABEL[condition]}, level ${levelN}. Pass it on from the Notes tab.` });
    } catch (e) {
      setMsg({ tone: 'bad', text: `Could not seal the note: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  // ---------------------------------------------------------------- relatives
  const [board, setBoard] = useState<RelativeStatus[]>([]);
  useEffect(() => {
    if (!fam) return setBoard([]);
    let live = true;
    readFamily(fam, store).then((b) => live && setBoard(b));
    return () => {
      live = false;
    };
  }, [fam, store, version]);

  const nameOf = (keyId: KeyIdHex) =>
    keyId === device.identity.keyId ? 'You' : (device.peers().find((p) => p.keyId === keyId)?.name ?? `Relative ${keyId.slice(0, 4)}`);
  const quiet = fam ? fam.members.filter((k) => !board.some((r) => r.author === k)) : [];

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className="text-lg font-semibold">Family</h2>
        <p className="text-sm text-slate-300">
          A family shares one secret key, swapped in person by QR. Anyone can carry your family notes. Only your family can open them.
        </p>
        {families.length > 1 && (
          <select
            value={fam?.tag}
            onChange={(e) => setTag(e.target.value)}
            aria-label="Family"
            className="min-h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-base"
          >
            {families.map((f) => (
              <option key={f.tag} value={f.tag}>
                {f.name}
              </option>
            ))}
          </select>
        )}
        {fam && (
          <p className="text-base">
            Family <b>{fam.name}</b> <span className="font-mono text-xs text-slate-400">tag {fam.tag}</span>
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {fam && (
            <button type="button" className={btnPrimary} onClick={() => setShowCode((s) => !s)}>
              {showCode ? 'Hide family code' : 'Show family code'}
            </button>
          )}
          <button type="button" className={btnSecondary} onClick={() => { setMsg(null); setScan((s) => !s); }}>
            {scan ? 'Stop scanning' : fam ? 'Scan a relative\'s code' : 'Join a family (scan code)'}
          </button>
        </div>
        {showCode && fam && (
          <>
            <QrView text={encodeFamilyCode(fam, { publicKey: device.identity.publicKey, name: device.identity.name, level: device.identity.level })} label="Family code" />
            <p className="text-sm text-amber-200">
              This code is the family key. Show it only to relatives standing next to you. It is never sent by sound.
            </p>
          </>
        )}
        {scan && <QrScan onScan={onScan} onClose={() => setScan(false)} />}
        {!fam && (
          <div className="space-y-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={24}
              placeholder="Family name"
              aria-label="Family name"
              className="min-h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-lg"
            />
            <button type="button" className={btnPrimary} disabled={!newName.trim()} onClick={make}>
              Make a family
            </button>
          </div>
        )}
        {msg && <p className={`text-sm ${msg.tone === 'ok' ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</p>}
      </section>

      {fam && (
        <section className={card}>
          <h2 className="text-lg font-semibold">My status</h2>
          <label className="flex items-center gap-3 text-base">
            <span>I am on level</span>
            <input
              value={level}
              onChange={(e) => setLevel(e.target.value.replace(/[^0-9]/g, ''))}
              inputMode="numeric"
              aria-label="My level"
              className="min-h-12 w-20 rounded-lg border border-slate-700 bg-slate-900 px-3 text-lg"
            />
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Short message (optional)"
            aria-label="Short message"
            className="min-h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-base"
          />
          <p className={`text-xs ${noteBytes > FAMILY_MESSAGE_MAX_BYTES ? 'text-amber-300' : 'text-slate-400'}`}>
            {noteBytes} of {FAMILY_MESSAGE_MAX_BYTES} bytes{noteBytes > FAMILY_MESSAGE_MAX_BYTES ? ', the end will be cut' : ''}.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {CONDITION_BUTTON.map((b) => (
              <button
                key={b.c}
                type="button"
                disabled={!levelOk || busy}
                onClick={() => send(b.c)}
                className={`min-h-16 rounded-lg px-3 text-lg font-semibold text-white disabled:opacity-40 ${b.cls}`}
              >
                {b.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {fam && (
        <section className={card}>
          <h2 className="text-lg font-semibold">Relatives</h2>
          {board.length === 0 && quiet.length === 0 && <p className="text-sm text-slate-400">No family notes yet.</p>}
          <ul className="space-y-2">
            {board.map((r) => (
              <li key={r.author} className="rounded-lg bg-slate-800 p-3" data-testid="relative">
                <p className="text-lg text-slate-100">{statusLine(nameOf(r.author), r, now)}</p>
                {r.message && <p className="text-base text-slate-300">"{r.message}"</p>}
                {!r.verified && (
                  <p className="text-xs text-amber-200">Opened with the family key. Signature not checked: scan their family code to check it.</p>
                )}
              </li>
            ))}
            {quiet.map((k) => (
              <li key={k} className="rounded-lg bg-slate-800/50 p-3 text-base text-slate-400">
                {nameOf(k)}: no news yet
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
