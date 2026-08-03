/*
 * base45, per RFC 9285.
 *
 * Chosen over base64 because its alphabet is exactly QR's alphanumeric mode
 * charset. A QR encoder can pack alphanumeric input at 5.5 bits per character
 * instead of the 8 it needs for arbitrary bytes, which is the difference
 * between a version 6 code you can scan across a table and a version 10 code
 * you cannot. It is the same reason the EU digital COVID certificate used it.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const VALUE = new Map<string, number>();
for (let i = 0; i < ALPHABET.length; i++) VALUE.set(ALPHABET[i]!, i);

export function encodeBase45(bytes: Uint8Array): string {
  let out = '';

  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      // Two bytes become three characters, little-endian base 45.
      const n = bytes[i]! * 256 + bytes[i + 1]!;
      out += ALPHABET[n % 45]! + ALPHABET[Math.floor(n / 45) % 45]! + ALPHABET[Math.floor(n / 2025)]!;
    } else {
      const n = bytes[i]!;
      out += ALPHABET[n % 45]! + ALPHABET[Math.floor(n / 45)]!;
    }
  }

  return out;
}

export function decodeBase45(text: string): Uint8Array {
  const digits: number[] = [];
  for (const ch of text) {
    const v = VALUE.get(ch);
    if (v === undefined) throw new Error(`base45: bad character ${JSON.stringify(ch)}`);
    digits.push(v);
  }

  if (digits.length % 3 === 1) throw new Error('base45: truncated input');

  const out: number[] = [];
  for (let i = 0; i < digits.length; i += 3) {
    if (i + 2 < digits.length) {
      const n = digits[i]! + digits[i + 1]! * 45 + digits[i + 2]! * 2025;
      if (n > 0xffff) throw new Error('base45: value out of range');
      out.push(n >> 8, n & 0xff);
    } else {
      const n = digits[i]! + digits[i + 1]! * 45;
      if (n > 0xff) throw new Error('base45: value out of range');
      out.push(n);
    }
  }

  return new Uint8Array(out);
}
