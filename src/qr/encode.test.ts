import { describe, expect, it } from 'vitest';
import { encodeQr, qrVersion } from './encode.ts';
import { encodeHandshake } from '../net/sdp-codec.ts';
import type { Handshake } from '../net/handshake.ts';

function handshake(candidates: Handshake['candidates']): string {
  return encodeHandshake({
    version: 1,
    kind: 'offer',
    nonce: 0xbeef,
    ufrag: 'Xk4p',
    pwd: 'lTQ0kM8gWvR2bYhNfC1jZs7d',
    fingerprint: new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff),
    candidates,
  });
}

describe('encodeQr', () => {
  it('produces a square matrix of the declared size', () => {
    const m = encodeQr('HELLO');
    expect(m.dark).toHaveLength(m.size * m.size);
  });

  it('keeps a realistic handshake inside a version 8 code', () => {
    // The whole argument of §3.2: this is the version a phone camera can read
    // across a table in a dim room. Version 40 — raw SDP — is not.
    const text = handshake([
      { kind: 'ipv4', address: '192.168.1.42', port: 51234 },
      { kind: 'mdns', address: 'c4a5b1e2-8f3d-4a6b-9c0e-1d2f3a4b5c6d.local', port: 51235 },
    ]);

    expect(qrVersion(encodeQr(text))).toBeLessThanOrEqual(8);
  });

  it('gets alphanumeric density from base45 rather than byte mode', () => {
    const text = handshake([{ kind: 'ipv4', address: '192.168.1.42', port: 51234 }]);

    // Same payload, forced into byte mode by one out-of-charset character.
    const asBytes = encodeQr(`${text}~`);
    expect(qrVersion(encodeQr(text))).toBeLessThan(qrVersion(asBytes));
  });

  it('falls back to byte mode for text outside the alphanumeric charset', () => {
    expect(() => encodeQr('lower case and ~tildes~')).not.toThrow();
  });
});
