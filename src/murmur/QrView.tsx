import { useMemo } from 'react';
import encodeQR from 'qr';

/** A QR code as inline SVG on a white card (QR needs dark on light, so it ignores the dark theme). */
export function QrView({ text, label }: { text: string; label?: string }) {
  const svg = useMemo(() => encodeQR(text, 'svg', { ecc: 'medium', border: 2 }), [text]);
  return (
    <div className="mx-auto w-full max-w-[22rem]">
      <div
        role="img"
        aria-label={label ?? 'QR code'}
        className="rounded-lg bg-white p-1 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
