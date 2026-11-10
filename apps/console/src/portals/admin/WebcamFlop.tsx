import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { FlopSnapshot, ReadingCheck } from '@preflop/client';
import { Button } from '@preflop/ui';
import { Camera, CameraOff, Eye, EyeOff, ScanSearch } from 'lucide-react';
import { loadCv } from '../../lib/cards/opencv.ts';
import { readCards } from '../../lib/cards/reader.ts';
import { WATCH_INTERVAL_MS, initialWatch, nextWatch } from '../../lib/cards/flopWatch.ts';
import { frameSnapshot } from '../../lib/cards/snapshot.ts';
import { MIN_CONFIDENCE, type Reading } from '../../lib/cards/vision.ts';
import { cardLabel } from '../../lib/manualFlop.ts';
import { api } from '../../lib/api.ts';
import { FlopText } from '../../components/domain.tsx';
import { ReadingVerdicts } from '../../components/decisions.tsx';
import { Select } from '../../components/ui.tsx';

/** The flop the watcher saw, with the frame it was read from. Settling it still needs a staff tap. */
export interface FlopCapture { cards: string[]; snapshot: FlopSnapshot; previewUrl: string }

/**
 * The camera chosen last at this table, so its next hand's panel opens it again without a click
 * (sessionStorage, per table: another table never starts watching by itself).
 */
const cameraKey = (tableId: string) => `pf.manual.camera.${tableId}`;
const rememberedCamera = (tableId: string): string | null => { try { return sessionStorage.getItem(cameraKey(tableId)); } catch { return null; } };
const rememberCamera = (tableId: string, id: string | null) => {
  try { if (id === null) sessionStorage.removeItem(cameraKey(tableId)); else sessionStorage.setItem(cameraKey(tableId), id); } catch { /* private mode: ask again next hand */ }
};

const frameOf = (v: HTMLVideoElement) => {
  const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext('2d')!.drawImage(v, 0, 0);
  return c;
};
const cameraError = (e: unknown) => (e instanceof Error && e.name === 'NotAllowedError'
  ? 'Camera access was refused. Allow the camera for this site and try again.'
  : `Camera unavailable: ${e instanceof Error ? e.message : String(e)}`);

/**
 * Camera panel (docs/19) for a hand whose betting has closed. The camera is the webcam over the table
 * (or the streaming software's virtual camera). While "Watch for the flop" is on, the laptop reads a
 * frame every second; once the same three cards are read three times in a row it keeps that frame and
 * hands the flop to the operator, who confirms it. Nothing settles by itself. Recognition runs in
 * this browser (OpenCV.js); nothing leaves the laptop until the operator confirms.
 */
