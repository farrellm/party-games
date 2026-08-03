/*
 * QR decoding, with the native detector where it exists.
 *
 * BarcodeDetector is fast and free on Chrome and Android. Safari cannot be
 * relied on for it, so zxing-wasm ships in the bundle as the fallback — never
 * fetched at runtime, because a party on a hotspot with no data plan is an
 * explicit target and a first scan is exactly when you cannot reach a CDN.
 */

import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

export type Decode = (source: ImageData) => Promise<string | null>;

type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
};

type BarcodeDetectorCtor = {
  new (options: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats(): Promise<string[]>;
};

function nativeDetector(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return ctor ?? null;
}

async function makeNative(): Promise<Decode | null> {
  const Ctor = nativeDetector();
  if (!Ctor) return null;

  try {
    const formats = await Ctor.getSupportedFormats();
    if (!formats.includes('qr_code')) return null;

    const detector = new Ctor({ formats: ['qr_code'] });
    return async (source) => {
      const found = await detector.detect(await createImageBitmap(source));
      return found[0]?.rawValue ?? null;
    };
  } catch {
    return null;
  }
}

function makeWasm(): Decode {
  // Point the module at the copy Vite emitted into our own assets.
  prepareZXingModule({ overrides: { locateFile: () => wasmUrl }, fireImmediately: false });

  return async (source) => {
    const found = await readBarcodes(source, { formats: ['QRCode'], tryHarder: true });
    return found[0]?.text ?? null;
  };
}

/** Resolves once, to whichever decoder this browser can actually use. */
export async function createDecoder(): Promise<Decode> {
  return (await makeNative()) ?? makeWasm();
}
