import { describe, expect, it, vi } from 'vitest';
import { MemoryNetwork } from '../net/memory-transport.ts';
import { MatchHost } from '../match/host.ts';
import type { AnyGame, GameOption, Placement } from './types.ts';

vi.mock('../match/snapshot.ts', () => ({
  saveSnapshot: vi.fn(async () => {}),
  loadSnapshot: vi.fn(async () => null),
  clearSnapshot: vi.fn(async () => {}),
}));

/*
 * The config seam, on its own.
 *
 * `C` was in `GameDefinition` from the start and nothing ever supplied one, so
 * these are the first tests that a host's choice actually reaches `init` — and
 * that leaving it out still hands over the default, which every existing caller
 * relies on.
 */

type Config = { deck: 'main' | 'family'; points: number };

const OPTIONS: GameOption<Config>[] = [
  {
    kind: 'one',
    key: 'deck',
    label: 'Deck',
    choices: [
      { value: 'main', label: 'Standard' },
      { value: 'family', label: 'Family Edition' },
    ],
  },
  {
    kind: 'one',
    key: 'points',
    label: 'First to',
    choices: [
      { value: 3, label: '3' },
      { value: 5, label: '5' },
    ],
  },
];

/** Records the config it was handed and does nothing else. */
function spyGame(): AnyGame {
  return {
    id: 'spy',
    name: 'Spy',
    blurb: '',
    minPlayers: 1,
    maxPlayers: 8,
    hue: '#fff',
    defaultConfig: { deck: 'main', points: 5 } satisfies Config,
    options: OPTIONS,
    summary: (config: Config) => `${config.deck} · first to ${config.points}`,
    init: (_players, config) => ({ config }),
    validate: () => null,
    reduce: (state) => state,
    view: (state) => state,
    result: (): Placement | null => null,
    Component: null as never,
  };
}

function host() {
  const net = new MemoryNetwork('host');
  return new MatchHost(net.connect('host', 'Host'), 'host', 'Host');
}

describe('a config chosen before the game starts', () => {
  it('reaches init', () => {
    const match = host();
    match.start(spyGame(), { deck: 'family', points: 3 });

    expect(match.clientState().view).toEqual({ config: { deck: 'family', points: 3 } });
  });

  it('falls back to the default when the caller does not pass one', () => {
    const match = host();
    match.start(spyGame());

    expect(match.clientState().view).toEqual({ config: { deck: 'main', points: 5 } });
  });

  it('is not on the wire, and not in what a player is sent', () => {
    // The host's choice is an argument to `init` and nothing else. Anything a
    // player needs to know has to be copied into game state by the game itself,
    // which is also what makes a resumed snapshot self-contained.
    const match = host();
    match.start(spyGame(), { deck: 'family', points: 3 });

    expect(match.clientState()).not.toHaveProperty('config');
  });

  it('does not survive a return to the lobby on its own', () => {
    // The shell holds the setup above the lobby, so `start` is always given it
    // again. MatchHost deliberately remembers nothing.
    const match = host();
    const game = spyGame();

    match.start(game, { deck: 'family', points: 3 });
    match.toLobby();
    match.start(game);

    expect(match.clientState().view).toEqual({ config: { deck: 'main', points: 5 } });
  });
});

describe('the option declaration', () => {
  it('names a key the config actually has', () => {
    const game = spyGame();
    for (const option of game.options ?? []) {
      expect(Object.keys(game.defaultConfig)).toContain(option.key);
    }
  });

  it('offers the default as one of the choices', () => {
    // A default that is not on the list renders as nothing selected, which
    // reads as a control the host has yet to answer.
    const game = spyGame();
    const config = game.defaultConfig as Record<string, unknown>;

    for (const option of game.options ?? []) {
      expect(option.choices.map((c) => c.value)).toContain(config[option.key]);
    }
  });
});
