// Device test page, shown at /#devtest. Four hands-on tests: pair by QR, signed note by sound,
// multi-frame QR bundle, charger sensing. Every test writes a line to the results panel.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { createReplayGuard, receiveNote, signNote } from '../world';
import type { NoteBody, ReplayGuard, VerifiedNote } from '../world';
import { batterySupported, watchCharger } from './battery';
import type { ChargerWatch } from './battery';
import { BUNDLE_FPS, createBundleDecoder, createBundleEncoder } from './bundle';
import type { BundleDecoder, BundleEncoder } from './bundle';
import { CardFormatError, decodeCard, encodeCard } from './card';
import { createDevice, loadDevice } from './device';
import type { Device } from './device';
import { QrScan } from './QrScan';
import { QrView } from './QrView';
import { formatResults } from './results';
import type { ResultLine } from './results';
import {
  SoundReassembler,
  frameForSound,
  playMessage,
  startListening,
  startLiveEngine,
} from './sound';
import type { HeardMessage, Listener, LiveEngine, SoundMode, SoundProtocol } from './sound';
import { btnPrimary, btnSecondary, card } from './styles';

const RESULTS_KEY = 'gt.devtest.results.v1';
const BUNDLE_SIZE = 20;
const UA = typeof navigator === 'undefined' ? '' : navigator.userAgent;

const nowS = () => Math.floor(Date.now() / 1000);
const short = (keyId: string) => `${keyId.slice(0, 4)} ${keyId.slice(4, 8)}`;
const secs = (ms: number) => (ms / 1000).toFixed(1);

function loadResults(): ResultLine[] {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    return raw ? (JSON.parse(raw) as ResultLine[]) : [];
  } catch {
    return [];
  }
}

function fullText(name: string, seq: number): string {
  const head = `GT ${name} #${seq} `.replace(/[^\x20-\x7e]/g, '?');
  return head.padEnd(59, '.').slice(0, 59); // all ASCII, so exactly 59 bytes: the note is the full 140
}

