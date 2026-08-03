import { describe, expect, it } from 'vitest';
import { liarsDice } from './index.ts';
import { makeRng } from '../rng.ts';
import type { LiarsDiceAction, LiarsDiceState } from './state.ts';

const PLAYERS = [
  { id: 'ann', name: 'Ann' },
  { id: 'bo', name: 'Bo' },
  { id: 'cy', name: 'Cy' },
];

function fresh(seed = 1): LiarsDiceState {
  return liarsDice.init(PLAYERS, liarsDice.defaultConfig, makeRng({ seed, calls: 0 }));
}

/** Applies an action the way MatchHost does: validate, then reduce. */
function apply(state: LiarsDiceState, actor: string, action: LiarsDiceAction): LiarsDiceState {
  const reason = liarsDice.validate(state, actor, action);
  if (reason !== null) throw new Error(`rejected: ${reason}`);
  return liarsDice.reduce(state, actor, action, makeRng({ seed: 99, calls: state.round }));
}

function diceOf(state: LiarsDiceState, id: string): number {
  return state.seats.find((s) => s.id === id)!.dice.length;
}

describe("liar's dice — setup", () => {
  it('deals five dice to everyone and starts rolling', () => {
    const state = fresh();
    expect(state.phase).toBe('ROLLING');
    expect(state.round).toBe(1);
    expect(state.seats.map((s) => s.dice.length)).toEqual([5, 5, 5]);
    expect(state.seats.every((s) => s.dice.every((d) => d >= 1 && d <= 6))).toBe(true);
  });

  it('is fully determined by its seed', () => {
    expect(fresh(7)).toEqual(fresh(7));
    expect(fresh(7)).not.toEqual(fresh(8));
  });
});

describe("liar's dice — the round loop", () => {
  it('runs call, pick, reroll', () => {
    let state = fresh();

    state = apply(state, 'bo', { t: 'CALL_LIAR' });
    expect(state.phase).toBe('CALLED');
    expect(state.caller).toBe('bo');

    state = apply(state, 'bo', { t: 'PICK_LOSER', loser: 'cy' });
    expect(state.phase).toBe('RESOLVED');
    expect(state.lastLoser).toBe('cy');
    expect(diceOf(state, 'cy')).toBe(4);
    expect(diceOf(state, 'ann')).toBe(5);

    state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    expect(state.phase).toBe('ROLLING');
    expect(state.round).toBe(2);
    // Everyone rerolls, and the counts carry over from the last round.
    expect(state.seats.map((s) => s.dice.length)).toEqual([5, 5, 4]);
  });

  it('rerolls the faces each round', () => {
    let state = fresh();
    const before = state.seats.map((s) => [...s.dice]);

    state = apply(state, 'bo', { t: 'CALL_LIAR' });
    state = apply(state, 'bo', { t: 'PICK_LOSER', loser: 'bo' });
    state = apply(state, 'ann', { t: 'NEXT_ROUND' });

    expect(state.seats.map((s) => s.dice)).not.toEqual(before);
  });
});

describe("liar's dice — the two rules the software owns", () => {
  it('gives the first of two simultaneous calls the round', () => {
    // There is no turn to wait for, so presses genuinely race. The host takes
    // the first and the second must be a no-op, not a takeover.
    let state = fresh();
    state = apply(state, 'bo', { t: 'CALL_LIAR' });

    expect(liarsDice.validate(state, 'ann', { t: 'CALL_LIAR' })).toMatch(/already called/);
    expect(state.caller).toBe('bo');
  });

  it('lets only the caller pick the loser', () => {
    let state = fresh();
    state = apply(state, 'bo', { t: 'CALL_LIAR' });

    expect(liarsDice.validate(state, 'ann', { t: 'PICK_LOSER', loser: 'cy' })).toMatch(
      /Only the caller/,
    );
  });

  it('lets the caller pick themselves', () => {
    // The normal outcome of a bad call. The picker must not exclude them.
    let state = fresh();
    state = apply(state, 'bo', { t: 'CALL_LIAR' });
    state = apply(state, 'bo', { t: 'PICK_LOSER', loser: 'bo' });

    expect(diceOf(state, 'bo')).toBe(4);
  });

  it('refuses a call outside ROLLING', () => {
    const state = fresh();
    expect(liarsDice.validate(state, 'ann', { t: 'PICK_LOSER', loser: 'bo' })).toMatch(
      /Nobody has called/,
    );
  });

  it('refuses actions from someone who is not in the game', () => {
    expect(liarsDice.validate(fresh(), 'stranger', { t: 'CALL_LIAR' })).toMatch(/not in this game/);
  });
});

