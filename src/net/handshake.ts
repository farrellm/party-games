export type PlayerId = string;

/**
 * A host ICE candidate, stripped to the parts that carry information.
 *
 * Foundation, priority, and component are all regenerable — the peer does not
 * need our numbers, only somewhere to send packets — so they never go on the
 * wire. See sdp-codec.ts.
 */
export type Candidate =
  | { kind: 'ipv4'; address: string; port: number }
  | { kind: 'ipv6'; address: string; port: number }
  /** address is the full `<uuid>.local` name; only the UUID is transmitted. */
  | { kind: 'mdns'; address: string; port: number };

export type HandshakeKind = 'offer' | 'answer';

/**
 * Everything that varies between one data-channel SDP and another.
 *
 * The rest of the SDP is a constant for our purposes and lives in a template,
 * which is what gets this down from 1–2 KB to ~100–150 bytes and therefore
 * from an unscannable version-40 QR to a version 6–8 one.
 */
export type Handshake = {
  version: 1;
  kind: HandshakeKind;
  /** Offer identity, so a second player scanning a spent code can be told so. */
  nonce: number;
  ufrag: string;
  pwd: string;
  /** Raw SHA-256 bytes, not the 95-character colon-hex form. */
  fingerprint: Uint8Array;
  candidates: Candidate[];
  /**
   * Answers carry identity, which is how the host learns who just joined
   * without anyone confirming anything.
   */
  identity?: { playerId: PlayerId; name: string };
};

export const MAX_NAME_BYTES = 24;