function Seg<T extends string>(props: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="grid grid-flow-col auto-cols-fr gap-1 rounded-lg bg-slate-800 p-1">
      {props.options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => props.onChange(o.id)}
          className={`min-h-11 rounded-md px-2 text-sm font-medium ${
            props.value === o.id ? 'bg-sky-600 text-white' : 'text-slate-300'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <p className={`rounded-lg px-3 py-2 text-sm font-medium ${ok ? 'bg-emerald-900/60 text-emerald-200' : 'bg-rose-900/60 text-rose-200'}`}>
      {children}
    </p>
  );
}

export default function DevTest() {
  const [device, setDevice] = useState<Device | null>(() => loadDevice());
  const deviceRef = useRef<Device | null>(device);
  deviceRef.current = device;
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [nameInput, setNameInput] = useState(/iPhone|iPad/.test(UA) ? 'Phone' : 'Mac');
  const [results, setResults] = useState<ResultLine[]>(loadResults);
  const [copied, setCopied] = useState(false);

  const addResult = useCallback((line: Omit<ResultLine, 'at'>) => {
    setResults((prev) => {
      const next = [...prev, { at: new Date().toISOString(), ...line }];
      try {
        localStorage.setItem(RESULTS_KEY, JSON.stringify(next));
      } catch {
        /* storage blocked: the list still shows for this session */
      }
      return next;
    });
  }, []);

  // ---------------------------------------------------------------- test 1: pair by QR
  const [showCard, setShowCard] = useState(false);
  const [scanCard, setScanCard] = useState(false);
  const [paired, setPaired] = useState<string | null>(null);
  const [cardMsg, setCardMsg] = useState<string | null>(null);
  const lastBadCard = useRef('');
  const cardStart = useRef(0);

  const onCardScan = (text: string) => {
    const d = deviceRef.current;
    if (!d) return;
    try {
      const peer = d.addPeer(decodeCard(text));
      if (peer.keyId === d.identity.keyId) {
        setCardMsg('That is your own card. Scan the other device.');
        return;
      }
      setPaired(`${peer.name}, key ${short(peer.keyId)}`);
      setCardMsg(null);
      setScanCard(false);
      bump();
      addResult({ test: '1 pair by QR', pass: true, detail: `paired with ${peer.name} (${short(peer.keyId)}) in ${secs(performance.now() - cardStart.current)} s` });
    } catch (e) {
      if (lastBadCard.current !== text) {
        lastBadCard.current = text;
        setCardMsg(e instanceof CardFormatError ? e.message : 'Could not read that code.');
      }
    }
  };

  // ---------------------------------------------------------------- test 2: signed note by sound
  const [protocol, setProtocol] = useState<SoundProtocol>('normal');
  const [mode, setMode] = useState<SoundMode>('binary');
  const liveRef = useRef<Promise<LiveEngine> | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const reassemblerRef = useRef(new SoundReassembler());
  const guardRef = useRef<ReplayGuard>(createReplayGuard());
  const sendingRef = useRef(false);
  const pendingOnset = useRef<number | null>(null);
  const listenStart = useRef(0);
  const [listening, setListening] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [heard, setHeard] = useState<{ ok: boolean; text: string } | null>(null);
  const [soundErr, setSoundErr] = useState<string | null>(null);

  // Must be called straight from a tap (iOS audio unlock).
  const ensureLive = () => (liveRef.current ??= startLiveEngine());

  const onHeard = useCallback(
    (m: HeardMessage) => {
      const d = deviceRef.current;
      if (sendingRef.current || !d) return;
      const whole = reassemblerRef.current.push(m.bytes);
      if (!whole) {
        pendingOnset.current ??= m.onsetMs;
        setHeard({ ok: true, text: 'Heard the first half of a base64 note, waiting for the second half.' });
        return;
      }
      const onset = pendingOnset.current ?? m.onsetMs;
      pendingOnset.current = null;
      const toVerified = (m.decodedMs - onset) / 1000;
      const sinceListen = (m.decodedMs - listenStart.current) / 1000;
      const res = receiveNote(whole.bytes, d.keys, guardRef.current, nowS());
      const bytes = whole.bytes.length;
      if (res.ok) {
        const peer = d.peers().find((p) => p.keyId === res.note.author);
        const body = res.note.body;
        const text = body.kind === 'text' ? body.text : body.kind;
        const detail = `verified from ${peer?.name ?? res.note.author}, ${bytes} B, ${toVerified.toFixed(1)} s from start of sound to verified (${sinceListen.toFixed(1)} s since Listen)`;
        setHeard({ ok: true, text: `VERIFIED from ${peer?.name ?? res.note.author}: "${text}". ${bytes} bytes, ${toVerified.toFixed(1)} s from start of sound to verified.` });
        addResult({ test: '2 sound receive', pass: true, detail, mode: whole.mode });
      } else {
        const why = res.detail ? `${res.reason} (${res.detail})` : res.reason;
        setHeard({ ok: false, text: `REJECTED: ${why}. ${bytes} bytes, ${toVerified.toFixed(1)} s. ${res.reason === 'unknown-key' ? 'Pair by QR first (test 1).' : ''}` });
        addResult({ test: '2 sound receive', pass: false, detail: `rejected: ${why}, ${bytes} B, ${toVerified.toFixed(1)} s`, mode: whole.mode });
      }
    },
    [addResult],
  );

  const stopListening = useCallback(() => {
    listenerRef.current?.stop();
    listenerRef.current = null;
    setListening(false);
  }, []);

  const toggleListen = async () => {
    if (listening) {
      stopListening();
      return;
    }
    setSoundErr(null);
    try {
      const live = await ensureLive();
      reassemblerRef.current = new SoundReassembler();
      pendingOnset.current = null;
      listenStart.current = performance.now();
      listenerRef.current = await startListening(live, onHeard);
      setListening(true);
      setHeard(null);
    } catch (e) {
      setSoundErr(`Could not start listening: ${e instanceof Error ? e.message : String(e)}`);
      addResult({ test: '2 sound listen', pass: false, detail: `microphone or audio failed: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const sendNote = async () => {
    const d = deviceRef.current;
    if (!d || sendingRef.current) return;
    setSoundErr(null);
    sendingRef.current = true;
    stopListening(); // the mic would hear our own speaker; on iPhone an open mic also makes playback quiet
    try {
      const livePromise = ensureLive();
      const live = await livePromise;
      const seq = d.nextSeq();
      const note = signNote({ seq, time: nowS(), body: { kind: 'text', text: fullText(d.identity.name, seq) } }, d.identity);
      const frames = frameForSound(note.bytes, mode);
      const t0 = performance.now();
      let soundS = 0;
      for (let i = 0; i < frames.length; i++) {
        setSendMsg(`Sending ${note.bytes.length} byte note (${mode}, ${protocol}), part ${i + 1} of ${frames.length}. Hold the devices close.`);
        const p = playMessage(live, frames[i]!, protocol);
        soundS += p.durationS;
        await p.ended;
        if (i < frames.length - 1) await new Promise((r) => setTimeout(r, 1500));
      }
      const wall = (performance.now() - t0) / 1000;
      setSendMsg(`Sent ${note.bytes.length} bytes (${mode}, ${protocol}). Sound lasted ${soundS.toFixed(1)} s, ${wall.toFixed(1)} s on the clock.`);
      addResult({ test: '2 sound send', pass: true, detail: `sent ${note.bytes.length} B in ${frames.length} message(s), sound ${soundS.toFixed(1)} s, ${protocol}`, mode });
    } catch (e) {
      setSoundErr(`Could not send: ${e instanceof Error ? e.message : String(e)}`);
      addResult({ test: '2 sound send', pass: false, detail: `audio failed: ${e instanceof Error ? e.message : String(e)}`, mode });
    } finally {
      sendingRef.current = false;
    }
  };

  // ---------------------------------------------------------------- test 3: multi-frame QR bundle
  const [encoder, setEncoder] = useState<BundleEncoder | null>(null);
  const [frame, setFrame] = useState('');
  const [frameNo, setFrameNo] = useState(0);
  const [scanBundle, setScanBundle] = useState(false);
  const [bundleProg, setBundleProg] = useState<{ pct: number; frames: number } | null>(null);
  const [bundleOut, setBundleOut] = useState<{ ok: boolean; text: string } | null>(null);
  const decoderRef = useRef<BundleDecoder | null>(null);
  const bundleStart = useRef(0);
  const bundleFrames = useRef(0);
  const bundleDone = useRef(false);

  const makeBundle = async () => {
    const d = deviceRef.current;
    if (!d) return;
    const id = d.identity;
    const bodies: NoteBody[] = [];
    for (let i = 0; i < BUNDLE_SIZE; i++) {
      const k = i % 5;
      bodies.push(
        k === 0
          ? { kind: 'text', text: `bundle note ${i + 1} from ${id.name}` }
          : k === 1
            ? { kind: 'power', level: id.level, zone: i, event: i % 2 ? 'ok' : 'flicker', durationS: 0 }
            : k === 2
              ? { kind: 'water', level: id.level, tap: 100 + i, result: 'ok' }
              : k === 3
                ? { kind: 'surface', probe: 1, readings: [{ metric: 'o2', value: 20.9 }, { metric: 'co2', value: 420 }] }
                : { kind: 'commit', topic: 'notebook-head', value: new Uint8Array(32).fill(i) },
      );
    }
    const notes: VerifiedNote[] = bodies.map((body) => signNote({ seq: d.nextSeq(), time: nowS(), body }, id));
    const enc = await createBundleEncoder(notes.map((n) => n.bytes));
    setEncoder(enc);
    setFrameNo(0);
    setFrame(enc.nextFrame());
  };

  useEffect(() => {
    if (!encoder) return;
    const t = setInterval(() => {
      setFrame(encoder.nextFrame());
      setFrameNo((n) => n + 1);
    }, 1000 / BUNDLE_FPS);
    return () => clearInterval(t);
  }, [encoder]);

  const startBundleScan = async () => {
    decoderRef.current = await createBundleDecoder();
    bundleStart.current = performance.now();
    bundleFrames.current = 0;
    bundleDone.current = false;
    setBundleProg({ pct: 0, frames: 0 });
    setBundleOut(null);
    setScanBundle(true);
  };

  const onBundleScan = (text: string) => {
    const dec = decoderRef.current;
    const d = deviceRef.current;
    if (!dec || !d || bundleDone.current) return;
    if (!dec.receive(text)) return;
    bundleFrames.current += 1;
    setBundleProg({ pct: Math.round(dec.progress() * 100), frames: bundleFrames.current });
    if (!dec.isComplete()) return;
    bundleDone.current = true;
    const took = (performance.now() - bundleStart.current) / 1000;
    setScanBundle(false);
    try {
      const notes = dec.result();
      const guard = createReplayGuard();
      let ok = 0;
      const reasons = new Map<string, number>();
      for (const bytes of notes) {
        const r = receiveNote(bytes, d.keys, guard, nowS());
        if (r.ok) ok++;
        else reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
      }
      const why = [...reasons].map(([k, v]) => `${v} ${k}`).join(', ');
      const pass = ok === BUNDLE_SIZE;
      const detail = `${ok} of ${notes.length} notes verified (${BUNDLE_SIZE} expected) in ${took.toFixed(1)} s, ${bundleFrames.current} frames scanned${why ? `, rejected: ${why}` : ''}`;
      setBundleOut({ ok: pass, text: `${detail}.${reasons.has('unknown-key') ? ' Pair by QR first (test 1).' : ''}` });
      addResult({ test: '3 multi-frame QR', pass, detail });
    } catch (e) {
      const detail = `bundle damaged: ${e instanceof Error ? e.message : String(e)}`;
      setBundleOut({ ok: false, text: detail });
      addResult({ test: '3 multi-frame QR', pass: false, detail });
    }
  };

  // ---------------------------------------------------------------- test 4: charger
  const watchRef = useRef<ChargerWatch | null>(null);
  const unplugAt = useRef<number | null>(null);
  const [charger, setCharger] = useState<{ checked: boolean; supported: boolean; charging: boolean }>({
    checked: false,
    supported: false,
    charging: false,
  });
  const [powerLog, setPowerLog] = useState<string[]>([]);
  const cycleLogged = useRef(false);

  const signPower = useCallback(
    (event: 'out' | 'restored', durationS: number) => {
      const d = deviceRef.current;
      if (!d) return;
      const note = signNote({ seq: d.nextSeq(), time: nowS(), body: { kind: 'power', level: d.identity.level, zone: 0, event, durationS } }, d.identity);
      setPowerLog((prev) => [`${new Date().toLocaleTimeString()}: signed power note "${event}"${event === 'restored' ? ` after ${durationS} s` : ''}, ${note.bytes.length} bytes, id ${note.id.slice(0, 8)}`, ...prev].slice(0, 8));
      return note;
    },
    [],
  );

  const onChargeChange = useCallback(
    (charging: boolean) => {
      setCharger((c) => ({ ...c, charging }));
      if (!charging) {
        unplugAt.current = Date.now();
        signPower('out', 0);
      } else {
        const gone = unplugAt.current ? Math.min(65535, Math.round((Date.now() - unplugAt.current) / 1000)) : 0;
        signPower('restored', gone);
        if (unplugAt.current && !cycleLogged.current) {
          cycleLogged.current = true;
          addResult({ test: '4 charger', pass: true, detail: `unplug and replug both detected, signed out and restored notes (${gone} s gap)` });
        }
        unplugAt.current = null;
      }
    },
    [addResult, signPower],
  );

  const checkCharger = async () => {
    if (!batterySupported()) {
      setCharger({ checked: true, supported: false, charging: false });
      addResult({ test: '4 charger', pass: true, detail: 'Battery Status API is missing here (expected on Safari and iPhone). Fallback: resident taps "my power flickered".' });
      return;
    }
    watchRef.current?.stop();
    const w = await watchCharger(onChargeChange);
    watchRef.current = w;
    cycleLogged.current = false;
    setCharger({ checked: true, supported: !!w, charging: w?.charging ?? false });
    addResult({ test: '4 charger', pass: true, detail: `Battery Status API present, charging now: ${w?.charging ? 'yes' : 'no'}. Now unplug and replug.` });
  };

  useEffect(
    () => () => {
      watchRef.current?.stop();
      listenerRef.current?.stop();
    },
    [],
  );

  // ---------------------------------------------------------------- results
  const copyResults = async () => {
    const text = formatResults(results, UA);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const caps = [
    ['secure context (HTTPS)', typeof window !== 'undefined' && window.isSecureContext],
    ['camera and microphone API', !!navigator.mediaDevices?.getUserMedia],
    ['Web Audio', typeof AudioContext !== 'undefined' || 'webkitAudioContext' in window],
    ['Battery Status API', batterySupported()],
  ] as const;

  if (!device) {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <h1 className="text-2xl font-semibold">Device tests</h1>
        <p className="text-slate-300">Give this device a short name, like Mac or Phone. It makes a fresh key that stays on this device.</p>
        <input
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          maxLength={20}
          aria-label="Device name"
          className="min-h-12 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-lg"
        />
        <button
          type="button"
          className={btnPrimary}
          disabled={!nameInput.trim()}
          onClick={() => setDevice(createDevice(nameInput.trim()))}
        >
          Start
        </button>
      </main>
    );
  }

  const myCard = encodeCard({ publicKey: device.identity.publicKey, name: device.identity.name, level: device.identity.level });
  const peers = device.peers();

  return (
    <main className="mx-auto max-w-xl space-y-4 p-4 pb-16">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Device tests</h1>
        <p className="text-slate-300">
          This device: <b>{device.identity.name}</b>, key <span className="font-mono">{short(device.identity.keyId)}</span>
        </p>
        <p className="text-xs text-slate-400">
          {caps.map(([label, ok]) => `${label}: ${ok ? 'yes' : 'NO'}`).join(' | ')}
        </p>
      </header>

      <section className={card}>
        <h2 className="text-lg font-semibold">Test 1: pair by QR</h2>
        <p className="text-sm text-slate-300">On one device tap Show my card. On the other tap Scan a card. Then swap.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={btnPrimary} onClick={() => setShowCard((s) => !s)}>
            {showCard ? 'Hide my card' : 'Show my card'}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              cardStart.current = performance.now();
              setCardMsg(null);
              setScanCard((s) => !s);
            }}
          >
            {scanCard ? 'Stop scanning' : 'Scan a card'}
          </button>
        </div>
        {showCard && <QrView text={myCard} label="Your resident card" />}
        {scanCard && <QrScan onScan={onCardScan} onClose={() => setScanCard(false)} />}
        {cardMsg && <p className="text-sm text-amber-300">{cardMsg}</p>}
        {paired && <Badge ok>PAIRED with {paired}</Badge>}
        <p className="text-sm text-slate-400">
          Known residents: {peers.length ? peers.map((p) => `${p.name} (${short(p.keyId)})`).join(', ') : 'none yet'}
        </p>
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Test 2: signed note by sound</h2>
        <p className="text-sm text-slate-300">
          Pair first. Put both devices close, volume up. On the receiver tap Listen, then on the sender tap Send. Then swap roles. Airplane mode on is fine.
        </p>
        <Seg
          value={protocol}
          onChange={setProtocol}
          options={[
            { id: 'normal', label: 'Normal' },
            { id: 'fast', label: 'Fast' },
          ]}
        />
        <Seg
          value={mode}
          onChange={setMode}
          options={[
            { id: 'binary', label: 'Raw binary' },
            { id: 'base64', label: 'Fallback: base64 x2' },
          ]}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={btnPrimary} onClick={sendNote}>
            Send a signed note by sound
          </button>
          <button type="button" className={listening ? btnPrimary : btnSecondary} onClick={toggleListen}>
            {listening ? 'Listening, tap to stop' : 'Listen'}
          </button>
        </div>
        {sendMsg && <p className="text-sm text-slate-200">{sendMsg}</p>}
        {listening && !heard && <p className="text-sm text-slate-300">Listening. Nothing heard yet.</p>}
        {heard && <Badge ok={heard.ok}>{heard.text}</Badge>}
        {soundErr && <p className="text-sm text-rose-300">{soundErr}</p>}
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Test 3: multi-frame QR</h2>
        <p className="text-sm text-slate-300">
          Pair first. One device shows a bundle of {BUNDLE_SIZE} signed notes as a looping animated QR. The other scans it until the counter hits 100.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={btnPrimary} onClick={() => (encoder ? setEncoder(null) : makeBundle())}>
            {encoder ? 'Hide bundle' : 'Show a bundle'}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => (scanBundle ? setScanBundle(false) : startBundleScan())}
          >
            {scanBundle ? 'Stop scanning' : 'Scan a bundle'}
          </button>
        </div>
        {encoder && (
          <>
            <QrView text={frame} label="Bundle frame" />
            <p className="text-center text-sm text-slate-300">
              Frame {frameNo + 1}, loops forever. Needs about {encoder.frameCount} frames, any order.
            </p>
          </>
        )}
        {scanBundle && <QrScan onScan={onBundleScan} onClose={() => setScanBundle(false)} />}
        {bundleProg && (
          <p className="text-sm text-slate-200">
            Progress {bundleProg.pct}% ({bundleProg.frames} frames read)
          </p>
        )}
        {bundleOut && <Badge ok={bundleOut.ok}>{bundleOut.text}</Badge>}
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Test 4: charger</h2>
        <p className="text-sm text-slate-300">
          Tap Check charger, then unplug and replug the charger. Each change signs a power note. Safari has no Battery API, and that is an expected result.
        </p>
        <button type="button" className={btnPrimary} onClick={checkCharger}>
          Check charger
        </button>
        {charger.checked && !charger.supported && (
          <Badge ok>Battery Status API is not available on this browser. Expected on Safari. Fallback: tap "my power flickered" by hand.</Badge>
        )}
        {charger.checked && charger.supported && (
          <Badge ok>Charger is {charger.charging ? 'PLUGGED IN' : 'UNPLUGGED'}</Badge>
        )}
        {charger.checked && !charger.supported && (
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className={btnSecondary} onClick={() => signPower('out', 0)}>
              Sign a power out note by hand
            </button>
            <button type="button" className={btnSecondary} onClick={() => signPower('restored', 0)}>
              Sign a power restored note by hand
            </button>
          </div>
        )}
        {powerLog.length > 0 && (
          <ul className="space-y-1 font-mono text-xs text-slate-300">
            {powerLog.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <h2 className="text-lg font-semibold">Results</h2>
        {results.length === 0 && <p className="text-sm text-slate-400">Nothing yet. Every test adds a line here.</p>}
        <ul className="space-y-2">
          {results.map((r, i) => (
            <li key={i} className="rounded-lg bg-slate-800 p-2 text-sm">
              <span className={r.pass ? 'font-semibold text-emerald-300' : 'font-semibold text-rose-300'}>{r.pass ? 'PASS' : 'FAIL'}</span>{' '}
              <span className="font-medium">{r.test}</span>
              {r.mode && <span className="text-slate-400"> [{r.mode}]</span>}
              <div className="text-slate-300">{r.detail}</div>
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" className={btnPrimary} onClick={copyResults} disabled={results.length === 0}>
            {copied ? 'Copied' : 'Copy results'}
          </button>
          <button
            type="button"
            className={btnSecondary}
            onClick={() => {
              setResults([]);
              try {
                localStorage.removeItem(RESULTS_KEY);
              } catch {
                /* ignore */
              }
            }}
          >
            Clear results
          </button>
        </div>
        <p className="break-words text-xs text-slate-500">{UA}</p>
      </section>
    </main>
  );
}
