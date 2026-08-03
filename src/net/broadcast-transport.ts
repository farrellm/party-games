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

const CHANNEL = 'party-games';

type Wire =
  | { kind: 'envelope'; envelope: Envelope }
  | { kind: 'hello'; id: PlayerId; name: string }
  | { kind: 'beat'; id: PlayerId; name: string }
  | { kind: 'bye'; id: PlayerId };

/**
 * Several tabs on one machine, playing a real game with no cameras involved.
 *
 * Reached with ?transport=broadcast. This exists so UI work doesn't require
 * four phones and a QR scan per reload — it is a development affordance, not a
 * shipping feature, and it deliberately skips the handshake entirely.
 */
export class BroadcastChannelTransport implements Transport {
  private readonly channel = new BroadcastChannel(CHANNEL);
  private readonly messages = new Emitter<Envelope>();
  private readonly peerChanges = new Emitter<PeerStatus[]>();
  private readonly seq = new Sequencer();
  private readonly lastSeen = new Map<PlayerId, { name: string; at: number }>();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    readonly self: PlayerId,
    private readonly name: string,
  ) {
    this.channel.onmessage = (event: MessageEvent<Wire>) => this.receive(event.data);

    this.timer = setInterval(() => {
      this.post({ kind: 'beat', id: this.self, name: this.name });
      this.prune();
    }, HEARTBEAT_MS);

    this.post({ kind: 'hello', id: this.self, name: this.name });
  }

  send(to: PlayerId | '*', type: string, payload: unknown): void {
    this.post({
      kind: 'envelope',
      envelope: { v: 1, from: this.self, to, seq: this.seq.next(), type, payload },
    });
  }

  onMessage(handler: (e: Envelope) => void): Unsubscribe {
    return this.messages.on(handler);
  }

  onPeersChanged(handler: (peers: PeerStatus[]) => void): Unsubscribe {
    return this.peerChanges.on(handler);
  }

  peers(): PeerStatus[] {
    const now = Date.now();
    return [...this.lastSeen.entries()].map(([id, seen]) => ({
      id,
      name: seen.name,
      health: health(now - seen.at),
    }));
  }

  close(): void {
    clearInterval(this.timer);
    this.post({ kind: 'bye', id: this.self });
    this.channel.close();
    this.messages.clear();
    this.peerChanges.clear();
  }

  private post(wire: Wire): void {
    this.channel.postMessage(wire);
  }

  private receive(wire: Wire): void {
    switch (wire.kind) {
      case 'envelope': {
        const { envelope } = wire;
        if (envelope.from === this.self) return;
        if (envelope.to !== '*' && envelope.to !== this.self) return;
        this.touch(envelope.from);
        this.messages.emit(envelope);
        return;
      }

      case 'hello': {
        if (wire.id === this.self) return;
        this.lastSeen.set(wire.id, { name: wire.name, at: Date.now() });
        // Answer a hello with a beat so the newcomer learns about us without
        // waiting a full heartbeat.
        this.post({ kind: 'beat', id: this.self, name: this.name });
        this.peerChanges.emit(this.peers());
        return;
      }

      case 'beat': {
        if (wire.id === this.self) return;
        const known = this.lastSeen.has(wire.id);
        this.lastSeen.set(wire.id, { name: wire.name, at: Date.now() });
        if (!known) this.peerChanges.emit(this.peers());
        return;
      }

      case 'bye': {
        if (this.lastSeen.delete(wire.id)) this.peerChanges.emit(this.peers());
        return;
      }
    }
  }

  private touch(id: PlayerId): void {
    const seen = this.lastSeen.get(id);
    if (seen) seen.at = Date.now();
  }

  private prune(): void {
    const now = Date.now();
    let changed = false;

    for (const [id, seen] of this.lastSeen) {
      // Three missed beats and the tab is gone, not just slow.
      if (now - seen.at > DEGRADED_AFTER_MS * 2) {
        this.lastSeen.delete(id);
        changed = true;
      } else if (now - seen.at > DEGRADED_AFTER_MS) {
        changed = true;
      }
    }

    if (changed) this.peerChanges.emit(this.peers());
  }
}

function health(silentFor: number): PeerHealth {
  return silentFor > DEGRADED_AFTER_MS ? 'degraded' : 'connected';
}
