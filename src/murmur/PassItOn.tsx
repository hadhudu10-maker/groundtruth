// "Pass it on" resident screen, shown at /#pass. Two devices can pair, write a text note, hand notes
// across by sound (one note) or animated QR (many), and read each other's notes with their verified status.
// Everything incoming goes through the note store, which sends it through receiveNote. Works with every radio off.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { NOTE_MAX_PAYLOAD_BYTES, NoteFormatError, signNote } from '../world';
import type { KeyIdHex, NoteBody, VerifiedNote } from '../world';
import { BUNDLE_FPS, createBundleDecoder, createBundleEncoder } from './bundle';
import type { BundleDecoder, BundleEncoder } from './bundle';
import { CardFormatError, decodeCard, encodeCard } from './card';
import { createDevice, loadDevice } from './device';
import type { Device } from './device';
import { bundleOf, createCounterpart, encodeHave, handleSound, haveIds, ingest, planOffer } from './forward';
import type { IngestSummary } from './forward';
import { QrScan } from './QrScan';
import { QrView } from './QrView';
import { SoundReassembler, frameForSound, playMessage, startListening, startLiveEngine } from './sound';
import type { HeardMessage, Listener, LiveEngine, SoundProtocol } from './sound';
import { createNoteStore } from './store';
import type { Outcome } from './store';
import { btnPrimary, btnSecondary, card } from './styles';

const UA = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const nowS = () => Math.floor(Date.now() / 1000);
const short = (keyId: string) => `${keyId.slice(0, 4)} ${keyId.slice(4, 8)}`;
const byteLength = (s: string) => new TextEncoder().encode(s).length;

const REASONS: Record<string, string> = {
  malformed: 'not a readable note',
  'bad-signature': 'the signature does not match, so it was changed or faked',
  stale: 'it is more than a week old',
  future: 'its clock is more than an hour ahead of this device',
  'seq-reused': 'the author already used that number on a different note, a sign of forgery',
  replay: 'an old note played back after the author had moved far past it',
};

function describe(body: NoteBody): string {
  switch (body.kind) {
    case 'text':
      return body.text;
    case 'power':
      return `Power ${body.event}, level ${body.level}, zone ${body.zone}`;
    case 'water':
      return `Water test ${body.result} at tap ${body.tap}, level ${body.level}`;
    case 'sick':
      return `Sickness report, level ${body.level}, ${body.caseTags.length} case${body.caseTags.length === 1 ? '' : 's'}`;
    case 'family':
      return 'Family note (sealed)';
    case 'surface':
      return `Surface reading, probe ${body.probe}: ${body.readings.map((r) => `${r.metric} ${r.value}`).join(', ')}`;
    case 'witness':
      return `Witness of note ${body.ref.slice(0, 8)}`;
    case 'commit':
      return `Commitment: ${body.topic}`;
  }
}

interface LogLine {
  tone: 'ok' | 'bad' | 'info';
  text: string;
  at: string;
}

function Badge({ tone, children }: { tone: 'ok' | 'bad' | 'warn'; children: React.ReactNode }) {
  const cls =
    tone === 'ok' ? 'bg-emerald-900/60 text-emerald-200' : tone === 'bad' ? 'bg-rose-900/60 text-rose-200' : 'bg-amber-900/60 text-amber-200';
  return <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export default function PassItOn() {
  const [device, setDevice] = useState<Device | null>(() => loadDevice());
  const [nameInput, setNameInput] = useState(/iPhone|iPad/.test(UA) ? 'Phone' : 'Mac');
  if (!device) {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Pass it on</h1>
        <p className="text-slate-300">
          Give this device a short name. It makes a key that stays on this device and signs everything you write.
        </p>
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          maxLength={20}
          aria-label="Your name"
          className="min-h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-lg"
        />
        <button type="button" className={btnPrimary} disabled={!nameInput.trim()} onClick={() => setDevice(createDevice(nameInput.trim()))}>
          Start
        </button>
      </main>
    );
  }
  return <Screen device={device} />;
}

