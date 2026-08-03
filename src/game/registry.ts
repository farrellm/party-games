import { liarsDice } from './liars-dice/index.ts';
import type { AnyGame } from './types.ts';

/**
 * Every game the app knows about.
 *
 * The shell reads nothing from a game but this list and the GameDefinition
 * interface, so adding a second one is adding a file and a line here.
 */
export const GAMES: AnyGame[] = [liarsDice];

export function findGame(id: string | null): AnyGame | null {
  return GAMES.find((g) => g.id === id) ?? null;
}
