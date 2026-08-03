import { decodeHandshake, encodeHandshake, fromSdp, toSdp } from './sdp-codec.ts';
import { CHANNEL_LABEL, gather, newPeerConnection, randomNonce } from './webrtc.ts';
import { Emitter, type Unsubscribe } from './transport.ts';
import type { PlayerId } from './handshake.ts';

export type LiveOffer = {
  nonce: number;
  /** The base45 string that goes in the QR, and in the paste-code fallback. */
  text: string;
};

export type Joined = {
  playerId: PlayerId;
  name: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
};

export type AcceptResult =
  | { ok: true; joined: Joined }
  /** Someone else answered this code first; the fix is one rescan (§3.1). */
  | { ok: false; reason: 'stale' }
  /**
   * The same answer arrived twice — the camera looking at a code that is still
   * being held up. Nothing happened, and nothing is wrong: say nothing.
   */
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'unreadable'; error: Error };

type Pending = {
  nonce: number;
  text: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
};

/**
 * An RTCPeerConnection accepts exactly one remote answer and its ICE
 * credentials cannot be reused, so the host cannot show one static QR to a
 * crowd. Instead: keep a few fully-gathered offers warm, show one at a time,
 * and swap to the next the moment an answer lands.
 *
 * The pool is what makes the swap instant. Generating an offer on demand means
 * a visible ICE-gathering pause between every player.
 */
export class OfferPool {
  private live: Pending | null = null;
  private spares: Pending[] = [];
  /**
   * Answers already taken, by their exact text.
   *
   * A player's code stays on screen until their channel opens, so the host's
   * camera — which looks ten times a second — sees the same answer several
   * times after the one that counted. Keyed on the text rather than the nonce
   * on purpose: two *different* players answering one offer share a nonce, and
   * that collision is the real §3.1 race, which still deserves 'stale'.
   */
  private readonly consumed = new Set<string>();
  private readonly changes = new Emitter<LiveOffer | null>();
  private closed = false;
  private refilling: Promise<void> | null = null;

  constructor(private readonly size = 2) {}

  async start(): Promise<void> {
    await this.refill();
  }

  current(): LiveOffer | null {
    return this.live && { nonce: this.live.nonce, text: this.live.text };
  }

  onChange(handler: (offer: LiveOffer | null) => void): Unsubscribe {
    return this.changes.on(handler);
  }

  /**
   * Take a scanned or pasted answer. On success the caller gets a connection
   * that is still opening, and the displayed code has already moved on.
   */
  async accept(answerText: string): Promise<AcceptResult> {
    if (this.consumed.has(answerText)) return { ok: false, reason: 'duplicate' };

    let nonce: number;
    let handshake;

    try {
      handshake = decodeHandshake(answerText);
      if (handshake.kind !== 'answer') throw new Error('That code is an invitation, not an answer.');
      if (!handshake.identity) throw new Error('That answer carries no name.');
      nonce = handshake.nonce;
    } catch (error) {
      return { ok: false, reason: 'unreadable', error: error as Error };
    }

    const live = this.live;
    if (!live || live.nonce !== nonce) return { ok: false, reason: 'stale' };

    // Claimed before the await, not after: setRemoteDescription takes long
    // enough for the next camera frame to arrive, and a peer connection accepts
    // exactly one answer.
    this.consumed.add(answerText);

    try {
      await live.pc.setRemoteDescription({ type: 'answer', sdp: toSdp(handshake) });
    } catch (error) {
      this.consumed.delete(answerText);
      return { ok: false, reason: 'unreadable', error: error as Error };
    }

    this.live = null;
    void this.promote();

    return {
      ok: true,
      joined: {
        playerId: handshake.identity.playerId,
        name: handshake.identity.name,
        pc: live.pc,
        dc: live.dc,
      },
    };
  }

  close(): void {
    this.closed = true;
    for (const p of [this.live, ...this.spares]) p?.pc.close();
    this.live = null;
    this.spares = [];
    this.consumed.clear();
    this.changes.clear();
  }

  private async promote(): Promise<void> {
    this.live = this.spares.shift() ?? null;
    this.changes.emit(this.current());
    await this.refill();
  }

  private async refill(): Promise<void> {
    // Serialise refills: two concurrent callers would each mint a full pool.
    this.refilling ??= this.doRefill().finally(() => {
      this.refilling = null;
    });
    await this.refilling;
  }

  private async doRefill(): Promise<void> {
    while (!this.closed && this.spares.length + (this.live ? 1 : 0) < this.size) {
      const pending = await this.mint();
      if (this.closed) {
        pending.pc.close();
        return;
      }

      if (this.live) {
        this.spares.push(pending);
      } else {
        this.live = pending;
        this.changes.emit(this.current());
      }
    }
  }

  private async mint(): Promise<Pending> {
    const nonce = randomNonce();
    const pc = newPeerConnection();

    // Creating the channel before the offer is what puts the m=application
    // section in the SDP at all.
    const dc = pc.createDataChannel(CHANNEL_LABEL, { ordered: true });

    await pc.setLocalDescription(await pc.createOffer());
    await gather(pc);

    const text = encodeHandshake(fromSdp(pc.localDescription!.sdp, 'offer', nonce));
    return { nonce, text, pc, dc };
  }
}
