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
 * A choice the host makes in the lobby, before the game starts.
 *
 * Declarative because the shell is colourless and knows nothing about any game:
 * it renders what a game declares and hands the answer straight back to `init`
 * as config. Nothing about a choice reaches the wire — `init` copies whatever
 * `view` will need into game state, the way it already does for a scoring
 * target.
 *
 * `kind` has one member on purpose. Several values for one key (expansion packs
 * are the coming case) wants a second variant, and a discriminant here means
 * that arrives as a new member rather than as a reinterpretation of this one.
 */
export type GameChoice<C, K extends keyof C> = {
  kind: 'one';
  key: K;
  label: string;
  choices: { value: C[K]; label: string; note?: string }[];
  /** Absent means always. For options that only apply in some modes. */
  when?: (config: C) => boolean;
};

/**
 * Distributed over the config's keys, so a choice's `value` has to be the type
 * of the key it sets — a wrong constant is a compile error rather than a
 * surprise in `init`.
 *
 * Narrowed to string keys deliberately. `AnyGame` erases `C` to `any`, and
 * `keyof any` drags in `number | symbol`, which would leave the erased option
 * below unassignable from the declared one for no gain: config keys are
 * properties in a literal, and there is no other kind.
 */
export type GameOption<C> = {
  [K in keyof C & string]-?: GameChoice<C, K>;
}[keyof C & string];

/**
 * The same option with its config type erased, which is all the shell can know.
 * `AnyGame` throws `C` away, so this is what `HostLobby` actually renders.
 */
export type AnyOption = {
  kind: 'one';
  key: string;
  label: string;
  choices: { value: unknown; label: string; note?: string }[];
  when?: (config: Record<string, unknown>) => boolean;
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

  /** What the host may change before starting. Absent means nothing to choose. */
  options?: GameOption<C>[];
  /**
   * One line naming the current setup, in the game's own voice. The lobby keeps
   * the options collapsed behind it, and the shell cannot write "first to 5"
   * out of two independent options without guessing at how they read together.
   */
  summary?: (config: C) => string;

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
