import type { PlayerId } from './handshake.ts';
import {
  DEGRADED_AFTER_MS,
  Emitter,
  HEARTBEAT_MS,
  Sequencer,
  type Envelope,
  type PeerHealth,
  type PeerStatus,
  type Transport,
  type Unsubscribe,
} from './transport.ts';
import type { Joined } from './offer-pool.ts';

/** Reserved. Heartbeats never reach application handlers. */
const BEAT = '@beat';

type Seat = {
  id: PlayerId;
  name: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  lastSeen: number;
  failed: boolean;
};

/**
 * The hub of the star. Holds one connection per player and forwards anything
 * addressed elsewhere.
 *
 * Liar's dice never needs the relay, but having it means a future game can do
 * player-to-player messaging without anyone touching the transport.
 */
export class WebRtcHostTransport implements Transport {
  private readonly seats = new Map<PlayerId, Seat>();
  private readonly messages = new Emitter<Envelope>();
  private readonly peerChanges = new Emitter<PeerStatus[]>();
  private readonly seq = new Sequencer();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(readonly self: PlayerId) {
    this.timer = setInterval(() => {
      this.send('*', BEAT, null);
      this.sweep();
    }, HEARTBEAT_MS);
  }

  /**
   * Seat a connection that is negotiated but very likely not open yet.
   *
   * A playerId we already have a seat for is a reconnect, not a new player: the
   * seat rebinds, so they return with their dice count intact (§4).
   *
   * The peer is announced twice on purpose. The first announcement is what puts
   * a name on the host's roster the instant the code is scanned; but sends on a
   * channel that is still connecting are dropped on the floor, so anything that
   * announcement provoked never left. The second one, on open, is the one whose
   * messages actually arrive.
   */
  adopt({ playerId, name, pc, dc }: Joined): void {
    const existing = this.seats.get(playerId);
    if (existing) {
      existing.dc.onmessage = null;
      existing.pc.close();
    }

    const seat: Seat = { id: playerId, name, pc, dc, lastSeen: Date.now(), failed: false };
    this.seats.set(playerId, seat);

    dc.onmessage = (event: MessageEvent<string>) => this.receive(seat, event.data);

    if (dc.readyState !== 'open') {
      dc.addEventListener(
        'open',
        () => {
          // Only if this seat is still the live one: a reconnect will have
          // replaced it, and a dead channel has nothing to say about the roster.
          if (this.seats.get(playerId) === seat) this.peerChanges.emit(this.peers());
        },
        { once: true },
      );
    }

    const drop = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        seat.failed = true;
        this.peerChanges.emit(this.peers());
      }
    };
    pc.addEventListener('connectionstatechange', drop);

    this.peerChanges.emit(this.peers());
  }

  send(to: PlayerId | '*', type: string, payload: unknown): void {
    this.dispatch({ v: 1, from: this.self, to, seq: this.seq.next(), type, payload });
  }

  onMessage(handler: (e: Envelope) => void): Unsubscribe {
    return this.messages.on(handler);
  }

  onPeersChanged(handler: (peers: PeerStatus[]) => void): Unsubscribe {
    return this.peerChanges.on(handler);
  }

  peers(): PeerStatus[] {
    const now = Date.now();
    return [...this.seats.values()].map((seat) => ({
      id: seat.id,
      name: seat.name,
      health: seat.failed ? ('disconnected' as const) : health(now - seat.lastSeen),
    }));
  }

  close(): void {
    clearInterval(this.timer);
    for (const seat of this.seats.values()) seat.pc.close();
    this.seats.clear();
    this.messages.clear();
    this.peerChanges.clear();
  }

  private dispatch(e: Envelope): void {
    const text = JSON.stringify(e);

    if (e.to === '*') {
      for (const seat of this.seats.values()) {
        if (seat.id !== e.from) post(seat, text);
      }
      return;
    }

    const seat = this.seats.get(e.to);
    if (seat) post(seat, text);
  }

  private receive(seat: Seat, data: string): void {
    seat.lastSeen = Date.now();

    let e: Envelope;
    try {
      e = JSON.parse(data) as Envelope;
    } catch {
      return;
    }

    if (e.type === BEAT) return;

    if (e.to !== this.self) this.dispatch(e);
    if (e.to === this.self || e.to === '*') this.messages.emit(e);
  }

  private sweep(): void {
    const now = Date.now();
    const stale = [...this.seats.values()].some(
      (seat) => !seat.failed && now - seat.lastSeen > DEGRADED_AFTER_MS,
    );
    // Health is derived, so the roster only needs a nudge when it would change.
    if (stale) this.peerChanges.emit(this.peers());
  }
}

/** A player holds exactly one connection, to the host. */
export class WebRtcPlayerTransport implements Transport {
  private readonly messages = new Emitter<Envelope>();
  private readonly peerChanges = new Emitter<PeerStatus[]>();
  private readonly seq = new Sequencer();
  private readonly timer: ReturnType<typeof setInterval>;
  private lastSeen = Date.now();
  private failed = false;

  constructor(
    readonly self: PlayerId,
    readonly hostId: PlayerId,
    private readonly pc: RTCPeerConnection,
    private readonly dc: RTCDataChannel,
  ) {
    dc.onmessage = (event: MessageEvent<string>) => this.receive(event.data);

    pc.addEventListener('connectionstatechange', () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        this.failed = true;
        this.peerChanges.emit(this.peers());
      }
    });

    this.timer = setInterval(() => {
      this.send(this.hostId, BEAT, null);
      if (Date.now() - this.lastSeen > DEGRADED_AFTER_MS) this.peerChanges.emit(this.peers());
    }, HEARTBEAT_MS);
  }

  send(to: PlayerId | '*', type: string, payload: unknown): void {
    // Everything goes to the host, which relays anything not addressed to it.
    if (this.dc.readyState !== 'open') return;
    this.dc.send(JSON.stringify({ v: 1, from: this.self, to, seq: this.seq.next(), type, payload }));
  }

  onMessage(handler: (e: Envelope) => void): Unsubscribe {
    return this.messages.on(handler);
  }

  onPeersChanged(handler: (peers: PeerStatus[]) => void): Unsubscribe {
    return this.peerChanges.on(handler);
  }

  peers(): PeerStatus[] {
    return [
      {
        id: this.hostId,
        name: 'Host',
        health: this.failed
          ? ('disconnected' as const)
          : health(Date.now() - this.lastSeen),
      },
    ];
  }

  close(): void {
    clearInterval(this.timer);
    this.pc.close();
    this.messages.clear();
    this.peerChanges.clear();
  }

  private receive(data: string): void {
    this.lastSeen = Date.now();

    let e: Envelope;
    try {
      e = JSON.parse(data) as Envelope;
    } catch {
      return;
    }

    if (e.type === BEAT) return;
    if (e.to === this.self || e.to === '*') this.messages.emit(e);
  }
}

function post(seat: Seat, text: string): void {
  if (seat.dc.readyState === 'open') seat.dc.send(text);
}

function health(silentFor: number): PeerHealth {
  return silentFor > DEGRADED_AFTER_MS ? 'degraded' : 'connected';
}
