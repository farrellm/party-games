import { useEffect, useRef, useState } from 'react';
import { createDecoder, type Decode } from './scanner.ts';

type Props = {
  onScan: (text: string) => void;
  /** Repeat scans of the same code are ignored until this changes. */
  resetKey?: string | number | undefined;
};

/** Roughly ten looks a second: fast enough to feel instant, cheap enough to hold. */
const INTERVAL_MS = 100;

/**
 * Camera preview that reports whatever QR passes in front of it.
 *
 * Camera permission does double duty here: it is how you scan, and it is also
 * what makes Chrome stop obfuscating local IPs as mDNS names, so the ICE
 * candidates in the codes get better the moment this mounts (§3.3).
 */
export function Scanner({ onScan, resetKey }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so a re-render never restarts the camera.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const lastRef = useRef<string | null>(null);
  useEffect(() => {
    lastRef.current = null;
  }, [resetKey]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let decode: Decode | null = null;
    let stopped = false;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      const video = videoRef.current;
      if (stopped || !decode || !ctx || !video || video.readyState < 2) return schedule();

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      try {
        const text = await decode(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (text && text !== lastRef.current) {
          lastRef.current = text;
          onScanRef.current(text);
        }
      } catch {
        // A frame that won't decode is the normal case, not an error.
      }

      schedule();
    };

    const schedule = () => {
      if (!stopped) timer = setTimeout(() => void tick(), INTERVAL_MS);
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (stopped) return;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        decode = await createDecoder();
        schedule();
      } catch {
        setError('No camera. Paste the code instead.');
      }
    };

    void start();

    return () => {
      stopped = true;
      clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, []);

  return (
    <div className="camera">
      <video ref={videoRef} playsInline muted aria-label="Camera" />
      {error && <p className="camera-error note">{error}</p>}
    </div>
  );
}
