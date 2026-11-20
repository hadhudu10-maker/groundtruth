import { useEffect, useRef, useState } from 'react';
import QrScanner from 'qr-scanner';
import { btnSecondary } from './styles';

/** Camera view that calls `onScan` with the text of every QR code it reads. Stops the camera on unmount. */
export function QrScan({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScanner(video, (r) => onScanRef.current(r.data), {
      preferredCamera: 'environment',
      maxScansPerSecond: 20,
      returnDetailedScanResult: true,
      highlightScanRegion: true,
    });
    let cancelled = false;
    scanner.start().catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    });
    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg bg-black">
        <video ref={videoRef} playsInline muted className="block aspect-square w-full object-cover" />
      </div>
      {error && <p className="text-sm text-rose-300">Camera problem: {error}</p>}
      <button type="button" onClick={onClose} className={btnSecondary}>
        Stop camera
      </button>
    </div>
  );
}
