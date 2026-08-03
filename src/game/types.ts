import type { JSX } from 'react';
import type { PlayerId } from '../net/handshake.ts';
import type { Rng } from './rng.ts';

export type Placement = {
  /** Best first. */
  placements: PlayerId[];
  points: Record<PlayerId, number>;
};

export type SeatInfo = {
  id: PlayerId;
  name: string;
};

/**
 * A game is a pure reducer, a projection, and a component.
 *
 * Host-authoritative with per-player view projection — deliberately not a
 * symmetric replicated state machine. A replicated machine would put the whole
 * state on every device, which for liar's dice means every phone holds every
 * player's dice. The projection is what keeps secrets secret (§5).
 */
export interface GameDefinition<S, A, V, C> {
  id: string;
  name: string;
  /** One line, shown under the name in the game list. */
  blurb: string;
  minPlayers: number;
  maxPlayers: number;
  defaultConfig: C;

  /**
   * The one hue this game lights its surface with. The shell owns everything
   * else, so a second game brings its own colour and needs no redesign.
   */
  hue: string;

  init(players: SeatInfo[], config: C, rng: Rng): S;
  /** null means legal. Anything else is a reason, in words a player could read. */
  validate(state: S, actor: PlayerId, action: A): string | null;
  /** Host only. Never called on a player's device. */
  reduce(state: S, actor: PlayerId, action: A, rng: Rng): S;
  /** The projection. Must never include another player's secrets. */
  view(state: S, viewer: PlayerId): V;
  /** null while the game is still running. */
  result(state: S): Placement | null;

  Component: (props: {
    view: V;
    me: PlayerId;
    dispatch: (action: A) => void;
  }) => JSX.Element;
}

/** Games are stored and passed around without their type parameters. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGame = GameDefinition<any, any, any, any>;
