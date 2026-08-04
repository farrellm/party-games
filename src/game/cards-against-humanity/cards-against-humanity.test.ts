import { describe, expect, it } from 'vitest';
import { cardsAgainstHumanity as cah } from './index.ts';
import { makeRng } from '../rng.ts';
import { BLACK, WHITE } from './deck.ts';
import { deckOf } from './decks.ts';
import { HAND_SIZE, type CahAction, type CahConfig, type CahState } from './state.ts';

const PLAYERS = [
  { id: 'ann', name: 'Ann' },
  { id: 'bo', name: 'Bo' },
  { id: 'cy', name: 'Cy' },
  { id: 'di', name: 'Di' },
];

/** `config` is an overlay, so a case names only the setting it is about. */
function fresh(seed = 1, config: Partial<CahConfig> = {}): CahState {
  return cah.init(PLAYERS, { ...cah.defaultConfig, ...config }, makeRng({ seed, calls: 0 }));
}

/** Applies an action the way MatchHost does: validate, then reduce. */
function apply(state: CahState, actor: string, action: CahAction): CahState {
  const reason = cah.validate(state, actor, action);
  if (reason !== null) throw new Error(`rejected: ${reason}`);
  return cah.reduce(state, actor, action, makeRng({ seed: 99, calls: state.round }));
}

function seat(state: CahState, id: string) {
  return state.seats.find((s) => s.id === id)!;
}

function czarId(state: CahState): string {
  return state.seats[state.czar]!.id;
}

function others(state: CahState): string[] {
  return state.seats.filter((s) => s.id !== czarId(state)).map((s) => s.id);
}

/** Everyone but the Czar plays the first legal cards off the top of their hand. */
function everyonePlays(state: CahState): CahState {
  const pick = deckOf(state).black[state.black]!.pick;
  for (const id of others(state)) {
    state = apply(state, id, { t: 'PLAY', cards: seat(state, id).hand.slice(0, pick) });
  }
  return state;
}

/** A full round: everyone plays, the Czar judges position 0, the table moves on. */
function playRound(state: CahState, winnerAt = 0): CahState {
  state = everyonePlays(state);
  state = apply(state, czarId(state), { t: 'JUDGE', pick: winnerAt });
  return state;
}

/** Every card index that exists somewhere, which must always be the whole deck. */
function allWhites(state: CahState): number[] {
  return [
    ...state.whitePile,
    ...state.whiteDiscard,
    ...state.seats.flatMap((s) => s.hand),
    ...state.submissions.flatMap((s) => s.cards),
  ];
}

describe('cards against humanity — the deal', () => {
  it('deals ten to everyone and puts a prompt up', () => {
    const state = fresh();
    expect(state.phase).toBe('PICKING');
    expect(state.round).toBe(1);
    expect(state.seats.map((s) => s.hand.length)).toEqual([10, 10, 10, 10]);
    expect(BLACK[state.black]).toBeDefined();
    expect(state.seats.every((s) => s.wins === 0)).toBe(true);
  });

  it('is fully determined by its seed', () => {
    expect(fresh(7)).toEqual(fresh(7));
    expect(fresh(7)).not.toEqual(fresh(8));
  });

  it('never puts one card in two places', () => {
    let state = fresh(3);
    for (let i = 0; i < 6; i++) {
      state = playRound(state);
      const cards = allWhites(state);
      expect(new Set(cards).size).toBe(cards.length);
      expect(cards).toHaveLength(WHITE.length);
      state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    }
  });

  it('refills every hand back to ten', () => {
    let state = fresh(5);
    state = playRound(state);

    // Mid-round the players who laid cards down are short, on purpose.
    expect(seat(state, others(state)[0]!).hand.length).toBeLessThan(HAND_SIZE);

    state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    expect(state.seats.map((s) => s.hand.length)).toEqual([10, 10, 10, 10]);
  });

  it('reshuffles the discard when the pile runs dry', () => {
    // 500 cards cannot actually run out at this table, so the path is forced.
    const start = fresh(11);
    const thin: CahState = { ...start, whitePile: [], whiteDiscard: [...start.whitePile] };

    const state = apply(playRound(thin), 'ann', { t: 'NEXT_ROUND' });
    expect(state.seats.map((s) => s.hand.length)).toEqual([10, 10, 10, 10]);
    expect(state.whitePile.length).toBeGreaterThan(0);
  });
});

