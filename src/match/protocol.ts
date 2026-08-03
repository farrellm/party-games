import type { PlayerId } from '../net/handshake.ts';
import type { PeerHealth } from '../net/transport.ts';
import type { Placement } from '../game/types.ts';

export type MatchPhase = 'LOBBY' | 'PLAYING' | 'RESULTS';

export type RosterEntry = {
  id: PlayerId;
  name: string;
  health: PeerHealth;
  /** Accumulated across every game in the match, not just this one. */
  score: number;
};

/**
 * Everything one device is allowed to know, in one message.
 *
 * Whole-state sync rather than diffs: a party game's state is a few hundred
 * bytes, and a client that can only ever be one message behind is a client
 * that cannot desynchronise.
 */
export type ClientState = {
  phase: MatchPhase;
  roster: RosterEntry[];
  hostId: PlayerId;
  gameId: string | null;
  /** The projection from GameDefinition.view — this viewer's, and only theirs. */
  view: unknown;
  result: Placement | null;
  /** Which game of the match this is, counting from one. */
  gameNumber: number;
};

export const SYNC = 'sync';
export const ACT = 'act';
export const REJECTED = 'rejected';

export type ActMessage = { action: unknown };
export type RejectedMessage = { reason: string };