function Screen({ device }: { device: Device }) {
  const store = useMemo(() => createNoteStore(device), [device]);
  useSyncExternalStore(store.subscribe, store.version);
  const [who] = useState(createCounterpart);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  const [log, setLog] = useState<LogLine[]>([]);
  const [repeats, setRepeats] = useState(0);
  const addLog = useCallback((tone: LogLine['tone'], text: string) => {
    setLog((prev) => [{ tone, text, at: new Date().toLocaleTimeString() }, ...prev].slice(0, 12));
  }, []);

  const nameOf = useCallback(
    (keyId: KeyIdHex) =>
      keyId === device.identity.keyId ? 'you' : (device.peers().find((p) => p.keyId === keyId)?.name ?? `key ${short(keyId)}`),
    [device],
  );

  // ---------------------------------------------------------------- results of taking notes in
  const report = useCallback(
    (where: string, s: IngestSummary) => {
      setRepeats((n) => n + s.duplicates);
      if (s.added.length) addLog('ok', `${where}: ${s.added.length} new note${s.added.length === 1 ? '' : 's'}, all checked and VERIFIED.`);
      if (s.parked) addLog('info', `${where}: ${s.parked} note${s.parked === 1 ? '' : 's'} from people you have not paired with. Kept aside, not trusted. Pair with them to check.`);
      for (const r of s.rejected) addLog('bad', `${where}: REJECTED, ${REASONS[r.reason] ?? r.reason}.`);
    },
    [addLog],
  );

  const reportOutcome = useCallback(
    (o: Outcome) => {
      if (o.kind === 'added') {
        const text = o.note.body.kind === 'text' ? `"${o.note.body.text}"` : describe(o.note.body);
        addLog('ok', `Heard by sound: ${text} from ${nameOf(o.note.author)}. VERIFIED.`);
      } else if (o.kind === 'duplicate') setRepeats((n) => n + 1);
      else if (o.kind === 'parked') {
        if (o.isNew) addLog('info', `Heard a note from key ${short(o.author)}, who you have not paired with. Kept aside, not trusted.`);
        else setRepeats((n) => n + 1);
      } else addLog('bad', `Heard by sound but REJECTED: ${REASONS[o.reason] ?? o.reason}.`);
    },
    [addLog, nameOf],
  );

  // ---------------------------------------------------------------- pair by QR
  const [showCard, setShowCard] = useState(false);
  const [scanCard, setScanCard] = useState(false);
  const [cardMsg, setCardMsg] = useState<string | null>(null);
  const lastBadCard = useRef('');
  const onCardScan = (text: string) => {
    try {
      const peer = device.addPeer(decodeCard(text));
      if (peer.keyId === device.identity.keyId) {
        setCardMsg('That is your own card. Scan the other device.');
        return;
      }
      setScanCard(false);
      setCardMsg(null);
      const promoted = store.retryParked(nowS());
      addLog('ok', `Paired with ${peer.name} (key ${short(peer.keyId)}).${promoted ? ` ${promoted} note${promoted === 1 ? '' : 's'} you were carrying are now checked and VERIFIED.` : ''}`);
      who.reset();
      who.setResident(peer.keyId);
      setPassTo(peer.keyId);
      bump();
    } catch (e) {
      if (lastBadCard.current !== text) {
        lastBadCard.current = text;
        setCardMsg(e instanceof CardFormatError ? e.message : 'Could not read that code.');
      }
    }
  };

  // ---------------------------------------------------------------- write a note
  const [draft, setDraft] = useState('');
  const [writeErr, setWriteErr] = useState<string | null>(null);
  const draftBytes = byteLength(draft);
  const sign = () => {
    setWriteErr(null);
    try {
      const note = signNote({ seq: device.nextSeq(), time: nowS(), body: { kind: 'text', text: draft.trim() } }, device.identity);
      store.receive(note.bytes, nowS());
      setDraft('');
    } catch (e) {
      setWriteErr(e instanceof NoteFormatError ? e.message : 'Could not sign that note.');
    }
  };

  // ---------------------------------------------------------------- who we are passing to
  const [passTo, setPassTo] = useState<KeyIdHex | ''>('');
  const changePassTo = (keyId: KeyIdHex | '') => {
    who.reset();
    who.setResident(keyId || null);
    setPassTo(keyId);
  };
  const offer = planOffer(store, who);
  const stats = who.stats();

  // ---------------------------------------------------------------- sound
  const [protocol, setProtocol] = useState<SoundProtocol>('normal');
  const liveRef = useRef<Promise<LiveEngine> | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const reassemblerRef = useRef(new SoundReassembler());
  const sendingRef = useRef(false);
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [soundErr, setSoundErr] = useState<string | null>(null);

  // Must be called straight from a tap (iPhone audio unlock).
  const ensureLive = () => (liveRef.current ??= startLiveEngine());

  // The microphone callback is installed once, so it calls through a ref that always holds the latest handler.
  const onHeardRef = useRef<(m: HeardMessage) => void>(() => {});
  useEffect(() => {
    onHeardRef.current = (m) => {
      if (sendingRef.current) return;
      const whole = reassemblerRef.current.push(m.bytes);
      if (!whole) return;
      const r = handleSound(store, who, whole.bytes, nowS());
      if (r.kind === 'have') {
        const lacks = planOffer(store, who).items.length;
        addLog('info', `Heard what they hold (${r.shortIds.length} notes). You have ${lacks} to pass on.`);
        bump();
      } else if (r.kind === 'note') {
        reportOutcome(r.outcome);
        bump();
      }
    };
  });

  const stopListening = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListening(false);
  }, []);

  const beginListening = async (live: LiveEngine) => {
    reassemblerRef.current = new SoundReassembler();
    listenerRef.current = await startListening(live, (m) => onHeardRef.current(m));
    setListening(true);
  };

  const toggleListen = async () => {
    if (listening) return stopListening();
    setSoundErr(null);
    try {
      await beginListening(await ensureLive());
    } catch (e) {
      setSoundErr(`Could not start listening: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** Plays one sound message. `make` runs after the audio is unlocked and returns what to send. */
  const soundSend = async (what: string, make: () => { bytes: Uint8Array; after?: () => void } | null) => {
    if (sendingRef.current) return;
    const livePromise = ensureLive(); // first, before any await, so it counts as part of the tap
    setSoundErr(null);
    sendingRef.current = true;
    const wasListening = listenerRef.current !== null;
    stopListening(); // the mic would hear our own speaker, and an open mic makes iPhone playback quiet
    try {
      const live = await livePromise;
      const m = make();
      if (!m) {
        addLog('info', 'Nothing to send.');
        return;
      }
      setBusy(`Sending ${what} by sound (${protocol}). Hold the devices close.`);
      const p = playMessage(live, frameForSound(m.bytes, 'binary')[0]!, protocol, 100);
      await p.ended;
      m.after?.();
      addLog('ok', `Sent ${what} by sound, ${p.durationS.toFixed(1)} s.`);
    } catch (e) {
      setSoundErr(`Could not send: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      sendingRef.current = false;
      setBusy(null);
      bump();
      if (wasListening) {
        try {
          await beginListening(await livePromise);
        } catch {
          setSoundErr('Sent, but could not start listening again. Tap Listen.');
        }
      }
    }
  };

  const sendNext = () =>
    soundSend('1 note', () => {
      const item = planOffer(store, who).items[0];
      return item ? { bytes: item.bytes, after: () => who.markOffered([item.id]) } : null;
    });
  const sendHave = () => soundSend('what you hold', () => ({ bytes: encodeHave(haveIds(store)) }));

  // ---------------------------------------------------------------- QR bundle
  const [encoder, setEncoder] = useState<BundleEncoder | null>(null);
  const [frame, setFrame] = useState('');
  const [frameNo, setFrameNo] = useState(0);
  const [bundleCount, setBundleCount] = useState(0);
  const showBundle = async () => {
    const items = bundleOf(planOffer(store, who));
    if (!items.length) return;
    setSoundErr(null);
    try {
      const enc = await createBundleEncoder(items.map((i) => i.bytes));
      who.markOffered(items.map((i) => i.id));
      setBundleCount(items.length);
      setEncoder(enc);
      setFrameNo(0);
      setFrame(enc.nextFrame());
      bump();
    } catch (e) {
      setSoundErr(`Could not make the QR: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  useEffect(() => {
    if (!encoder) return;
    const t = setInterval(() => {
      setFrame(encoder.nextFrame());
      setFrameNo((n) => n + 1);
    }, 1000 / BUNDLE_FPS);
    return () => clearInterval(t);
  }, [encoder]);

  const [scanBundle, setScanBundle] = useState(false);
  const [progress, setProgress] = useState(0);
  const decoderRef = useRef<BundleDecoder | null>(null);
  const bundleDone = useRef(false);
  const startBundleScan = async () => {
    setSoundErr(null);
    try {
      decoderRef.current = await createBundleDecoder();
      bundleDone.current = false;
      setProgress(0);
      setScanBundle(true);
    } catch (e) {
      setSoundErr(`Could not start the QR scan: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const onBundleScan = (text: string) => {
    const dec = decoderRef.current;
    if (!dec || bundleDone.current || !dec.receive(text)) return;
    setProgress(Math.round(dec.progress() * 100));
    if (!dec.isComplete()) return;
    bundleDone.current = true;
    setScanBundle(false);
    try {
      report('QR bundle', ingest(store, who, dec.result(), nowS()));
    } catch (e) {
      addLog('bad', `QR bundle was damaged: ${e instanceof Error ? e.message : String(e)}`);
    }
    bump();
  };

  useEffect(() => () => listenerRef.current?.stop(), []);

  // ---------------------------------------------------------------- render
  const peers = device.peers();
  const myCard = encodeCard({ publicKey: device.identity.publicKey, name: device.identity.name, level: device.identity.level });
  const notes: VerifiedNote[] = store.all().slice().sort((a, b) => b.time - a.time || b.seq - a.seq);
  const parked = store.parked();
  const recommended =
    offer.recommended === 'none'
      ? 'Nothing to pass on: the other side is not missing any note you know of.'
      : offer.recommended === 'sound'
        ? '1 note to pass on. Sound is the right fit (about 14 seconds).'
        : `${offer.items.length} notes to pass on. The animated QR carries ${Math.min(offer.items.length, 40)} at once.`;

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Pass it on</h1>
        <p className="text-slate-300">
          You are <b>{device.identity.name}</b>, key <span className="font-mono">{short(device.identity.keyId)}</span>.
        </p>
        <p className="text-xs text-slate-400">
          Notes pass by sound and QR with every radio off. Load this page once on the HTTPS site first. <a className="underline" href="#devtest">Device tests</a>
        </p>
      </header>

      <section className={card}>
        <h2 className="text-lg font-semibold">1. Pair</h2>
        <p className="text-sm text-slate-300">Show your card on one device and scan it on the other, then swap. That is how each device learns the other's key.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={btnPrimary} onClick={() => setShowCard((s) => !s)}>
            {showCard ? 'Hide my card' : 'Show my card'}
          </button>
          <button type="button" className={btnSecondary} onClick={() => { setCardMsg(null); setScanCard((s) => !s); }}>
            {scanCard ? 'Stop scanning' : 'Scan a card'}
          </button>
        </div>
        {showCard && <QrView text={myCard} label="Your resident card" />}
        {scanCard && <QrScan onScan={onCardScan} onClose={() => setScanCard(false)} />}
        {cardMsg && <p className="text-sm text-amber-300">{cardMsg}</p>}
        <p className="text-sm text-slate-400">
          Paired with: {peers.length ? peers.map((p) => `${p.name} (${short(p.keyId)})`).join(', ') : 'nobody yet'}
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">2. Write a note</h2>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          aria-label="Note text"
          placeholder="Short message for the Hollow"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-base"
        />
        <p className={`text-xs ${draftBytes > NOTE_MAX_PAYLOAD_BYTES ? 'text-rose-300' : 'text-slate-400'}`}>
          {draftBytes} of {NOTE_MAX_PAYLOAD_BYTES} bytes. A note is one ggwave sound message at most, signature included.
        </p>
        <button type="button" className={btnPrimary} disabled={!draft.trim() || draftBytes > NOTE_MAX_PAYLOAD_BYTES} onClick={sign}>
          Sign and keep
        </button>
        {writeErr && <p className="text-sm text-rose-300">{writeErr}</p>}
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">3. Pass it on</h2>
        <label className="block space-y-1 text-sm text-slate-300">
          <span>Passing to</span>
          <select
            value={passTo}
            onChange={(e) => changePassTo(e.target.value)}
            className="min-h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-base"
          >
            <option value="">Someone I have not paired with</option>
            {peers.map((p) => (
              <option key={p.keyId} value={p.keyId}>
                {p.name} ({short(p.keyId)})
              </option>
            ))}
          </select>
        </label>
        <p className="text-sm text-slate-200">{recommended}</p>
        <p className="text-xs text-slate-400">
          Known to be on their side: {stats.confirmed} confirmed, {stats.offered} offered this session.{' '}
          <button type="button" className="underline" onClick={() => { who.forgetOffered(); bump(); }}>
            Send everything again
          </button>
        </p>

        <div className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-slate-800 p-1">
          {(['normal', 'fast'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProtocol(p)}
              className={`min-h-11 rounded-md px-2 text-sm font-medium ${protocol === p ? 'bg-sky-600 text-white' : 'text-slate-300'}`}
            >
              {p === 'normal' ? 'Sound: normal (14 s)' : 'Sound: fast (9 s)'}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={btnPrimary} disabled={!offer.items.length || !!busy} onClick={sendNext}>
            Send 1 note by sound
          </button>
          <button type="button" className={btnSecondary} disabled={!!busy} onClick={sendHave}>
            Tell them what I hold (sound)
          </button>
          <button type="button" className={btnPrimary} disabled={!offer.items.length} onClick={() => (encoder ? setEncoder(null) : showBundle())}>
            {encoder ? 'Hide the QR' : `Show ${Math.min(offer.items.length, 40)} as animated QR`}
          </button>
          <button type="button" className={btnSecondary} onClick={() => (scanBundle ? setScanBundle(false) : startBundleScan())}>
            {scanBundle ? 'Stop scanning' : 'Scan their QR'}
          </button>
        </div>
        <button type="button" className={listening ? btnPrimary : btnSecondary} onClick={toggleListen}>
          {listening ? 'Listening for sound, tap to stop' : 'Listen for sound'}
        </button>
        {busy && <p className="rounded-lg bg-sky-900/60 px-3 py-2 text-sm text-sky-100">{busy}</p>}
        {soundErr && <p className="text-sm text-rose-300">{soundErr}</p>}
        {encoder && (
          <>
            <QrView text={frame} label="Notes to pass on" />
            <p className="text-center text-sm text-slate-300">
              {bundleCount} note{bundleCount === 1 ? '' : 's'}, frame {frameNo + 1}, loops forever. The other device scans until it reaches 100%.
            </p>
          </>
        )}
        {scanBundle && (
          <>
            <QrScan onScan={onBundleScan} onClose={() => setScanBundle(false)} />
            <p className="text-sm text-slate-200">Progress {progress}%</p>
          </>
        )}
        <p className="text-xs text-slate-400">
          Typical hand-off: the receiver taps Listen (or Scan their QR), the sender taps send. Notes already held are dropped quietly{repeats ? ` (${repeats} repeat${repeats === 1 ? '' : 's'} ignored so far)` : ''}.
        </p>
        {log.length > 0 && (
          <ul className="space-y-1 text-sm">
            {log.map((l, i) => (
              <li key={i} className={l.tone === 'ok' ? 'text-emerald-300' : l.tone === 'bad' ? 'text-rose-300' : 'text-slate-300'}>
                <span className="text-xs text-slate-500">{l.at}</span> {l.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">4. Notes I hold ({notes.length})</h2>
        {notes.length === 0 && <p className="text-sm text-slate-400">None yet. Write one above, or receive one.</p>}
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg bg-slate-800 p-3">
              <p className="break-words text-base text-slate-100">{describe(n.body)}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <Badge tone="ok">VERIFIED</Badge>
                <span>
                  from <b className="text-slate-200">{nameOf(n.author)}</b>
                </span>
                <span>#{n.seq}</span>
                <span>{new Date(n.time * 1000).toLocaleString()}</span>
                <span className="font-mono">id {n.id.slice(0, 8)}</span>
              </p>
            </li>
          ))}
        </ul>
        {parked.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-amber-200">Carried for others, not checked ({parked.length})</h3>
            <p className="text-xs text-slate-400">
              These are from people you have not paired with. They are not trusted and not shown. They are passed on, and checked here as soon as you scan the author's card.
            </p>
            <ul className="space-y-1 text-xs text-slate-300">
              {parked.slice(-8).reverse().map((p) => (
                <li key={p.id}>
                  <Badge tone="warn">UNCHECKED</Badge> from key <span className="font-mono">{short(p.author)}</span> #{p.seq}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}
