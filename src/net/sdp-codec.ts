/*
 * The load-bearing module.
 *
 * WebRTC needs a signaling channel to trade SDP. We have no server, so the
 * signaling channel is a QR code and a camera. A gathered data-channel offer is
 * 1–2 KB, which encodes to a version-40 QR: a 177x177 grid that phones cannot
 * read across a table in a dim room.
 *
 * So we don't transmit SDP. We transmit the handful of fields that vary and
 * rebuild the rest from a template on the far side.
 *
 * The reconstructed SDP is only ever handed to setRemoteDescription. Each
 * browser's *own* local description is the real one its engine generated — we
 * only ever read that with fromSdp. That keeps the blast radius of a strict
 * SDP parser as small as it can be (DESIGN.md §13.1).
 */

import { decodeBase45, encodeBase45 } from './base45.ts';
import { MAX_NAME_BYTES, type Candidate, type Handshake, type HandshakeKind } from './handshake.ts';

const VERSION = 1;

const KIND_OFFER = 0;
const KIND_ANSWER = 1;

const TAG_IPV4 = 0;
const TAG_IPV6 = 1;
const TAG_MDNS = 2;

const FINGERPRINT_BYTES = 32;

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

class Writer {
  private bytes: number[] = [];

  u8(n: number) {
    this.bytes.push(n & 0xff);
  }

  u16(n: number) {
    this.bytes.push((n >> 8) & 0xff, n & 0xff);
  }

  raw(b: Uint8Array) {
    for (const x of b) this.bytes.push(x);
  }

  lenPrefixed(b: Uint8Array) {
    this.u8(b.length);
    this.raw(b);
  }

