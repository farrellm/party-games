import type { PlayerId } from './handshake.ts';

/**
 * Every message on the wire. JSON-encoded: party-game payloads are tiny, and
 * being able to read them in a console beats saving a few bytes.
 */
export type Envelope = {
  v: 1;
  from: PlayerId;
  /** '*' is a broadcast. Anything else the host will relay if it isn't for it. */
  to: PlayerId | '*';
  /** Per-sender, monotonic. */
  seq: number;
  type: string;
  payload: unknown;
};

export type PeerHealth = 'connected' | 'degraded' | 'disconnected';

export type PeerStatus = {
  id: PlayerId;
  name: string;
  health: PeerHealth;
};

export type Unsubscribe = () => void;

/**
 * Games and the match shell only ever see this. Keeping the surface this
 * narrow is what lets the whole host/projection/action loop be tested in
 * process, with no browser and no WebRTC (§12).
 */
export interface Transport {
  readonly self: PlayerId;
  send(to: PlayerId | '*', type: string, payload: unknown): void;
  onMessage(handler: (e: Envelope) => void): Unsubscribe;
  onPeersChanged(handler: (peers: PeerStatus[]) => void): Unsubscribe;
  peers(): PeerStatus[];
  close(): void;
}

/** Heartbeat cadence and the silence thresholds that follow from it (§4). */
export const HEARTBEAT_MS = 3_000;
export const DEGRADED_AFTER_MS = 8_000;

export class Emitter<T> {
  private handlers = new Set<(value: T) => void>();

  on(handler: (value: T) => void): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(value: T): void {
    for (const handler of [...this.handlers]) handler(value);
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Sequence numbers are per-sender and only ever compared to their predecessor. */
export class Sequencer {
  private n = 0;

  next(): number {
    return ++this.n;
  }
}
