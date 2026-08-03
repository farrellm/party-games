import { describe, expect, it } from 'vitest';
import { decodeHandshake, encodeHandshake, fromSdp, toSdp } from './sdp-codec.ts';
import type { Handshake } from './handshake.ts';

const FINGERPRINT = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

function offer(over: Partial<Handshake> = {}): Handshake {
  return {
    version: 1,
    kind: 'offer',
    nonce: 0xbeef,
    ufrag: 'Xk4p',
    pwd: 'lTQ0kM8gWvR2bYhNfC1jZs7d',
    fingerprint: FINGERPRINT,
    candidates: [{ kind: 'ipv4', address: '192.168.1.42', port: 51234 }],
    ...over,
  };
}

describe('encodeHandshake / decodeHandshake', () => {
  it('round-trips an offer', () => {
    const h = offer();
    expect(decodeHandshake(encodeHandshake(h))).toEqual(h);
  });

  it('round-trips an answer with identity', () => {
    const h = offer({
      kind: 'answer',
      identity: { playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', name: 'Ann' },
    });
    expect(decodeHandshake(encodeHandshake(h))).toEqual(h);
  });

  it('round-trips mDNS, IPv4 and IPv6 candidates together', () => {
    const h = offer({
      candidates: [
        { kind: 'mdns', address: 'c4a5b1e2-8f3d-4a6b-9c0e-1d2f3a4b5c6d.local', port: 49152 },
        { kind: 'ipv4', address: '10.0.0.7', port: 65535 },
        { kind: 'ipv6', address: 'fe80::1c2d:3e4f:5a6b:7c8d', port: 1 },
      ],
    });
    expect(decodeHandshake(encodeHandshake(h))).toEqual(h);
  });

  it('round-trips an empty candidate list', () => {
    const h = offer({ candidates: [] });
    expect(decodeHandshake(encodeHandshake(h))).toEqual(h);
  });

  it('round-trips a multi-byte name at the length limit', () => {
    // Eight 3-byte characters is exactly the 24-byte cap.
    const h = offer({
      kind: 'answer',
      identity: { playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', name: '日本語日本語日本' },
    });
    expect(decodeHandshake(encodeHandshake(h))).toEqual(h);
  });

  it('rejects a name over the limit', () => {
    const h = offer({
      kind: 'answer',
      identity: { playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', name: 'x'.repeat(25) },
    });
    expect(() => encodeHandshake(h)).toThrow(/name too long/);
  });

  it('fits a realistic offer in a version 6-8 QR', () => {
    const text = encodeHandshake(
      offer({
        candidates: [
          { kind: 'ipv4', address: '192.168.1.42', port: 51234 },
          { kind: 'mdns', address: 'c4a5b1e2-8f3d-4a6b-9c0e-1d2f3a4b5c6d.local', port: 51235 },
        ],
      }),
    );
    // Version 8 alphanumeric at error correction M holds 293 characters.
    expect(text.length).toBeLessThanOrEqual(293);
  });

  it('rejects corrupt, truncated and trailing input', () => {
    const good = encodeHandshake(offer());
    expect(() => decodeHandshake(good.slice(0, 12))).toThrow();
    expect(() => decodeHandshake(`${good}000`)).toThrow(/trailing bytes/);
    expect(() => decodeHandshake('!!!!')).toThrow(/bad character/);
  });

  it('rejects an unknown version', () => {
    const bytes = encodeHandshake(offer());
    // The first three base45 characters carry bytes 0-1: version and kind.
    const bumped = `01${bytes.slice(2)}`;
    expect(() => decodeHandshake(bumped)).toThrow(/unsupported version|unknown kind/);
  });
});

// A real offer from Chrome, trimmed of nothing. This is the input fromSdp has
// to survive in production.
const CHROME_OFFER = [
  'v=0',
  'o=- 8532072936404101173 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1510613869 1 udp 2113937151 c4a5b1e2-8f3d-4a6b-9c0e-1d2f3a4b5c6d.local 51234 typ host generation 0 network-cost 999',
  'a=candidate:559267639 1 udp 2113939711 fe80::1c2d:3e4f:5a6b:7c8d 51235 typ host generation 0 network-cost 999',
  'a=candidate:842163049 1 tcp 1518214911 192.168.1.42 9 typ host tcptype active generation 0',
  'a=ice-ufrag:Xk4p',
  'a=ice-pwd:lTQ0kM8gWvR2bYhNfC1jZs7d',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 03:0A:11:18:1F:26:2D:34:3B:42:49:50:57:5E:65:6C:73:7A:81:88:8F:96:9D:A4:AB:B2:B9:C0:C7:CE:D5:DC',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
  '',
].join('\r\n');

describe('fromSdp', () => {
  it('pulls the varying fields out of a real Chrome offer', () => {
    const h = fromSdp(CHROME_OFFER, 'offer', 0x1234);

    expect(h.ufrag).toBe('Xk4p');
    expect(h.pwd).toBe('lTQ0kM8gWvR2bYhNfC1jZs7d');
    expect(h.fingerprint).toEqual(FINGERPRINT);
    expect(h.nonce).toBe(0x1234);
  });

  it('keeps udp host candidates and drops the tcp one', () => {
    // The tcp candidate is gathered on port 9 and is unusable without a peer
    // listening; carrying it would cost 7 bytes of QR for nothing.
    expect(fromSdp(CHROME_OFFER, 'offer', 1).candidates).toEqual([
      { kind: 'mdns', address: 'c4a5b1e2-8f3d-4a6b-9c0e-1d2f3a4b5c6d.local', port: 51234 },
      { kind: 'ipv6', address: 'fe80::1c2d:3e4f:5a6b:7c8d', port: 51235 },
    ]);
  });

  it('drops srflx candidates and rtcp components', () => {
    const sdp = CHROME_OFFER.replace(
      'a=ice-ufrag:Xk4p',
      [
        'a=candidate:1 2 udp 2113937151 192.168.1.42 51236 typ host',
        'a=candidate:2 1 udp 1677729535 203.0.113.9 51237 typ srflx raddr 192.168.1.42 rport 51234',
        'a=ice-ufrag:Xk4p',
      ].join('\r\n'),
    );
    const addresses = fromSdp(sdp, 'offer', 1).candidates.map((c) => c.address);
    expect(addresses).not.toContain('203.0.113.9');
    expect(addresses).not.toContain('192.168.1.42');
  });

  it('throws on SDP with no fingerprint', () => {
    const sdp = CHROME_OFFER.split('\r\n')
      .filter((l) => !l.startsWith('a=fingerprint'))
      .join('\r\n');
    expect(() => fromSdp(sdp, 'offer', 1)).toThrow(/fingerprint/);
  });
});

describe('toSdp', () => {
  it('is inverted by fromSdp', () => {
    const h = offer({
      candidates: [
        { kind: 'mdns', address: 'c4a5b1e2-8f3d-4a6b-9c0e-1d2f3a4b5c6d.local', port: 51234 },
        { kind: 'ipv6', address: 'fe80::1c2d:3e4f:5a6b:7c8d', port: 51235 },
        { kind: 'ipv4', address: '192.168.1.42', port: 51236 },
      ],
    });
    expect(fromSdp(toSdp(h), h.kind, h.nonce)).toEqual(h);
  });

  it('round-trips a real Chrome offer through the wire format and back', () => {
    // The whole premise in one assertion: parse what Chrome made, shrink it to
    // a QR string, expand it again, and get an SDP that says the same things.
    const parsed = fromSdp(CHROME_OFFER, 'offer', 0x1234);
    const rebuilt = fromSdp(toSdp(decodeHandshake(encodeHandshake(parsed))), 'offer', 0x1234);
    expect(rebuilt).toEqual(parsed);
  });

  it('uses actpass on offers and active on answers', () => {
    expect(toSdp(offer())).toContain('a=setup:actpass');
    expect(
      toSdp(
        offer({
          kind: 'answer',
          identity: { playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', name: 'Ann' },
        }),
      ),
    ).toContain('a=setup:active');
  });

  it('declares gathering complete, since there is no channel to trickle over', () => {
    expect(toSdp(offer())).toContain('a=end-of-candidates');
  });

  it('emits CRLF line endings and a trailing newline, as SDP requires', () => {
    const sdp = toSdp(offer());
    expect(sdp.endsWith('\r\n')).toBe(true);
    expect(sdp).not.toMatch(/[^\r]\n/);
  });
});