  done(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

class Reader {
  private at = 0;

  constructor(private readonly bytes: Uint8Array) {}

  private need(n: number) {
    if (this.at + n > this.bytes.length) throw new Error('handshake: truncated');
  }

  u8(): number {
    this.need(1);
    return this.bytes[this.at++]!;
  }

  u16(): number {
    this.need(2);
    return (this.bytes[this.at++]! << 8) | this.bytes[this.at++]!;
  }

  raw(n: number): Uint8Array {
    this.need(n);
    return this.bytes.slice(this.at, (this.at += n));
  }

  lenPrefixed(): Uint8Array {
    return this.raw(this.u8());
  }

  get exhausted(): boolean {
    return this.at === this.bytes.length;
  }
}

const utf8 = new TextEncoder();
const utf8Decode = new TextDecoder('utf-8', { fatal: true });

function encodeCandidate(w: Writer, c: Candidate): void {
  switch (c.kind) {
    case 'ipv4': {
      w.u8(TAG_IPV4);
      w.raw(ipv4ToBytes(c.address));
      break;
    }
    case 'ipv6': {
      w.u8(TAG_IPV6);
      w.raw(ipv6ToBytes(c.address));
      break;
    }
    case 'mdns': {
      w.u8(TAG_MDNS);
      w.raw(uuidToBytes(c.address.replace(/\.local\.?$/i, '')));
      break;
    }
  }
  w.u16(c.port);
}

function decodeCandidate(r: Reader): Candidate {
  const tag = r.u8();
  switch (tag) {
    case TAG_IPV4:
      return { kind: 'ipv4', address: bytesToIpv4(r.raw(4)), port: r.u16() };
    case TAG_IPV6:
      return { kind: 'ipv6', address: bytesToIpv6(r.raw(16)), port: r.u16() };
    case TAG_MDNS:
      return { kind: 'mdns', address: `${bytesToUuid(r.raw(16))}.local`, port: r.u16() };
    default:
      throw new Error(`handshake: unknown candidate tag ${tag}`);
  }
}

export function encodeHandshake(h: Handshake): string {
  if (h.fingerprint.length !== FINGERPRINT_BYTES) {
    throw new Error(`handshake: fingerprint must be ${FINGERPRINT_BYTES} bytes`);
  }
  if (h.candidates.length > 255) throw new Error('handshake: too many candidates');

  const w = new Writer();
  w.u8(VERSION);
  w.u8(h.kind === 'offer' ? KIND_OFFER : KIND_ANSWER);
  w.u16(h.nonce);
  w.lenPrefixed(utf8.encode(h.ufrag));
  // The doc calls ice-pwd a fixed 24 bytes. It is, in every engine we target
  // today — but a length prefix costs one byte and removes a whole class of
  // cross-engine breakage, which is a good trade for a QR that already fits.
  w.lenPrefixed(utf8.encode(h.pwd));
  w.raw(h.fingerprint);

  w.u8(h.candidates.length);
  for (const c of h.candidates) encodeCandidate(w, c);

  if (h.kind === 'answer') {
    if (!h.identity) throw new Error('handshake: answer needs an identity');
    w.raw(uuidToBytes(h.identity.playerId));
    const name = utf8.encode(h.identity.name);
    if (name.length > MAX_NAME_BYTES) throw new Error('handshake: name too long');
    w.lenPrefixed(name);
  }

  return encodeBase45(w.done());
}

export function decodeHandshake(text: string): Handshake {
  const r = new Reader(decodeBase45(text.trim().toUpperCase()));

  const version = r.u8();
  if (version !== VERSION) throw new Error(`handshake: unsupported version ${version}`);

  const kindByte = r.u8();
  if (kindByte !== KIND_OFFER && kindByte !== KIND_ANSWER) {
    throw new Error(`handshake: unknown kind ${kindByte}`);
  }
  const kind: HandshakeKind = kindByte === KIND_OFFER ? 'offer' : 'answer';

  const nonce = r.u16();
  const ufrag = utf8Decode.decode(r.lenPrefixed());
  const pwd = utf8Decode.decode(r.lenPrefixed());
  const fingerprint = r.raw(FINGERPRINT_BYTES);

  const candidates: Candidate[] = [];
  const count = r.u8();
  for (let i = 0; i < count; i++) candidates.push(decodeCandidate(r));

  const h: Handshake = { version: VERSION, kind, nonce, ufrag, pwd, fingerprint, candidates };

  if (kind === 'answer') {
    const playerId = bytesToUuid(r.raw(16));
    const name = utf8Decode.decode(r.lenPrefixed());
    h.identity = { playerId, name };
  }

  // Trailing bytes mean the sender and receiver disagree about the format,
  // which is worth failing loudly rather than half-reading.
  if (!r.exhausted) throw new Error('handshake: trailing bytes');

  return h;
}

// ---------------------------------------------------------------------------
// SDP template
// ---------------------------------------------------------------------------

/**
 * Everything here is constant for a bundle-only, data-channel-only session.
 * The session id is arbitrary and never has to match the far side's.
 */
function template(h: Handshake, lines: string[]): string {
  const setup = h.kind === 'offer' ? 'actpass' : 'active';

  return [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...lines,
    `a=ice-ufrag:${h.ufrag}`,
    `a=ice-pwd:${h.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${bytesToHexColon(h.fingerprint)}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n');
}

export function toSdp(h: Handshake): string {
  const lines = h.candidates.map((c, i) => {
    // Foundation and priority are ours to choose: the peer only uses them to
    // order its connectivity checks, and on a LAN there is nothing to order.
    // Descending priority preserves the order the browser gathered in.
    const foundation = i + 1;
    const priority = 2130706431 - i;
    return `a=candidate:${foundation} 1 udp ${priority} ${c.address} ${c.port} typ host`;
  });

  // Gathering is complete before we ever encode — there is no channel to
  // trickle over — so say so and spare the peer a timeout.
  lines.push('a=end-of-candidates');

  return template(h, lines);
}

const CANDIDATE_RE = /^a=candidate:\S+ (\d+) (\S+) \d+ (\S+) (\d+) typ host\b/;

export function fromSdp(sdp: string, kind: HandshakeKind, nonce: number): Handshake {
  const ufrag = matchOne(sdp, /^a=ice-ufrag:(.+)$/m, 'ice-ufrag');
  const pwd = matchOne(sdp, /^a=ice-pwd:(.+)$/m, 'ice-pwd');
  const fingerprintHex = matchOne(sdp, /^a=fingerprint:sha-256 (.+)$/im, 'sha-256 fingerprint');

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const line of sdp.split(/\r\n|\n/)) {
    const m = CANDIDATE_RE.exec(line.trim());
    if (!m) continue;

    const [, component, transport, address, port] = m;

    // Component 2 is RTCP, which a data channel never has. TCP host candidates
    // are gathered with port 9 and are unusable without a listening peer.
    if (component !== '1') continue;
    if (transport!.toLowerCase() !== 'udp') continue;

    const candidate = classify(address!, Number(port));
    if (!candidate) continue;

    const key = `${candidate.address}:${candidate.port}`;
    if (seen.has(key)) continue;
    seen.add(key);

    candidates.push(candidate);
  }

  return {
    version: VERSION,
    kind,
    nonce,
    ufrag: ufrag.trim(),
    pwd: pwd.trim(),
    fingerprint: hexColonToBytes(fingerprintHex.trim()),
    candidates,
  };
}

function classify(address: string, port: number): Candidate | null {
  if (/\.local\.?$/i.test(address)) {
    const label = address.replace(/\.local\.?$/i, '');
    // Chrome and Safari mint a UUID per candidate; anything else we cannot
    // pack into 16 bytes and would rather drop than misencode.
    if (!UUID_RE.test(label)) return null;
    return { kind: 'mdns', address: `${label}.local`, port };
  }

  if (address.includes(':')) return { kind: 'ipv6', address, port };
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) return { kind: 'ipv4', address, port };

  return null;
}

function matchOne(sdp: string, re: RegExp, what: string): string {
  const m = re.exec(sdp);
  if (!m?.[1]) throw new Error(`sdp: no ${what}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// Address and hex helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ipv4ToBytes(address: string): Uint8Array {
  const parts = address.split('.');
  if (parts.length !== 4) throw new Error(`sdp: bad IPv4 ${address}`);
  return new Uint8Array(
    parts.map((p) => {
      const n = Number(p);
      if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`sdp: bad IPv4 ${address}`);
      return n;
    }),
  );
}

function bytesToIpv4(b: Uint8Array): string {
  return Array.from(b).join('.');
}

function ipv6ToBytes(address: string): Uint8Array {
  // Strip any zone index; it is meaningless on the far side of the link.
  const [bare] = address.split('%');
  const [head, tail] = bare!.split('::');

  const parse = (s: string | undefined) =>
    s ? s.split(':').filter(Boolean).map((g) => Number.parseInt(g, 16)) : [];

  const left = parse(head);
  const right = parse(tail);

  if (left.some(Number.isNaN) || right.some(Number.isNaN)) {
    throw new Error(`sdp: bad IPv6 ${address}`);
  }

  const groups =
    tail === undefined
      ? left
      : [...left, ...new Array(8 - left.length - right.length).fill(0), ...right];

  if (groups.length !== 8) throw new Error(`sdp: bad IPv6 ${address}`);

  const out = new Uint8Array(16);
  groups.forEach((g, i) => {
    out[i * 2] = (g >> 8) & 0xff;
    out[i * 2 + 1] = g & 0xff;
  });
  return out;
}

function bytesToIpv6(b: Uint8Array): string {
  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2) groups.push((b[i]! << 8) | b[i + 1]!);

  // Collapse the longest run of zero groups, per RFC 5952, so what comes back
  // out is the same text the browser put in.
  let bestStart = -1;
  let bestLen = 0;
  let start = -1;
  for (let i = 0; i <= groups.length; i++) {
    if (i < groups.length && groups[i] === 0) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const len = i - start;
      if (len > bestLen) [bestStart, bestLen] = [start, len];
      start = -1;
    }
  }

  const hex = groups.map((g) => g.toString(16));
  if (bestLen < 2) return hex.join(':');

  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLen).join(':')}`;
}

function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_RE.test(uuid)) throw new Error(`bad uuid ${uuid}`);
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(b: Uint8Array): string {
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

function bytesToHexColon(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

function hexColonToBytes(hex: string): Uint8Array {
  const parts = hex.split(':');
  if (parts.length !== FINGERPRINT_BYTES) {
    throw new Error(`sdp: fingerprint has ${parts.length} bytes, expected ${FINGERPRINT_BYTES}`);
  }
  return new Uint8Array(
    parts.map((p) => {
      const n = Number.parseInt(p, 16);
      if (Number.isNaN(n)) throw new Error('sdp: bad fingerprint');
      return n;
    }),
  );
}
