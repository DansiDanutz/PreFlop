import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Badge, Button } from '@preflop/ui';
import { Camera, CameraOff, ImageUp, ScanSearch } from 'lucide-react';
import { loadCv } from '../../lib/cards/opencv.ts';
import { readCards } from '../../lib/cards/reader.ts';
import { MIN_CONFIDENCE, type Reading, center } from '../../lib/cards/vision.ts';
import { cardLabel } from '../../lib/manualFlop.ts';
import { Callout, PageHeader, Section } from '../../components/ui.tsx';
import { FlopText } from '../../components/domain.tsx';

/**
 * Card reader test (docs/19): what the in-browser recognition reads from the webcam or a photo, with
 * no bet connected. The PreFlop team uses it to check a deck, camera and light before trusting the
 * "Read cards" button on a manual table. Nothing leaves the laptop: OpenCV.js runs in this tab.
 */
export function CardReader() {
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'loading' | 'reading' | null>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [source, setSource] = useState<'camera' | 'photo' | null>(null);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, [stream]);

  const startCamera = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) { setError('This browser gives no camera access here; the console must be opened over https.'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      setStream((prev) => { prev?.getTracks().forEach((t) => t.stop()); return s; });
      setSource('camera');
    } catch (e) {
      setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera access was refused. Allow the camera for this site and try again.' : `Camera unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const stopCamera = () => { setStream(null); if (source === 'camera') setSource(null); };

  /** Draws the frame (video or image) on the canvas and runs the reader on it. */
  const run = async (draw: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void) => {
    const c = canvas.current;
    if (!c) return;
    setError(null);
    try {
      setBusy('loading');
      const cv = await loadCv();
      setBusy('reading');
      const ctx = c.getContext('2d')!;
      draw(ctx, c);
      const r = readCards(cv, c);
      // Outline what was found, on the same canvas the operator looks at.
      for (const g of r.guesses) {
        ctx.strokeStyle = g.confidence >= MIN_CONFIDENCE ? '#4ade80' : '#f87171';
        ctx.lineWidth = Math.max(2, c.width / 320);
        ctx.beginPath();
        g.corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath(); ctx.stroke();
        const mid = center(g.corners);
        ctx.font = `bold ${Math.max(14, c.width / 40)}px sans-serif`;
        ctx.fillStyle = ctx.strokeStyle; ctx.textAlign = 'center';
        ctx.fillText(`${cardLabel(g.card)} ${Math.round(g.confidence * 100)}%`, mid.x, mid.y);
      }
      setReading(r);
    } catch (e) {
      setError(`Reading failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const readFromCamera = () => run((ctx, c) => {
    const v = video.current!;
    c.width = v.videoWidth || 1280; c.height = v.videoHeight || 720;
    ctx.drawImage(v, 0, 0, c.width, c.height);
  });

  const readFromFile = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      void run((ctx, c) => { c.width = img.naturalWidth; c.height = img.naturalHeight; ctx.drawImage(img, 0, 0); }).finally(() => URL.revokeObjectURL(url));
      setSource('photo');
    };
    img.onerror = () => { setError('That file is not an image this browser can open.'); URL.revokeObjectURL(url); };
    img.src = url;
  };

  return (
    <>
      <PageHeader eyebrow="PreFlop team" title="Card reader test"
        subtitle="What the laptop reads from the camera or a photo of the dealt cards. Nothing is uploaded and no bet is connected: this page only reports."
        actions={<Button variant="secondary" onClick={() => nav('/admin/manual')}>Back to manual tables</Button>} />
      <div className="space-y-6">
        <Callout tone="info" title="How to test">
          Lay three cards face up on the felt, flat and not overlapping, under even light. Point the camera straight down or read a photo.
          A card reads well when its white face stands out from the table and the corner index is sharp. The first reading loads the
          recognition library (about 13 MB, once per visit).
        </Callout>
        <Section title="Frame" actions={
          <>
            {stream
              ? <Button size="sm" variant="secondary" onClick={stopCamera}><CameraOff size={14} aria-hidden />Stop camera</Button>
              : <Button size="sm" variant="secondary" onClick={() => void startCamera()}><Camera size={14} aria-hidden />Use webcam</Button>}
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-line-strong px-3 py-1.5 text-sm font-medium hover:border-accent">
              <ImageUp size={14} aria-hidden />Read a photo
              <input type="file" accept="image/*" className="sr-only" data-testid="card-photo" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFromFile(f); e.target.value = ''; }} />
            </label>
            {stream && <Button size="sm" onClick={() => void readFromCamera()} disabled={!!busy}><ScanSearch size={14} aria-hidden />{busy === 'loading' ? 'Loading reader…' : busy === 'reading' ? 'Reading…' : 'Read cards'}</Button>}
          </>
        }>
          {error && <p className="mb-3 text-sm text-danger">{error}</p>}
          <div className="grid gap-4 lg:grid-cols-2">
            {stream && <video ref={video} autoPlay playsInline muted className="aspect-video w-full rounded-[8px] border border-line bg-black" aria-label="Webcam view of the table" />}
            <canvas ref={canvas} data-testid="reading-canvas" className={`w-full rounded-[8px] border border-line bg-black ${reading ? '' : 'hidden'}`} aria-label="The frame that was read, with the cards found outlined" />
            {!stream && !reading && <p className="text-sm text-muted">Start the webcam or read a photo to see a frame here.</p>}
          </div>
        </Section>
        {reading && (
          <Section title="Reading" subtitle={`${reading.guesses.length} card${reading.guesses.length === 1 ? '' : 's'} found in ${reading.size.width}×${reading.size.height} in ${reading.ms} ms`}>
            <div className="space-y-3" data-testid="reading-result">
              <p className="text-sm">Flop: {reading.flop.length ? <FlopText cards={reading.flop} /> : <span className="text-muted">not enough sure cards for a flop</span>}</p>
              <ul className="flex flex-wrap gap-2">
                {reading.guesses.map((g, i) => (
                  <li key={i}><Badge tone={g.confidence >= MIN_CONFIDENCE ? 'live' : 'warn'}>{cardLabel(g.card)} · {Math.round(g.confidence * 100)}%</Badge></li>
                ))}
              </ul>
              {reading.guesses.length === 0 && <p className="text-sm text-muted">No card-shaped bright rectangle was found. Check the light and that the cards lie flat and apart.</p>}
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