describe("liar's dice — elimination and the win", () => {
  /** Knocks a player down to zero dice, one round at a time. */
  function grind(state: LiarsDiceState, loser: string, times: number): LiarsDiceState {
    for (let i = 0; i < times; i++) {
      state = apply(state, 'ann', { t: 'CALL_LIAR' });
      state = apply(state, 'ann', { t: 'PICK_LOSER', loser });
      if (liarsDice.result(state)) break;
      state = apply(state, 'ann', { t: 'NEXT_ROUND' });
    }
    return state;
  }

  it('marks a player out at zero dice but keeps them in the roster', () => {
    const state = grind(fresh(), 'cy', 5);

    const cy = state.seats.find((s) => s.id === 'cy')!;
    expect(cy.out).toBe(true);
    expect(cy.dice).toEqual([]);
    expect(state.seats).toHaveLength(3);
    expect(liarsDice.view(state, 'ann').roster.map((p) => p.id)).toContain('cy');
  });

  it('refuses to take a die from someone who has none', () => {
    let state = grind(fresh(), 'cy', 5);
    state = apply(state, 'ann', { t: 'CALL_LIAR' });

    expect(liarsDice.validate(state, 'ann', { t: 'PICK_LOSER', loser: 'cy' })).toMatch(
      /no dice left/,
    );
  });

  it('will not let an eliminated player call', () => {
    const state = grind(fresh(), 'cy', 5);
    expect(state.phase).toBe('ROLLING');
    expect(liarsDice.validate(state, 'cy', { t: 'CALL_LIAR' })).toMatch(/out of dice/);
  });

  it('has no result until one player is left', () => {
    expect(liarsDice.result(fresh())).toBeNull();
    expect(liarsDice.result(grind(fresh(), 'cy', 5))).toBeNull();
  });

  it('ranks the survivor first and the rest by when they went out', () => {
    let state = grind(fresh(), 'cy', 5);
    state = grind(state, 'bo', 5);

    const result = liarsDice.result(state)!;
    expect(result.placements).toEqual(['ann', 'bo', 'cy']);
    // Points are how many players you outlasted, which carries across games.
    expect(result.points).toEqual({ ann: 2, bo: 1, cy: 0 });
  });
});

describe("liar's dice — secrecy", () => {
  /**
   * The invariant whose violation would be invisible in normal play: the app
   * never sends anyone another player's faces. Not on a call, not on a reveal —
   * the reveal is physical, people hold their phones up.
   */
  function assertNoForeignFaces(state: LiarsDiceState, viewer: string) {
    const view = liarsDice.view(state, viewer);
    const mine = state.seats.find((s) => s.id === viewer)?.dice ?? [];

    expect(view.myDice).toEqual(mine);

    // Search the whole serialized projection, not just the fields we expect
    // faces in — a leak added later would most likely arrive somewhere new.
    const json = JSON.stringify(view);
    const withoutMine = JSON.stringify({ ...view, myDice: [] });

    for (const seat of state.seats) {
      if (seat.id === viewer || seat.dice.length === 0) continue;

      // Any other seat's exact face array must appear nowhere.
      expect(withoutMine).not.toContain(JSON.stringify(seat.dice));
    }

    // And the projection must carry counts, never arrays, for everyone else.
    for (const entry of view.roster) {
      expect(entry).not.toHaveProperty('dice');
      expect(typeof entry.diceCount).toBe('number');
    }

    expect(json.length).toBeGreaterThan(0);
  }

  /** Walks the game through every phase, including elimination. */
  function reachableStates(): LiarsDiceState[] {
    const states: LiarsDiceState[] = [];
    let state = fresh(4);
    states.push(state);

    for (let round = 0; round < 12; round++) {
      state = apply(state, 'bo', { t: 'CALL_LIAR' });
      states.push(state);

      const target = state.seats.find((s) => !s.out)!.id;
      state = apply(state, 'bo', { t: 'PICK_LOSER', loser: target });
      states.push(state);

      if (liarsDice.result(state)) break;
      state = apply(state, 'bo', { t: 'NEXT_ROUND' });
      states.push(state);
    }

    return states;
  }

  it('never shows one player another player’s faces, in any reachable state', () => {
    const states = reachableStates();
    expect(states.length).toBeGreaterThan(10);

    for (const state of states) {
      for (const seat of state.seats) assertNoForeignFaces(state, seat.id);
    }
  });

  it('still hides faces during a call, when the temptation to reveal is highest', () => {
    let state = fresh();
    state = apply(state, 'bo', { t: 'CALL_LIAR' });

    const annsView = liarsDice.view(state, 'ann');
    expect(annsView.phase).toBe('CALLED');
    expect(annsView.myDice).toEqual(state.seats.find((s) => s.id === 'ann')!.dice);

    // Bo called, and Bo's own faces still do not reach Ann.
    const bosDice = state.seats.find((s) => s.id === 'bo')!.dice;
    expect(JSON.stringify(annsView)).not.toContain(JSON.stringify(bosDice));
  });

  it('shows a spectator nothing at all', () => {
    const view = liarsDice.view(fresh(), 'stranger');
    expect(view.myDice).toEqual([]);
    expect(view.amOut).toBe(true);
  });
});
