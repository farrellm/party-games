import { Emitter, type Transport, type Unsubscribe } from '../net/transport.ts';
import { ACT, REJECTED, SYNC, type ClientState, type RejectedMessage } from './protocol.ts';

/**
 * The player's half. It holds no game state of its own — only the last
 * projection the host sent — and it never mutates anything locally.
 *
 * That is what makes the secrecy invariant hold end to end: a player's device
 * has never been told another player's dice, so it cannot leak them however
 * badly its UI is written.
 */
export class MatchClient {
  private current: ClientState | null = null;
  private lastRejection: string | null = null;

  private readonly changes = new Emitter<void>();
  private readonly subscriptions: Unsubscribe[] = [];

  constructor(private readonly transport: Transport) {
    this.subscriptions.push(
      transport.onMessage((e) => {
        if (e.type === SYNC) {
          this.current = e.payload as ClientState;
          this.lastRejection = null;
          this.changes.emit();
        }

        if (e.type === REJECTED) {
          this.lastRejection = (e.payload as RejectedMessage).reason;
          this.changes.emit();
        }
      }),
    );
  }

  state(): ClientState | null {
    return this.current;
  }

  /** Why the host turned down the last thing this player tried, if it did. */
  rejection(): string | null {
    return this.lastRejection;
  }

  onChange(handler: () => void): Unsubscribe {
    return this.changes.on(handler);
  }

  dispatch(action: unknown): void {
    const hostId = this.current?.hostId;
    if (hostId) this.transport.send(hostId, ACT, { action });
  }

  close(): void {
    for (const off of this.subscriptions) off();
    this.changes.clear();
  }
}
