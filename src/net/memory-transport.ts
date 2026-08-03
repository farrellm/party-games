import type { PlayerId } from './handshake.ts';
import {
  Emitter,
  Sequencer,
  type Envelope,
  type PeerStatus,
  type Transport,
  type Unsubscribe,
} from './transport.ts';

/**
 * A star network in one process, for tests.
 *
 * It enforces the same topology as the real thing: players only ever reach each
 * other through the host, so a game that accidentally depends on direct
 * player-to-player delivery fails here too.
 */
export class MemoryNetwork {
  private readonly nodes = new Map<PlayerId, MemoryTransport>();
  private readonly names = new Map<PlayerId, string>();

  /** Envelopes seen by the switchboard, in order. Handy for asserting on traffic. */
  readonly log: Envelope[] = [];

  constructor(readonly hostId: PlayerId) {}

  connect(id: PlayerId, name: string): MemoryTransport {
    const node = new MemoryTransport(this, id);
    this.nodes.set(id, node);
    this.names.set(id, name);
    this.announce();
    return node;
  }

  disconnect(id: PlayerId): void {
    this.nodes.delete(id);
    this.announce();
  }

  peers(exclude: PlayerId): PeerStatus[] {
    return [...this.nodes.keys()]
      .filter((id) => id !== exclude)
      .map((id) => ({ id, name: this.names.get(id) ?? id, health: 'connected' as const }));
  }

  deliver(e: Envelope): void {
    this.log.push(e);

    if (e.to === '*') {
      // A broadcast from a player still passes through the host, which is the
      // only node holding a connection to everyone.
      for (const [id, node] of this.nodes) if (id !== e.from) node.receive(e);
      return;
    }

    this.nodes.get(e.to)?.receive(e);
  }

  private announce(): void {
    for (const [id, node] of this.nodes) node.peersChanged(this.peers(id));
  }
}

export class MemoryTransport implements Transport {
  private readonly messages = new Emitter<Envelope>();
  private readonly peerChanges = new Emitter<PeerStatus[]>();
  private readonly seq = new Sequencer();

  constructor(
    private readonly network: MemoryNetwork,
    readonly self: PlayerId,
  ) {}

  send(to: PlayerId | '*', type: string, payload: unknown): void {
    this.network.deliver({ v: 1, from: this.self, to, seq: this.seq.next(), type, payload });
  }

  onMessage(handler: (e: Envelope) => void): Unsubscribe {
    return this.messages.on(handler);
  }

  onPeersChanged(handler: (peers: PeerStatus[]) => void): Unsubscribe {
    return this.peerChanges.on(handler);
  }

  peers(): PeerStatus[] {
    return this.network.peers(this.self);
  }

  close(): void {
    this.network.disconnect(this.self);
    this.messages.clear();
    this.peerChanges.clear();
  }

  /** @internal — called by the network. */
  receive(e: Envelope): void {
    this.messages.emit(e);
  }

  /** @internal — called by the network. */
  peersChanged(peers: PeerStatus[]): void {
    this.peerChanges.emit(peers);
  }
}