export function WebcamFlop({ tableId, previousFlop, onReading, onCapture }: {
  tableId: string;
  /** The last settled flop at this table: cards left on the felt are never taken for the new flop. */
  previousFlop: string[] | null;
  onReading: (cards: string[]) => void;
  onCapture: (c: FlopCapture) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(() => rememberedCamera(tableId));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'loading' | 'reading' | null>(null);
  const [watching, setWatching] = useState(true);
  const [reading, setReading] = useState<Reading | null>(null);
  const [check, setCheck] = useState<ReadingCheck | null>(null);
  const readingNo = useRef(0);
  // A stream granted for a request the operator has since stopped or repeated, or after this panel is
  // gone, is stopped at once instead of staying live with no view and no Stop button.
  const request = useRef(0);
  const mounted = useRef(true);
  const captured = useRef(onCapture);
  captured.current = onCapture;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current++; };
  }, []);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  const start = async (id: string | null) => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError('This browser gives no camera access here; the console must be opened over https.'); return; }
    const req = ++request.current;
    try {
      const constraints = id ? { deviceId: { exact: id } } : { facingMode: 'environment' };
      const s = await navigator.mediaDevices.getUserMedia({ video: { ...constraints, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      if (!mounted.current || req !== request.current) { s.getTracks().forEach((t) => t.stop()); return; }
      setStream(s); // the [stream] effect's cleanup stops the previous one
      const used = s.getVideoTracks()[0]?.getSettings().deviceId ?? id;
      setDeviceId(used ?? null);
      rememberCamera(tableId, used ?? '');
      const all = await navigator.mediaDevices.enumerateDevices();
      if (mounted.current) setDevices(all.filter((d) => d.kind === 'videoinput'));
    } catch (e) {
      if (!mounted.current || req !== request.current) return;
      if (id) rememberCamera(tableId, null);
      setError(cameraError(e));
    }
  };
  const stop = () => { request.current++; readingNo.current++; rememberCamera(tableId, null); setStream(null); setReading(null); setCheck(null); };
  // The camera chosen for the last hand opens again by itself: the browser already allowed it.
  useEffect(() => { const id = rememberedCamera(tableId); if (id !== null) void start(id || null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const adviseOn = (r: Reading) => {
    setCheck(null);
    const no = ++readingNo.current;
    if (!r.guesses.length) return;
    api.adminReadingCheck(r.guesses.map((g) => ({ card: g.card, confidence: g.confidence, margin: g.margin })))
      .then((v) => { if (mounted.current && no === readingNo.current) setCheck(v); }, () => { /* the reading stands on its own */ });
  };

  /** One read on demand: a proposal the operator applies with "Use these cards". */
  const readOnce = async () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    setError(null);
    try {
      setBusy('loading');
      const cv = await loadCv();
      setBusy('reading');
      const r = readCards(cv, frameOf(v));
      if (!mounted.current) return;
      setReading(r);
      adviseOn(r);
    } catch (e) {
      if (mounted.current) setError(`Reading failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (mounted.current) setBusy(null);
    }
  };

  // Watching: a read every second; a flop read three times in a row is captured with its frame.
  useEffect(() => {
    if (!watching || !stream) return;
    let state = initialWatch, running = false, cancelled = false;
    const tick = async () => {
      const v = video.current;
      if (running || !v?.videoWidth) return;
      running = true;
      try {
        const cv = await loadCv();
        if (cancelled) return;
        const frame = frameOf(v);
        const r = readCards(cv, frame);
        if (cancelled) return;
        setReading(r);
        const n = nextWatch(state, r.flop.length === 3 ? r.flop : null, previousFlop);
        state = n.state;
        if (!n.stable) return;
        const shot = await frameSnapshot(frame);
        if (cancelled) return;
        setWatching(false);
        adviseOn(r);
        captured.current({ cards: n.stable, ...shot });
      } catch (e) {
        if (!cancelled) { setWatching(false); setError(`Watching stopped: ${e instanceof Error ? e.message : String(e)}`); }
      } finally {
        running = false;
      }
    };
    const i = setInterval(() => void tick(), WATCH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(i); };
  }, [watching, stream]); // eslint-disable-line react-hooks/exhaustive-deps

  const unsure = reading?.guesses.filter((g) => g.confidence < MIN_CONFIDENCE) ?? [];
  return (
    <div className="rounded-[10px] border border-line p-3">
      <div className="flex flex-wrap items-center gap-3">
        {stream
          ? <Button size="sm" variant="secondary" onClick={stop}><CameraOff size={14} aria-hidden />Stop camera</Button>
          : <Button size="sm" variant="secondary" onClick={() => void start(deviceId)}><Camera size={14} aria-hidden />Use webcam</Button>}
        {stream && devices.length > 1 && (
          <Select aria-label="Camera" className="h-8 max-w-[220px] text-xs" value={deviceId ?? ''} onChange={(e) => void start(e.target.value)}>
            {devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}
          </Select>
        )}
        {stream && (watching
          ? <Button size="sm" variant="secondary" onClick={() => setWatching(false)}><EyeOff size={14} aria-hidden />Stop watching</Button>
          : <Button size="sm" variant="secondary" onClick={() => setWatching(true)}><Eye size={14} aria-hidden />Watch for the flop</Button>)}
        {stream && !watching && <Button size="sm" onClick={() => void readOnce()} disabled={!!busy}><ScanSearch size={14} aria-hidden />{busy === 'loading' ? 'Loading reader…' : busy === 'reading' ? 'Reading…' : 'Read cards'}</Button>}
        <span className="text-xs text-muted">Use the webcam over the table (or your streaming app's virtual camera). <Link to="/admin/manual/reader" className="underline">Test the reader</Link></span>
      </div>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {stream && watching && <p className="mt-2 text-xs text-muted" role="status">Watching for the flop: the frame is kept when the same three cards are read three times in a row.</p>}
      {stream && <video ref={video} autoPlay playsInline muted className="mt-3 aspect-video w-full max-w-md rounded-[8px] border border-line bg-black" aria-label="Webcam view of the table" />}
      {reading && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" data-testid="webcam-reading">
          {reading.flop.length
            ? <>Read: <FlopText cards={reading.flop} />{!watching && <Button size="sm" variant="secondary" onClick={() => onReading(reading.flop)}>Use these cards</Button>}</>
            : <span className="text-muted">{reading.guesses.length ? `${reading.guesses.length} card${reading.guesses.length === 1 ? '' : 's'} seen, not three sure ones` : 'No cards seen'}{watching ? '' : ': pick them below'}.</span>}
          {unsure.length > 0 && <span className="text-xs text-muted">({unsure.map((g) => cardLabel(g.card)).join(', ')} unsure)</span>}
          <ReadingVerdicts check={check} />
        </div>
      )}
    </div>
  );
}
