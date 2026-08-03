import type { PlayerId } from '../net/handshake.ts';
import { Emitter, type PeerStatus, type Transport, type Unsubscribe } from '../net/transport.ts';
import type { AnyGame, SeatInfo } from '../game/types.ts';
import { makeRng, randomSeed, type RngState } from '../game/rng.ts';
import { ACT, REJECTED, SYNC, type ActMessage, type ClientState, type MatchPhase } from './protocol.ts';
import { saveSnapshot, type Snapshot } from './snapshot.ts';

type Seat = {
  id: PlayerId;
  name: string;
  score: number;
};

type Running = {
  game: AnyGame;
  state: unknown;
  rng: RngState;
};

/**
 * The authoritative half of a match.
 *
 * A match is a sequence of game instances over a stable roster (§6). The shell
 * owns the roster, the cross-game scoreboard and the flow between games, so
 * that "multiple rounds, tracking scores" is a property of the app rather than
 * something every game reimplements.
 */
export class MatchHost {
  private readonly seats = new Map<PlayerId, Seat>();
  private readonly changes = new Emitter<void>();
  private readonly subscriptions: Unsubscribe[] = [];

  private phase: MatchPhase = 'LOBBY';
  private running: Running | null = null;
  private gameNumber = 0;
  private health = new Map<PlayerId, PeerStatus['health']>();

  readonly matchId = crypto.randomUUID();

  constructor(
    private readonly transport: Transport,
    readonly self: PlayerId,
    selfName: string,
  ) {
    this.seats.set(self, { id: self, name: selfName, score: 0 });

    this.subscriptions.push(
      transport.onMessage((e) => {
        if (e.type === ACT) this.dispatch(e.from, (e.payload as ActMessage).action);
      }),
      transport.onPeersChanged((peers) => {
        this.health = new Map(peers.map((p) => [p.id, p.health]));
        // A phone falling asleep changes the roster, not the game.
        this.changes.emit();
        this.broadcast();
      }),
    );
  }

  onChange(handler: () => void): Unsubscribe {
    return this.changes.on(handler);
  }

  /**
   * Seat a player, or re-seat one we already know.
   *
   * A returning playerId keeps its score and its place in the running game —
   * that is the whole point of persisting identity in localStorage (§4).
   */
  seat(id: PlayerId, name: string): void {
    const existing = this.seats.get(id);
    if (existing) existing.name = name;
    else this.seats.set(id, { id, name, score: 0 });

    this.changes.emit();
    // Send the newcomer their projection immediately rather than making them
    // wait for the next state change.
    this.syncTo(id);
    this.broadcast();
  }

  roster(): Seat[] {
    return [...this.seats.values()];
  }

  canStart(game: AnyGame): boolean {
    return this.seats.size >= game.minPlayers && this.seats.size <= game.maxPlayers;
  }

  start(game: AnyGame): void {
    const players: SeatInfo[] = this.roster().map(({ id, name }) => ({ id, name }));
    const rng = makeRng({ seed: randomSeed(), calls: 0 });

    this.running = {
      game,
      state: game.init(players, game.defaultConfig, rng),
      rng: rng.snapshot(),
    };
    this.gameNumber++;
    this.phase = 'PLAYING';

    this.settle();
  }

  /** Back to the lobby with the same roster and the same scores. */
  toLobby(): void {
    this.running = null;
    this.phase = 'LOBBY';
    this.settle();
  }

  dispatch(actor: PlayerId, action: unknown): void {
    const running = this.running;
    if (!running || this.phase !== 'PLAYING') return;
    if (!this.seats.has(actor)) return;

    const reason = running.game.validate(running.state, actor, action);
    if (reason !== null) {
      // Rejections are told only to whoever tried. Everyone else's screen has
      // no business flickering because someone mistimed a tap.
      if (actor !== this.self) this.transport.send(actor, REJECTED, { reason });
      return;
    }

    const rng = makeRng(running.rng);
    running.state = running.game.reduce(running.state, actor, action, rng);
    running.rng = rng.snapshot();

    const result = running.game.result(running.state);
    if (result) {
      for (const [id, points] of Object.entries(result.points)) {
        const seat = this.seats.get(id);
        if (seat) seat.score += points;
      }
      this.phase = 'RESULTS';
    }

    this.settle();
  }

  /** What this device — the host is a player too — should render. */
  clientState(): ClientState {
    return this.stateFor(this.self);
  }

  close(): void {
    for (const off of this.subscriptions) off();
    this.changes.clear();
  }

  private settle(): void {
    this.changes.emit();
    this.broadcast();
    void this.persist();
  }

  private stateFor(viewer: PlayerId): ClientState {
    const running = this.running;

    return {
      phase: this.phase,
      hostId: this.self,
      gameId: running?.game.id ?? null,
      gameNumber: this.gameNumber,
      view: running ? running.game.view(running.state, viewer) : null,
      result: running ? running.game.result(running.state) : null,
      roster: this.roster().map((seat) => ({
        id: seat.id,
        name: seat.name,
        score: seat.score,
        health: seat.id === this.self ? 'connected' : (this.health.get(seat.id) ?? 'connected'),
      })),
    };
  }

  private syncTo(id: PlayerId): void {
    if (id === this.self) return;
    this.transport.send(id, SYNC, this.stateFor(id));
  }

  /**
   * One message per player, each carrying only that player's projection. No
   * broadcast of game state ever happens, because a broadcast would by
   * definition contain somebody else's secrets.
   */
  private broadcast(): void {
    for (const seat of this.seats.values()) this.syncTo(seat.id);
  }

  private async persist(): Promise<void> {
    const snapshot: Snapshot = {
      matchId: this.matchId,
      hostId: this.self,
      seats: this.roster(),
      gameId: this.running?.game.id ?? null,
      gameNumber: this.gameNumber,
      gameState: this.running?.state ?? null,
      rng: this.running?.rng ?? { seed: 0, calls: 0 },
      savedAt: Date.now(),
    };
    await saveSnapshot(snapshot);
  }
}
