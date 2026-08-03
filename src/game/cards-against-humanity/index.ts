import type { PlayerId } from '../../net/handshake.ts';
import type { GameDefinition, Placement, SeatInfo } from '../types.ts';
import type { Rng } from '../rng.ts';
import { Cah } from './Cah.tsx';
import { BLACK, WHITE } from './deck.ts';
import {
  HAND_SIZE,
  type CahAction,
  type CahConfig,
  type CahState,
  type CahView,
  type Seat,
} from './state.ts';

/*
 * A dealer and a scorekeeper (§5). The reading still happens out loud, across
 * the table — the Czar's screen is the only one that shows the submissions, and
 * only while they are reading them. Everyone else gets "Ellie is reading", the
 * same way they would get a person holding a fan of cards.
 *
 * Every number in this file is a deck index. Text appears only in `view`.
 */

function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function indices(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

/** Piles are drawn from and reshuffled in place, on a copy the reducer owns. */
type Piles = { pile: number[]; discard: number[] };

/**
 * A deck of 500 whites cannot actually run out with ten players, and a hundred
 * blacks outlast a race to five. The reshuffle is here because a game that
 * silently deals `undefined` on the one night somebody sets pointsToWin to 50
 * is a worse outcome than four lines of bookkeeping.
 */
function draw(piles: Piles, rng: Rng): number | undefined {
  if (piles.pile.length === 0) {
    if (piles.discard.length === 0) return undefined;
    piles.pile = shuffled(piles.discard, rng);
    piles.discard = [];
  }
  return piles.pile.pop();
}

function seatOf(state: CahState, id: PlayerId): Seat | undefined {
  return state.seats.find((s) => s.id === id);
}

function czarSeat(state: CahState): Seat {
  // The czar index is rotated modulo seats.length and seats never leave, so
  // this cannot miss. `!` rather than a fallback seat that would hide a bug.
  return state.seats[state.czar]!;
}

function prompt(state: CahState) {
  return BLACK[state.black]!;
}

/** Everyone but the Czar owes a card. */
function owed(state: CahState): number {
  return state.seats.length - 1;
}

function beginReading(state: CahState, rng: Rng): CahState {
  return { ...state, phase: 'READING', order: shuffled(indices(state.submissions.length), rng) };
}

export const cardsAgainstHumanity: GameDefinition<CahState, CahAction, CahView, CahConfig> = {
  id: 'cards-against-humanity',
  name: 'Cards Against Humanity',
  blurb: 'Fill in the blank. The Czar picks the worst. Adults only.',
  minPlayers: 3,
  maxPlayers: 10,

  /*
   * Blacklight violet. The cards themselves stay black and white, the way they
   * are printed; this hue is only ever the light in the room — the Czar, the
   * one button, and the words you supplied in the assembled sentence.
   */
  hue: '#B08CFF',

  defaultConfig: { pointsToWin: 5 },

  init(players: SeatInfo[], config, rng) {
    const whites: Piles = { pile: shuffled(indices(WHITE.length), rng), discard: [] };
    const blacks: Piles = { pile: shuffled(indices(BLACK.length), rng), discard: [] };

    const seats: Seat[] = players.map(({ id, name }) => ({
      id,
      name,
      hand: Array.from({ length: HAND_SIZE }, () => draw(whites, rng)!),
      wins: 0,
    }));

    return {
      phase: 'PICKING',
      round: 1,
      seats,
      czar: rng.int(seats.length),
      black: draw(blacks, rng)!,
      blackPile: blacks.pile,
      blackDiscard: blacks.discard,
      whitePile: whites.pile,
      whiteDiscard: whites.discard,
      pointsToWin: config.pointsToWin,
      submissions: [],
      order: [],
      winner: null,
    };
  },

  validate(state, actor, action) {
    const seat = seatOf(state, actor);
    if (!seat) return 'You’re not in this game.';
    const isCzar = czarSeat(state).id === actor;

    switch (action.t) {
      case 'PLAY': {
        if (state.phase !== 'PICKING') return 'Everyone is in — too late to change it.';
        if (isCzar) return 'You’re the Czar this round. You judge, you don’t play.';
        if (state.submissions.some((s) => s.by === actor)) return 'You already played.';

        const { pick } = prompt(state);
        if (action.cards.length !== pick) {
          return pick === 1 ? 'Play one card.' : `This one takes ${pick} cards.`;
        }
        if (new Set(action.cards).size !== action.cards.length) {
          return 'You can only play a card once.';
        }
        if (!action.cards.every((c) => seat.hand.includes(c))) return 'That isn’t in your hand.';
        return null;
      }

      case 'FORCE_READ': {
        if (state.phase !== 'PICKING') return 'Nobody is still picking.';
        if (!isCzar) return 'Only the Czar can start reading.';
        // Below two there is nothing to judge between, so this would just be a
        // way to hand yourself the round.
        if (state.submissions.length < 2) return 'Wait for at least two cards.';
        return null;
      }

      case 'JUDGE': {
        if (state.phase !== 'READING') return 'Still waiting on cards.';
        if (!isCzar) return 'Only the Czar picks the winner.';
        if (action.pick < 0 || action.pick >= state.order.length) return 'No such answer.';
        return null;
      }

      case 'NEXT_ROUND': {
        if (state.phase !== 'SCORED') return 'The round is still going.';
        return null;
      }
    }
  },

  reduce(state, actor, action, rng) {
    switch (action.t) {
      case 'PLAY': {
        const played = new Set(action.cards);
        const next: CahState = {
          ...state,
          seats: state.seats.map((seat) =>
            seat.id === actor ? { ...seat, hand: seat.hand.filter((c) => !played.has(c)) } : seat,
          ),
          submissions: [...state.submissions, { by: actor, cards: action.cards }],
        };

        // The last card in flips the round on its own — nobody has to press
        // anything, and the Czar's screen fills the moment the table is done.
        return next.submissions.length >= owed(next) ? beginReading(next, rng) : next;
      }

      case 'FORCE_READ':
        return beginReading(state, rng);

      case 'JUDGE': {
        const winning = state.submissions[state.order[action.pick]!]!;
        return {
          ...state,
          phase: 'SCORED',
          winner: winning.by,
          seats: state.seats.map((seat) =>
            seat.id === winning.by ? { ...seat, wins: seat.wins + 1 } : seat,
          ),
        };
      }

      case 'NEXT_ROUND': {
        const whites: Piles = { pile: [...state.whitePile], discard: [...state.whiteDiscard] };
        const blacks: Piles = { pile: [...state.blackPile], discard: [...state.blackDiscard] };

        // Spent cards go face down, and come back only once the pile is out.
        for (const s of state.submissions) whites.discard.push(...s.cards);
        blacks.discard.push(state.black);

        const seats = state.seats.map((seat) => {
          const hand = [...seat.hand];
          while (hand.length < HAND_SIZE) {
            const card = draw(whites, rng);
            if (card === undefined) break;
            hand.push(card);
          }
          return { ...seat, hand };
        });

        return {
          ...state,
          phase: 'PICKING',
          round: state.round + 1,
          seats,
          czar: (state.czar + 1) % state.seats.length,
          black: draw(blacks, rng) ?? state.black,
          blackPile: blacks.pile,
          blackDiscard: blacks.discard,
          whitePile: whites.pile,
          whiteDiscard: whites.discard,
          submissions: [],
          order: [],
          winner: null,
        };
      }
    }
  },

  view(state, viewer): CahView {
    const me = seatOf(state, viewer);
    const czar = czarSeat(state);
    const iAmCzar = czar.id === viewer;
    const mine = state.submissions.find((s) => s.by === viewer) ?? null;
    const winner = state.winner ? seatOf(state, state.winner) : undefined;
    const winningCards = state.submissions.find((s) => s.by === state.winner)?.cards ?? [];
    const taken = state.seats.find((s) => s.wins >= state.pointsToWin) ?? null;

    return {
      phase: state.phase,
      round: state.round,
      black: { text: BLACK[state.black]!.text, pick: BLACK[state.black]!.pick },
      czar: { id: czar.id, name: czar.name },
      iAmCzar,

      myHand: (me?.hand ?? []).map((c) => ({ id: c, text: WHITE[c]! })),
      mySubmission: mine ? mine.cards.map((c) => WHITE[c]!) : null,

      submittedCount: state.submissions.length,
      waitingCount: Math.max(0, owed(state) - state.submissions.length),

      // The only place another player's cards are projected, and it costs the
      // Czar their authorship: `order` is a shuffle and nothing here says who.
      submissions:
        iAmCzar && state.phase === 'READING'
          ? state.order.map((i) => state.submissions[i]!.cards.map((c) => WHITE[c]!))
          : null,

      winner: winner
        ? { id: winner.id, name: winner.name, cards: winningCards.map((c) => WHITE[c]!) }
        : null,

      roster: state.seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        wins: seat.wins,
        submitted: state.submissions.some((s) => s.by === seat.id),
        isCzar: seat.id === czar.id,
      })),

      pointsToWin: state.pointsToWin,
      gameWinner: taken ? { id: taken.id, name: taken.name } : null,
    };
  },

  result(state): Placement | null {
    if (!state.seats.some((s) => s.wins >= state.pointsToWin)) return null;

    // Stable, so a tie on black cards is broken by seating order rather than
    // by whatever the sort happened to do that night.
    const ranked = [...state.seats].sort((a, b) => b.wins - a.wins);
    const placements = ranked.map((s) => s.id);

    const points: Record<PlayerId, number> = {};
    placements.forEach((id, index) => {
      points[id] = placements.length - 1 - index;
    });

    return { placements, points };
  },

  Component: Cah,
};