describe('cards against humanity — the round loop', () => {
  it('flips to reading on its own once the last card is in', () => {
    let state = fresh();
    const [first, ...rest] = others(state);
    const pick = BLACK[state.black]!.pick;

    state = apply(state, first!, { t: 'PLAY', cards: seat(state, first!).hand.slice(0, pick) });
    expect(state.phase).toBe('PICKING');

    for (const id of rest) {
      state = apply(state, id, { t: 'PLAY', cards: seat(state, id).hand.slice(0, pick) });
    }

    // Nobody pressed anything — the table finishing is the trigger.
    expect(state.phase).toBe('READING');
    expect(state.order).toHaveLength(3);
  });

  it('scores the play the Czar picks and rotates the Czar', () => {
    let state = fresh(2);
    const wasCzar = state.czar;

    state = everyonePlays(state);
    const winner = state.submissions[state.order[1]!]!.by;

    state = apply(state, czarId(state), { t: 'JUDGE', pick: 1 });
    expect(state.phase).toBe('SCORED');
    expect(state.winner).toBe(winner);
    expect(seat(state, winner).wins).toBe(1);

    state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    expect(state.phase).toBe('PICKING');
    expect(state.round).toBe(2);
    expect(state.czar).toBe((wasCzar + 1) % PLAYERS.length);
    expect(state.submissions).toEqual([]);
  });

  it('gives every seat the chair', () => {
    let state = fresh(6);
    const chairs = new Set<string>();

    for (let i = 0; i < PLAYERS.length; i++) {
      chairs.add(czarId(state));
      state = apply(playRound(state), 'ann', { t: 'NEXT_ROUND' });
    }

    expect(chairs.size).toBe(PLAYERS.length);
  });

  it('deals a new prompt each round', () => {
    let state = fresh(8);
    const seen = [state.black];

    for (let i = 0; i < 5; i++) {
      state = apply(playRound(state), 'ann', { t: 'NEXT_ROUND' });
      seen.push(state.black);
    }

    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe('cards against humanity — what the reducer refuses', () => {
  it('will not let the Czar play a card', () => {
    const state = fresh();
    const czar = czarId(state);
    expect(cah.validate(state, czar, { t: 'PLAY', cards: seat(state, czar).hand.slice(0, 1) })).toMatch(
      /you don’t play/,
    );
    expect(cah.validate(state, czar, { t: 'FORCE_READ' })).toMatch(/at least two/);
  });

  it('will not let anyone play twice', () => {
    let state = fresh();
    const [who] = others(state);
    const pick = BLACK[state.black]!.pick;

    state = apply(state, who!, { t: 'PLAY', cards: seat(state, who!).hand.slice(0, pick) });
    expect(cah.validate(state, who!, { t: 'PLAY', cards: [WHITE.length - 1] })).toMatch(
      /already played/,
    );
  });

  it('will not let anyone play a card they do not hold', () => {
    const state = fresh();
    const who = others(state)[0]!;
    const hand = seat(state, who).hand;
    const notMine = [...Array(WHITE.length).keys()].find((c) => !hand.includes(c))!;

    // Padded to the prompt's arity, so this trips the ownership check and not
    // the count check ahead of it.
    const cards = [notMine, ...hand.slice(0, BLACK[state.black]!.pick - 1)];
    expect(cah.validate(state, who, { t: 'PLAY', cards })).toMatch(/isn’t in your hand/);
  });

  it('insists on the right number of cards', () => {
    // Find a table whose opening prompt takes two, so both branches are real.
    let state = fresh(1);
    for (let i = 0; i < 60 && BLACK[state.black]!.pick === 1; i++) state = fresh(i + 2);
    expect(BLACK[state.black]!.pick).toBeGreaterThan(1);

    const who = others(state)[0]!;
    expect(cah.validate(state, who, { t: 'PLAY', cards: seat(state, who).hand.slice(0, 1) })).toMatch(
      /takes 2 cards/,
    );
  });

  it('will not let the same card fill two gaps', () => {
    let state = fresh(1);
    for (let i = 0; i < 60 && BLACK[state.black]!.pick === 1; i++) state = fresh(i + 2);

    const who = others(state)[0]!;
    const card = seat(state, who).hand[0]!;
    expect(cah.validate(state, who, { t: 'PLAY', cards: [card, card] })).toMatch(/only play a card once/);
  });

  it('lets only the Czar judge', () => {
    const state = everyonePlays(fresh());
    const notCzar = others(state)[0]!;
    expect(cah.validate(state, notCzar, { t: 'JUDGE', pick: 0 })).toMatch(/Only the Czar/);
    expect(cah.validate(state, czarId(state), { t: 'JUDGE', pick: 9 })).toMatch(/No such answer/);
  });

  it('holds the reading open until two cards are in', () => {
    let state = fresh();
    const czar = czarId(state);
    expect(cah.validate(state, czar, { t: 'FORCE_READ' })).toMatch(/at least two/);

    const [a, b] = others(state);
    const pick = BLACK[state.black]!.pick;
    state = apply(state, a!, { t: 'PLAY', cards: seat(state, a!).hand.slice(0, pick) });
    state = apply(state, b!, { t: 'PLAY', cards: seat(state, b!).hand.slice(0, pick) });

    // A phone that went to sleep must not be able to stall the party.
    state = apply(state, czar, { t: 'FORCE_READ' });
    expect(state.phase).toBe('READING');
    expect(state.order).toHaveLength(2);
  });

  it('refuses actions from someone who is not in the game', () => {
    expect(cah.validate(fresh(), 'stranger', { t: 'NEXT_ROUND' })).toMatch(/not in this game/);
  });
});

describe('cards against humanity — the win', () => {
  it('keeps the winning card on screen after the round that settles it', () => {
    /*
     * The bug this pins: `result` used to key straight off the score, so the
     * shell flipped the whole match to RESULTS on the winning JUDGE and took
     * the SCORED screen — the one showing the card that won — with it. Nobody
     * ever saw what did it.
     */
    let state = fresh(4, { points: 1 });
    state = everyonePlays(state);
    state = apply(state, czarId(state), { t: 'JUDGE', pick: 0 });

    expect(state.phase).toBe('SCORED');
    expect(cah.view(state, 'ann').lastRound).toBe(true);
    expect(cah.view(state, 'ann').winner).not.toBeNull();
    // Still running, so the surface stays up and the card stays readable.
    expect(cah.result(state)).toBeNull();

    state = apply(state, 'ann', { t: 'FINISH' });
    expect(cah.result(state)).not.toBeNull();
  });

  it('can be stopped early from any seat, in a game nobody has won', () => {
    let state = fresh(4, { points: 5 });
    state = everyonePlays(state);
    state = apply(state, czarId(state), { t: 'JUDGE', pick: 0 });

    expect(cah.view(state, 'bo').lastRound).toBe(false);
    expect(cah.result(state)).toBeNull();

    // Not the Czar, not the round's winner — a party game that can only be
    // ended by one particular person is a party game that does not end.
    state = apply(state, 'di', { t: 'FINISH' });

    const result = cah.result(state)!;
    expect(result.placements).toHaveLength(4);
  });

  it('refuses to finish in the middle of a round', () => {
    const state = fresh(4);
    expect(cah.validate(state, 'ann', { t: 'FINISH' })).toBe('Finish the round first.');
  });

  it('has no result until somebody gets there', () => {
    let state = fresh(4, { points: 3 });
    expect(cah.result(state)).toBeNull();

    // Always hand it to whoever sits at position 0 of the shuffle.
    for (let i = 0; i < 2; i++) {
      state = apply(playRound(state), 'ann', { t: 'NEXT_ROUND' });
      expect(cah.result(state)).toBeNull();
    }
  });

  it('ranks by black cards and scores like the rest of the app', () => {
    let state = fresh(4, { points: 2 });

    // Give Ann the round whenever she is in it — on the rounds she is Czar she
    // has nothing in the pile, so somebody else takes that one.
    for (let i = 0; i < 8 && !cah.result(state); i++) {
      state = everyonePlays(state);
      const hers = state.order.findIndex((o) => state.submissions[o]!.by === 'ann');
      state = apply(state, czarId(state), { t: 'JUDGE', pick: hers >= 0 ? hers : 0 });
      // Reaching the target does not end the game by itself — the table still
      // has to leave the round, which is what keeps the winning card on screen.
      const settled = cah.view(state, 'ann').lastRound;
      state = apply(state, 'ann', settled ? { t: 'FINISH' } : { t: 'NEXT_ROUND' });
    }

    const result = cah.result(state)!;
    expect(seat(state, 'ann').wins).toBe(2);
    expect(result.placements[0]).toBe('ann');
    // Points are how many players you finished above — the same currency the
    // cross-game scoreboard gets from liar's dice.
    expect(result.points['ann']).toBe(3);
    expect(Object.values(result.points).sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('cards against humanity — how the game ends', () => {
  /** Rounds until `lastRound`, capped so a broken condition fails rather than hangs. */
  function runUntilSettled(state: CahState, cap = 30): CahState {
    for (let i = 0; i < cap && !cah.view(state, 'ann').lastRound; i++) {
      state = playRound(state);
      if (cah.view(state, 'ann').lastRound) break;
      state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    }
    return state;
  }

  it('plays to a score when that is what was chosen', () => {
    const state = runUntilSettled(fresh(4, { until: 'points', points: 3 }));
    expect(Math.max(...state.seats.map((s) => s.wins))).toBe(3);
  });

  it('plays a fixed number of rounds, and not one either side', () => {
    let state = fresh(4, { until: 'rounds', rounds: 4 });

    for (let round = 1; round <= 3; round++) {
      state = playRound(state);
      expect(cah.view(state, 'ann').lastRound, `after round ${round}`).toBe(false);
      state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    }

    state = playRound(state);
    expect(state.round).toBe(4);
    expect(cah.view(state, 'ann').lastRound).toBe(true);
  });

  it('ignores the score in a fixed-length game', () => {
    // Somebody running away with it does not cut the evening short.
    let state = fresh(4, { until: 'rounds', rounds: 6 });
    for (let i = 0; i < 4; i++) {
      state = everyonePlays(state);
      const hers = state.order.findIndex((o) => state.submissions[o]!.by === 'ann');
      state = apply(state, czarId(state), { t: 'JUDGE', pick: hers >= 0 ? hers : 0 });
      state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    }
    expect(seat(state, 'ann').wins).toBeGreaterThanOrEqual(3);
    expect(cah.view(state, 'ann').lastRound).toBe(false);
  });

  it('never ends on its own when the deck is the finish line', () => {
    // 500 whites at this table is ~112 rounds, so "endless" is exactly that in
    // any real evening. The only way out is somebody calling it.
    let state = fresh(4, { until: 'empty' });
    for (let i = 0; i < 12; i++) {
      state = apply(playRound(state), 'ann', { t: 'NEXT_ROUND' });
    }
    expect(cah.view(state, 'ann').lastRound).toBe(false);
    expect(cah.result(state)).toBeNull();

    state = apply(playRound(state), 'cy', { t: 'FINISH' });
    expect(cah.result(state)).not.toBeNull();
  });

  it('spends the white pile for good when playing to exhaustion', () => {
    // Forced, because the real path is a hundred rounds long. The discard is
    // stocked and the pile is nearly out: recycling would refill every hand.
    const start = fresh(11, { until: 'empty' });
    const thin: CahState = {
      ...start,
      whitePile: start.whitePile.slice(0, 2),
      whiteDiscard: start.whitePile.slice(2),
    };

    const state = apply(playRound(thin), 'ann', { t: 'NEXT_ROUND' });

    expect(state.whitePile).toHaveLength(0);
    expect(state.whiteDiscard.length).toBeGreaterThan(0);
    expect(state.seats.some((s) => s.hand.length < HAND_SIZE)).toBe(true);
    expect(cah.view(state, 'ann').lastRound).toBe(true);
  });

  it('still recycles the black pile when the whites are the finish line', () => {
    // A hundred prompts cannot outlast five hundred answers, so the game would
    // deal `undefined` for a prompt long before the whites ran out.
    const start = fresh(11, { until: 'empty' });
    const thin: CahState = { ...start, blackPile: [], blackDiscard: [...start.blackPile] };

    const state = apply(playRound(thin), 'ann', { t: 'NEXT_ROUND' });
    expect(state.black).toBeDefined();
    expect(BLACK[state.black]).toBeDefined();
  });

  it('does not wait on a seat with nothing left to play', () => {
    // Only reachable in the exhaustion ending. A seat holding no cards can
    // never submit, and counting it would hang the round for everyone else.
    const start = fresh(12, { until: 'empty' });
    const [broke] = others(start);
    const stripped: CahState = {
      ...start,
      whitePile: [],
      seats: start.seats.map((s) => (s.id === broke ? { ...s, hand: [] } : s)),
    };

    let state = stripped;
    for (const id of others(state).filter((id) => id !== broke)) {
      state = apply(state, id, { t: 'PLAY', cards: seat(state, id).hand.slice(0, 1) });
    }

    // Everyone who could play has, so the Czar's screen fills anyway.
    expect(state.phase).toBe('READING');
  });

  it('tells the surface which ending is in play, and only that one', () => {
    expect(cah.view(fresh(1, { until: 'points', points: 7 }), 'ann').ending).toEqual({
      until: 'points',
      points: 7,
    });
    expect(cah.view(fresh(1, { until: 'rounds', rounds: 12 }), 'ann').ending).toEqual({
      until: 'rounds',
      rounds: 12,
    });
    expect(cah.view(fresh(1, { until: 'empty' }), 'ann').ending).toEqual({ until: 'empty' });
  });
});

/*
 * Invariant 3, walked over every deck rather than over the one that happened to
 * be hard-coded. A second deck is a second set of card text, and this walk
 * identifies a leak *by* card text — so it has to be re-run, not assumed.
 */
describe.each(['main', 'family'] as const)(
  'cards against humanity — secrecy (%s deck)',
  (deck) => {
    const { black: BLACK_, white: WHITE_ } = deckOf({ deck });
  /**
   * The invariant this game exists to test: a hand of ten is the largest secret
   * in the app, and the Czar has to be able to judge without being told whose
   * joke is whose.
   */
  function assertNoForeignCards(state: CahState, viewer: string) {
    const view = cah.view(state, viewer);
    const mine = seat(state, viewer).hand;

    expect(view.myHand.map((c) => c.id)).toEqual(mine);

    const json = JSON.stringify(view);
    const isCzar = czarId(state) === viewer;

    for (const other of state.seats) {
      if (other.id === viewer) continue;

      // No other player's hand text reaches this device, ever. Card texts are
      // unique across the deck, so finding one is proof of a leak.
      for (const card of other.hand) {
        expect(json, `${other.id}'s hand leaked to ${viewer}`).not.toContain(
          JSON.stringify(WHITE_[card]!),
        );
      }
    }

    // Submissions are the Czar's alone, and only while they are reading.
    if (isCzar && state.phase === 'READING') {
      expect(view.submissions).toHaveLength(state.submissions.length);
    } else {
      expect(view.submissions).toBeNull();
    }

    /*
     * Whatever the Czar can see, it never says who wrote it.
     *
     * Checked structurally rather than by searching the JSON for "by": an entry
     * is a bare array of card text, so it has no key to hang an author on. The
     * substring version of this both missed an author field under any other
     * name and tripped over the Family Edition's "A hot air balloon powered by
     * fart gas."
     */
    for (const entry of view.submissions ?? []) {
      expect(Array.isArray(entry)).toBe(true);
      expect(entry.every((card) => typeof card === 'string')).toBe(true);
    }

    // The piles are the next round's secrets and are projected to nobody.
    for (const upcoming of state.whitePile.slice(0, 20)) {
      const held = state.seats.some((s) => s.id === viewer && s.hand.includes(upcoming));
      if (!held) expect(json).not.toContain(JSON.stringify(WHITE_[upcoming]!));
    }

    for (const entry of view.roster) {
      expect(entry).not.toHaveProperty('hand');
      expect(typeof entry.wins).toBe('number');
      expect(typeof entry.submitted).toBe('boolean');
    }
  }

  /** Walks a whole game, so every phase and both Czar roles are covered. */
  function reachableStates(): CahState[] {
    const states: CahState[] = [];
    let state = fresh(4, { deck, points: 3 });
    states.push(state);

    for (let round = 0; round < 10; round++) {
      for (const id of others(state)) {
        state = apply(state, id, {
          t: 'PLAY',
          cards: seat(state, id).hand.slice(0, BLACK_[state.black]!.pick),
        });
        states.push(state);
      }

      state = apply(state, czarId(state), { t: 'JUDGE', pick: 0 });
      states.push(state);

      if (cah.result(state)) break;
      state = apply(state, 'ann', { t: 'NEXT_ROUND' });
      states.push(state);
    }

    return states;
  }

  it('never shows one player another player’s cards, in any reachable state', () => {
    const states = reachableStates();
    expect(states.length).toBeGreaterThan(15);

    for (const state of states) {
      for (const s of state.seats) assertNoForeignCards(state, s.id);
    }
  });

  it('hides the submissions while people are still picking', () => {
    // The moment of maximum temptation: cards are down, the round is not shut,
    // and the Czar's screen would love to start showing them.
    let state = fresh(1, { deck });
    const [a] = others(state);
    state = apply(state, a!, {
      t: 'PLAY',
      cards: seat(state, a!).hand.slice(0, BLACK_[state.black]!.pick),
    });

    const czarView = cah.view(state, czarId(state));
    expect(czarView.submissions).toBeNull();
    expect(czarView.submittedCount).toBe(1);
    expect(czarView.waitingCount).toBe(2);

    for (const card of seat(state, a!).hand) {
      expect(JSON.stringify(czarView)).not.toContain(JSON.stringify(WHITE_[card]!));
    }
  });

  it('reveals only the winning play, and only once it has been read out', () => {
    let state = everyonePlays(fresh(9, { deck }));
    const czarView = cah.view(state, czarId(state));
    expect(czarView.submissions).toHaveLength(3);

    state = apply(state, czarId(state), { t: 'JUDGE', pick: 0 });

    // Everyone sees who took it and with what. The plays that lost stay lost.
    const annsView = cah.view(state, 'ann');
    expect(annsView.winner).not.toBeNull();
    expect(annsView.submissions).toBeNull();

    const losers = state.submissions.filter((s) => s.by !== state.winner);
    for (const loser of losers) {
      for (const card of loser.cards) {
        if (seat(state, 'ann').hand.includes(card)) continue;
        if (state.submissions.find((s) => s.by === 'ann')?.cards.includes(card)) continue;
        expect(JSON.stringify(annsView)).not.toContain(JSON.stringify(WHITE_[card]!));
      }
    }
  });

  it('shows a spectator no hand at all', () => {
    const view = cah.view(fresh(1, { deck }), 'stranger');
    expect(view.myHand).toEqual([]);
    expect(view.mySubmission).toBeNull();
    expect(view.submissions).toBeNull();
  });
  },
);
