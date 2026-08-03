import type { PlayerId } from '../../net/handshake.ts';
import type { GameDefinition, Placement, SeatInfo } from '../types.ts';
import type { Rng } from '../rng.ts';
import { LiarsDice } from './LiarsDice.tsx';
import {
  DICE_PER_PLAYER,
  SIDES,
  type LiarsDiceAction,
  type LiarsDiceConfig,
  type LiarsDiceState,
  type LiarsDiceView,
  type Seat,
} from './state.ts';

/*
 * A secret dice dealer and a scorekeeper. Not a rules engine.
 *
 * Bidding happens out loud, across the table, the way it does with real dice
 * under real cups. This app never asks anyone to type a bid, tracks no turn
 * order, and never tallies a challenge. Ones are wild — but that is a rule the
 * humans apply while counting, not something the software computes (§8).
 */

function roll(rng: Rng, count: number): number[] {
  return Array.from({ length: count }, () => rng.die(SIDES));
}

function seatOf(state: LiarsDiceState, id: PlayerId): Seat | undefined {
  return state.seats.find((s) => s.id === id);
}

function stillIn(state: LiarsDiceState): Seat[] {
  return state.seats.filter((s) => !s.out);
}

export const liarsDice: GameDefinition<
  LiarsDiceState,
  LiarsDiceAction,
  LiarsDiceView,
  LiarsDiceConfig
> = {
  id: 'liars-dice',
  name: "Liar's Dice",
  blurb: 'Five secret dice each. Bid out loud. Call the bluff.',
  minPlayers: 2,
  maxPlayers: 8,
  hue: '#EDE4D3',

  defaultConfig: { exactCalls: false, palifico: false },

  init(players: SeatInfo[], _config, rng) {
    return {
      phase: 'ROLLING',
      round: 1,
      caller: null,
      lastLoser: null,
      eliminated: [],
      seats: players.map(({ id, name }) => ({
        id,
        name,
        dice: roll(rng, DICE_PER_PLAYER),
        out: false,
      })),
    };
  },

  validate(state, actor, action) {
    const seat = seatOf(state, actor);
    if (!seat) return "You're not in this game.";

    switch (action.t) {
      case 'CALL_LIAR': {
        // Two rules are all the software owns. This is the first.
        if (state.phase !== 'ROLLING') return 'Too late — someone already called.';
        if (seat.out) return "You're out of dice.";
        return null;
      }

      case 'PICK_LOSER': {
        if (state.phase !== 'CALLED') return 'Nobody has called liar.';
        if (state.caller !== actor) return 'Only the caller decides who lost.';

        const loser = seatOf(state, action.loser);
        if (!loser) return 'No such player.';
        if (loser.out) return 'They have no dice left to lose.';
        return null;
      }

      case 'NEXT_ROUND': {
        if (state.phase !== 'RESOLVED') return 'The round is still going.';
        if (seat.out) return "You're out of dice.";
        return null;
      }
    }
  },

  reduce(state, actor, action, rng) {
    switch (action.t) {
      case 'CALL_LIAR':
        // The host accepts the first press and ignores the rest, so
        // simultaneous calls resolve deterministically rather than racing.
        return { ...state, phase: 'CALLED', caller: actor };

      case 'PICK_LOSER': {
        let knockedOut = false;

        const seats = state.seats.map((seat) => {
          if (seat.id !== action.loser) return seat;

          // The faces are spent either way; only the count carries forward.
          const dice = seat.dice.slice(0, -1);
          knockedOut = dice.length === 0;
          return { ...seat, dice, out: knockedOut };
        });

        return {
          ...state,
          seats,
          phase: 'RESOLVED',
          caller: null,
          lastLoser: action.loser,
          eliminated: knockedOut ? [...state.eliminated, action.loser] : state.eliminated,
        };
      }

      case 'NEXT_ROUND':
        return {
          ...state,
          phase: 'ROLLING',
          round: state.round + 1,
          caller: null,
          seats: state.seats.map((seat) =>
            seat.out ? seat : { ...seat, dice: roll(rng, seat.dice.length) },
          ),
        };
    }
  },

  view(state, viewer): LiarsDiceView {
    const me = seatOf(state, viewer);
    const caller = state.caller ? seatOf(state, state.caller) : null;
    const lastLoser = state.lastLoser ? seatOf(state, state.lastLoser) : null;
    const survivors = stillIn(state);
    const winner = survivors.length === 1 ? survivors[0]! : null;

    return {
      phase: state.phase,
      round: state.round,

      // The only faces that ever leave the host for this device.
      myDice: me?.dice ?? [],
      amOut: me?.out ?? true,

      roster: state.seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        diceCount: seat.dice.length,
        out: seat.out,
      })),

      caller: caller ? { id: caller.id, name: caller.name } : null,
      lastLoser: lastLoser ? { id: lastLoser.id, name: lastLoser.name } : null,
      iAmCalling: state.caller === viewer,
      winner: winner ? { id: winner.id, name: winner.name } : null,
    };
  },

  result(state): Placement | null {
    const survivors = stillIn(state);
    if (survivors.length > 1) return null;

    // Last out is runner-up, and so on back down the order they were knocked
    // out in. The survivor, if there is one, takes first.
    const placements = [...survivors.map((s) => s.id), ...[...state.eliminated].reverse()];

    const points: Record<PlayerId, number> = {};
    placements.forEach((id, index) => {
      points[id] = placements.length - 1 - index;
    });

    return { placements, points };
  },

  Component: LiarsDice,
};
