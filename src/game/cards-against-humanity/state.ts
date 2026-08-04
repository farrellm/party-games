import type { PlayerId } from '../../net/handshake.ts';
import type { DeckId } from './cards.ts';

export const HAND_SIZE = 10;

export type Phase = 'PICKING' | 'READING' | 'SCORED';

/**
 * What the table agreed to play to.
 *
 * `empty` is the deck running out, which at five players is something like a
 * hundred rounds — so in practice it means "no target, somebody will call it",
 * and the surface offers a way to do that in every mode.
 */
export type Until = 'points' | 'rounds' | 'empty';

export type Seat = {
  id: PlayerId;
  name: string;
  /** Indices into WHITE. The one genuinely private thing in this game. */
  hand: number[];
  /** Black cards taken. The physical game keeps the cards; a count is all we show. */
  wins: number;
};

export type Submission = {
  by: PlayerId;
  /** Indices into WHITE, in the order the player laid them down. */
  cards: number[];
};

/**
 * Everything here is a deck index, never a card's text.
 *
 * The deck ships on every device, so the host can keep state, its IndexedDB
 * snapshots and the wire down to small integers, and `view` resolves them to
 * prose at the last moment. A hand of ten becomes ten numbers rather than a
 * paragraph on every sync.
 */
export type CahState = {
  phase: Phase;
  round: number;
  seats: Seat[];
  /** Index into `seats`. Rotates one seat per round. */
  czar: number;
  /** Index into the deck's black cards. */
  black: number;

  /**
   * Which deck every index here is an offset into. Carried from config for the
   * same reason as the target below, and for one more: a snapshot resumed a day
   * later has to resolve its cards against the deck they were dealt from, not
   * against whatever the host happens to have selected by then.
   */
  deck: DeckId;

  blackPile: number[];
  blackDiscard: number[];
  whitePile: number[];
  whiteDiscard: number[];

  /** Carried from config, because `view` is only handed the state. */
  until: Until;
  points: number;
  rounds: number;

  /** In arrival order, which is why it is shuffled before the Czar sees it. */
  submissions: Submission[];
  /**
   * Indices into `submissions`, shuffled on entering READING. The Czar judges a
   * position in this list, so authorship never has to reach their device.
   */
  order: number[];
  /** Set in SCORED. */
  winner: PlayerId | null;

  /**
   * The game is over when the table says so, not when the score says so.
   *
   * `result` keys off this rather than off the score directly, because the
   * shell flips to RESULTS the instant `result` returns — so a game that ended
   * itself on the winning JUDGE would take the round's own SCORED screen with
   * it, and that screen is the one that shows the card that won. Ending on the
   * way out of a round instead means the table always sees what did it.
   */
  over: boolean;
};

/**
 * Composing a play is local to the player's own screen; only the confirmed
 * PLAY is dispatched. That is what "face down" means here, and it keeps an
 * UNPLAY off the wire entirely.
 *
 * NEXT_ROUND is legal from any seat rather than only the Czar, and FORCE_READ
 * exists at all, for the same reason liar's dice lets a neighbour nudge the
 * round along: a party game that deadlocks on one person whose phone went to
 * sleep is worse than one that can be moved on without them.
 */
export type CahAction =
  | { t: 'PLAY'; cards: number[] }
  | { t: 'FORCE_READ' }
  | { t: 'JUDGE'; pick: number }
  | { t: 'NEXT_ROUND' }
  | { t: 'FINISH' };

export type CahConfig = {
  deck: DeckId;
  until: Until;
  /**
   * Both are always present, and only the one `until` names is read.
   *
   * They are siblings rather than a discriminated union because each is then an
   * ordinary key the lobby can offer a list of values for — and because a host
   * who tries "10 rounds" and changes back still finds their 5 where they left
   * it.
   */
  points: number;
  rounds: number;
};

export type RosterView = {
  id: PlayerId;
  name: string;
  /** A count of black cards won. Never which ones, and never a hand. */
  wins: number;
  submitted: boolean;
  isCzar: boolean;
};

export type HandCard = {
  /** Index into WHITE — what a PLAY action names. */
  id: number;
  text: string;
};

export type CahView = {
  phase: Phase;
  round: number;
  /** The prompt, already resolved to text. Public — the Czar reads it aloud. */
  black: { text: string; pick: number };
  czar: { id: PlayerId; name: string };
  iAmCzar: boolean;

  /**
   * This viewer's hand, and only ever theirs. Carries the deck index so a play
   * names the card itself rather than a position that could drift.
   */
  myHand: HandCard[];
  /** What this viewer has already laid down this round. */
  mySubmission: string[] | null;

  submittedCount: number;
  /** How many players still owe a card. */
  waitingCount: number;

  /**
   * Non-null only for the Czar, and only in READING. Shuffled and stripped of
   * authorship: the Czar is judging the joke, not the friend.
   */
  submissions: string[][] | null;

  /** Set in SCORED. Public, because the Czar just read it out. */
  winner: { id: PlayerId; name: string; cards: string[] } | null;

  roster: RosterView[];
  /** Already resolved to the one that applies, so the surface just reads it. */
  ending:
    | { until: 'points'; points: number }
    | { until: 'rounds'; rounds: number }
    | { until: 'empty' };

  /**
   * Attribution is a licence term, so the credit names the edition actually in
   * play. `cc` is false for the Family Edition: its PDF grants no Creative
   * Commons licence, and claiming one would be a false statement rather than a
   * missing one. See NOTICE.md.
   */
  credit: { name: string; cc: boolean };
  /**
   * This round settled it, and the next tap ends the game rather than dealing
   * again. Announcing the winner is the shell's job, not this game's — all the
   * surface has to do is offer the right button.
   */
  lastRound: boolean;
};
