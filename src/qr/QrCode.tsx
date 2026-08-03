import { useEffect, useRef } from 'react';
import { encodeQr } from './encode.ts';

type Props = {
  text: string;
  /** Announced to screen readers, since the canvas itself says nothing. */
  label: string;
};

const QUIET_MODULES = 4;

/**
 * The QR as a printed ticket.
 *
 * Rendered dark-on-bone rather than bone-on-night: the brightest thing on
 * screen should be the thing you point a camera at, and inverted codes defeat
 * a good number of scanners outright.
 */
export function QrCode({ text, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const { size, dark } = encodeQr(text);
    const total = size + QUIET_MODULES * 2;

    // One module per device pixel at an integer scale, so nothing lands on a
    // half pixel and blurs. The CSS box does the actual sizing.
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    const scale = Math.max(1, Math.floor((canvas.clientWidth * dpr) / total));
    const pixels = total * scale;

    canvas.width = pixels;
    canvas.height = pixels;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#EDE4D3';
    ctx.fillRect(0, 0, pixels, pixels);

    ctx.fillStyle = '#14110F';
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (!dark[row * size + col]) continue;
        ctx.fillRect((col + QUIET_MODULES) * scale, (row + QUIET_MODULES) * scale, scale, scale);
      }
    }
  }, [text]);

  return <canvas ref={canvasRef} className="qr" role="img" aria-label={label} />;
}
