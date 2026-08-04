import type { PlayerId } from '../../net/handshake.ts';
import type { GameDefinition, Placement, SeatInfo } from '../types.ts';
import type { Rng } from '../rng.ts';
import { Cah } from './Cah.tsx';
import { deckOf } from './decks.ts';
import type { DeckId } from './cards.ts';
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
 * silently deals `undefined` on the one night somebody sets the target to 50 is
 * a worse outcome than four lines of bookkeeping.
 *
 * `recycle` turns it off, and only the white pile ever turns it off: the
 * `empty` ending is the whites running out, so recycling them would be
 * recycling the finish line. Blacks keep coming round either way — a hundred
 * prompts do not outlast five hundred answers.
 */
function draw(piles: Piles, rng: Rng, recycle = true): number | undefined {
  if (piles.pile.length === 0) {
    if (!recycle || piles.discard.length === 0) return undefined;
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
  return deckOf(state).black[state.black]!;
}

/**
 * How big a deck is, counted off the deck itself rather than written down
 * beside it — the two are genuinely different sizes, and a number typed into
 * the lobby by hand is a number that starts lying the day the cards change.
 */
function size(id: DeckId): string {
  const deck = deckOf({ deck: id });
  return `${deck.black.length}/${deck.white.length}`;
}

/** Resolved down to the one that applies, so the surface never has to choose. */
function ending(state: CahState): CahView['ending'] {
  switch (state.until) {
    case 'points':
      return { until: 'points', points: state.points };
    case 'rounds':
      return { until: 'rounds', rounds: state.rounds };
    case 'empty':
      return { until: 'empty' };
  }
}

/** Whether the end condition is satisfied. Not the same as the game being over. */
function done(state: CahState): boolean {
  switch (state.until) {
    case 'points':
      return state.seats.some((s) => s.wins >= state.points);
    case 'rounds':
      return state.round >= state.rounds;
    case 'empty':
      // The pile is the finish line, and it is not refilled in this mode.
      return state.whitePile.length === 0;
  }
}

/**
 * Everyone but the Czar owes a card — unless they have none left to play.
 *
 * Empty hands are only reachable in the `empty` ending, where the deck runs
 * down for real. A seat with nothing in hand can never submit, so counting it
 * would leave the round waiting on a card that cannot come.
 *
 * A seat that has *already* played still counts even though playing may have
 * emptied its hand. Dropping it would shrink the total mid-round and flip the
 * Czar's screen up while somebody was still choosing.
 */
function owed(state: CahState): number {
  const czar = czarSeat(state).id;
  return state.seats.filter(
    (s) => s.id !== czar && (s.hand.length > 0 || state.submissions.some((x) => x.by === s.id)),
  ).length;
}

function beginReading(state: CahState, rng: Rng): CahState {
  return { ...state, phase: 'READING', order: shuffled(indices(state.submissions.length), rng) };
}

export const cardsAgainstHumanity: GameDefinition<CahState, CahAction, CahView, CahConfig> = {
  id: 'cards-against-humanity',
  name: 'Cards Against Humanity',
  // "Adults only" was true of the only deck there used to be. It is not true of
  // the one a tap away, and the warning now lives on the choice it belongs to.
  blurb: 'Fill in the blank. The Czar picks the worst. Adults, or the Family Edition.',
  minPlayers: 3,
  maxPlayers: 10,

  /*
   * Blacklight violet. The cards themselves stay black and white, the way they
   * are printed; this hue is only ever the light in the room — the Czar, the
   * one button, and the words you supplied in the assembled sentence.
   */
  hue: '#B08CFF',

  defaultConfig: { deck: 'main', until: 'points', points: 5, rounds: 10 },

  /*
   * The deck notes describe who is at the table, because that is what the host
   * is actually looking at when they decide, and the sizes beside them are
   * counted off the decks rather than typed in.
   *
   * `until` and its number are two options rather than one so that each is an
   * ordinary key with a list of values; `when` is what keeps the number that
   * does not apply off the screen.
   */
  options: [
    {
      kind: 'one',
      key: 'deck',
      label: 'Deck',
      choices: [
        { value: 'main', label: 'Standard', note: `Adults only · ${size('main')}` },
        { value: 'family', label: 'Family Edition', note: `Kids can play · ${size('family')}` },
      ],
    },
    {
      kind: 'one',
      key: 'until',
      label: 'Ends',
      choices: [
        // Three parallel nouns for what ends it, rather than a preposition and
        // two nouns — and they fit the row, which "First to" did not.
        { value: 'points', label: 'Score' },
        { value: 'rounds', label: 'Rounds' },
        // Not a promise of a finish line: the deck outlasts the evening, and
        // somebody calls it. See `Until` in state.ts.
        { value: 'empty', label: 'Endless' },
      ],
    },
    {
      kind: 'one',
      key: 'points',
      label: 'First to',
      when: (config) => config.until === 'points',
      choices: [
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 7, label: '7' },
      ],
    },
    {
      kind: 'one',
      key: 'rounds',
      label: 'Rounds',
      when: (config) => config.until === 'rounds',
      choices: [
        { value: 5, label: '5' },
        { value: 10, label: '10' },
        { value: 15, label: '15' },
      ],
    },
  ],

  summary(config) {
    const deck = config.deck === 'family' ? 'Family Edition' : 'Standard';
    const ends =
      config.until === 'points'
        ? `first to ${config.points}`
        : config.until === 'rounds'
          ? `${config.rounds} rounds`
          : 'endless';
    return `${deck} · ${ends}`;
  },

  init(players: SeatInfo[], config, rng) {
    const deck = deckOf(config);
    const whites: Piles = { pile: shuffled(indices(deck.white.length), rng), discard: [] };
    const blacks: Piles = { pile: shuffled(indices(deck.black.length), rng), discard: [] };

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
      deck: config.deck,
      until: config.until,
      points: config.points,
      rounds: config.rounds,
      submissions: [],
      order: [],
      winner: null,
      over: false,
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

      case 'FINISH': {
        // Legal from any seat, like NEXT_ROUND and for the same reason: the
        // person who ought to press it may be the one whose phone went to sleep.
        if (state.phase !== 'SCORED') return 'Finish the round first.';
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

      case 'FINISH':
        return { ...state, over: true };

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

        // Playing to exhaustion means the whites are spent for good; every
        // other ending recycles them so a long game cannot deal `undefined`.
        const recycle = state.until !== 'empty';

        const seats = state.seats.map((seat) => {
          const hand = [...seat.hand];
          while (hand.length < HAND_SIZE) {
            const card = draw(whites, rng, recycle);
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
    // The one place a number becomes a card, and it resolves against the deck
    // recorded in state rather than a module constant — which is what lets a
    // second deck exist at all.
    const deck = deckOf(state);
    const me = seatOf(state, viewer);
    const czar = czarSeat(state);
    const iAmCzar = czar.id === viewer;
    const mine = state.submissions.find((s) => s.by === viewer) ?? null;
    const winner = state.winner ? seatOf(state, state.winner) : undefined;
    const winningCards = state.submissions.find((s) => s.by === state.winner)?.cards ?? [];

    return {
      phase: state.phase,
      round: state.round,
      black: { text: prompt(state).text, pick: prompt(state).pick },
      czar: { id: czar.id, name: czar.name },
      iAmCzar,

      myHand: (me?.hand ?? []).map((c) => ({ id: c, text: deck.white[c]! })),
      mySubmission: mine ? mine.cards.map((c) => deck.white[c]!) : null,

      submittedCount: state.submissions.length,
      waitingCount: Math.max(0, owed(state) - state.submissions.length),

      // The only place another player's cards are projected, and it costs the
      // Czar their authorship: `order` is a shuffle and nothing here says who.
      submissions:
        iAmCzar && state.phase === 'READING'
          ? state.order.map((i) => state.submissions[i]!.cards.map((c) => deck.white[c]!))
          : null,

      winner: winner
        ? { id: winner.id, name: winner.name, cards: winningCards.map((c) => deck.white[c]!) }
        : null,

      roster: state.seats.map((seat) => ({
        id: seat.id,
        name: seat.name,
        wins: seat.wins,
        submitted: state.submissions.some((s) => s.by === seat.id),
        isCzar: seat.id === czar.id,
      })),

      ending: ending(state),
      lastRound: done(state),
      credit: { name: deck.name, cc: state.deck === 'main' },
    };
  },

  result(state): Placement | null {
    if (!state.over) return null;

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
