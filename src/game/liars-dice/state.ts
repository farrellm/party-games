import type { PlayerId } from '../../net/handshake.ts';

export const DICE_PER_PLAYER = 5;
export const SIDES = 6;

export type Phase = 'ROLLING' | 'CALLED' | 'RESOLVED';

export type Seat = {
  id: PlayerId;
  name: string;
  dice: number[];
  out: boolean;
};

export type LiarsDiceState = {
  phase: Phase;
  seats: Seat[];
  /** Set in CALLED. The first press wins; later ones are ignored. */
  caller: PlayerId | null;
  /** Drives "X starts". */
  lastLoser: PlayerId | null;
  /** In the order they went out, which is the order placements are read off. */
  eliminated: PlayerId[];
  round: number;
};

/**
 * NEXT_ROUND is not in the design's two-action list, but its three-phase loop
 * needs something to leave RESOLVED — that phase shows who lost a die and who
 * starts, and then somebody has to shake the cups.
 *
 * It is legal from anyone still holding dice rather than only from whoever
 * "starts". In a loud room the person who should start has often put their
 * phone down, and a party game that can deadlock on one distracted player is
 * worse than one that lets a neighbour nudge it along.
 */
export type LiarsDiceAction =
  | { t: 'CALL_LIAR' }
  | { t: 'PICK_LOSER'; loser: PlayerId }
  | { t: 'NEXT_ROUND' };

export type LiarsDiceConfig = {
  /**
   * Reserved and off (§8). Neither would require the app to start tracking
   * bids, so both stay additive.
   */
  exactCalls: boolean;
  palifico: boolean;
};

export type RosterView = {
  id: PlayerId;
  name: string;
  /** A count. Never faces — that is the whole invariant. */
  diceCount: number;
  out: boolean;
};

export type LiarsDiceView = {
  phase: Phase;
  round: number;
  /** Only the viewer's own faces, and only ever theirs. */
  myDice: number[];
  amOut: boolean;
  roster: RosterView[];
  caller: { id: PlayerId; name: string } | null;
  /** Set in RESOLVED. */
  lastLoser: { id: PlayerId; name: string } | null;
  /** True when this viewer is the one who has to pick. */
  iAmCalling: boolean;
  winner: { id: PlayerId; name: string } | null;
};
