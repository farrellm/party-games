import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from './base45.ts';

describe('base45', () => {
  it('matches the RFC 9285 test vectors', () => {
    const enc = new TextEncoder();
    expect(encodeBase45(enc.encode('AB'))).toBe('BB8');
    expect(encodeBase45(enc.encode('Hello!!'))).toBe('%69 VD92EX0');
    expect(encodeBase45(enc.encode('base-45'))).toBe('UJCLQE7W581');
    expect(encodeBase45(enc.encode('ietf!'))).toBe('QED8WEX0');
  });

  it('stays inside the QR alphanumeric charset', () => {
    const bytes = new Uint8Array(512);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff;
    expect(encodeBase45(bytes)).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
  });

  it('round-trips every length up to 300 bytes', () => {
    for (let n = 0; n <= 300; n++) {
      const bytes = new Uint8Array(n);
      for (let i = 0; i < n; i++) bytes[i] = (i * 37 + n) & 0xff;
      expect(decodeBase45(encodeBase45(bytes))).toEqual(bytes);
    }
  });

  it('rejects characters outside the alphabet', () => {
    expect(() => decodeBase45('AB!')).toThrow(/bad character/);
  });

  it('rejects a truncated group', () => {
    expect(() => decodeBase45('BB8B')).toThrow(/truncated/);
  });

  it('rejects a group that decodes past 16 bits', () => {
    expect(() => decodeBase45(':::')).toThrow(/out of range/);
  });
});
