import { BLACK, WHITE } from './deck.ts';
import { BLACK as FAMILY_BLACK, WHITE as FAMILY_WHITE } from './family.ts';
import type { Deck, DeckId } from './cards.ts';

/*
 * Which cards are in play. The only file that knows every deck exists.
 */

export const DECKS: Record<DeckId, Deck> = {
  main: { id: 'main', name: 'Cards Against Humanity', black: BLACK, white: WHITE },
  family: {
    id: 'family',
    name: 'Cards Against Humanity: Family Edition',
    black: FAMILY_BLACK,
    white: FAMILY_WHITE,
  },
};

/**
 * Takes a spec rather than an id so `init` can ask with a config and `view` can
 * ask with a state, and neither has to unpack the other's shape. When a deck
 * grows parts that are chosen separately, they join the spec and no call site
 * here changes.
 */
export function deckOf(spec: { deck: DeckId }): Deck {
  return DECKS[spec.deck];
}
